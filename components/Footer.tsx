"use client";

import React from 'react';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { Github, Mail, Twitter } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-8 mt-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Motion Analysis</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              高精度な全身動作分析を提供するプラットフォームです。スポーツ、リハビリ、エンターテイメントなど様々な分野でご活用いただけます。
            </p>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">リンク</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/" className="text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground text-sm">
                  ホーム
                </Link>
              </li>
              <li>
                <Link href="/motion-analysis" className="text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground text-sm">
                  動作分析
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground text-sm">
                  ダッシュボード
                </Link>
              </li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">お問い合わせ</h3>
            <ul className="space-y-2">
              <li className="flex items-center space-x-2">
                <Mail size={16} className="text-gray-600 dark:text-gray-400" />
                <a href="mailto:info@motion-analysis.jp" className="text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground text-sm">
                  info@motion-analysis.jp
                </a>
              </li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">ソーシャル</h3>
            <div className="flex space-x-4">
              <a href="https://github.com" className="text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground" target="_blank" rel="noopener noreferrer">
                <Github size={20} />
              </a>
              <a href="https://twitter.com" className="text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground" target="_blank" rel="noopener noreferrer">
                <Twitter size={20} />
              </a>
            </div>
          </div>
        </div>
        
        <Separator className="my-8 bg-gray-200 dark:bg-gray-800" />
        
        <div className="flex flex-col md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            © 2024 Motion Analysis. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex space-x-4">
            <Link href="/terms" className="text-xs text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground">
              利用規約
            </Link>
            <Link href="/privacy" className="text-xs text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-foreground">
              プライバシーポリシー
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
