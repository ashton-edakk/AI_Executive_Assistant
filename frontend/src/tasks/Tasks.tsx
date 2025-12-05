import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Play, Square, CheckCircle, Clock, Trash2, Plus } from 'lucide-react';

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
  const [showModal, setShowModal] = useState(false);

  // structured entry
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'med' | 'high'>('med');
  const [estMinutes, setEstMinutes] = useState<number | ''>('');

  // plain text entry
  const [rawTaskInput, setRawTaskInput] = useState('');

  const [activeTab, setActiveTab] = useState<'structured' | 'plain'>(
    'structured',
  );
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

  // --- Structured create ---
  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || !session.user) {
        setErrorMessage('You must be signed in to create tasks.');
        return;
      }

      const { error } = await supabase.from('tasks').insert({
        user_id: session.user.id,
        title,
        notes: notes || null,
        due_date: dueDate || null,
        priority,
        status: 'todo',
        est_minutes: estMinutes === '' ? null : estMinutes,
      });

      if (error) {
        console.error('createTask error', error);
        setErrorMessage(error.message);
        return;
      }

      // reset & refresh
      setTitle('');
      setNotes('');
      setDueDate('');
      setPriority('med');
      setEstMinutes('');
      setShowModal(false);
      await fetchTasks();
    } catch (err: any) {
      console.error('createTask exception', err);
      setErrorMessage('Failed to create task.');
    }
  };

  // --- Plain text create (uses AI to parse) ---
  const [isParsingTask, setIsParsingTask] = useState(false);
  
  const savePlainTextTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawTaskInput.trim()) return;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || !session.user) {
        setErrorMessage('You must be signed in to create tasks.');
        return;
      }

      setIsParsingTask(true);
      
      // Use the chat API to parse and create the task
      const accessToken = session.access_token;
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          message: `Create a task: ${rawTaskInput}`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse task');
      }

      const result = await response.json();
      
      if (result.task_created) {
        setRawTaskInput('');
        setShowModal(false);
        await fetchTasks();
        setErrorMessage(null);
      } else if (result.needs_clarification) {
        setErrorMessage(`AI needs more info: ${result.response}`);
      } else {
        // Fallback: create basic task if AI doesn't recognize it as task creation
        const { error } = await supabase.from('tasks').insert({
          user_id: session.user.id,
          title: rawTaskInput,
          priority: 'med',
          status: 'todo',
        });

        if (error) {
          throw error;
        }
        
        setRawTaskInput('');
        setShowModal(false);
        await fetchTasks();
      }
    } catch (err: any) {
      console.error('savePlainTextTask exception', err);
      setErrorMessage(err.message || 'Failed to save task.');
    } finally {
      setIsParsingTask(false);
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

  // --- Delete task ---
  const deleteTask = async (id: string) => {
    try {
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
  }, []);

  return (
    <div className="p-4 max-w-lg mx-auto">
      {errorMessage && (
        <p className="mb-3 text-sm text-red-500">{errorMessage}</p>
      )}

      {/* Add Task Button */}
      <button
        onClick={() => setShowModal(true)}
        className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors"
      >
        <Plus className="w-5 h-5" />
        Add Task
      </button>

      {/* Task List */}
      <ul className="space-y-3">
        {tasks.length === 0 && (
          <li className="text-center py-8 text-gray-400">
            No tasks yet. Add one to get started!
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

      {/* Modal Form */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center backdrop-blur-sm bg-black/30 z-50">
          <div className="bg-white p-6 rounded-xl w-full max-w-md relative">
            <h3 className="text-xl font-bold mb-4">Create Task</h3>

            {/* Tab Switcher */}
            <div className="flex mb-4 border-b">
              <button
                className={`flex-1 py-2 text-center ${activeTab === 'structured'
                    ? 'border-b-2 border-blue-500 font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                  }`}
                onClick={() => setActiveTab('structured')}
              >
                Structured Entry
              </button>
              <button
                className={`flex-1 py-2 text-center ${activeTab === 'plain'
                    ? 'border-b-2 border-blue-500 font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                  }`}
                onClick={() => setActiveTab('plain')}
              >
                Plain Text Entry
              </button>
            </div>

            {/* Structured Entry Form */}
            {activeTab === 'structured' && (
              <form onSubmit={createTask} className="space-y-3">
                <div>
                  <label className="block mb-1 font-semibold">Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="border p-2 w-full rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block mb-1 font-semibold">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="border p-2 w-full rounded"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block mb-1 font-semibold">
                    Estimated Minutes
                  </label>
                  <input
                    type="number"
                    value={estMinutes}
                    onChange={(e) =>
                      setEstMinutes(
                        e.target.value === ''
                          ? ''
                          : Number(e.target.value),
                      )
                    }
                    className="border p-2 w-full rounded"
                    placeholder="e.g. 120"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-semibold">
                    Due Date (Date only)
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="border p-2 w-full rounded"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-semibold">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as 'low' | 'med' | 'high')
                    }
                    className="border p-2 w-full rounded"
                  >
                    <option value="low">Low</option>
                    <option value="med">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    className="px-4 py-2 rounded bg-gray-300 hover:bg-gray-400"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            {/* Plain Text Entry Form */}
            {activeTab === 'plain' && (
              <form onSubmit={savePlainTextTask} className="space-y-3">
                <div>
                  <label className="block mb-1 font-semibold">
                    Task Description
                  </label>
                  <textarea
                    value={rawTaskInput}
                    onChange={(e) => setRawTaskInput(e.target.value)}
                    className="border p-2 w-full rounded"
                    rows={5}
                    placeholder='e.g. "Prep for the CS 484 exam by Friday this week, high priority"'
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    className="px-4 py-2 rounded bg-gray-300 hover:bg-gray-400"
                    onClick={() => setShowModal(false)}
                    disabled={isParsingTask}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                    disabled={isParsingTask}
                  >
                    {isParsingTask ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        Parsing with AI...
                      </>
                    ) : (
                      'Save Task (AI Parsed)'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
