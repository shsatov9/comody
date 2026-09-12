/**
 * 今週の献立。平日のうち3日（月・水・金）の夕食と、土日の買い物リスト。
 *
 * 既定は一番新しい献立。`?plan=` で過去のものも開ける。
 *
 * 献立を組む口はまだ無い（チラシの取り込みができていないため）。この画面は、
 * 入っている献立を並べて「これ食べた」を押せるようにするところまで。
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { timeZone } from '@/lib/config';
import { dayLabel, todayIn } from '@/lib/day';
import { errorMessage } from '@/lib/meal';
import { byDay, shoppingTotal, tonightPrep, weekAverage } from '@/lib/plan';
import type { PlanItem, ShoppingItem } from '@/lib/plan';
import { currentViewer } from '@/lib/household';
import { supabaseServer } from '@/lib/supabase/server';
import { Nav } from '@/components/nav';
import { Day, ShoppingList, TonightPrep, WeekSummary } from '@/components/plan';

export const dynamic = 'force-dynamic';

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login?next=%2Fplan');
  if (!viewer.household) redirect('/onboarding');

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');

  const tz = timeZone();
  const today = todayIn(tz);
  const supabase = await supabaseServer();

  // 所帯の絞り込みを書いていないのは、RLS が自分の所帯の行しか返さないから。
  let q = supabase
    .from('meal_plans')
    .select('id, shopping_on, starts_on, ends_on, status')
    .order('starts_on', { ascending: false })
    .limit(1);
  if (one('plan')) q = q.eq('id', one('plan'));

  const { data: plans, error: planErr } = await q;
  if (planErr) console.error('献立の読み出しに失敗', planErr.message);
  const plan = plans?.[0] ?? null;

  const notice = one('imported')
    ? '取り込みました。'
    : one('ate')
      ? '記録しました。'
      : one('undone')
        ? '取り消しました。'
        : '';
  const failure = errorMessage(one('e'));

  if (!plan) {
    return (
      <main>
        <Nav current="plan" />
        <h1>献立</h1>
        {failure && <p className="warn">{failure}</p>}
        <p className="empty">まだ献立がありません。</p>
        <p className="hint">
          献立を組むのは Claude（<code>.claude/skills/meal-plan</code>）です。出てきた
          JSON を<Link href="/plan/import">取り込む画面</Link>に貼ってください。
          設計は <code>docs/DESIGN.md</code> の §5 にあります。
        </p>
      </main>
    );
  }

  const [{ data: itemRows, error: itemErr }, { data: shopRows, error: shopErr }] = await Promise.all([
    supabase
      .from('meal_plan_items')
      .select('id, day, slot, title, cook_minutes, prep_note, kcal, protein_g, fat_g, carb_g, salt_g, meal_id')
      .eq('plan_id', plan.id),
    supabase
      .from('shopping_items')
      .select('id, name, qty, amount_yen, to_freeze, flyer_item_id')
      .eq('plan_id', plan.id)
      .order('to_freeze', { ascending: false }),
  ]);

  if (itemErr) console.error('献立の品の読み出しに失敗', itemErr.message);
  if (shopErr) console.error('買い物リストの読み出しに失敗', shopErr.message);

  const days = byDay((itemRows ?? []) as PlanItem[], plan.starts_on, plan.ends_on);
  const shopping = (shopRows ?? []) as ShoppingItem[];
  const prep = tonightPrep(days, today);
  const avg = weekAverage(days);

  return (
    <main>
      <Nav current="plan" />
      <h1>
        {dayLabel(plan.starts_on)} 〜 {dayLabel(plan.ends_on)} の夕食
      </h1>

      {notice && <p className="notice">{notice}</p>}
      {failure && <p className="warn">{failure}</p>}

      {/* 30分・作り置きなしで後半を冷凍から回す以上、ここが読まれないと翌日が崩れる */}
      {prep && <TonightPrep prep={prep} />}

      {days.map((d) => (
        <Day key={d.day} day={d} today={today} />
      ))}

      <section>
        <h2>買い物</h2>
        <ShoppingList
            items={shopping}
            total={shoppingTotal(shopping)}
            shoppingOn={plan.shopping_on}
            cookDays={avg?.days ?? 0}
          />
      </section>

      {avg && (
        <section>
          <h2>この週の平均</h2>
          <WeekSummary avg={avg} />
        </section>
      )}

      <p className="hint">
        「食べた」を押すと<Link href="/">その日の記録</Link>に1行入ります。
        栄養値は献立の推定なので、手で入れた記録とは区別して持っています。
      </p>

      <p className="hint">
        次の週は<Link href="/plan/import">取り込む画面</Link>から足します。
      </p>
    </main>
  );
}
