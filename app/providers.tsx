"use client";

import SupabaseProvider from '../providers/SupabaseProvider';
import StateProvider from '../providers/StateProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SupabaseProvider>
      <StateProvider>
        {children}
      </StateProvider>
    </SupabaseProvider>
  );
}