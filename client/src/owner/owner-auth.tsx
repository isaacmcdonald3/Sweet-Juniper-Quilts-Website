import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseClient } from "../services/supabase";

interface OwnerAuthValue {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  sessionError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const OwnerAuthContext = createContext<OwnerAuthValue | null>(null);

export function OwnerAuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    if (!supabaseClient) {
      setLoading(false);
      return;
    }

    let active = true;
    const { data: subscription } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setSessionError("");
        setLoading(false);
      }
    });

    void supabaseClient.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setSession(null);
        setSessionError("Your saved sign-in could not be restored. Please sign in again.");
      } else {
        setSession(data.session);
        setSessionError("");
      }
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<OwnerAuthValue>(() => ({
    session,
    loading,
    configured: Boolean(supabaseClient),
    sessionError,
    signIn: async (email, password) => {
      if (!supabaseClient) throw new Error("Owner sign-in is not configured.");
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw new Error("Sign-in failed. Check your email and password.");
    },
    signOut: async () => {
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw new Error("Sign out could not be completed. Please try again.");
    },
  }), [loading, session, sessionError]);

  return <OwnerAuthContext.Provider value={value}>{children}</OwnerAuthContext.Provider>;
}

export function useOwnerAuth(): OwnerAuthValue {
  const value = useContext(OwnerAuthContext);
  if (!value) throw new Error("useOwnerAuth must be used within OwnerAuthProvider.");
  return value;
}
