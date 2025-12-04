import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
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

  // --- Plain text create ---
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

      const { error } = await supabase.from('tasks').insert({
        user_id: session.user.id,
        title: rawTaskInput,
        notes: 'Unprocessed text input',
        priority: 'med',
        status: 'todo',
      });

      if (error) {
        console.error('savePlainTextTask error', error);
        setErrorMessage(error.message);
        return;
      }

      setRawTaskInput('');
      setShowModal(false);
      await fetchTasks();
    } catch (err: any) {
      console.error('savePlainTextTask exception', err);
      setErrorMessage('Failed to save task.');
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

  useEffect(() => {
    fetchTasks();
  }, []);

  return (
    <div className="p-4 max-w-lg mx-auto">
      {errorMessage && (
        <p className="mb-3 text-sm text-red-500">{errorMessage}</p>
      )}

      {/* Task List */}
      <ul className="space-y-2">
        {tasks.map((task) => {
          const isCompleted = task.status === 'done';
          return (
            <li
              key={task.id}
              className="flex justify-between items-center p-2 border rounded"
            >
              <span
                className={`cursor-pointer ${
                  isCompleted ? 'line-through text-gray-500' : ''
                }`}
                onClick={() => toggleTask(task)}
              >
                {task.title}{' '}
                {task.priority && (
                  <span className="text-sm text-gray-400">
                    ({task.priority})
                  </span>
                )}
              </span>
              <button
                className="text-red-500"
                onClick={() => deleteTask(task.id)}
              >
                ✕
              </button>
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
                className={`flex-1 py-2 text-center ${
                  activeTab === 'structured'
                    ? 'border-b-2 border-blue-500 font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('structured')}
              >
                Structured Entry
              </button>
              <button
                className={`flex-1 py-2 text-center ${
                  activeTab === 'plain'
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
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600"
                  >
                    Save Task
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
