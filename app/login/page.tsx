/**
 * ログイン。メールアドレスとパスワード。
 *
 * 登録の口も、パスワードの再発行の口もここには無い。使うのは所帯の2人だけ
 * なので、増やすのも直すのも Supabase のダッシュボードから行う
 * （README「入る人を増やす」）。
 *
 * 失敗の文言を1つにしてあるのは、登録の有無を漏らさないため
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
      {error === 'bad_credentials' && (
        <p className="warn">メールアドレスかパスワードが違います。</p>
      )}
      {/* ダッシュボードから送ったリンクで入るときだけ通る道（/auth/callback）。 */}
      {error === 'expired' && <p className="warn">リンクの期限が切れています。</p>}
      {error === 'no_code' && <p className="warn">リンクが正しくありません。</p>}

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

        <label htmlFor="password">パスワード</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={!configured}
        />

        <button type="submit" disabled={!configured}>
          入る
        </button>
      </form>

      <p className="hint">
        パスワードを忘れたときは、Supabase のダッシュボードから設定し直します。
        この画面からは変えられません。
      </p>
    </main>
  );
}
