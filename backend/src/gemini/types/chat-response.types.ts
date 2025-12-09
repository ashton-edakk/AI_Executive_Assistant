// gemini/types/chat-response.types.ts
export interface BaseChatResponse {
  response: string;
}

export interface ClarificationNeededResponse extends BaseChatResponse {
  needs_clarification: true;
  partial_task: any;
  ready_to_create?: false;
}

export interface ReadyToCreateResponse extends BaseChatResponse {
  ready_to_create: true;
  parsed_task: any;
  needs_clarification?: false;
}

// New type: Task is created but user can optionally refine it with one follow-up
export interface TaskCreatedWithRefinementResponse extends BaseChatResponse {
  ready_to_create: true;
  parsed_task: any;
  refinement_prompt?: string; // Optional follow-up question
  awaiting_refinement?: boolean; // True if we're waiting for optional refinement
}

export interface TaskCreatedResponse extends BaseChatResponse {
  task_created: true;
  task: any;
  parsed_task: any;
}

export interface RegularChatResponse extends BaseChatResponse {
  needs_clarification?: false;
  ready_to_create?: false;
  task_created?: false;
}

export interface MultiTaskResponse extends BaseChatResponse {
  tasks: Array<{
    title: string;
    notes?: string;
    due_date?: string;
    priority: 'low' | 'med' | 'high';
    est_minutes?: number;
  }>;
  ready_to_create: true;
  is_multi_task: true;
}

export type ChatResponse = 
  | RegularChatResponse 
  | ClarificationNeededResponse 
  | ReadyToCreateResponse 
  | TaskCreatedWithRefinementResponse
  | TaskCreatedResponse
  | MultiTaskResponse;
