"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isSupabaseEnabled } from '../lib/storage-adapter';

interface SupabaseContextType {
  supabase: any;
  user: User | null;
  loading: boolean;
  isEnabled: boolean;
}

const SupabaseContext = createContext<SupabaseContextType>({
  supabase,
  user: null,
  loading: true,
  isEnabled: false,
});

export const useSupabase = () => useContext(SupabaseContext);

const SupabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const enabled = isSupabaseEnabled();

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }: any) => {
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [enabled]);

  const value = {
    supabase,
    user,
    loading,
    isEnabled: enabled,
  };

  return (
    <SupabaseContext.Provider value={value}>
      <div className="bg-white dark:bg-gray-800 min-h-screen">
        {loading ? (
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900 dark:border-white"></div>
          </div>
        ) : (
          children
        )}
      </div>
    </SupabaseContext.Provider>
  );
};

export default SupabaseProvider; // または export { SupabaseProvider }