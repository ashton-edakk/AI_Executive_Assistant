import { HttpException, Injectable, Inject } from '@nestjs/common';
import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ADMIN } from '../db/supabase-admin.provider';
import { GoogleAuthService } from '../auth/google-auth.service';

// This is the shape of the "user" object that SupabaseAuthGuard
// attaches to req.user
type CalendarUser = {
  id: string;               // Supabase user id (we don't store it in calendar_events table)
  provider_token?: string;  // Optional Google access token from Supabase
};

type CreateCalendarEventInput = {
  start: string; // ISO-8601
  end: string;   // ISO-8601
  summary: string;
  description?: string;
  extendedPrivate?: Record<string, string>;
};

@Injectable()
export class CalendarService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly googleAuth: GoogleAuthService,
  ) { }

  /**
   * Get a valid Google access token for the given user.
   * Prefer the Supabase provider_token; fall back to refresh_token.
   */
  private async getAccessTokenForUser(user: CalendarUser): Promise<string> {
    if (user.provider_token) {
      return user.provider_token;
    }

    const accessFromRefresh =
      await this.googleAuth.getAccessTokenFromRefreshToken(user.id);
    if (!accessFromRefresh) {
      throw new HttpException(
        'Missing Google access token (no provider_token or refresh_token)',
        401,
      );
    }
    return accessFromRefresh;
  }

  /**
   * Fetch events from Google Calendar and mirror them into the
   * `calendar_events` table (no per-user column in this schema).
   */
  async fetchCalendarEvents(user: CalendarUser) {
    const token = await this.getAccessTokenForUser(user);

    const timeMin = new Date().toISOString();
    const url =
      'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
      '?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=' +
      encodeURIComponent(timeMin);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      let msg = 'Failed to fetch events';
      try {
        const errData = await res.json();
        msg = errData.error?.message || msg;
      } catch {
        // ignore JSON parse error, keep generic message
      }
      throw new HttpException(msg, res.status);
    }

    const data: any = await res.json();
    const items: any[] = data.items || [];

    // Mirror everything into calendar_events (single-user schema)
    await this.syncEventsToDatabase(items);

    return items;
  }

  /**
   * Create a Google Calendar event AND insert it into the
   * `calendar_events` table so it counts as busy time.
   */
  async createEvent(user: CalendarUser, input: CreateCalendarEventInput) {
    // DEV fake calendar switch (for local testing without Google)
    if (process.env.DEV_FAKE_CALENDAR === '1') {
      return { id: `DEV-${Math.random().toString(36).slice(2)}`, dev: true };
    }

    const token = await this.getAccessTokenForUser(user);

    const body = {
      summary: input.summary,
      description: input.description ?? '',
      start: { dateTime: input.start },
      end: { dateTime: input.end },
      extendedProperties: input.extendedPrivate
        ? { private: input.extendedPrivate }
        : undefined,
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 5 }],
      },
    };

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new HttpException(err || 'Failed to create event', res.status);
    }

    const event: any = await res.json();

    // Also store this event in Supabase so future free-time calls see it
    try {
      const startISO =
        event.start?.dateTime ??
        (event.start?.date ? `${event.start.date}T00:00:00.000Z` : null);
      const endISO =
        event.end?.dateTime ??
        (event.end?.date ? `${event.end.date}T23:59:59.000Z` : null);

      if (startISO && endISO && event.id) {
        const isAllDay =
          !!event.start?.date && !event.start?.dateTime ? true : false;

        await this.sb.from('calendar_events').insert({
          google_event_id: event.id as string,
          start_ts: startISO as string,
          end_ts: endISO as string,
          summary: (event.summary as string) ?? null,
          is_all_day: isAllDay,
        });
      }
    } catch (e) {
      // Don't kill the request if mirroring fails; just log.
      // eslint-disable-next-line no-console
      console.error('Failed to mirror created event into calendar_events', e);
    }

    return event;
  }

  /**
   * Delete a Google Calendar event by its event ID.
   */
  async deleteEvent(user: CalendarUser, googleEventId: string) {
    // DEV fake calendar switch (for local testing without Google)
    if (process.env.DEV_FAKE_CALENDAR === '1') {
      return { deleted: true, dev: true };
    }

    const token = await this.getAccessTokenForUser(user);

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    // 204 No Content = success, 404 = already deleted (treat as success)
    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new HttpException(err || 'Failed to delete event', res.status);
    }

    // Also remove from our local calendar_events table
    try {
      await this.sb.from('calendar_events').delete().eq('google_event_id', googleEventId);
    } catch (e) {
      console.error('Failed to remove event from calendar_events table', e);
    }

    return { deleted: true, googleEventId };
  }

  /**
   * Sync Google events into the `calendar_events` table.
   * Since the table has no user_id column, we:
   *   - clear existing rows
   *   - insert fresh ones
   */
  private async syncEventsToDatabase(items: any[]) {
    const rows = items
      .map((ev) => {
        const startISO =
          ev.start?.dateTime ??
          (ev.start?.date ? `${ev.start.date}T00:00:00.000Z` : null);
        const endISO =
          ev.end?.dateTime ??
          (ev.end?.date ? `${ev.end.date}T23:59:59.000Z` : null);

        if (!startISO || !endISO || !ev.id) return null;

        const isAllDay =
          !!ev.start?.date && !ev.start?.dateTime ? true : false;

        return {
          google_event_id: ev.id as string,
          start_ts: startISO as string,
          end_ts: endISO as string,
          summary: (ev.summary as string) ?? null,
          is_all_day: isAllDay,
        };
      })
      .filter((row) => row !== null) as {
        google_event_id: string;
        start_ts: string;
        end_ts: string;
        summary: string | null;
        is_all_day: boolean;
      }[];

    // Wipe existing rows (single-user schema)
    const { error: delError } = await this.sb
      .from('calendar_events')
      .delete()
      .neq('google_event_id', ''); // deletes all rows
    if (delError) {
      throw new HttpException(
        delError.message || 'Failed clearing existing calendar_events',
        500,
      );
    }

    if (!rows.length) {
      return;
    }

    const { error: insError } = await this.sb
      .from('calendar_events')
      .insert(rows);
    if (insError) {
      throw new HttpException(
        insError.message || 'Failed syncing calendar events to database',
        500,
      );
    }
  }
}
