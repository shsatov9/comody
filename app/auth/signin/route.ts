/**
 * ログイン。メールアドレスとパスワードを受け取ってセッションを立てる。
 *
 * ## 成否の文言を分けない
 *
 * 「そのアドレスは登録が無い」と「パスワードが違う」を出し分けると、
 * 「このアドレスはこのサービスを使っている」を誰でも確かめられる口になる。
 * Supabase はこの2つに同じエラーを返すので、こちらも1つの文言に畳む。
 * 理由はログにだけ残す。
 *
 * ## セッションはここで立つ
 *
 * Route Handler の cookies() は書けるので、@supabase/ssr の setAll がそのまま
 * 効く。以降の更新は proxy.ts が毎リクエストで済ませる。
 *
 * ## 登録と再発行はこの画面に無い
 *
 * 使うのは所帯の2人だけなので、人を増やすのもパスワードを直すのも Supabase の
 * ダッシュボードから行う（README「入る人を増やす」）。画面を3枚作っても
 * 一度ずつしか通らない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { safeNext } from '@/lib/origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get('email') ?? '').trim();
  const password = String(form?.get('password') ?? '');
  const next = safeNext(form?.get('next'));

  // 失敗しても戻り先は持ち帰る。入れた直後に行きたかった画面へ送るため。
  const fail = () => {
    const url = new URL('/login', req.url);
    url.searchParams.set('e', 'bad_credentials');
    if (next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url, 303);
  };

  if (!email || !password) return fail();

  try {
    const supabase = await supabaseServer();
    // 返り値の error を見る。supabase-js は失敗を throw ではなく返り値で返すので、
    // catch に任せきりだと「入れていない」がどこにも出ない。
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('ログインに失敗', error.message);
      return fail();
    }
  } catch (err) {
    // 設定が無い（supabaseServer が投げる）ときもここに来る。画面は同じ。
    console.error('ログインに失敗', err);
    return fail();
  }

  return NextResponse.redirect(new URL(next, req.url), 303);
}
