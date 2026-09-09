/**
 * 食べたものを1件記録する。
 *
 * 料理名だけ必須で、あとは全部任意にしてある。カロリーが分からないから
 * 記録しない、が一番もったいないため。栄養値の無い記録は合計に 0 として
 * 足されるが、画面が「PFC未入力 n件」を添えるので数字を信用しすぎることはない。
 *
 * JavaScript は置かない。素の <form> から /api/meals に POST する。
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { timeZone } from '@/lib/config';
import { dayLabel, isDay, todayIn } from '@/lib/day';
import { errorMessage, isTime, timeInZone } from '@/lib/meal';
import { currentViewer } from '@/lib/household';
import { Nav } from '@/components/nav';

export const dynamic = 'force-dynamic';

/** 詳しい欄。畳んでおくが、値が入っていたり弾かれたときは開く。 */
const MACROS = [
  { name: 'protein_g', label: 'たんぱく質 (g)' },
  { name: 'fat_g', label: '脂質 (g)' },
  { name: 'carb_g', label: '炭水化物 (g)' },
  { name: 'salt_g', label: '食塩相当量 (g)' },
] as const;

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login?next=%2Frecord');
  if (!viewer.household) redirect('/onboarding');

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');

  const tz = timeZone();
  // 弾かれて戻ってきたときは、打った値がそのまま載っている。
  const day = isDay(one('day')) ? one('day') : todayIn(tz);
  const time = isTime(one('time')) ? one('time') : timeInZone(tz);
  const error = one('e');
  const macroValues = MACROS.map((m) => one(m.name));
  const detailsOpen = macroValues.some(Boolean) || error === 'bad_macro';

  return (
    <main className="narrow">
      <Nav current="record" />
      <h1>記録する</h1>

      {error && <p className="warn">{errorMessage(error) || '保存できませんでした。'}</p>}

      <form method="post" action="/api/meals" className="entry-form">
        <input type="hidden" name="intent" value="create" />

        <label htmlFor="title">料理名</label>
        <input
          id="title" name="title" type="text" maxLength={200}
          required autoFocus autoComplete="off" enterKeyHint="done"
          defaultValue={one('title')} placeholder="十勝風 豚丼"
        />

        <label htmlFor="kcal">カロリー (kcal)</label>
        <input
          id="kcal" name="kcal" type="number" min="0" step="any"
          inputMode="decimal" autoComplete="off"
          defaultValue={one('kcal')} placeholder="分からなければ空のまま"
        />

        <div className="when">
          <div>
            <label htmlFor="day">日付</label>
            <input id="day" name="day" type="date" required defaultValue={day} />
          </div>
          <div>
            <label htmlFor="time">時刻</label>
            <input id="time" name="time" type="time" required defaultValue={time} />
          </div>
        </div>

        <details open={detailsOpen}>
          <summary>PFC・食塩も入れる</summary>
          <div className="macros">
            {MACROS.map((m, i) => (
              <div key={m.name}>
                <label htmlFor={m.name}>{m.label}</label>
                <input
                  id={m.name} name={m.name} type="number" min="0" step="any"
                  inputMode="decimal" autoComplete="off" defaultValue={macroValues[i]}
                />
              </div>
            ))}
          </div>
        </details>

        <button type="submit">記録する</button>
      </form>

      <p className="hint">
        入れた記録は<Link href={`/?day=${day}`}>{dayLabel(day)}の画面</Link>に並びます。
      </p>
    </main>
  );
}
