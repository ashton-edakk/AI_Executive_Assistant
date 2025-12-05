import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  BarChart3, 
  Clock, 
  Target, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Loader2
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:8080';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface DailyInsights {
  date: string;
  minutes: {
    planned: number;
    confirmed: number;
    executed: number;
    calendarBusy: number;
  };
  slipped: Array<{ taskId: string; title: string }>;
  estimationBias: number;
}

interface WeeklyInsights {
  weekStart: string;
  minutes: {
    planned: number;
    confirmed: number;
    executed: number;
  };
  estimationBias: number;
}

export default function Insights() {
  const [daily, setDaily] = useState<DailyInsights | null>(null);
  const [weekly, setWeekly] = useState<WeeklyInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setError('Please sign in to view insights');
        setLoading(false);
        return;
      }

      const accessToken = session.access_token;
      const today = new Date().toISOString().split('T')[0];

      // Fetch daily insights
      const dailyRes = await fetch(`${API_URL}/insights/daily`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ userId: session.user.id, date: today }),
      });

      // Fetch weekly insights
      const weeklyRes = await fetch(`${API_URL}/insights/weekly`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ userId: session.user.id, date: today }),
      });

      if (dailyRes.ok) {
        const dailyData = await dailyRes.json();
        setDaily(dailyData);
      }

      if (weeklyRes.ok) {
        const weeklyData = await weeklyRes.json();
        setWeekly(weeklyData);
      }

      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch insights:', err);
      setError('Could not load insights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  const formatMinutes = (mins: number): string => {
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  };

  const getBiasLabel = (bias: number): { label: string; color: string; icon: 'up' | 'down' | 'neutral' } => {
    if (bias > 0.15) return { label: 'Underestimating', color: 'text-orange-600', icon: 'up' };
    if (bias < -0.15) return { label: 'Overestimating', color: 'text-blue-600', icon: 'down' };
    return { label: 'Accurate', color: 'text-green-600', icon: 'neutral' };
  };

  const getCompletionPercentage = (executed: number, planned: number): number => {
    if (planned === 0) return 0;
    return Math.round((executed / planned) * 100);
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
          <span className="ml-2 text-indigo-600">Loading insights...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-6 border border-red-100">
        <p className="text-red-600 text-center">{error}</p>
      </div>
    );
  }

  const dailyCompletion = daily ? getCompletionPercentage(daily.minutes.executed, daily.minutes.planned) : 0;
  const weeklyCompletion = weekly ? getCompletionPercentage(weekly.minutes.executed, weekly.minutes.planned) : 0;
  const biasInfo = daily ? getBiasLabel(daily.estimationBias) : getBiasLabel(0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-6 h-6 text-indigo-600" />
        <h2 className="text-xl font-bold text-gray-800">Productivity Insights</h2>
      </div>

      {/* Today's Progress Card */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            <span className="font-semibold">Today's Progress</span>
          </div>
          <span className="text-3xl font-bold">{dailyCompletion}%</span>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-white/20 rounded-full h-3 mb-3">
          <div 
            className="bg-white rounded-full h-3 transition-all duration-500"
            style={{ width: `${Math.min(dailyCompletion, 100)}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center">
            <p className="text-white/70">Planned</p>
            <p className="font-bold">{formatMinutes(daily?.minutes.planned || 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-white/70">Scheduled</p>
            <p className="font-bold">{formatMinutes(daily?.minutes.confirmed || 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-white/70">Worked</p>
            <p className="font-bold">{formatMinutes(daily?.minutes.executed || 0)}</p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Weekly Progress */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-green-600" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">This Week</span>
          </div>
          <p className="text-2xl font-bold text-gray-800">{weeklyCompletion}%</p>
          <p className="text-xs text-gray-500">
            {formatMinutes(weekly?.minutes.executed || 0)} / {formatMinutes(weekly?.minutes.planned || 0)}
          </p>
        </div>

        {/* Estimation Accuracy */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            {biasInfo.icon === 'up' && <TrendingUp className="w-4 h-4 text-orange-600" />}
            {biasInfo.icon === 'down' && <TrendingDown className="w-4 h-4 text-blue-600" />}
            {biasInfo.icon === 'neutral' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
            <span className="text-xs text-gray-500 uppercase tracking-wide">Estimates</span>
          </div>
          <p className={`text-lg font-bold ${biasInfo.color}`}>{biasInfo.label}</p>
          <p className="text-xs text-gray-500">
            {daily?.estimationBias !== undefined 
              ? `${daily.estimationBias > 0 ? '+' : ''}${(daily.estimationBias * 100).toFixed(0)}% bias`
              : 'No data yet'
            }
          </p>
        </div>
      </div>

      {/* Calendar Busy Time */}
      {daily && daily.minutes.calendarBusy > 0 && (
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">
              {formatMinutes(daily.minutes.calendarBusy)} in meetings today
            </span>
          </div>
        </div>
      )}

      {/* Slipped Tasks Warning */}
      {daily && daily.slipped.length > 0 && (
        <div className="bg-red-50 rounded-xl p-4 border border-red-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span className="text-sm font-medium text-red-800">
              {daily.slipped.length} task{daily.slipped.length > 1 ? 's' : ''} slipped today
            </span>
          </div>
          <ul className="text-xs text-red-600 space-y-1">
            {daily.slipped.slice(0, 3).map((task) => (
              <li key={task.taskId} className="truncate">• {task.title}</li>
            ))}
            {daily.slipped.length > 3 && (
              <li className="text-red-400">+ {daily.slipped.length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Empty State */}
      {(!daily || (daily.minutes.planned === 0 && daily.minutes.executed === 0)) && (
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-center">
          <p className="text-gray-500 text-sm">
            Start tracking tasks to see your productivity insights!
          </p>
        </div>
      )}
    </div>
  );
}

