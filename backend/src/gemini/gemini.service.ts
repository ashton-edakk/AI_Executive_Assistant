// gemini/gemini.service.ts
import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { InsertMessageDto } from './dto/insert-message.dto';
import { 
  ChatResponse, 
  ClarificationNeededResponse, 
  ReadyToCreateResponse, 
  RegularChatResponse 
} from './types/chat-response.types';

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
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    });
  }

  async generateResponse(body: InsertMessageDto): Promise<ChatResponse> {
    try {
      // Check if this looks like a task creation request
      if (this.looksLikeTaskCreation(body.message) || body.context === 'clarification') {
        return await this.handleTaskCreation(body);
      }

      // Regular chat response
      const prompt = `
        You are an AI Executive Assistant helping the user with planning, task breakdown, scheduling, and productivity.
        Stay helpful, structured, and concise.

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
    const taskKeywords = [
      'create', 'add', 'new task', 'make a task', 'schedule', 
      'remind me to', 'i need to', 'todo:', 'task:',
      'set a task', 'add to my tasks', 'i have to'
    ];
    const lowerMessage = message.toLowerCase();
    // Don't treat planning requests as task creation
    if (this.looksLikePlanningRequest(lowerMessage)) {
      return false;
    }
    return taskKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  looksLikePlanningRequest(message: string): boolean {
    const planningKeywords = [
      'plan my day', 'plan today', 'schedule my day', 'what should i work on',
      'help me plan', 'organize my tasks', 'prioritize my tasks',
      'what\'s my plan', 'show my schedule', 'daily plan'
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
      'add to my google calendar', 'schedule it'
    ];
    const lowerMessage = message.toLowerCase();
    return calendarKeywords.some(keyword => lowerMessage.includes(keyword));
  }

private async handleTaskCreation(body: InsertMessageDto): Promise<ChatResponse> {
  try {
    // Check if this is a clarification response to a previous task
    if (body.context === 'clarification' && body.partialTask) {
      return await this.handleClarificationResponse(body);
    }

    const prompt = `
    Parse this task description and extract structured information. Return ONLY valid JSON in this exact format:
    {
      "title": "string (required)",
      "notes": "string (optional)",
      "due_date": "YYYY-MM-DD or null",
      "priority": "low/med/high or null",
      "est_minutes": "number or null",
      "clarification_needed": "boolean",
      "clarification_question": "string if clarification_needed is true"
    }

    Task: "${body.message}"

    Rules:
    - Title is REQUIRED. If unclear, set clarification_needed to true
    - due_date: extract from phrases like "by friday", "next week", "tomorrow", specific dates. Format as YYYY-MM-DD
    - priority: extract from words like "urgent/important/critical" = high, "medium/normal" = med, "low/not urgent" = low
    - est_minutes: estimate from time references like "2 hour meeting" = 120, "30 minute task" = 30
    - Current date: ${new Date().toISOString().split('T')[0]}
    - If est_minutes is provided, it must be greater than 0
    - If clarification is needed, provide a specific, natural-sounding question about what's missing

    Examples:
    - "Finish report by Friday" => {"title": "Finish report", "due_date": "2024-12-20", ...}
    - "High priority: Call client" => {"title": "Call client", "priority": "high", ...}
    - "Study for exam for 2 hours" => {"title": "Study for exam", "est_minutes": 120, ...}

    JSON:`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    
    const cleanJson = text.replace(/```json\n?|\n?```/g, '');
    const parsedTask = JSON.parse(cleanJson);

    console.log('Parsed task:', parsedTask);

    // Check if we need clarification for missing important fields
    let needsClarification = parsedTask.clarification_needed;
    let clarificationQuestion = parsedTask.clarification_question;

    // If Gemini didn't set clarification but we have missing fields, generate a natural question
    if (!needsClarification) {
      const missingFields: string[] = [];
      if (!parsedTask.due_date) missingFields.push('due_date');
      if (!parsedTask.priority) missingFields.push('priority');
      if (!parsedTask.est_minutes) missingFields.push('est_minutes');

      if (missingFields.length > 0) {
        needsClarification = true;
        // Let Gemini generate a natural-sounding clarification question
        clarificationQuestion = await this.generateNaturalClarification(parsedTask, missingFields, body.message);
      }
    }

    // Check for invalid est_minutes (if provided but <= 0)
    if (parsedTask.est_minutes !== null && parsedTask.est_minutes <= 0) {
      needsClarification = true;
      clarificationQuestion = await this.generateNaturalClarification(parsedTask, ['invalid_est_minutes'], body.message);
    }

    if (needsClarification) {
      const clarificationResponse: ClarificationNeededResponse = {
        response: clarificationQuestion || "Could you provide more details about this task?",
        needs_clarification: true,
        partial_task: parsedTask
      };
      
      return clarificationResponse;
    }

    const readyToCreateResponse: ReadyToCreateResponse = {
      response: `I'll create the task: "${parsedTask.title}"${parsedTask.due_date ? ` (Due: ${parsedTask.due_date})` : ''}${parsedTask.priority ? ` [${parsedTask.priority} priority]` : ''}${parsedTask.est_minutes ? ` ⏱️ ${parsedTask.est_minutes}min` : ''}`,
      parsed_task: parsedTask,
      ready_to_create: true
    };

    return readyToCreateResponse;

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

  private async generateNaturalClarification(parsedTask: any, missingFields: string[], originalMessage: string): Promise<string> {
    const prompt = `
    You are an AI assistant helping a user create a task. The user said: "${originalMessage}"
    
    We've parsed this into a task: ${JSON.stringify(parsedTask, null, 2)}
    
    However, we're missing some information: ${missingFields.join(', ')}
    
    Please generate a SINGLE, natural-sounding clarification question that:
    - Sounds conversational and helpful
    - Asks for all the missing information at once
    - Is specific to this task context
    - Doesn't sound robotic or like a form
    
    Missing fields explanation:
    - due_date: When is this due? (tomorrow, next week, by Friday, etc.)
    - priority: How important is this? (high/medium/low urgency)
    - est_minutes: How long will this take? (30 minutes, 2 hours, etc.)
    - invalid_est_minutes: The time estimate provided doesn't make sense
    
    Examples of good clarification questions:
    - "Got it! To schedule this properly, when would you like to complete '${parsedTask.title}' and how urgent is it?"
    - "I can add '${parsedTask.title}' to your tasks. When should this be done by, and about how long will it take?"
    - "For '${parsedTask.title}', could you let me know when you'd like to finish this and how important it is compared to your other tasks?"
    - "I'd like to make sure I schedule '${parsedTask.title}' properly. When's your deadline and about how much time should I block off for it?"
    
    Your natural clarification question:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      let text = response.text().trim();

      // Clean up any markdown or quotes that might appear
      text = text.replace(/^["']|["']$/g, ''); // Remove surrounding quotes
      text = text.replace(/```[\s\S]*?```/g, ''); // Remove code blocks
      text = text.trim();

      return text;
    } catch (error) {
      console.error('Error generating natural clarification:', error);
      // Fallback to simple question
      if (missingFields.includes('invalid_est_minutes')) {
        return "How much time should I allocate for this task?";
      }
      return "Could you provide a bit more detail about when you'd like to complete this and how important it is?";
    }
  }

  private async handleClarificationResponse(body: InsertMessageDto): Promise<ChatResponse> {
    try {
      const prompt = `
      You are helping complete a task creation. The user previously provided a partial task, and now they're providing clarification.

      Original partial task: ${JSON.stringify(body.partialTask)}
      User's clarification: "${body.message}"

      Update the task with the clarification information. Return ONLY valid JSON in this exact format:
      {
        "title": "string (required)",
        "notes": "string (optional)",
        "due_date": "YYYY-MM-DD or null",
        "priority": "low/med/high or null",
        "est_minutes": "number or null",
        "clarification_needed": "boolean",
        "clarification_question": "string if clarification_needed is true"
      }

      Rules:
      - Keep the original title: "${body.partialTask.title}" - do not change it unless the user explicitly says to
      - Extract priority from: "high/urgent/important/critical" = "high", "medium/normal/standard" = "med", "low/not urgent" = "low"
      - Extract time estimates: "20 minutes/20 mins/20m" = 20, "1 hour/1hr" = 60, "2 hours/2hrs" = 120
      - Extract due dates from: "tomorrow", "next week", "by friday" (but prefer the original due_date if it exists)
      - Current date: ${new Date().toISOString().split('T')[0]}
      - Only set clarification_needed to true if critical information is still missing after this update
      - If clarification is still needed, make the question natural and conversational

      Examples:
      - Clarification "high priority" => updates priority to "high"
      - Clarification "30 minutes" => updates est_minutes to 30
      - Clarification "high, 1 hour" => updates priority to "high" and est_minutes to 60

      Updated task JSON:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      const cleanJson = text.replace(/```json\n?|\n?```/g, '');
      const updatedTask = JSON.parse(cleanJson);

      console.log('Updated task after clarification:', updatedTask);

      // Apply our validation logic to the updated task
      let needsClarification = updatedTask.clarification_needed;
      let clarificationQuestion = updatedTask.clarification_question;

      const missingFields: string[] = [];
      if (!updatedTask.priority) missingFields.push('priority');
      if (!updatedTask.est_minutes) missingFields.push('est_minutes');

      if (missingFields.length > 0 && !needsClarification) {
        needsClarification = true;
        clarificationQuestion = await this.generateNaturalClarification(updatedTask, missingFields, body.message);
      }

      if (needsClarification) {
        const clarificationResponse: ClarificationNeededResponse = {
          response: clarificationQuestion,
          needs_clarification: true,
          partial_task: updatedTask
        };
        return clarificationResponse;
      }

      const readyToCreateResponse: ReadyToCreateResponse = {
        response: `✅ Task created: "${updatedTask.title}"${updatedTask.due_date ? ` (Due: ${updatedTask.due_date})` : ''}${updatedTask.priority ? ` [${updatedTask.priority} priority]` : ''}${updatedTask.est_minutes ? ` ⏱️ ${updatedTask.est_minutes}min` : ''}`,
        parsed_task: updatedTask,
        ready_to_create: true
      };

      return readyToCreateResponse;

    } catch (error) {
      console.error('Clarification processing error:', error);
      // If clarification fails, fall back to asking for the original information
      const fallbackResponse: ClarificationNeededResponse = {
        response: "I still need to know the priority and estimated time for this task. Could you provide those details?",
        needs_clarification: true,
        partial_task: body.partialTask
      };
      return fallbackResponse;
    }
  }
}