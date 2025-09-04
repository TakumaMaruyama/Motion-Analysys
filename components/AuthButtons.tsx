"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const AuthButtons: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    };
    checkAuth();
  }, []);

  const handleLogin = () => {
    router.push('/auth/login');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    router.push('/');
  };

  return (
    <div>
      {!isAuthenticated ? (
        <>
          <Button 
            onClick={handleLogin}
            className="w-full bg-[#3B82F6] text-white hover:bg-[#2563EB]"
          >
            ログイン
          </Button>
        </>
      ) : (
        <Button 
          variant="outline" 
          onClick={handleLogout}
          className="w-full border-[#3B82F6] text-[#3B82F6] hover:bg-[#EFF6FF]"
        >
          ログアウト
        </Button>
      )}
    </div>
  );
};

export default AuthButtons;
