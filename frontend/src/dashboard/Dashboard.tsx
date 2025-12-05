import React, { useEffect, useState } from "react";
import { useSupabase } from "../context/SupabaseSessionContext";
import Tasks from "../tasks/Tasks";
import Insights from "./Insights";
import { ChevronLeft, ChevronRight, Calendar, MessageCircle, CircleCheckBig } from "lucide-react";
import ChatBot from "../assistant/ChatBot";

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

interface EventsByWeek {
  weekLabel: string;
  weekStart: Date;
  weekEnd: Date;
  events: CalendarEvent[];
}

const Dashboard: React.FC = () => {
  const { session } = useSupabase();
  const [allEventsByWeek, setAllEventsByWeek] = useState<EventsByWeek[]>([]);
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false); 

  /**
   * Groups Google Calendar events into weekly buckets starting on Monday
   */
  const groupEventsByWeek = (events: CalendarEvent[]): EventsByWeek[] => {
    const weeks: { [key: string]: EventsByWeek } = {};

    events.forEach((event) => {
      const dateStr = event.start?.dateTime || event.start?.date;
      if (!dateStr) return;

      const eventDate = new Date(dateStr);
      
      // Calculate week start (Monday)
      const weekStart = new Date(eventDate);
      const dayOfWeek = eventDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days
      weekStart.setDate(eventDate.getDate() + daysToMonday);
      weekStart.setHours(0, 0, 0, 0);

      // Calculate week end (Sunday)
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const weekKey = weekStart.toISOString();

      if (!weeks[weekKey]) {
        const weekLabel = weekStart.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        
        weeks[weekKey] = {
          weekLabel,
          weekStart,
          weekEnd,
          events: [],
        };
      }

      weeks[weekKey].events.push(event);
    });

    // Sort weeks chronologically
    return Object.values(weeks)
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
  };

  /**
   * Generate empty weeks for the next 6 months including current week
   */
  const generateAllWeeks = (events: CalendarEvent[]): EventsByWeek[] => {
    const eventWeeks = groupEventsByWeek(events);
    const allWeeks: EventsByWeek[] = [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate 6 months from now
    const sixMonthsFromNow = new Date(today);
    sixMonthsFromNow.setMonth(today.getMonth() + 6);
    sixMonthsFromNow.setHours(23, 59, 59, 999);

    // Find the Monday of the current week
    const currentWeekStart = new Date(today);
    const currentDayOfWeek = today.getDay();
    const daysToMonday = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
    currentWeekStart.setDate(today.getDate() + daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);

    // Generate all weeks from current week to 6 months from now
    let weekStart = new Date(currentWeekStart);
    
    while (weekStart <= sixMonthsFromNow) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const existingWeek = eventWeeks.find(w => w.weekStart.getTime() === weekStart.getTime());
      
      const weekLabel = weekStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

      allWeeks.push({
        weekLabel,
        weekStart: new Date(weekStart),
        weekEnd: new Date(weekEnd),
        events: existingWeek ? existingWeek.events : []
      });

      // Move to next week (add 7 days)
      weekStart = new Date(weekStart);
      weekStart.setDate(weekStart.getDate() + 7);
    }

    return allWeeks;
  };

  const currentWeek = allEventsByWeek[currentWeekIndex] || {
    weekLabel: "",
    weekStart: new Date(),
    weekEnd: new Date(),
    events: [],
  };

  const canGoPrevious = currentWeekIndex > 0;
  const canGoNext = currentWeekIndex < allEventsByWeek.length - 1;

  const goToPreviousWeek = () => {
    if (canGoPrevious) {
      setCurrentWeekIndex(currentWeekIndex - 1);
    }
  };

  const goToNextWeek = () => {
    if (canGoNext) {
      setCurrentWeekIndex(currentWeekIndex + 1);
    }
  };

  useEffect(() => {
    if (!session) return;

    const fetchCalendarEvents = async () => {
      setLoading(true);
      setError("");

      try {
        // Get the Google access token from Supabase session
        const providerToken = session.provider_token;
        
        if (!providerToken) {
          throw new Error("No Google access token available");
        }

        // Calculate date range: today to 6 months from now
        const now = new Date().toISOString();
        const sixMonthsFromNow = new Date();
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
        const timeMax = sixMonthsFromNow.toISOString();

        // Include all event types by not filtering
        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${now}&timeMax=${timeMax}&maxResults=2500`;
        
        const response = await fetch(url, {
          headers: { 
            'Authorization': `Bearer ${providerToken}` 
          },
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Google Calendar access denied. Please sign in again.");
          }
          const errData = await response.json();
          throw new Error(errData.error?.message || "Failed to fetch events");
        }

        const data = await response.json();
        const events: CalendarEvent[] = data.items || [];
        
        // Generate all weeks (including empty ones) for the next 6 months
        const allWeeks = generateAllWeeks(events);
        setAllEventsByWeek(allWeeks);
        
        // Start at the current week (index 0)
        setCurrentWeekIndex(0);
      } catch (err) {
        console.error("Error fetching calendar events:", err);
        setError(err instanceof Error ? err.message : "An error occurred while fetching events");
      } finally {
        setLoading(false);
      }
    };

    fetchCalendarEvents();
  }, [session]);

  // Format date for display
  const formatEventDate = (event: CalendarEvent) => {
    if (event.start?.dateTime) {
      return new Date(event.start.dateTime).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (event.start?.date) {
      return new Date(event.start.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      }) + " (All day)";
    }
    return "No start date";
  };

  // Format week range for display
  const formatWeekRange = (weekStart: Date, weekEnd: Date) => {
    const startStr = weekStart.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
    const endStr = weekEnd.toLocaleDateString(undefined, {
      month: weekStart.getMonth() === weekEnd.getMonth() ? 'numeric' : 'short',
      day: 'numeric',
      year: weekStart.getFullYear() !== weekEnd.getFullYear() ? 'numeric' : undefined
    });
    
    // Include year if it's different from current year or spans year boundary
    const currentYear = new Date().getFullYear();
    const showYear = weekStart.getFullYear() !== currentYear || weekEnd.getFullYear() !== currentYear;
    
    if (showYear) {
      return `${startStr} - ${endStr}`;
    }
    return `${startStr} - ${endStr}`;
  };

  // Check if a week is the current week
  const isCurrentWeek = (weekStart: Date, weekEnd: Date) => {
    const today = new Date();
    return today >= weekStart && today <= weekEnd;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      {/* Floating Chat Button */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-6 right-6 bg-indigo-600 text-white p-4 rounded-full shadow-lg hover:bg-indigo-700 transition-colors z-40 flex items-center gap-2"
        >
          <MessageCircle className="w-6 h-6" />
          <span className="font-semibold">Chat with Assistant</span>
        </button>
      )}

      {/* Chat Component */}
      <ChatBot isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

      <div className="flex gap-6 w-full max-w-6xl">
        {/* Calendar Section */}
        <div className="bg-white p-6 rounded-xl shadow-md w-2/3">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-8 h-8" />
              Your Google Calendar
            </h1>
            <div className="flex gap-2">
              <button 
                onClick={() => window.location.reload()} 
                className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg text-sm"
              >
                Refresh Events
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="text-indigo-600 font-medium flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading calendar events...
              </div>
            </div>
          )}
          
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-700 font-medium">Error: {error}</p>
              <button 
                onClick={() => window.location.hash = ''}
                className="text-red-600 underline text-sm mt-2"
              >
                Return to home
              </button>
            </div>
          )}

          {!loading && !error && allEventsByWeek.length > 0 && (
            <div className="space-y-4">
              {/* Week Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={goToPreviousWeek}
                  disabled={!canGoPrevious}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    canGoPrevious
                      ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
                      : "bg-gray-50 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous Week
                </button>

                <div className="text-center">
                  <h2 className="text-xl font-bold text-gray-800">
                    {formatWeekRange(currentWeek.weekStart, currentWeek.weekEnd)}
                    {isCurrentWeek(currentWeek.weekStart, currentWeek.weekEnd) && (
                      <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full">
                        Current Week
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-500">
                    Week {currentWeekIndex + 1} of {allEventsByWeek.length} • {currentWeek.events.length} event{currentWeek.events.length === 1 ? '' : 's'}
                  </p>
                </div>

                <button
                  onClick={goToNextWeek}
                  disabled={!canGoNext}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    canGoNext
                      ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
                      : "bg-gray-50 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Next Week
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Events for Current Week */}
              <div className="border border-gray-200 rounded-lg p-4 min-h-[400px]">
                {currentWeek.events.length === 0 ? (
                  <div className="text-center py-16">
                    <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 text-lg mb-2">No events scheduled for this week</p>
                    <p className="text-gray-400 text-sm">Events from your Google Calendar will appear here when scheduled</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100 space-y-2">
                    {currentWeek.events.map((event) => (
                      <li key={event.id} className="py-3 hover:bg-gray-50 px-3 rounded transition-colors border border-gray-100">
                        <p className="text-lg font-semibold text-gray-800 mb-1">
                          {event.summary || "Untitled Event"}
                        </p>
                        <p className="text-sm text-gray-600 flex items-center gap-1">
                          <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
                          {formatEventDate(event)}
                        </p>
                        {event.end && (
                          <p className="text-xs text-gray-500 mt-1">
                            Duration: {(() => {
                              const start = event.start?.dateTime || event.start?.date;
                              const end = event.end?.dateTime || event.end?.date;
                              if (start && end) {
                                const startDate = new Date(start);
                                const endDate = new Date(end);
                                const diffMs = endDate.getTime() - startDate.getTime();
                                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                                const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                                
                                if (diffHours > 0) {
                                  return `${diffHours}h ${diffMinutes}m`;
                                }
                                return `${diffMinutes}m`;
                              }
                              return "Unknown duration";
                            })()}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Tasks + Insights */}
        <div className="w-1/3 space-y-6">
          {/* Tasks Section */}
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-4">
              <CircleCheckBig className="w-6 h-6" />
              Your Tasks
            </h1>
            <Tasks />
          </div>

          {/* Insights Section */}
          <div className="bg-white p-6 rounded-xl shadow-md">
            <Insights />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;