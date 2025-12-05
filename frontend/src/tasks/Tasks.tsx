import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Play, Square, CheckCircle, Clock, Trash2, MessageCircle } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:8080';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DB row shape for tasks table
interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  priority: 'low' | 'med' | 'high' | null;
  due_date: string | null;
  est_minutes: number | null;
  status: 'todo' | 'in_progress' | 'done' | null;
  created_at: string;
  updated_at: string;
  actual_minutes_total: number | null;
  sessions_count: number | null;
}

type Task = TaskRow;

// --- TASKS COMPONENT ---
export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Execution tracking state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isTracking, setIsTracking] = useState<boolean>(false);

  // --- Fetch tasks for the current user ---
  const fetchTasks = async () => {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('fetchTasks: session error', sessionError);
        setErrorMessage('Could not read auth session.');
        return;
      }

      if (!session || !session.user) {
        setErrorMessage('You must be signed in to view tasks.');
        return;
      }

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('fetchTasks error', error);
        setErrorMessage(error.message);
        return;
      }

      setTasks((data ?? []) as TaskRow[]);
      setErrorMessage(null);
    } catch (err: any) {
      console.error('fetchTasks exception', err);
      setErrorMessage('Failed to fetch tasks.');
    }
  };

  // --- Toggle task status between todo/done ---
  const toggleTask = async (task: Task) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done';

    try {
      const { error } = await supabase
        .from('tasks')
        .update({ status: newStatus })
        .eq('id', task.id);

      if (error) {
        console.error('toggleTask error', error);
        setErrorMessage(error.message);
        return;
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: newStatus } : t,
        ),
      );
      setErrorMessage(null);
    } catch (err: any) {
      console.error('toggleTask exception', err);
      setErrorMessage('Failed to toggle task.');
    }
  };

  // --- Delete task (and related sessions/blocks/calendar events) ---
  const deleteTask = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      // First, get any Google Calendar event IDs from task_blocks
      const { data: blocks } = await supabase
        .from('task_blocks')
        .select('google_event_id')
        .eq('task_id', id)
        .not('google_event_id', 'is', null);

      // Delete Google Calendar events if any exist
      if (blocks && blocks.length > 0) {
        for (const block of blocks) {
          if (block.google_event_id) {
            try {
              await fetch(`${API_URL}/calendar/events/${encodeURIComponent(block.google_event_id)}`, {
                method: 'DELETE',
                headers: {
                  ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
                },
              });
              console.log('Deleted calendar event:', block.google_event_id);
            } catch (calErr) {
              console.error('Failed to delete calendar event:', calErr);
              // Continue anyway - event might already be deleted
            }
          }
        }
      }

      // Delete related task_sessions (foreign key constraint)
      const { error: sessionsError } = await supabase
        .from('task_sessions')
        .delete()
        .eq('task_id', id);
      
      if (sessionsError) {
        console.error('deleteTask: sessions error', sessionsError);
        // Continue anyway - might not have sessions
      }

      // Delete related task_blocks
      const { error: blocksError } = await supabase
        .from('task_blocks')
        .delete()
        .eq('task_id', id);
      
      if (blocksError) {
        console.error('deleteTask: blocks error', blocksError);
        // Continue anyway - might not have blocks
      }

      // Finally, delete the task itself
      const { error } = await supabase.from('tasks').delete().eq('id', id);

      if (error) {
        console.error('deleteTask error', error);
        setErrorMessage(error.message);
        return;
      }

      setTasks((prev) => prev.filter((t) => t.id !== id));
      setErrorMessage(null);
    } catch (err: any) {
      console.error('deleteTask exception', err);
      setErrorMessage('Failed to delete task.');
    }
  };

  // Timer effect for tracking elapsed time
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isTracking && activeTaskId) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTracking, activeTaskId]);

  // Format seconds to MM:SS or HH:MM:SS
  const formatTime = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Get access token for API calls
  const getAccessToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  };

  // Start tracking a task
  const startTask = async (taskId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setErrorMessage('You must be signed in to track tasks.');
        return;
      }

      const accessToken = await getAccessToken();
      const response = await fetch(`${API_URL}/exec/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: session.user.id,
          taskId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start task tracking');
      }

      setActiveTaskId(taskId);
      setElapsedSeconds(0);
      setIsTracking(true);
      
      // Update local task status
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'in_progress' } : t
        )
      );
      setErrorMessage(null);
    } catch (err: any) {
      console.error('startTask error:', err);
      setErrorMessage('Failed to start task tracking.');
    }
  };

  // Stop tracking a task (pause)
  const stopTask = async (taskId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setErrorMessage('You must be signed in to track tasks.');
        return;
      }

      const accessToken = await getAccessToken();
      const response = await fetch(`${API_URL}/exec/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: session.user.id,
          taskId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to stop task tracking');
      }

      setIsTracking(false);
      setActiveTaskId(null);
      setElapsedSeconds(0);
      setErrorMessage(null);
    } catch (err: any) {
      console.error('stopTask error:', err);
      setErrorMessage('Failed to stop task tracking.');
    }
  };

  // Complete a task
  const completeTask = async (taskId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setErrorMessage('You must be signed in to complete tasks.');
        return;
      }

      const accessToken = await getAccessToken();
      const response = await fetch(`${API_URL}/exec/done`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          userId: session.user.id,
          taskId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to complete task');
      }

      const result = await response.json();
      console.log('Task completed:', result);

      // Stop tracking if this was the active task
      if (activeTaskId === taskId) {
        setIsTracking(false);
        setActiveTaskId(null);
        setElapsedSeconds(0);
      }

      // Update local task status
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'done' } : t
        )
      );
      setErrorMessage(null);
    } catch (err: any) {
      console.error('completeTask error:', err);
      setErrorMessage('Failed to complete task.');
    }
  };

  useEffect(() => {
    fetchTasks();

    // Subscribe to realtime changes on the tasks table
    const setupRealtimeSubscription = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const channel = supabase
        .channel('tasks-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'tasks',
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload) => {
            console.log('Tasks realtime update:', payload);
            // Refresh the task list when any change happens
            fetchTasks();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    const cleanup = setupRealtimeSubscription();
    
    return () => {
      cleanup.then((unsub) => unsub?.());
    };
  }, []);

  return (
    <div className="p-4 max-w-lg mx-auto">
      {errorMessage && (
        <p className="mb-3 text-sm text-red-500">{errorMessage}</p>
      )}

      {/* Task List */}
      <ul className="space-y-3">
        {tasks.length === 0 && (
          <li className="text-center py-8">
            <MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium mb-2">No tasks yet</p>
            <p className="text-gray-400 text-sm">
              Use the chat assistant to create tasks!
            </p>
            <p className="text-gray-400 text-xs mt-2 italic">
              Try: "Create a task to study for my exam by Friday, 2 hours, high priority"
            </p>
          </li>
        )}
        {tasks.map((task) => {
          const isCompleted = task.status === 'done';
          const isActive = activeTaskId === task.id;
          const priorityColor = task.priority === 'high' ? 'bg-red-100 text-red-700' 
            : task.priority === 'med' ? 'bg-yellow-100 text-yellow-700' 
            : 'bg-green-100 text-green-700';
          
          return (
            <li
              key={task.id}
              className={`p-3 border rounded-lg transition-all ${
                isActive ? 'border-indigo-500 bg-indigo-50 shadow-md' : 
                isCompleted ? 'bg-gray-50 border-gray-200' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`font-medium truncate ${
                        isCompleted ? 'line-through text-gray-400' : 'text-gray-800'
                      }`}
                    >
                      {task.title}
                    </span>
                    {task.priority && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor}`}>
                        {task.priority}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {task.est_minutes && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {task.est_minutes}m est
                      </span>
                    )}
                    {task.due_date && (
                      <span>Due: {task.due_date}</span>
                    )}
                    {isActive && isTracking && (
                      <span className="text-indigo-600 font-mono font-semibold animate-pulse">
                        ⏱️ {formatTime(elapsedSeconds)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1">
                  {!isCompleted && (
                    <>
                      {isActive && isTracking ? (
                        <button
                          onClick={() => stopTask(task.id)}
                          className="p-2 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors"
                          title="Stop tracking"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => startTask(task.id)}
                          className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                          title="Start tracking"
                          disabled={isTracking && activeTaskId !== task.id}
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => completeTask(task.id)}
                        className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                        title="Mark as done"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {isCompleted && (
                    <button
                      onClick={() => toggleTask(task)}
                      className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Reopen task"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    title="Delete task"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
