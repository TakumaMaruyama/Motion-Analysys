import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import SupabaseProvider from '../providers/SupabaseProvider';
import StateProvider from '../providers/StateProvider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>
        <SupabaseProvider>
          <StateProvider>
            <div className="min-h-screen flex flex-col">
              <Header />
              <main className="flex-1">
                {children}
              </main>
              <Footer />
            </div>
          </StateProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}