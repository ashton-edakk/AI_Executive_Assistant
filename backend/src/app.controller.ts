// app.controller.ts
import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { SupabaseAuthGuard } from './auth/supabase.guard';
import { AuthService } from './auth/auth.service';
import { EnsureUserDto } from './auth/dto/ensure-user.dto';

@Controller('api')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly authService: AuthService,
  ) { }

  // NOTE: /api/chat is now handled by ChatController in gemini/chat.controller.ts
  // Removed duplicate route that was causing conflicts with multi-task support

  @Post('auth/ensure-user')
  @UseGuards(SupabaseAuthGuard)
  async ensureUser(@Body() body: EnsureUserDto, @Req() req: any) {
    body.id = req.user.id;
    body.email = req.user.email;
    return this.authService.ensureUser(body);
  }

  @Get('status')
  getHello(): string {
    return this.appService.getHealthStatus();
  }

  @Post('task/parse')
  async parseTask(@Body('taskText') taskText: string, @Req() req: any) {
    const userId = req.user?.id || 'placeholder-user-id';
    const structuredTask = await this.appService.processTaskWithAI(taskText, userId);
    return structuredTask;
  }
}
