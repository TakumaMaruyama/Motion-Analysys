import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // ファイルをバッファに変換
    const buffer = Buffer.from(await file.arrayBuffer());

    // Supabaseにアップロード
    const { data, error } = await supabase.storage
      .from('videos')
      .upload(`uploads/${file.name}`, buffer);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error processing video:', error);
    return NextResponse.json(
      { error: 'Error processing video' },
      { status: 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};