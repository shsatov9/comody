/**
 * 1日の記録。既定は今日で、?day= で行き来する。
 *
 * 所帯の記録を全部出す。誰が入れたかで分けない — 同じ食卓を囲んでいるので、
 * 「わが家が今日食べたもの」が1つあればよい。
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { timeZone } from '@/lib/config';
import { addDays, dayLabel, isDay, todayIn } from '@/lib/day';
import { errorMessage } from '@/lib/meal';
import { gram, kcal, n0 } from '@/lib/format';
import { totalsOf } from '@/lib/totals';
import { currentViewer } from '@/lib/household';
import { supabaseServer } from '@/lib/supabase/server';
import { Nav } from '@/components/nav';
import { MealList, PfcBar, TotalsSummary } from '@/components/meals';
import type { MealRow } from '@/components/meals';

export const dynamic = 'force-dynamic';

export default async function DayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login');
  if (!viewer.household) redirect('/onboarding');

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');

  const tz = timeZone();
  const today = todayIn(tz);
  const day = isDay(one('day')) ? one('day') : today;

  const supabase = await supabaseServer();
  // 所帯の絞り込みを書いていないのは、RLS が自分の所帯の行しか返さないから。
  const { data, error } = await supabase
    .from('meals')
    .select('id, day, at, title, kcal, protein_g, fat_g, carb_g, salt_g')
    .eq('day', day)
    .is('deleted_at', null)
    .order('at', { ascending: true });

  if (error) console.error('記録の読み出しに失敗', error.message);
  const meals = (data ?? []) as MealRow[];
  const totals = totalsOf(meals);

  const notice = one('added') ? '記録しました。' : one('removed') ? '消しました。' : '';
  const failure = errorMessage(one('e'));

  return (
    <main>
      <Nav current="today" />
      <h1>
        {day === today ? '今日' : day}（{dayLabel(day)}）
      </h1>

      {notice && <p className="notice">{notice}</p>}
      {failure && <p className="warn">{failure}</p>}

      <div className="period-row">
        <Link className="step" href={`/?day=${addDays(day, -1)}`} rel="prev">
          ← 前の日
        </Link>
        {day !== today && (
          <Link className="step" href="/">
            今日へ
          </Link>
        )}
        {day < today ? (
          <Link className="step" href={`/?day=${addDays(day, 1)}`} rel="next">
            次の日 →
          </Link>
        ) : (
          <span className="step disabled">次の日 →</span>
        )}
        <Link className="step" href={`/record?day=${day}`}>
          ＋この日に記録する
        </Link>
      </div>

      <section>
        <h2>
          合計
          <TotalsSummary
            totals={totals}
            targetKcal={viewer.profile?.target_kcal ?? null}
            targetProteinG={viewer.profile?.target_protein_g ?? null}
          />
        </h2>
        <dl className="figures">
          <div><dt>カロリー</dt><dd>{kcal(totals.kcal)}</dd></div>
          <div><dt>たんぱく質</dt><dd>{gram(totals.proteinG)}</dd></div>
          <div><dt>脂質</dt><dd>{gram(totals.fatG)}</dd></div>
          <div><dt>炭水化物</dt><dd>{gram(totals.carbG)}</dd></div>
          <div><dt>食塩相当量</dt><dd>{gram(totals.saltG)}</dd></div>
          <div><dt>記録</dt><dd>{n0(totals.count)} 件</dd></div>
        </dl>
        <PfcBar totals={totals} />
      </section>

      <section>
        <h2>記録</h2>
        <MealList meals={meals} timeZone={tz} day={day} />
      </section>
    </main>
  );
}
