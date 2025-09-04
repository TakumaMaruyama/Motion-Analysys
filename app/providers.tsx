"use client";

import { ThemeProvider } from 'next-themes';
import React from 'react';
import SupabaseProvider from '../providers/SupabaseProvider';
import StateProvider from '../providers/StateProvider';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SupabaseProvider>
        <StateProvider>
          {children}
        </StateProvider>
      </SupabaseProvider>
    </ThemeProvider>
  );
}