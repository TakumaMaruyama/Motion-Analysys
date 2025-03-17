import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import VideoList from '@/components/VideoList';
import UploadVideoButton from '@/components/UploadVideoButton';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

const DashboardPage: React.FC = () => {
  const router = useRouter();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/auth/login');
        return;
      }
      setUserId(session.user.id);
      fetchVideos(session.user.id);
    };

    checkAuth();
  }, [router]);

  const fetchVideos = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setVideos(data || []);
    } catch (error) {
      console.error('Error fetching videos:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 bg-[#ffffff] dark:bg-[#1a1a1a]">
      <Card className="w-full bg-[#f8f8f8] dark:bg-[#2a2a2a]">
        <CardHeader>
          <CardTitle className="text-[#333333] dark:text-[#ffffff]">
            動画ダッシュボード
          </CardTitle>
          <CardDescription className="text-[#666666] dark:text-[#cccccc]">
            アップロードした動画とその分析結果を確認できます
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <UploadVideoButton onUploadComplete={() => fetchVideos(userId || '')} />
          </div>
          {loading ? (
            <div className="text-center py-8 text-[#666666] dark:text-[#cccccc]">
              読み込み中...
            </div>
          ) : (
            <VideoList videos={videos} />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardPage;