/**
 * 自分の設定と、所帯の合い言葉。
 *
 * 目標値は本人のもの（同じ所帯でも他人には見せない）。記録は所帯で共有するが、
 * 「1日 2200 kcal」は人ごとに違う。
 */
import { redirect } from 'next/navigation';
import { errorMessage } from '@/lib/meal';
import { currentViewer } from '@/lib/household';
import { Nav } from '@/components/nav';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login?next=%2Fsettings');
  if (!viewer.household) redirect('/onboarding');

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const p = viewer.profile;

  return (
    <main className="narrow">
      <Nav current="settings" />
      <h1>設定</h1>

      {one('saved') && <p className="notice">保存しました。</p>}
      {one('e') === 'bad_target' && <p className="warn">目標は 0 以上の数で入れてください。</p>}
      {one('e') === 'storage_failed' && <p className="warn">{errorMessage('storage_failed')}</p>}

      <section>
        <h2>所帯</h2>
        <dl className="figures">
          <div><dt>名前</dt><dd>{viewer.household.name}</dd></div>
          <div><dt>ログイン中</dt><dd style={{ fontSize: 13 }}>{viewer.email ?? '—'}</dd></div>
        </dl>
        <p className="hint">相手にこの合い言葉を伝えると、同じ記録を見られるようになります。</p>
        <p className="code">{viewer.household.join_code}</p>
      </section>

      <section>
        <h2>目標</h2>
        <p className="hint">
          入れておくと、その日の合計の横に残りが出ます。空のあいだ判定は出しません。
        </p>
        <form method="post" action="/api/profile" className="entry-form">
          <label htmlFor="display_name">表示名</label>
          <input
            id="display_name" name="display_name" type="text" maxLength={60}
            defaultValue={p?.display_name ?? ''} placeholder="（任意）"
          />

          <label htmlFor="target_kcal">1日の目標カロリー (kcal)</label>
          <input
            id="target_kcal" name="target_kcal" type="number" min="0" step="1"
            inputMode="numeric" defaultValue={p?.target_kcal ?? ''} placeholder="2200"
          />

          <label htmlFor="target_protein_g">たんぱく質の下限 (g)</label>
          <input
            id="target_protein_g" name="target_protein_g" type="number" min="0" step="any"
            inputMode="decimal" defaultValue={p?.target_protein_g ?? ''} placeholder="90"
          />

          <div className="check">
            <input id="pregnant" name="pregnant" type="checkbox" defaultChecked={p?.pregnant ?? false} />
            <label htmlFor="pregnant">妊娠中</label>
          </div>
          <p className="hint">
            献立の提案（Phase 4）で、生ものや非加熱の食品を外し、葉酸・鉄・
            カルシウムを厚くするために使います。今はまだ何も変わりません。
          </p>

          <button type="submit">保存する</button>
        </form>
      </section>
    </main>
  );
}
