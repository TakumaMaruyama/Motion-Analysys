import React from 'react';
import SimpleMotionAnalyzer from '@/components/simple-motion-analyzer';

const Page: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8 text-center text-[#2c3e50] dark:text-white">
          モーションビジョン
        </h1>
        <SimpleMotionAnalyzer />
      </div>
    </div>
  );
};

export default Page;