import { Controller, Get, Delete, Param, Req, UseGuards, HttpException } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { SupabaseAuthGuard } from '../auth/supabase.guard';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) { }

  // Only allow authenticated users
  @UseGuards(SupabaseAuthGuard)
  @Get('events')
  async getEvents(@Req() req) {
    const user = req.user;
    return this.calendarService.fetchCalendarEvents(user);
  }

  // Delete a calendar event by Google event ID
  @UseGuards(SupabaseAuthGuard)
  @Delete('events/:eventId')
  async deleteEvent(@Req() req, @Param('eventId') eventId: string) {
    const user = req.user;
    if (!eventId) {
      throw new HttpException('Event ID is required', 400);
    }
    return this.calendarService.deleteEvent(user, eventId);
  }
}
