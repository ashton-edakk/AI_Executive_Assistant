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
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    });
  }

  async generateResponse(body: InsertMessageDto): Promise<ChatResponse | MultiTaskResponse> {
    try {
      // Check if this looks like a task creation request
      if (this.looksLikeTaskCreation(body.message) || body.context === 'clarification') {
        return await this.handleTaskCreation(body);
      }

      // Regular chat response
      const prompt = `
        You are an AI Executive Assistant helping the user with planning, task breakdown, scheduling, and productivity.
        Stay helpful, structured, and concise.
        
        IMPORTANT: If the user mentions anything that sounds like a task, project, assignment, exam, deadline, 
        or something they need to do - help them create it as a task rather than asking questions.
        Be action-oriented, not question-oriented.

        User message: ${body.message}

        Provide your best response:
        `;

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

      // Single task parsing with smart defaults
      const prompt = `
      Parse this task description and extract structured information. Return ONLY valid JSON.
      
      CRITICAL RULES - BE ACTION-ORIENTED:
      1. ALWAYS create the task if you can understand what the user wants to do
      2. Use SMART DEFAULTS - don't ask for missing information, infer it:
         - No priority mentioned? Infer from context or default to "med"
         - No time estimate? Estimate based on task type (exam study = 120min, quick call = 15min, meeting = 60min)
         - No due date? Leave as null (that's fine!)
      3. ONLY set clarification_needed=true if you genuinely cannot understand what task to create
      4. The title is the only truly required field

      Task: "${body.message}"
      Current date: ${new Date().toISOString().split('T')[0]}

      SMART INFERENCE GUIDE:
      - "exam/test/final" → priority: "high", est_minutes: 120-180
      - "homework/assignment" → priority: "med", est_minutes: 60-90
      - "project" → priority: "high", est_minutes: 120
      - "call/meeting" → priority: "med", est_minutes: 30-60
      - "email/message" → priority: "low", est_minutes: 15
      - "review/read" → priority: "med", est_minutes: 30-45
      - "tomorrow" in text → priority should be at least "med"
      - "urgent/asap/critical" → priority: "high"
      - "when you get a chance/sometime" → priority: "low"

      Return this exact JSON format:
      {
        "title": "clear, actionable task title",
        "notes": "any additional context or null",
        "due_date": "YYYY-MM-DD or null",
        "priority": "low" or "med" or "high",
        "est_minutes": number (your best estimate, never null unless truly unknowable),
        "clarification_needed": false,
        "clarification_question": null
      }

      Examples:
      - "exam tomorrow" → {"title": "Study for exam", "due_date": "2024-12-10", "priority": "high", "est_minutes": 120, ...}
      - "cs 484 project due friday" → {"title": "Work on CS 484 project", "due_date": "2024-12-13", "priority": "high", "est_minutes": 120, ...}
      - "call mom" → {"title": "Call mom", "priority": "med", "est_minutes": 15, ...}
      - "finish report" → {"title": "Finish report", "priority": "med", "est_minutes": 60, ...}

      JSON:`;

      const result = await this.model.generateContent(prompt);
      const geminiResult = await result.response;
      const text = geminiResult.text().trim();
      
      const cleanJson = text.replace(/```json\n?|\n?```/g, '');
      const parsedTask = JSON.parse(cleanJson);

      console.log('Parsed task:', parsedTask);

      // Apply smart defaults if still missing (safety net)
      if (!parsedTask.priority) {
        parsedTask.priority = 'med';
      }
      
      // Only ask for clarification if title is missing or unclear
      if (!parsedTask.title || parsedTask.title.trim() === '') {
        const clarificationResponse: ClarificationNeededResponse = {
          response: "I'd love to help you create a task! Could you tell me what you need to do?",
          needs_clarification: true,
          partial_task: parsedTask
        };
        return clarificationResponse;
      }

      // Check for invalid est_minutes (if provided but <= 0)
      if (parsedTask.est_minutes !== null && parsedTask.est_minutes !== undefined && parsedTask.est_minutes <= 0) {
        parsedTask.est_minutes = 30; // Default to 30 minutes instead of asking
      }

      // Check what's missing to generate ONE optional refinement prompt
      const missingFields: string[] = [];
      if (!parsedTask.due_date) missingFields.push('due_date');
      if (!parsedTask.est_minutes) missingFields.push('est_minutes');
      
      // Generate a single, concise refinement prompt if fields are missing
      let refinementPrompt: string | undefined;
      if (missingFields.length > 0) {
        refinementPrompt = await this.generateRefinementPrompt(parsedTask, missingFields);
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
      // Fall back to regular chat if parsing fails
      const prompt = `The user mentioned a task but I couldn't parse it properly. Ask them to rephrase more clearly. User message: "${body.message}"`;
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const fallbackResponse: RegularChatResponse = {
        response: text
      };
      
      return fallbackResponse;
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
    try {
      const prompt = `
      Analyze this message and determine if the user is describing MULTIPLE separate tasks.
      
      Message: "${message}"
      Current date: ${new Date().toISOString().split('T')[0]}

      Signs of multiple tasks:
      - Words like "and", "also", "as well", "plus"
      - Comma-separated items
      - Multiple deadlines mentioned
      - Different subjects/topics mentioned

      If MULTIPLE tasks are detected, parse each one with smart defaults.
      If only ONE task, return isMultiple: false.

      SMART DEFAULTS (apply to each task):
      - "exam/test/final" → priority: "high", est_minutes: 120
      - "homework/assignment" → priority: "med", est_minutes: 60
      - "project" → priority: "high", est_minutes: 120
      - Default priority: "med"
      - Default est_minutes: 60

      Return ONLY valid JSON:
      {
        "isMultiple": true/false,
        "tasks": [
          {
            "title": "clear task title",
            "notes": "context or null",
            "due_date": "YYYY-MM-DD or null",
            "priority": "low/med/high",
            "est_minutes": number
          }
        ]
      }

      Examples:
      - "exam tomorrow and cs 484 project due friday" → isMultiple: true, 2 tasks
      - "study for my test" → isMultiple: false, 1 task
      - "I have homework, a paper to write, and need to prepare for a presentation" → isMultiple: true, 3 tasks

      JSON:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      const cleanJson = text.replace(/```json\n?|\n?```/g, '');
      const parsed = JSON.parse(cleanJson);

      // Apply defaults to each task
      if (parsed.tasks && Array.isArray(parsed.tasks)) {
        parsed.tasks = parsed.tasks.map((task: any) => ({
          title: task.title,
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

  /**
   * Generate a single, concise refinement prompt for missing fields
   * This is asked AFTER the task is created, not before
   */
  private async generateRefinementPrompt(task: any, missingFields: string[]): Promise<string> {
    // Build a simple, direct question based on what's missing
    const questions: string[] = [];
    
    if (missingFields.includes('due_date')) {
      questions.push('when is it due');
    }
    if (missingFields.includes('est_minutes')) {
      questions.push('how long it might take');
    }
    
    if (questions.length === 0) return '';
    
    // Create a natural-sounding single question
    const questionText = questions.join(' and ');
    return `\n\n💬 Want to add more details? Just tell me ${questionText}, or say "looks good" to keep it as is.`;
  }

  private async handleClarificationResponse(body: InsertMessageDto): Promise<ChatResponse> {
    try {
      const prompt = `
      You are completing a task creation. The user previously started creating a task, and now they're providing more information.

      Original partial task: ${JSON.stringify(body.partialTask)}
      User's response: "${body.message}"
      Current date: ${new Date().toISOString().split('T')[0]}

      Merge the new information with the original task. Use smart defaults for anything still missing.
      
      IMPORTANT: 
      - DO NOT ask more questions - just create the task with sensible defaults
      - If priority is missing, default to "med"
      - If est_minutes is missing, estimate based on task type (default 60)
      - If due_date is missing, leave as null (that's okay!)

      Return ONLY valid JSON:
      {
        "title": "string (required)",
        "notes": "string or null",
        "due_date": "YYYY-MM-DD or null",
        "priority": "low/med/high",
        "est_minutes": number,
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
