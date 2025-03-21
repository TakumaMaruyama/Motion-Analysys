"use client";

import React from 'react';

const Header: React.FC = () => {
  return (
    <div className="w-full bg-[#ffffff] dark:bg-[#1a1a1a] border-b border-[#e5e5e5] dark:border-[#333333]">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <a href="/" className="flex items-center space-x-2">
              <span className="text-[#333333] dark:text-[#ffffff] text-xl font-bold">Motion Analysys</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;