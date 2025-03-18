"use client";

import React from 'react';
import { Separator } from '@/components/ui/separator';

const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-[#1a1a1a] text-[#ffffff] py-8">
      <div className="max-w-7xl mx-auto px-4">
        <Separator className="my-6 bg-[#333333]" />
        
        <div className="text-center text-sm text-[#cccccc]">
          © 2024 全身動作分析. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
