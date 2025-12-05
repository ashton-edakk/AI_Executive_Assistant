// tasks/tasks.service.ts
import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

interface CreateTaskData {
  title: string;
  user_id: string;
  notes?: string;
  priority?: 'low' | 'med' | 'high';
  due_date?: string; // YYYY-MM-DD
  est_minutes?: number;
  status?: 'todo' | 'in_progress' | 'done';
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes?: string;
  priority: 'low' | 'med' | 'high';
  due_date?: string;
  est_minutes?: number;
  status: 'todo' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
  actual_minutes_total: number;
  sessions_count: number;
}

@Injectable()
export class TasksService {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  async createTask(taskData: CreateTaskData): Promise<Task> {
    // Validate required fields
    if (!taskData.title || !taskData.user_id) {
      throw new Error('Title and user_id are required');
    }

    // Validate est_minutes constraint
    if (taskData.est_minutes !== undefined && taskData.est_minutes <= 0 && taskData.est_minutes !== null) {
      throw new Error('est_minutes must be greater than 0');
    }

    // Validate priority
    if (taskData.priority && !['low', 'med', 'high'].includes(taskData.priority)) {
      throw new Error('Priority must be one of: low, med, high');
    }

    // Validate status
    if (taskData.status && !['todo', 'in_progress', 'done'].includes(taskData.status)) {
      throw new Error('Status must be one of: todo, in_progress, done');
    }

    const { data, error } = await this.supabase
      .from('tasks')
      .insert([{
        title: taskData.title,
        user_id: taskData.user_id,
        notes: taskData.notes || null,
        priority: taskData.priority || 'med',
        due_date: taskData.due_date || null,
        est_minutes: taskData.est_minutes || null,
        status: taskData.status || 'todo',
        actual_minutes_total: 0,
        sessions_count: 0,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating task:', error);
      throw new Error(`Failed to create task: ${error.message}`);
    }

    return data;
  }

  async getUserTasks(userId: string): Promise<Task[]> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tasks:', error);
      throw new Error(`Failed to fetch tasks: ${error.message}`);
    }

    return data || [];
  }

  async updateTask(taskId: string, updates: Partial<CreateTaskData>): Promise<Task> {
    // Validate constraints if updating relevant fields
    if (updates.est_minutes !== undefined && updates.est_minutes <= 0) {
      throw new Error('est_minutes must be greater than 0');
    }

    if (updates.priority && !['low', 'med', 'high'].includes(updates.priority)) {
      throw new Error('Priority must be one of: low, med, high');
    }

    if (updates.status && !['todo', 'in_progress', 'done'].includes(updates.status)) {
      throw new Error('Status must be one of: todo, in_progress, done');
    }

    const { data, error } = await this.supabase
      .from('tasks')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      console.error('Error updating task:', error);
      throw new Error(`Failed to update task: ${error.message}`);
    }

    return data;
  }

  async deleteTask(taskId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      console.error('Error deleting task:', error);
      throw new Error(`Failed to delete task: ${error.message}`);
    }
  }
}