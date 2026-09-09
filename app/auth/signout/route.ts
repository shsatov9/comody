/**
 * ログアウト。リンク（GET）にしないのは、画像やプリフェッチで勝手に
 * 押されうるため。
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', req.url), 303);
}
