// gemini/gemini.service.ts
import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { InsertMessageDto } from './dto/insert-message.dto';
import { 
  ChatResponse, 
  ClarificationNeededResponse, 
  ReadyToCreateResponse, 
  RegularChatResponse,
  MultiTaskResponse,
  TaskCreatedWithRefinementResponse
} from './types/chat-response.types';

// Re-export for convenience
export type { MultiTaskResponse, TaskCreatedWithRefinementResponse } from './types/chat-response.types';

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY not set in environment');
      throw new Error('GEMINI_API_KEY not set in environment');
    }

    const client = new GoogleGenerativeAI(apiKey);
    this.model = client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.3, // Lower temperature for more deterministic task parsing
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    });
  }

  async generateResponse(body: InsertMessageDto): Promise<ChatResponse | MultiTaskResponse> {
    try {
      // Check if this looks like a task creation request - be very aggressive about detecting tasks
      if (this.looksLikeTaskCreation(body.message) || body.context === 'clarification') {
        return await this.handleTaskCreation(body);
      }

      // For non-task messages, provide a simple helpful response
      // DO NOT ask clarifying questions - just respond helpfully
      const prompt = `
You are an AI Executive Assistant that helps with task scheduling.
Your ONLY purpose is to help users create and manage tasks on their calendar.

User message: "${body.message}"

Rules:
1. If the user mentions ANY work, task, project, assignment, exam, homework, deadline, meeting, or thing they need to do - respond by offering to create a task for them
2. Keep responses SHORT (2-3 sentences max)
3. DO NOT ask clarifying questions about what they want to do
4. DO NOT offer multiple options like "planning, task breakdown, scheduling, productivity"
5. If unsure, suggest they describe a task to create

Example good responses:
- "I can help with that! Just tell me what you need to do, when it's due, and roughly how long it will take."
- "To plan your day, just say 'plan my day' - but first make sure you have some tasks created!"
- "I can create that task for you. What's it called and when is it due?"

Respond now:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log('Gemini response:', text);
      
      const regularResponse: RegularChatResponse = {
        response: text
      };
      
      return regularResponse;
    } catch (e) {
      console.error('Gemini error:', e);
      
      const errorResponse: RegularChatResponse = {
        response: "I'm having trouble processing your request right now. Please try again later."
      };
      
      return errorResponse;
    }
  }

  private looksLikeTaskCreation(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    
    // Don't treat planning requests as task creation
    if (this.looksLikePlanningRequest(lowerMessage)) {
      return false;
    }
    
    // Explicit task creation keywords
    const explicitTaskKeywords = [
      'create', 'add', 'new task', 'make a task', 
      'remind me to', 'i need to', 'todo:', 'task:',
      'set a task', 'add to my tasks', 'i have to',
      'create task', 'add task', 'make task'
    ];
    
    // Context keywords that suggest task creation
    const contextKeywords = [
      'exam', 'test', 'quiz', 'midterm', 'final',
      'project', 'homework', 'assignment', 'paper', 'essay',
      'deadline', 'due', 'submit', 'turn in',
      'study for', 'prepare for', 'finish', 'complete',
      'meeting', 'call', 'appointment',
      'work on', 'start', 'begin',
      'by tomorrow', 'by friday', 'by next week', 'by monday',
      'this week', 'today', 'tonight'
    ];
    
    // Check explicit keywords first
    if (explicitTaskKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return true;
    }
    
    // Check context keywords - need at least one to trigger task creation
    const hasContextKeyword = contextKeywords.some(keyword => lowerMessage.includes(keyword));
    
    // Additional check: if message mentions multiple things with "and" or commas, likely tasks
    const hasMultipleItems = (lowerMessage.includes(' and ') || lowerMessage.includes(', ')) && hasContextKeyword;
    
    return hasContextKeyword || hasMultipleItems;
  }

  looksLikePlanningRequest(message: string): boolean {
    const planningKeywords = [
      'plan my day', 'plan today', 'schedule my day', 'what should i work on',
      'help me plan', 'organize my tasks', 'prioritize my tasks',
      'what\'s my plan', 'show my schedule', 'daily plan',
      'plan for today', 'today\'s plan', 'what\'s on my schedule'
    ];
    const lowerMessage = message.toLowerCase();
    return planningKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  looksLikeCalendarRequest(message: string): boolean {
    const calendarKeywords = [
      'add to calendar', 'add to my calendar', 'add to google calendar',
      'put on calendar', 'put on my calendar', 'schedule on calendar',
      'add it to calendar', 'add it to my calendar', 'add this to calendar',
      'confirm my plan', 'confirm the plan', 'confirm schedule',
      'add to my google calendar', 'schedule it', 'put it on my calendar'
    ];
    const lowerMessage = message.toLowerCase();
    return calendarKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  looksLikeListTasksRequest(message: string): boolean {
    const listKeywords = [
      'show my tasks', 'list my tasks', 'what are my tasks',
      'show tasks', 'list tasks', 'my tasks', 'all tasks',
      'what do i have to do', 'what\'s on my list', 'show todo',
      'what tasks do i have', 'pending tasks', 'view tasks'
    ];
    const lowerMessage = message.toLowerCase();
    return listKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  looksLikeAccomplishmentRequest(message: string): boolean {
    const accomplishKeywords = [
      'what did i accomplish', 'what have i done', 'my accomplishments',
      'what i completed', 'completed tasks', 'done today',
      'what did i finish', 'my progress', 'show my progress',
      'how productive', 'productivity summary', 'daily summary'
    ];
    const lowerMessage = message.toLowerCase();
    return accomplishKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  looksLikeEditTaskRequest(message: string): boolean {
    const editKeywords = [
      'change priority', 'update priority', 'set priority',
      'change due date', 'update due date', 'move due date',
      'edit task', 'update task', 'modify task',
      'make it high priority', 'make it low priority',
      'change the', 'update the'
    ];
    const lowerMessage = message.toLowerCase();
    return editKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  looksLikeHelpRequest(message: string): boolean {
    const helpKeywords = ['help', 'what can you do', 'how to use', 'commands', 'guide'];
    const lowerMessage = message.toLowerCase().trim();
    return helpKeywords.some(keyword => lowerMessage.includes(keyword)) || lowerMessage === 'help';
  }

  async parseEditRequest(message: string, existingTaskTitles: string): Promise<{
    taskTitle: string | null;
    newPriority: 'low' | 'med' | 'high' | null;
    newDueDate: string | null;
    newEstMinutes: number | null;
  }> {
    try {
      const prompt = `
      Parse this task edit request and extract the information. Return ONLY valid JSON.

      User message: "${message}"
      
      Existing tasks: ${existingTaskTitles}
      
      Return this exact JSON format:
      {
        "taskTitle": "the task name the user wants to edit (match to existing tasks) or null",
        "newPriority": "low" or "med" or "high" or null,
        "newDueDate": "YYYY-MM-DD format or null",
        "newEstMinutes": number or null
      }

      Rules:
      - Match taskTitle to the closest existing task name
      - For priority: "urgent/important/critical" = "high", "normal/medium" = "med", "low/not urgent" = "low"
      - For due date: Convert "tomorrow" to actual date, "next week" to Monday, etc.
      - Current date: ${new Date().toISOString().split('T')[0]}
      - For time: "2 hours" = 120, "30 minutes" = 30

      JSON:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      const cleanJson = text.replace(/```json\n?|\n?```/g, '');
      const parsed = JSON.parse(cleanJson);

      return {
        taskTitle: parsed.taskTitle || null,
        newPriority: parsed.newPriority || null,
        newDueDate: parsed.newDueDate || null,
        newEstMinutes: parsed.newEstMinutes || null,
      };
    } catch (error) {
      console.error('Failed to parse edit request:', error);
      return {
        taskTitle: null,
        newPriority: null,
        newDueDate: null,
        newEstMinutes: null,
      };
    }
  }

  private async handleTaskCreation(body: InsertMessageDto): Promise<ChatResponse | MultiTaskResponse> {
    try {
      // Check if this is a clarification response to a previous task
      if (body.context === 'clarification' && body.partialTask) {
        return await this.handleClarificationResponse(body);
      }

      // First, detect if this might be multiple tasks
      const multiTaskResult = await this.detectAndParseMultipleTasks(body.message);
      
      if (multiTaskResult.isMultiple && multiTaskResult.tasks.length > 1) {
        return this.createMultiTaskResponse(multiTaskResult.tasks);
      }

      // Single task parsing with smart defaults - NEVER ask questions, ALWAYS create the task
      const currentDate = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const prompt = `
Parse this task and return ONLY valid JSON. DO NOT ask questions. ALWAYS create the task.

User input: "${body.message}"
Today's date: ${currentDate}
Tomorrow's date: ${tomorrow}

RULES:
1. ALWAYS set clarification_needed to false
2. ALWAYS provide a title - extract the main thing to do
3. ALWAYS estimate time based on task type:
   - exam/test/study: 120 minutes
   - project/homework: 90 minutes
   - meeting/call: 30 minutes
   - email/quick task: 15 minutes
   - default: 60 minutes
4. Set priority based on context:
   - exam/test/deadline soon: "high"
   - homework/project: "med"
   - default: "med"
5. For dates:
   - "tomorrow" = ${tomorrow}
   - "friday" = calculate the next Friday from ${currentDate}
   - If no date mentioned, set to null

Return ONLY this JSON (no explanation):
{
  "title": "the task title",
  "notes": null,
  "due_date": "YYYY-MM-DD or null",
  "priority": "low" or "med" or "high",
  "est_minutes": number,
  "clarification_needed": false,
  "clarification_question": null
}

JSON:`;

      console.log('Calling Gemini for single task parsing...');
      const result = await this.model.generateContent(prompt);
      const geminiResult = await result.response;
      const text = geminiResult.text().trim();
      
      console.log('Single task Gemini response:', text);
      
      // More robust JSON cleaning
      let cleanJson = text;
      // Remove markdown code blocks
      cleanJson = cleanJson.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      // Trim whitespace
      cleanJson = cleanJson.trim();
      
      // Try to parse, with better error handling
      let parsedTask;
      try {
        parsedTask = JSON.parse(cleanJson);
      } catch (jsonError) {
        console.error('JSON parse error, raw text:', text);
        // Try to extract JSON from the response if it's wrapped in other text
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedTask = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not parse JSON from Gemini response');
        }
      }

      console.log('Parsed task:', parsedTask);

      // Apply smart defaults - ALWAYS fill in missing values, NEVER ask for clarification
      if (!parsedTask.priority) {
        parsedTask.priority = 'med';
      }
      if (!parsedTask.est_minutes || parsedTask.est_minutes <= 0) {
        // Infer from title
        const lowerTitle = (parsedTask.title || '').toLowerCase();
        if (lowerTitle.includes('exam') || lowerTitle.includes('study') || lowerTitle.includes('test')) {
          parsedTask.est_minutes = 120;
        } else if (lowerTitle.includes('project')) {
          parsedTask.est_minutes = 90;
        } else if (lowerTitle.includes('call') || lowerTitle.includes('meeting')) {
          parsedTask.est_minutes = 30;
        } else {
          parsedTask.est_minutes = 60;
        }
      }
      
      // Only ask for clarification if title is completely empty (very rare case)
      if (!parsedTask.title || parsedTask.title.trim() === '') {
        const clarificationResponse: ClarificationNeededResponse = {
          response: "What task would you like me to create?",
          needs_clarification: true,
          partial_task: parsedTask
        };
        return clarificationResponse;
      }

      // Force clarification_needed to false - we never want to ask questions
      parsedTask.clarification_needed = false;
      parsedTask.clarification_question = null;

      // Generate optional refinement prompt ONLY if due_date is missing
      let refinementPrompt: string | undefined;
      if (!parsedTask.due_date) {
        refinementPrompt = `\n\n💬 When is this due? (Or say "no deadline" to skip)`;
      }

      // Create the task immediately with optional refinement prompt
      const taskResponse: TaskCreatedWithRefinementResponse = {
        response: this.formatTaskCreationMessage(parsedTask),
        parsed_task: parsedTask,
        ready_to_create: true,
        refinement_prompt: refinementPrompt,
        awaiting_refinement: !!refinementPrompt,
      };

      return taskResponse;

    } catch (error) {
      console.error('Task parsing error:', error);
      
      // Create a fallback task from the message itself - don't try another Gemini call
      // Extract a reasonable title from the user's message
      const lowerMessage = body.message.toLowerCase();
      let title = body.message;
      
      // Try to extract the task part from common patterns
      const patterns = [
        /create (?:a )?task (?:to |for )?(.+)/i,
        /add (?:a )?task (?:to |for )?(.+)/i,
        /(?:i need to|i have to|remind me to) (.+)/i,
      ];
      
      for (const pattern of patterns) {
        const match = body.message.match(pattern);
        if (match && match[1]) {
          title = match[1].trim();
          // Remove trailing punctuation
          title = title.replace(/[.!?]+$/, '');
          // Capitalize first letter
          title = title.charAt(0).toUpperCase() + title.slice(1);
          break;
        }
      }
      
      // Infer priority and time from the message
      let priority: 'low' | 'med' | 'high' = 'med';
      let est_minutes = 60;
      
      if (lowerMessage.includes('exam') || lowerMessage.includes('test') || lowerMessage.includes('urgent')) {
        priority = 'high';
        est_minutes = 120;
      } else if (lowerMessage.includes('project')) {
        priority = 'high';
        est_minutes = 90;
      }
      
      const fallbackTask = {
        title,
        notes: null,
        due_date: null,
        priority,
        est_minutes,
        clarification_needed: false,
        clarification_question: null,
      };
      
      console.log('Using fallback task:', fallbackTask);
      
      const taskResponse: TaskCreatedWithRefinementResponse = {
        response: this.formatTaskCreationMessage(fallbackTask),
        parsed_task: fallbackTask,
        ready_to_create: true,
        refinement_prompt: `\n\n💬 When is this due? (Or say "no deadline" to skip)`,
        awaiting_refinement: true,
      };
      
      return taskResponse;
    }
  }

  /**
   * Detect and parse multiple tasks from a single message
   */
  private async detectAndParseMultipleTasks(message: string): Promise<{
    isMultiple: boolean;
    tasks: Array<{
      title: string;
      notes?: string;
      due_date?: string;
      priority: 'low' | 'med' | 'high';
      est_minutes?: number;
    }>;
  }> {
    // Quick check: if message doesn't contain "and" or multiple commas, skip the multi-task detection
    const lowerMessage = message.toLowerCase();
    const hasMultipleIndicators = 
      (lowerMessage.includes(' and ') && lowerMessage.split(' and ').length > 1) ||
      (lowerMessage.split(',').length > 2);
    
    if (!hasMultipleIndicators) {
      console.log('Single task detected (no multi-task indicators)');
      return { isMultiple: false, tasks: [] };
    }
    
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      
      const prompt = `
Parse this message for tasks. Return ONLY valid JSON. DO NOT ask questions.

Message: "${message}"
Today: ${currentDate}
Tomorrow: ${tomorrow}

RULES:
1. If there are multiple distinct things to do (connected by "and", ",", "also", etc.), return isMultiple: true
2. Each task MUST have a title, priority, and est_minutes
3. Time estimates: exam/study=120min, project=90min, homework=60min, call=30min, default=60min
4. Priority: exam/deadline="high", project/homework="med", default="med"
5. For "tomorrow" use ${tomorrow}, calculate other dates from ${currentDate}

Return ONLY this JSON:
{
  "isMultiple": true or false,
  "tasks": [
    {
      "title": "task title",
      "notes": null,
      "due_date": "YYYY-MM-DD" or null,
      "priority": "high" or "med" or "low",
      "est_minutes": number
    }
  ]
}

JSON:`;

      console.log('Calling Gemini for multi-task detection...');
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      console.log('Multi-task Gemini response:', text);
      
      // More robust JSON cleaning
      let cleanJson = text;
      // Remove markdown code blocks
      cleanJson = cleanJson.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      // Trim whitespace
      cleanJson = cleanJson.trim();
      
      const parsed = JSON.parse(cleanJson);

      // Apply defaults to each task
      if (parsed.tasks && Array.isArray(parsed.tasks)) {
        parsed.tasks = parsed.tasks.map((task: any) => ({
          title: task.title || 'Untitled Task',
          notes: task.notes || null,
          due_date: task.due_date || null,
          priority: task.priority || 'med',
          est_minutes: task.est_minutes || 60,
        }));
      }

      return {
        isMultiple: parsed.isMultiple === true && parsed.tasks?.length > 1,
        tasks: parsed.tasks || [],
      };
    } catch (error) {
      console.error('Multi-task detection error:', error);
      // Return false to fall through to single task parsing
      return { isMultiple: false, tasks: [] };
    }
  }

  /**
   * Format a multi-task response
   */
  private createMultiTaskResponse(tasks: Array<{
    title: string;
    notes?: string;
    due_date?: string;
    priority: 'low' | 'med' | 'high';
    est_minutes?: number;
  }>): MultiTaskResponse {
    let message = `✅ I'll create **${tasks.length} tasks** for you:\n\n`;
    
    tasks.forEach((task, index) => {
      const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'med' ? '🟡' : '🟢';
      message += `**${index + 1}. ${task.title}** ${priorityEmoji}\n`;
      if (task.due_date) message += `   📅 Due: ${task.due_date}\n`;
      if (task.est_minutes) message += `   ⏱️ ~${task.est_minutes} min\n`;
      message += '\n';
    });

    message += `\nAll tasks have been added to your task list!`;

    return {
      response: message,
      tasks,
      ready_to_create: true,
      is_multi_task: true,
    };
  }

  /**
   * Format a single task creation message
   */
  private formatTaskCreationMessage(task: any): string {
    const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'med' ? '🟡' : '🟢';
    let message = `✅ Created: **${task.title}** ${priorityEmoji}`;
    
    const details: string[] = [];
    if (task.due_date) details.push(`Due: ${task.due_date}`);
    if (task.est_minutes) details.push(`~${task.est_minutes} min`);
    
    if (details.length > 0) {
      message += `\n${details.join(' • ')}`;
    }
    
    if (task.notes) {
      message += `\n📝 ${task.notes}`;
    }
    
    return message;
  }

  private async handleClarificationResponse(body: InsertMessageDto): Promise<ChatResponse> {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const prompt = `
Complete this task. Return ONLY valid JSON.

Original task: ${JSON.stringify(body.partialTask)}
User's additional info: "${body.message}"
Today: ${currentDate}

Merge the info and return:
{
  "title": "task title",
  "notes": null,
  "due_date": "YYYY-MM-DD" or null,
  "priority": "low" or "med" or "high",
  "est_minutes": number (default 60),
  "clarification_needed": false,
  "clarification_question": null
}

JSON:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      const cleanJson = text.replace(/```json\n?|\n?```/g, '');
      const updatedTask = JSON.parse(cleanJson);

      console.log('Updated task after clarification:', updatedTask);

      // Apply defaults - never ask more questions
      if (!updatedTask.priority) updatedTask.priority = 'med';
      if (!updatedTask.est_minutes) updatedTask.est_minutes = 60;

      const readyToCreateResponse: ReadyToCreateResponse = {
        response: this.formatTaskCreationMessage(updatedTask),
        parsed_task: updatedTask,
        ready_to_create: true
      };

      return readyToCreateResponse;

    } catch (error) {
      console.error('Clarification processing error:', error);
      
      // Even on error, try to create with what we have
      const fallbackTask = {
        title: body.partialTask?.title || body.message,
        priority: 'med' as const,
        est_minutes: 60,
        due_date: body.partialTask?.due_date || null,
        notes: body.partialTask?.notes || null,
      };
      
      const readyToCreateResponse: ReadyToCreateResponse = {
        response: this.formatTaskCreationMessage(fallbackTask),
        parsed_task: fallbackTask,
        ready_to_create: true
      };
      
      return readyToCreateResponse;
    }
  }
}
