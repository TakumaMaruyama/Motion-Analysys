"use client";

import React from 'react';
import SimpleMotionAnalyzer from '@/components/simple-motion-analyzer';

const Page: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 分析ツールセクション */}
      <section className="py-8 md:py-12">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">モーション分析ツール</h2>
            <p className="max-w-2xl mx-auto text-gray-600 dark:text-gray-400">
              下記のツールを使って、カメラや動画からモーション分析を行うことができます。
            </p>
          </div>

          <div className="max-w-5xl mx-auto">
            <SimpleMotionAnalyzer />
          </div>
        </div>
      </section>
    </div>
  );
};

export default Page;