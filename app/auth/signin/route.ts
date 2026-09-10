/**
 * ログインの申し込み。メールアドレスを受け取ってマジックリンクを送る。
 *
 * パスワードを持たない。2人で使うアプリで、パスワードの保管と再発行を
 * 抱える理由がない。
 *
 * ## 成否を画面に出し分けない
 *
 * 登録済みのアドレスかどうかで応答を変えると、「このアドレスはこのサービスを
 * 使っている」を誰でも確かめられる口になる。送れても送れなくても同じ画面に返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { originOf, safeNext } from '@/lib/origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get('email') ?? '').trim();
  const next = safeNext(form?.get('next'));

  if (!email || !email.includes('@')) {
    return NextResponse.redirect(new URL('/login?e=bad_email', req.url), 303);
  }

  try {
    const supabase = await supabaseServer();
    // 戻り先を callback に渡す。PKCE の検証子はこの往復のあいだ Cookie に載る。
    const redirect = `${originOf(req)}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    // 返り値の error を見る。supabase-js は送信の失敗を throw ではなく返り値で
    // 返すので、catch に任せきりだと「送れていない」がどこにも出ない。画面には
    // 出さないと決めた以上、ログだけが気付く手段なので、ここで拾い切る。
    if (error) console.error('マジックリンクの送信に失敗', error.message);
  } catch (err) {
    // 送れなかったことも画面には出さない。ログで気付く。
    console.error('マジックリンクの送信に失敗', err);
  }

  return NextResponse.redirect(new URL('/login?sent=1', req.url), 303);
}
