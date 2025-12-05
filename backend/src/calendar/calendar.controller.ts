import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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
}
