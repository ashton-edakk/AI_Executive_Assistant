// app.controller.ts
import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { InsertMessageDto } from './gemini/dto/insert-message.dto';
import { GeminiService } from './gemini/gemini.service';
import { SupabaseAuthGuard } from './auth/supabase.guard';
import { AuthService } from './auth/auth.service';
import { EnsureUserDto } from './auth/dto/ensure-user.dto';
import { TasksService } from './tasks/tasks.service';
import { ReadyToCreateResponse, ChatResponse, MultiTaskResponse } from './gemini/types/chat-response.types';
import { CalendarService } from './calendar/calendar.service';

@Controller('api')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly geminiService: GeminiService,
    private readonly authService: AuthService,
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
  ) { }

  @Post('chat')
  @UseGuards(SupabaseAuthGuard)
  async handleChat(@Body() body: InsertMessageDto, @Req() req: any): Promise<any> {
    console.log(`Received chat request: "${body.message}" from user: ${req.user?.id}`);
    console.log('Received body:', body);
    console.log('Context:', body.context);
    console.log('Partial task:', body.partialTask);

    const response = await this.geminiService.generateResponse({
      ...body,
      userId: req.user?.id,
    });

    // If the model says we are ready to create a task, create both a DB task and a calendar event
    if (this.isReadyToCreateResponse(response) && req.user?.id) {
      try {
        const taskData = {
          title: response.parsed_task.title,
          user_id: req.user.id,
          notes: response.parsed_task.notes || `Created from chat: "${body.message}"`,
          due_date: response.parsed_task.due_date || null,
          priority: response.parsed_task.priority || 'med',
          est_minutes: response.parsed_task.est_minutes || null,
          status: 'todo' as const,
        };

        const createdTask = await this.tasksService.createTask(taskData);

        // Try to also create a Google Calendar event for this task
        let calendarNote = '';
        try {
          const now = new Date();
          const estMinutes =
            response.parsed_task.est_minutes ??
            taskData.est_minutes ??
            30;

          let startDate: Date;
          if (response.parsed_task.due_date) {
            // due_date expected in YYYY-MM-DD format
            startDate = new Date(`${response.parsed_task.due_date}T09:00:00`);
          } else {
            // otherwise, schedule it a few minutes from now
            startDate = new Date(now.getTime() + 5 * 60 * 1000);
          }
          const endDate = new Date(startDate.getTime() + estMinutes * 60 * 1000);

          await this.calendarService.createEvent(
            {
              id: req.user.id,
              // provider_token may or may not be present; CalendarService can fetch it if missing
              provider_token: (req.user as any).provider_token,
            },
            {
              start: startDate.toISOString(),
              end: endDate.toISOString(),
              summary: response.parsed_task.title,
              description: taskData.notes ?? '',
              extendedPrivate: {
                task_id: createdTask.id,
              },
            },
          );

          calendarNote = '\n\n📅 I also added this to your Google Calendar.';
        } catch (calendarError: any) {
          console.error(
            'Error creating Google Calendar event from task:',
            calendarError?.message || calendarError,
          );
          calendarNote =
            '\n\n⚠️ I created the task, but could not add it to Google Calendar.';
        }

        const prettyDue = response.parsed_task.due_date
          ? ` (due ${response.parsed_task.due_date})`
          : '';
        const prettyEst = response.parsed_task.est_minutes
          ? ` ⏱️ ${response.parsed_task.est_minutes}min`
          : '';

        return {
          ...response,
          task_created: true,
          task: createdTask,
          response: `✅ Task created: "${response.parsed_task.title}"${prettyDue}${prettyEst}${calendarNote}`,
        };
      } catch (error: any) {
        console.error('Error creating task:', error);
        return {
          ...response,
          response: `I understood your task but couldn't save it: ${error.message}`,
        };
      }
    }

    // If the model isn't ready to create a task yet, just return the normal chat response
    return response;
  }

  // Type guard to check if response is ReadyToCreateResponse (single task)
  private isReadyToCreateResponse(response: ChatResponse): response is ReadyToCreateResponse {
    return (response as ReadyToCreateResponse).ready_to_create === true && 
           !('is_multi_task' in response);
  }
  
  // Type guard to check if response is MultiTaskResponse
  private isMultiTaskResponse(response: ChatResponse): response is MultiTaskResponse {
    return (response as MultiTaskResponse).is_multi_task === true;
  }

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
