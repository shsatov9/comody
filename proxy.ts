/**
 * 画面の入口。ログインしていなければ /login に送り、ついでにセッションを更新する。
 *
 * Next 16 で middleware は proxy に改名された。既定で Node ランタイムで動く。
 *
 * ## ここでセッションを触るのは必須
 *
 * Supabase のアクセストークンは短命で、切れる前に更新しないといけない。
 * Server Component からは Cookie を書けないので、更新できるのは毎リクエストを
 * 通るこの関数だけ。getUser() を呼ぶと @supabase/ssr が必要なら更新し、
 * setAll でここのレスポンスに新しい Cookie が載る。
 *
 * ## 守る対象を「除外リスト」で書く理由
 *
 * 追加した画面を守り忘れないため。新しいページを足したときに何も書かなくても、
 * 既定で鍵が掛かる側に倒す。
 *
 * ## /api はここで守らない
 *
 * ここのリダイレクトは 307 で、POST は POST のまま飛ぶ。/api/* を捕まえると、
 * 期限切れの記録が /login に POST されることになる（受け口が無いので何も
 * 起きないが、利用者には「押したのに何も起きない」に見える）。
 *
 * API 側は自分で getUser() を見て、303 でログイン画面に送り直している。
 * そちらのほうが、フォームから叩かれる口の振る舞いとして正しい。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseConfig } from '@/lib/config';

export async function proxy(req: NextRequest) {
  const cfg = supabaseConfig();
  // 設定前は誰も入れない。設定の足りなさは /login が画面で説明する。
  if (!cfg) return NextResponse.redirect(new URL('/login', req.url));

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = new URL('/login', req.url);
    const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    if (next && next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // api（自分で認可する）、login と auth（ログインの往復そのもの）、
  // Next の静的ファイルを除く全部。
  matcher: ['/((?!api|login|auth|_next/static|_next/image|favicon.ico).*)'],
};
