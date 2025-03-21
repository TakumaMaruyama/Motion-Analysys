import React from 'react';
import { MotionAnalyzer } from '../../components/motion-analyzer';

export default function MotionAnalysisPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold mb-8 text-center text-[#2c3e50] dark:text-white">Motion Analysis</h1>
      <div className="max-w-4xl mx-auto">
        <MotionAnalyzer />
      </div>
    </div>
  );
}
