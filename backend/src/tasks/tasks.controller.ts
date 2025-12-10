// tasks/tasks.controller.ts
import { Controller, Delete, Param, Req, UseGuards, HttpException, Inject } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { SupabaseAuthGuard } from '../auth/supabase.guard';
import { SUPABASE_ADMIN } from '../db/supabase-admin.provider';
import { SupabaseClient } from '@supabase/supabase-js';

@Controller('tasks')
@UseGuards(SupabaseAuthGuard)
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Delete a task and all associated data:
   * - Google Calendar events
   * - task_blocks
   * - task_sessions
   * - the task itself
   */
  @Delete(':taskId')
  async deleteTask(@Req() req: any, @Param('taskId') taskId: string) {
    const user = req.user;
    
    if (!taskId) {
      throw new HttpException('Task ID is required', 400);
    }

    console.log(`[TasksController] Deleting task ${taskId} for user ${user.id}`);

    // Step 1: Get all Google Calendar event IDs from task_blocks
    const { data: blocks, error: blocksQueryError } = await this.supabase
      .from('task_blocks')
      .select('id, google_event_id')
      .eq('task_id', taskId);

    if (blocksQueryError) {
      console.error('[TasksController] Error querying task_blocks:', blocksQueryError);
    }

    // Step 2: Delete Google Calendar events
    const calendarDeleteResults: { eventId: string; success: boolean; error?: string }[] = [];
    
    if (blocks && blocks.length > 0) {
      for (const block of blocks) {
        if (block.google_event_id) {
          try {
            await this.calendarService.deleteEvent(
              {
                id: user.id,
                provider_token: user.provider_token,
              },
              block.google_event_id,
            );
            calendarDeleteResults.push({ eventId: block.google_event_id, success: true });
            console.log(`[TasksController] Deleted calendar event: ${block.google_event_id}`);
          } catch (calErr: any) {
            console.error(`[TasksController] Failed to delete calendar event ${block.google_event_id}:`, calErr);
            calendarDeleteResults.push({ 
              eventId: block.google_event_id, 
              success: false, 
              error: calErr.message 
            });
            // Continue anyway - event might already be deleted or user may have removed access
          }
        }
      }
    }

    // Step 3: Delete task_sessions
    const { error: sessionsError } = await this.supabase
      .from('task_sessions')
      .delete()
      .eq('task_id', taskId);

    if (sessionsError) {
      console.error('[TasksController] Error deleting task_sessions:', sessionsError);
      // Continue anyway
    }

    // Step 4: Delete task_blocks
    const { error: blocksDeleteError } = await this.supabase
      .from('task_blocks')
      .delete()
      .eq('task_id', taskId);

    if (blocksDeleteError) {
      console.error('[TasksController] Error deleting task_blocks:', blocksDeleteError);
      // Continue anyway
    }

    // Step 5: Delete the task itself
    try {
      await this.tasksService.deleteTask(taskId);
    } catch (taskErr: any) {
      console.error('[TasksController] Error deleting task:', taskErr);
      throw new HttpException(taskErr.message || 'Failed to delete task', 500);
    }

    console.log(`[TasksController] Successfully deleted task ${taskId}`);

    return {
      success: true,
      message: 'Task deleted successfully',
      calendarEventsDeleted: calendarDeleteResults.filter(r => r.success).length,
      calendarEventsFailed: calendarDeleteResults.filter(r => !r.success).length,
    };
  }
}

