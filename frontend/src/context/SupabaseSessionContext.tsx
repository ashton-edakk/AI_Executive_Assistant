import React, { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";

// --- Supabase Config ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

// --- Context Types ---
interface SupabaseContextType {
  supabase: SupabaseClient;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// --- Create Context ---
const SupabaseContext = createContext<SupabaseContextType | undefined>(undefined);

// --- Provider ---
export const SupabaseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setLoading(false);
    };
    initSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <SupabaseContext.Provider value={{ supabase, session, loading, signOut }}>
      {children}
    </SupabaseContext.Provider>
  );
};

// --- Hook for convenience ---
export const useSupabase = (): SupabaseContextType => {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error("useSupabase must be used within a SupabaseProvider");
  }
  return context;
};
