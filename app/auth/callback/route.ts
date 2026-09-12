/**
 * リンクから戻ってくる先。認可コードをセッションに換える。
 *
 * ## 常用の入口ではない
 *
 * ふだんはメールアドレスとパスワードで入る（/auth/signin）。ここが要るのは、
 * Supabase のダッシュボードから「マジックリンク」や「パスワード再設定」の
 * メールを送ったときの受け口として。パスワードを忘れた人を戻す道が、
 * ダッシュボードで直に書き換える以外にもう1本あるほうが詰まらない。
 *
 * Route Handler の cookies() は書けるので、@supabase/ssr の setAll がそのまま効く。
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { safeNext } from '@/lib/origin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = safeNext(req.nextUrl.searchParams.get('next'));

  if (!code) return NextResponse.redirect(new URL('/login?e=no_code', req.url));

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // リンクは1回きりで期限もある。踏み直しではなく、送り直してもらう。
    console.error('セッションの交換に失敗', error.message);
    return NextResponse.redirect(new URL('/login?e=expired', req.url));
  }

  return NextResponse.redirect(new URL(next, req.url));
}
