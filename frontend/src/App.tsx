import React, { useState, useEffect } from 'react';
import { LogIn, Calendar, CheckCircle, Sparkles, Clock, Brain, Mic, Zap, BarChart } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import Dashboard from './dashboard/Dashboard';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Google OAuth config for the *direct* Calendar connect flow
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = import.meta.env.VITE_GOOGLE_REDIRECT_URI;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Shared between Supabase Sign-In and our direct Google OAuth flow.
const GOOGLE_OAUTH_SCOPES = [
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

interface UserSession {
  id: string;
  email: string;
  full_name: string;
}

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; description: string; delay: string }> = ({ icon, title, description, delay }) => (
  <div 
    className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
    style={{ animationDelay: delay }}
  >
    <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-cyan-600 rounded-xl flex items-center justify-center mb-4 shadow-lg">
      {icon}
    </div>
    <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600 text-sm leading-relaxed">{description}</p>
  </div>
);

const App: React.FC = () => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<'home' | 'dashboard'>('home');

  // --- Handle hash changes for simple routing ---
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#dashboard') setPage('dashboard');
      else setPage('home');
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // --- Optional: ensure user exists in backend users table ---
  const ensureUser = async (accessToken: string) => {
    try {
      const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
      const res = await fetch(`${API_URL}/api/auth/ensure-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.error('Failed to ensure user:', await res.text());
      }
    } catch (err) {
      console.error('Error ensuring user:', err);
    }
  };

  // --- Initial session check + auth state listener ---
  useEffect(() => {
    const checkSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session && session.user) {
          // make sure there is a matching row in the backend users table
          await ensureUser(session.access_token);

          setSession({
            id: session.user.id,
            email: session.user.email || '',
            full_name: session.user.user_metadata.full_name || 'User',
          });
        } else {
          setSession(null);
        }
      } catch (error) {
        console.error('Error checking session:', error);
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session && session.user) {
          await ensureUser(session.access_token);
          setSession({
            id: session.user.id,
            email: session.user.email || '',
            full_name: session.user.user_metadata.full_name || 'User',
          });
        } else {
          setSession(null);
        }
      },
    );

    return () => {
      if (authListener && authListener.subscription) {
        authListener.subscription.unsubscribe();
      }
    };
  }, []);

  // --- Handler for Supabase Google Sign In ---
  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: GOOGLE_OAUTH_SCOPES,
          redirectTo: window.location.origin,
        },
      });

      if (error) {
        console.error('Error initiating Google Sign In:', error.message);
        setLoading(false);
      }
      // On success, browser redirects; no further JS here.
    } catch (error) {
      console.error('Error initiating Google Sign In:', error);
      setLoading(false);
    }
  };

  // --- Handler for *connecting* Google Calendar (direct OAuth) ---
  const handleConnectGoogleCalendar = () => {
    if (!session) return;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
      console.error(
        'VITE_GOOGLE_CLIENT_ID or VITE_GOOGLE_REDIRECT_URI is not set in the frontend env.',
      );
      return;
    }

    const state = JSON.stringify({ userId: session.id });

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_OAUTH_SCOPES,
      state,
    });

    window.location.href =
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  // --- Sign out handler ---
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setPage('home');
  };

  const goToDashboard = () => {
    window.location.hash = '#dashboard';
  };

  // --- Loading screen ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 flex flex-col items-center justify-center p-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-teal-400/30 rounded-full"></div>
          <div className="w-16 h-16 border-4 border-teal-400 rounded-full border-t-transparent animate-spin absolute top-0 left-0"></div>
        </div>
        <p className="mt-6 text-teal-300 font-medium tracking-wide">Initializing...</p>
      </div>
    );
  }

  // --- If logged in and on #dashboard, show dashboard ---
  if (session && page === 'dashboard') {
    return <Dashboard />;
  }

  // --- Signed in welcome screen ---
  if (session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>

        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-2xl shadow-2xl mb-6 rotate-3 hover:rotate-0 transition-transform">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white mb-4">
              Welcome back, <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-400">{session.full_name?.split(' ')[0] || 'there'}!</span>
            </h1>
            <p className="text-slate-400 text-lg">
              Signed in as <span className="text-teal-400 font-medium">{session.email}</span>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <button
              onClick={goToDashboard}
              className="group px-8 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40 transition-all duration-300 hover:-translate-y-1 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5 group-hover:animate-pulse" />
              Open Dashboard
            </button>

            <button
              onClick={handleConnectGoogleCalendar}
              className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-xl border border-white/20 hover:bg-white/20 transition-all duration-300 flex items-center justify-center gap-2"
            >
              <Calendar className="w-5 h-5" />
              Connect Calendar
            </button>

            <button
              onClick={handleSignOut}
              className="px-8 py-4 text-slate-400 hover:text-white font-semibold transition-colors"
            >
              Sign Out
            </button>
          </div>

          <p className="text-slate-500 text-sm text-center max-w-md">
            Your calendar is connected. Head to the dashboard to start planning your day!
          </p>
        </div>
      </div>
    );
  }

  // --- Signed out landing page ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-40 right-20 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }}></div>
        <div className="absolute bottom-20 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        
        {/* Grid pattern */}
        <div className="absolute inset-0" style={{ 
          backgroundImage: 'linear-gradient(rgba(45, 212, 191, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(45, 212, 191, 0.03) 1px, transparent 1px)',
          backgroundSize: '64px 64px'
        }}></div>
      </div>

      <div className="relative z-10">
        {/* Hero Section */}
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
          {/* Logo */}
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-2xl shadow-2xl shadow-teal-500/25 rotate-3 hover:rotate-0 transition-transform duration-300">
              <Brain className="w-10 h-10 text-white" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-5xl md:text-7xl font-black text-white mb-6 tracking-tight">
            <span className="block">AI Executive</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 via-cyan-400 to-emerald-400">
              Assistant
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-slate-400 max-w-2xl mb-4 leading-relaxed">
            Transform your daily check-ins into 
            <span className="text-teal-400 font-semibold"> intelligent schedules</span>
          </p>
          <p className="text-slate-500 max-w-xl mb-10">
            Voice-first productivity powered by AI. Tell us your tasks, and we'll optimize your calendar, track your progress, and help you accomplish more.
          </p>

          {/* CTA Button */}
          <button
            onClick={handleGoogleSignIn}
            className="group relative px-10 py-5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-bold text-lg rounded-2xl shadow-2xl shadow-teal-500/30 hover:shadow-teal-500/50 transition-all duration-300 hover:-translate-y-1 flex items-center justify-center gap-3"
          >
            <LogIn className="w-6 h-6" />
            Sign In with Google
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-teal-400 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity blur-xl -z-10"></div>
          </button>

          <p className="mt-6 text-slate-600 text-sm flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Requires Google Calendar access
          </p>

          {/* Scroll indicator */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce">
            <div className="w-6 h-10 border-2 border-slate-600 rounded-full flex items-start justify-center p-1">
              <div className="w-1.5 h-3 bg-teal-400 rounded-full animate-pulse"></div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
              Everything you need to 
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-400"> stay productive</span>
            </h2>
            <p className="text-slate-400 text-center mb-16 max-w-2xl mx-auto">
              Powered by advanced AI to understand your tasks and optimize your schedule automatically.
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard
                icon={<Mic className="w-6 h-6 text-white" />}
                title="Voice-First Input"
                description="Just speak or type naturally. 'I need to finish the report by Friday, about 2 hours work, high priority.'"
                delay="0ms"
              />
              <FeatureCard
                icon={<Brain className="w-6 h-6 text-white" />}
                title="AI Task Parsing"
                description="Our AI extracts title, duration, due date, and priority from your natural language input."
                delay="100ms"
              />
              <FeatureCard
                icon={<Calendar className="w-6 h-6 text-white" />}
                title="Smart Scheduling"
                description="Automatically schedules tasks around your meetings, respecting your working hours and preferences."
                delay="200ms"
              />
              <FeatureCard
                icon={<Clock className="w-6 h-6 text-white" />}
                title="Time Tracking"
                description="Track actual time spent on tasks. The AI learns from this to improve future estimates."
                delay="300ms"
              />
              <FeatureCard
                icon={<Zap className="w-6 h-6 text-white" />}
                title="Dynamic Replanning"
                description="Meetings moved? Plans changed? The assistant automatically adjusts your schedule."
                delay="400ms"
              />
              <FeatureCard
                icon={<BarChart className="w-6 h-6 text-white" />}
                title="Productivity Insights"
                description="See daily and weekly stats: planned vs completed hours, estimation accuracy, and more."
                delay="500ms"
              />
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="py-20 px-6 text-center">
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-6">
            Ready to take control of your time?
          </h3>
          <button
            onClick={handleGoogleSignIn}
            className="px-8 py-4 bg-white text-slate-900 font-bold rounded-xl hover:bg-teal-100 transition-colors shadow-xl"
          >
            Get Started Free
          </button>
          <p className="mt-4 text-slate-500 text-sm">No credit card required</p>
        </div>
      </div>
    </div>
  );
};

export default App;
