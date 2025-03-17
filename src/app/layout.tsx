import React from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SupabaseProvider from '@/providers/SupabaseProvider';
import StateProvider from '@/providers/StateProvider';

const RootLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <html lang="ja">
      <body style={{ backgroundColor: '#ffffff', color: '#333333' }}>
        <SupabaseProvider>
          <StateProvider>
            <div className="min-h-screen flex flex-col">
              <Header />
              
              <main className="flex-1 container mx-auto px-4 py-8" style={{ backgroundColor: '#ffffff' }}>
                {children}
              </main>

              <Footer />
            </div>
          </StateProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
};

export default RootLayout;

export const metadata = {
  title: 'ハンドジェスチャー分析アプリ',
  description: '動画のハンドジェスチャーを分析し、ランドマークを付与するアプリケーション',
};