import { Body, Controller, Post, UseGuards, Req, HttpException } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { TasksService } from '../tasks/tasks.service';
import { SupabaseAuthGuard } from '../auth/supabase.guard';
import { PlannerService } from '../planning/services/planner.service';
import { InsightsService } from '../planning/services/insights.service';
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
    private readonly insightsService: InsightsService,
  ) {}

  @Post()
  async chat(@Req() req: any, @Body() body: ChatRequest) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException('User not authenticated', 401);
      }

      const lowerMessage = body.message.toLowerCase();

      // Check if this is a list tasks request
      if (this.geminiService.looksLikeListTasksRequest(lowerMessage)) {
        return await this.handleListTasksRequest(userId);
      }

      // Check if this is an accomplishment/progress request
      if (this.geminiService.looksLikeAccomplishmentRequest(lowerMessage)) {
        return await this.handleAccomplishmentRequest(userId);
      }

      // Check if this is a calendar/confirm request
      if (this.geminiService.looksLikeCalendarRequest(lowerMessage)) {
        return await this.handleCalendarRequest(userId, body, req.user);
      }

      // Check if this is an edit task request
      if (this.geminiService.looksLikeEditTaskRequest(lowerMessage)) {
        return await this.handleEditTaskRequest(userId, body.message);
      }

      // Check if this is a planning request
      if (this.geminiService.looksLikePlanningRequest(lowerMessage)) {
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

  private async handleCalendarRequest(userId: string, body: ChatRequest, user: any) {
    try {
      // Get today's date
      const today = DateTime.now().toISODate();
      if (!today) {
        throw new Error('Could not determine today\'s date');
      }

      // First, propose a plan to get the blocks
      const proposal = await this.plannerService.propose({
        userId,
        date: today,
      });

      if (!proposal.blocks || proposal.blocks.length === 0) {
        return {
          response: "📋 **No tasks to schedule!**\n\nYou don't have any tasks to add to your calendar. Create some tasks first by saying something like:\n• \"Create a task to finish my homework by tomorrow, 2 hours, high priority\"",
        };
      }

      // Confirm the plan and create Google Calendar events
      const confirmResult = await this.plannerService.confirmWithUser(
        {
          userId,
          proposalId: proposal.proposalId,
          acceptBlockIds: proposal.blocks.map((b: any) => b.blockId),
        },
        user
      );

      // Get task details for better response
      const tasks = await this.tasksService.getUserTasks(userId);
      const taskMap = new Map(tasks.map(t => [t.id, t]));

      let responseMessage = '📅 **Added to your Google Calendar!**\n\n';
      
      if (confirmResult.created && confirmResult.created.length > 0) {
        responseMessage += '✅ **Scheduled blocks:**\n';
        proposal.blocks.forEach((block: any, index: number) => {
          const task = taskMap.get(block.taskId);
          const startTime = DateTime.fromISO(block.start).toFormat('h:mm a');
          const endTime = DateTime.fromISO(block.end).toFormat('h:mm a');
          responseMessage += `• **${task?.title || 'Task'}** - ${startTime} to ${endTime}\n`;
        });
      }

      if (confirmResult.skipped && confirmResult.skipped.length > 0) {
        responseMessage += '\n⚠️ **Skipped (already scheduled or error):**\n';
        confirmResult.skipped.forEach((skip: any) => {
          responseMessage += `• Block ${skip.blockId}: ${skip.reason}\n`;
        });
      }

      responseMessage += '\n🎉 Check your Google Calendar to see the scheduled focus blocks!';

      return {
        response: responseMessage,
        calendar_updated: true,
        created: confirmResult.created,
        skipped: confirmResult.skipped,
      };
    } catch (error: any) {
      console.error('Calendar request error:', error);
      return {
        response: `❌ I couldn't add tasks to your calendar. ${error.message || 'Please make sure you have connected your Google Calendar and try again.'}`,
        error: error.message,
      };
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

  private async handleListTasksRequest(userId: string) {
    try {
      const tasks = await this.tasksService.getUserTasks(userId);
      
      if (!tasks || tasks.length === 0) {
        return {
          response: "📋 **You don't have any tasks yet!**\n\nCreate one by saying:\n• \"Create a task to finish my homework by tomorrow, 2 hours, high priority\"\n• \"Add a task to prepare for the meeting\"",
        };
      }

      const todoTasks = tasks.filter(t => t.status === 'todo');
      const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
      const doneTasks = tasks.filter(t => t.status === 'done');

      let responseMessage = '📋 **Your Tasks:**\n\n';

      if (inProgressTasks.length > 0) {
        responseMessage += '🔄 **In Progress:**\n';
        inProgressTasks.forEach(t => {
          const priorityEmoji = t.priority === 'high' ? '🔴' : t.priority === 'med' ? '🟡' : '🟢';
          responseMessage += `• ${t.title} ${priorityEmoji}`;
          if (t.est_minutes) responseMessage += ` (${t.est_minutes}m)`;
          if (t.due_date) responseMessage += ` - Due: ${t.due_date}`;
          responseMessage += '\n';
        });
        responseMessage += '\n';
      }

      if (todoTasks.length > 0) {
        responseMessage += '📝 **To Do:**\n';
        todoTasks.forEach(t => {
          const priorityEmoji = t.priority === 'high' ? '🔴' : t.priority === 'med' ? '🟡' : '🟢';
          responseMessage += `• ${t.title} ${priorityEmoji}`;
          if (t.est_minutes) responseMessage += ` (${t.est_minutes}m)`;
          if (t.due_date) responseMessage += ` - Due: ${t.due_date}`;
          responseMessage += '\n';
        });
        responseMessage += '\n';
      }

      if (doneTasks.length > 0) {
        responseMessage += `✅ **Completed:** ${doneTasks.length} task${doneTasks.length > 1 ? 's' : ''}\n`;
      }

      responseMessage += `\n---\n**Total:** ${tasks.length} tasks (${todoTasks.length} to do, ${inProgressTasks.length} in progress, ${doneTasks.length} done)`;

      return {
        response: responseMessage,
        tasks: tasks,
      };
    } catch (error: any) {
      console.error('List tasks error:', error);
      return {
        response: `I couldn't fetch your tasks. ${error.message || 'Please try again.'}`,
        error: error.message,
      };
    }
  }

  private async handleEditTaskRequest(userId: string, message: string) {
    try {
      // Get all tasks to match against
      const tasks = await this.tasksService.getUserTasks(userId);
      
      if (!tasks || tasks.length === 0) {
        return {
          response: "📋 You don't have any tasks to edit. Create one first!",
        };
      }

      // Use Gemini to parse the edit request
      const taskTitles = tasks.map(t => t.title).join(', ');
      const parseResult = await this.geminiService.parseEditRequest(message, taskTitles);

      if (!parseResult.taskTitle) {
        return {
          response: "🤔 I couldn't figure out which task you want to edit. Please be more specific.\n\nYour tasks:\n" + 
            tasks.map(t => `• ${t.title}`).join('\n') +
            "\n\nTry: \"Change priority of [task name] to high\"",
        };
      }

      // Find the matching task (fuzzy match)
      const searchTitle = parseResult.taskTitle.toLowerCase();
      const matchedTask = tasks.find(t => 
        t.title.toLowerCase().includes(searchTitle) ||
        searchTitle.includes(t.title.toLowerCase())
      );

      if (!matchedTask) {
        return {
          response: `🔍 I couldn't find a task matching "${parseResult.taskTitle}".\n\nYour tasks:\n` +
            tasks.map(t => `• ${t.title}`).join('\n'),
        };
      }

      // Build the update object
      const updates: any = {};
      let changeDescription = '';

      if (parseResult.newPriority) {
        updates.priority = parseResult.newPriority;
        const emoji = parseResult.newPriority === 'high' ? '🔴' : parseResult.newPriority === 'med' ? '🟡' : '🟢';
        changeDescription += `Priority → ${parseResult.newPriority} ${emoji}\n`;
      }

      if (parseResult.newDueDate) {
        updates.due_date = parseResult.newDueDate;
        changeDescription += `Due date → ${parseResult.newDueDate}\n`;
      }

      if (parseResult.newEstMinutes) {
        updates.est_minutes = parseResult.newEstMinutes;
        changeDescription += `Estimated time → ${parseResult.newEstMinutes} minutes\n`;
      }

      if (Object.keys(updates).length === 0) {
        return {
          response: "🤔 I understood you want to edit a task, but I couldn't determine what to change.\n\nTry:\n• \"Change priority of [task] to high/medium/low\"\n• \"Update due date of [task] to tomorrow\"\n• \"Set estimated time for [task] to 2 hours\"",
        };
      }

      // Update the task
      await this.tasksService.updateTask(matchedTask.id, updates);

      return {
        response: `✅ **Updated "${matchedTask.title}":**\n\n${changeDescription}`,
        task_updated: true,
        task: matchedTask,
        updates: updates,
      };
    } catch (error: any) {
      console.error('Edit task error:', error);
      return {
        response: `I couldn't update the task. ${error.message || 'Please try again.'}`,
        error: error.message,
      };
    }
  }

  private async handleAccomplishmentRequest(userId: string) {
    try {
      const today = DateTime.now().toISODate();
      if (!today) throw new Error('Could not determine today\'s date');

      const [dailyInsights, tasks] = await Promise.all([
        this.insightsService.daily(userId, today),
        this.tasksService.getUserTasks(userId),
      ]);

      const completedToday = tasks.filter(t => 
        t.status === 'done' && 
        t.updated_at && 
        t.updated_at.startsWith(today)
      );

      let responseMessage = '🎯 **Your Productivity Summary:**\n\n';

      // Time worked
      if (dailyInsights.minutes.executed > 0) {
        const hours = Math.floor(dailyInsights.minutes.executed / 60);
        const mins = dailyInsights.minutes.executed % 60;
        responseMessage += `⏱️ **Time Worked Today:** ${hours > 0 ? `${hours}h ` : ''}${mins}m\n\n`;
      }

      // Completed tasks
      if (completedToday.length > 0) {
        responseMessage += '✅ **Completed Today:**\n';
        completedToday.forEach(t => {
          responseMessage += `• ${t.title}`;
          if (t.actual_minutes_total) responseMessage += ` (${t.actual_minutes_total}m)`;
          responseMessage += '\n';
        });
        responseMessage += '\n';
      } else {
        responseMessage += '📝 No tasks completed yet today.\n\n';
      }

      // Progress stats
      if (dailyInsights.minutes.planned > 0) {
        const completionRate = Math.round((dailyInsights.minutes.executed / dailyInsights.minutes.planned) * 100);
        responseMessage += `📊 **Progress:** ${completionRate}% of planned time\n`;
      }

      // Estimation accuracy
      if (dailyInsights.estimationBias !== 0) {
        const biasPercent = Math.round(dailyInsights.estimationBias * 100);
        if (biasPercent > 15) {
          responseMessage += `💡 **Tip:** You're underestimating tasks by ~${biasPercent}%. Consider adding buffer time.\n`;
        } else if (biasPercent < -15) {
          responseMessage += `💡 **Tip:** You're overestimating tasks by ~${Math.abs(biasPercent)}%. You're faster than you think!\n`;
        } else {
          responseMessage += `🎯 **Great job!** Your time estimates are accurate.\n`;
        }
      }

      // Slipped tasks warning
      if (dailyInsights.slipped.length > 0) {
        responseMessage += `\n⚠️ **${dailyInsights.slipped.length} task${dailyInsights.slipped.length > 1 ? 's' : ''} slipped today** - scheduled but not worked on.\n`;
      }

      return {
        response: responseMessage,
        insights: dailyInsights,
        completedTasks: completedToday,
      };
    } catch (error: any) {
      console.error('Accomplishment request error:', error);
      return {
        response: `I couldn't fetch your accomplishments. ${error.message || 'Please try again.'}`,
        error: error.message,
      };
    }
  }
}

