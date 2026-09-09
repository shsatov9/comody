/**
 * ログイン。メールアドレスを1つ入れるだけ。
 *
 * 送ったあとの画面で「届いていたら」と書くのは、登録の有無を漏らさないため
 * （/auth/signin の説明を参照）。
 */
import { supabaseConfig } from '@/lib/config';
import { safeNext } from '@/lib/origin';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const next = safeNext(one('next'));
  const configured = Boolean(supabaseConfig());
  const error = one('e');

  return (
    <main className="narrow">
      <h1>comody</h1>

      {!configured && (
        <p className="warn">
          サーバに <code>NEXT_PUBLIC_SUPABASE_URL</code> と{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> が設定されていません。
          設定するまでログインできません。
        </p>
      )}
      {one('sent') && (
        <p className="notice">
          メールを送りました。届いていたら、中のリンクを開いてください。
        </p>
      )}
      {error === 'bad_email' && <p className="warn">メールアドレスの形が正しくありません。</p>}
      {error === 'expired' && <p className="warn">リンクの期限が切れています。もう一度送ってください。</p>}
      {error === 'no_code' && <p className="warn">リンクが正しくありません。もう一度送ってください。</p>}

      <form method="post" action="/auth/signin" className="entry-form">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">メールアドレス</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          disabled={!configured}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={!configured}>
          リンクを送る
        </button>
      </form>

      <p className="hint">パスワードはありません。毎回メールのリンクで入ります。</p>
    </main>
  );
}
