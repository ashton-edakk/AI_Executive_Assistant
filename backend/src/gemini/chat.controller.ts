import { Body, Controller, Post, UseGuards, Req, HttpException } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { TasksService } from '../tasks/tasks.service';
import { SupabaseAuthGuard } from '../auth/supabase.guard';
import { PlannerService } from '../planning/services/planner.service';
import { DateTime } from 'luxon';

interface ChatRequest {
  message: string;
  context?: Array<{ role: string; content: string }>;
  clarification_state?: {
    active: boolean;
    partial_task: any;
    original_message: string;
  };
}

@Controller('api/chat')
@UseGuards(SupabaseAuthGuard)
export class ChatController {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly tasksService: TasksService,
    private readonly plannerService: PlannerService,
  ) {}

  @Post()
  async chat(@Req() req: any, @Body() body: ChatRequest) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException('User not authenticated', 401);
      }

      // Check if this is a planning request
      if (this.geminiService.looksLikePlanningRequest(body.message.toLowerCase())) {
        return await this.handlePlanningRequest(userId, body.message);
      }

      // Build the message DTO for Gemini
      const geminiInput = {
        message: body.message,
        userId,
        context: body.clarification_state?.active ? 'clarification' as const : 'chat' as const,
        partialTask: body.clarification_state?.partial_task,
      };

      // Get response from Gemini
      const geminiResponse = await this.geminiService.generateResponse(geminiInput);

      // Check if this is a ready-to-create task response
      if ('ready_to_create' in geminiResponse && geminiResponse.ready_to_create && 'parsed_task' in geminiResponse) {
        const parsedTask = geminiResponse.parsed_task;
        
        try {
          // Create the task in the database
          const createdTask = await this.tasksService.createTask({
            title: parsedTask.title,
            user_id: userId,
            notes: parsedTask.notes || null,
            priority: parsedTask.priority || 'med',
            due_date: parsedTask.due_date || null,
            est_minutes: parsedTask.est_minutes || null,
            status: 'todo',
          });

          return {
            response: geminiResponse.response,
            parsed_task: parsedTask,
            ready_to_create: true,
            task_created: true,
            task: createdTask,
          };
        } catch (taskError: any) {
          console.error('Failed to create task:', taskError);
          return {
            response: `I understood your task but couldn't save it: ${taskError.message}`,
            parsed_task: parsedTask,
            ready_to_create: true,
            task_created: false,
            error: taskError.message,
          };
        }
      }

      // Check if clarification is needed
      if ('needs_clarification' in geminiResponse && geminiResponse.needs_clarification) {
        return {
          response: geminiResponse.response,
          needs_clarification: true,
          partial_task: 'partial_task' in geminiResponse ? geminiResponse.partial_task : null,
          clarification_prompt: geminiResponse.response,
        };
      }

      // Regular chat response
      return {
        response: 'response' in geminiResponse ? geminiResponse.response : 'I processed your request.',
      };
    } catch (error: any) {
      console.error('Chat error:', error);
      throw new HttpException(error.message || 'Failed to process chat', 500);
    }
  }

  private async handlePlanningRequest(userId: string, message: string) {
    try {
      // Get today's date in ISO format
      const today = DateTime.now().toISODate();
      
      if (!today) {
        throw new Error('Could not determine today\'s date');
      }

      // Call the planner service to propose a plan
      const proposal = await this.plannerService.propose({
        userId,
        date: today,
      });

      // Format the response for the user
      if (!proposal.blocks || proposal.blocks.length === 0) {
        let noTasksMessage = "📋 **Your Day is Clear!**\n\nYou don't have any tasks to schedule right now.";
        
        if (proposal.unplaceable && proposal.unplaceable.length > 0) {
          noTasksMessage += "\n\n⚠️ **Some tasks couldn't be scheduled:**\n";
          proposal.unplaceable.forEach((item: any) => {
            noTasksMessage += `• Task ${item.taskId}: ${item.reason}\n`;
          });
        }
        
        noTasksMessage += "\n\nTry adding some tasks first by saying something like:\n• \"Create a task to review the project proposal\"\n• \"Add a 2-hour task to study for my exam\"";
        
        return { response: noTasksMessage, plan_proposal: proposal };
      }

      // Get task details for better formatting
      const tasks = await this.tasksService.getUserTasks(userId);
      const taskMap = new Map(tasks.map(t => [t.id, t]));

      let responseMessage = `📅 **Here's your proposed plan for today:**\n\n`;
      
      proposal.blocks.forEach((block: any, index: number) => {
        const task = taskMap.get(block.taskId);
        const startTime = DateTime.fromISO(block.start).toFormat('h:mm a');
        const endTime = DateTime.fromISO(block.end).toFormat('h:mm a');
        const taskTitle = task?.title || 'Unknown Task';
        const priority = task?.priority || 'med';
        const priorityEmoji = priority === 'high' ? '🔴' : priority === 'med' ? '🟡' : '🟢';
        
        responseMessage += `**${index + 1}. ${taskTitle}** ${priorityEmoji}\n`;
        responseMessage += `   ⏰ ${startTime} - ${endTime}\n`;
        if (block.reason) {
          responseMessage += `   💡 ${block.reason}\n`;
        }
        responseMessage += '\n';
      });

      if (proposal.unplaceable && proposal.unplaceable.length > 0) {
        responseMessage += `\n⚠️ **Couldn't fit these tasks today:**\n`;
        proposal.unplaceable.forEach((item: any) => {
          const task = taskMap.get(item.taskId);
          responseMessage += `• ${task?.title || item.taskId}: ${item.reason}\n`;
        });
      }

      responseMessage += `\n---\n✨ **Proposal ID:** \`${proposal.proposalId}\`\n`;
      responseMessage += `To confirm this schedule and add to Google Calendar, say "Confirm my plan" or manually approve in the calendar view.`;

      return {
        response: responseMessage,
        plan_proposal: proposal,
        has_plan: true,
      };
    } catch (error: any) {
      console.error('Planning error:', error);
      return {
        response: `I couldn't create a plan right now. ${error.message || 'Please try again later.'}`,
        error: error.message,
      };
    }
  }
}

