import { supabase, listMyTenants, type PayRakshaTenant } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  isAnonymous: boolean;
  role: string | null;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
}

interface UseAuthReturn {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  signIn: {
    emailOtp: (email: string) => Promise<void>;
    verifyOtp: (email: string, token: string) => Promise<void>;
    signInWithPassword: (email: string, password: string) => Promise<void>;
  };
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  const loadUser = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      setUser(null);
      return;
    }

    try {
      const { data: { user: supaUser } } = await supabase.auth.getUser();
      if (!supaUser) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      // Resolve tenant + role from Supabase server-side
      const tenants = await listMyTenants();
      const tenant: PayRakshaTenant | undefined = tenants.ok ? tenants.data[0] : undefined;

      setUser({
        id: supaUser.id,
        email: supaUser.email ?? null,
        name: supaUser.user_metadata?.full_name
          ?? supaUser.user_metadata?.name
          ?? supaUser.email?.split("@")[0]
          ?? "User",
        isAnonymous: supaUser.is_anonymous ?? false,
        role: tenant?.role ?? null,
        tenantId: tenant?.tenant_id ?? null,
        tenantSlug: tenant?.slug ?? null,
        tenantName: tenant?.name ?? null,
      });
    } catch (err) {
      console.error("[useAuth] Failed to load user:", err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();

    // Listen for auth state changes
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => subscription.unsubscribe();
  }, [loadUser]);

  const signIn = {
    emailOtp: async (email: string) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
    },

    verifyOtp: async (email: string, token: string) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (error) throw error;
      await loadUser();
    },

    signInWithPassword: async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      await loadUser();
    },
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  };

  return {
    isLoading,
    isAuthenticated: Boolean(user),
    user,
    signIn,
    signOut,
  };
}
