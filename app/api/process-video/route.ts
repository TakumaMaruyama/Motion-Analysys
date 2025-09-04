import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const videoFile = formData.get('video') as File;

    if (!videoFile) {
      return NextResponse.json({ error: '動画ファイルが見つかりません' }, { status: 400 });
    }

    // Supabaseに動画をアップロード
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')
      .upload(`original/${Date.now()}-${videoFile.name}`, videoFile);

    if (uploadError) {
      return NextResponse.json({ error: 'アップロードに失敗しました' }, { status: 500 });
    }

    // 動画のURLを返す
    const videoUrl = supabase.storage
      .from('videos')
      .getPublicUrl(uploadData.path).data.publicUrl;

    return NextResponse.json({
      success: true,
      videoUrl: videoUrl,
      videoId: uploadData.path
    });

  } catch (error) {
    console.error('動画処理中にエラーが発生しました:', error);
    return NextResponse.json(
      { error: '動画の処理中にエラーが発生しました' },
      { status: 500 }
    );
  }
}

// Vercel (Node.js Runtime) で動作させる
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
