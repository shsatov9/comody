/**
 * 最初の1回だけ通る画面。所帯を作るか、相手の所帯に入る。
 *
 * ログインした直後はまだどの所帯にも属していない。ここを通らないと
 * 記録の置き場所が決まらないので、他の画面はここへ送り返す。
 */
import { redirect } from 'next/navigation';
import { errorMessage } from '@/lib/meal';
import { currentViewer } from '@/lib/household';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login');
  // もう所帯があるなら、ここに用は無い。
  if (viewer.household) redirect('/');

  const sp = await searchParams;
  const error = typeof sp.e === 'string' ? sp.e : '';

  return (
    <main className="narrow">
      <h1>はじめに</h1>
      {error && <p className="warn">{errorMessage(error) || 'うまくいきませんでした。'}</p>}

      <section>
        <h2>所帯を作る</h2>
        <p className="hint">
          記録はこの所帯の中で共有します。あとから合い言葉で相手を呼べます。
        </p>
        <form method="post" action="/api/household" className="entry-form">
          <input type="hidden" name="intent" value="create" />
          <label htmlFor="name">名前</label>
          <input id="name" name="name" type="text" maxLength={60} placeholder="わが家" />
          <button type="submit">作る</button>
        </form>
      </section>

      <section>
        <h2>もう作ってある所帯に入る</h2>
        <p className="hint">相手の「設定」の画面に出ている合い言葉を入れてください。</p>
        <form method="post" action="/api/household" className="entry-form">
          <input type="hidden" name="intent" value="join" />
          <label htmlFor="code">合い言葉</label>
          <input
            id="code" name="code" type="text" required
            maxLength={8} minLength={8} autoCapitalize="characters"
            autoComplete="off" placeholder="2MCAQQXN"
          />
          <button type="submit">入る</button>
        </form>
      </section>
    </main>
  );
}
