/**
 * 献立1回ぶんを、貼り付けた JSON から入れる。
 *
 * 献立を組むのは Claude（`.claude/skills/meal-plan`）で、ここはその結果を
 * 置く口。以前は手で SQL を書いていた。
 *
 * ## 途中で失敗したら、片付けてから返す
 *
 * 表を5つまたぐのに、supabase-js からは1つのトランザクションにできない。
 * 途中で落ちると「献立はあるが買い物リストが無い」半端な行が残るので、
 * **`meal_plans` を先に `pending` で立て、最後に `done` にする。** 途中で
 * 落ちたらその1行を消せば、子は cascade で一緒に消える。
 *
 * 中途半端な行が残ったときに status で見分けが付くのは、DESIGN §5 が
 * `pending / done / failed / refused` を置いた理由そのもの。
 */
import { NextRequest, NextResponse } from 'next/server';
import { MAX_ERRORS, parsePlanJson } from '@/lib/plan-import';
import type { ImportPlan } from '@/lib/plan-import';
import { currentViewer } from '@/lib/household';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.redirect(new URL('/login?next=%2Fplan%2Fimport', req.url), 303);
  if (!viewer.household) return NextResponse.redirect(new URL('/onboarding', req.url), 303);

  const form = await req.formData().catch(() => null);
  const source = String(form?.get('plan') ?? '').trim();
  if (!source) return back(req, ['貼り付ける中身がありません。']);

  const parsed = parsePlanJson(source);
  if (!parsed.ok) return back(req, parsed.errors);

  return insert(req, parsed.plan, viewer.household.id, viewer.userId);
}

async function insert(req: NextRequest, plan: ImportPlan, householdId: string, userId: string) {
  const supabase = await supabaseServer();
  const owner = { household_id: householdId, created_by: userId };

  // ── チラシ（あれば）────────────────────────────────────────
  let flyerId = plan.flyerId;
  let insertedFlyerId: string | null = null;
  const flyerItemIds = new Map<string, string>();

  if (plan.flyer) {
    const f = plan.flyer;
    // 同じチラシを二度取り込まない。unique (household_id, image_sha256) が
    // 止めてくれるが、何が起きたか分からない文言になるので先に見る。
    const { data: already } = await supabase
      .from('flyers').select('id').eq('image_sha256', f.image_sha256).maybeSingle();
    if (already) {
      return back(req, [`このチラシは取り込み済みです。flyer を消して "flyer_id": "${already.id}" にしてください。`]);
    }

    const { data: row, error } = await supabase
      .from('flyers')
      .insert({
        ...owner,
        store: f.store, valid_from: f.valid_from, valid_to: f.valid_to,
        image_path: f.image_path, image_sha256: f.image_sha256,
        status: 'done', read_at: new Date().toISOString(),
      })
      .select('id').maybeSingle();

    if (error || !row) {
      console.error('チラシの取り込みに失敗', error?.message);
      return back(req, ['チラシを入れられませんでした。']);
    }
    flyerId = row.id;
    insertedFlyerId = row.id;

    const { data: items, error: itemErr } = await supabase
      .from('flyer_items')
      .insert(f.items.map((i) => ({
        flyer_id: row.id, household_id: householdId,
        name: i.name, price_yen: i.price_yen, price_tax_in: i.price_tax_in,
        unit: i.unit, discount_note: i.discount_note, category: i.category,
        origin: i.origin, valid_from: i.valid_from, valid_to: i.valid_to,
        limit_note: i.limit_note, confidence: i.confidence, raw: i.raw ?? {},
      })))
      .select('id, name');

    if (itemErr || !items) {
      console.error('チラシの商品の取り込みに失敗', itemErr?.message);
      await supabase.from('flyers').delete().eq('id', row.id);
      return back(req, ['チラシの商品を入れられませんでした。']);
    }
    // 返ってくる順は約束されていないので、名前で引き当てる。名前は
    // チラシ1枚の中では実質一意で、そうでなくても指す先は同じ品になる。
    const byName = new Map(items.map((r) => [r.name, r.id] as const));
    for (const i of f.items) {
      const id = i.key ? byName.get(i.name) : undefined;
      if (i.key && id) flyerItemIds.set(i.key, id);
    }
  }

  // ── 献立の入れもの。ここを消せば下は全部 cascade で消える ──
  const { data: planRow, error: planErr } = await supabase
    .from('meal_plans')
    .insert({
      ...owner, flyer_id: flyerId,
      shopping_on: plan.shopping_on, starts_on: plan.starts_on, ends_on: plan.ends_on,
      status: 'pending', raw: plan.raw,
    })
    .select('id').maybeSingle();

  if (planErr || !planRow) {
    console.error('献立の作成に失敗', planErr?.message);
    if (insertedFlyerId) await supabase.from('flyers').delete().eq('id', insertedFlyerId);
    return back(req, ['献立を入れられませんでした。']);
  }

  const planId = planRow.id;
  /** ここから先で落ちたら、半端な行を残さず消してから返す。 */
  const giveUp = async (message: string, detail?: string) => {
    console.error('献立の取り込みに失敗', detail);
    await supabase.from('meal_plans').delete().eq('id', planId);
    if (insertedFlyerId) await supabase.from('flyers').delete().eq('id', insertedFlyerId);
    return back(req, [message]);
  };

  // ── 買い物リスト ────────────────────────────────────────────
  const shoppingIds = new Map<string, string>();
  if (plan.shopping.length > 0) {
    const { data, error } = await supabase
      .from('shopping_items')
      .insert(plan.shopping.map((s) => ({
        plan_id: planId, household_id: householdId,
        flyer_item_id: s.flyerItemKey ? flyerItemIds.get(s.flyerItemKey) ?? null : null,
        name: s.name, qty: s.qty, amount_yen: s.amount_yen, to_freeze: s.to_freeze,
      })))
      .select('id, name');
    if (error || !data) return giveUp('買い物リストを入れられませんでした。', error?.message);

    const byName = new Map(data.map((r) => [r.name, r.id] as const));
    for (const s of plan.shopping) {
      const id = s.key ? byName.get(s.name) : undefined;
      if (s.key && id) shoppingIds.set(s.key, id);
    }
  }

  // ── その1日1品 ──────────────────────────────────────────────
  const { data: items, error: itemErr } = await supabase
    .from('meal_plan_items')
    .insert(plan.items.map((i) => ({
      plan_id: planId, household_id: householdId,
      day: i.day, slot: i.slot, title: i.title,
      cook_minutes: i.cook_minutes, prep_note: i.prep_note,
      kcal: i.kcal, protein_g: i.protein_g, fat_g: i.fat_g,
      carb_g: i.carb_g, salt_g: i.salt_g,
    })))
    .select('id, day, slot');
  if (itemErr || !items) return giveUp('献立の品を入れられませんでした。', itemErr?.message);

  // (day, slot) は unique (plan_id, day, slot) があるので、確実に1つに決まる。
  const byDaySlot = new Map(items.map((r) => [`${r.day}/${r.slot}`, r.id] as const));

  // ── 料理と食材 ──────────────────────────────────────────────
  const ingredients = plan.items.flatMap((i) => {
    const itemId = byDaySlot.get(`${i.day}/${i.slot}`);
    if (!itemId) return [];
    return i.ingredients.map((g) => ({
      item_id: itemId, household_id: householdId,
      shopping_item_id: g.shoppingKey ? shoppingIds.get(g.shoppingKey) ?? null : null,
      name: g.name, qty: g.qty, is_main: g.is_main,
    }));
  });

  if (ingredients.length > 0) {
    const { error } = await supabase.from('meal_plan_item_ingredients').insert(ingredients);
    if (error) return giveUp('食材を入れられませんでした。', error.message);
  }

  // ── ここまで来て初めて done ────────────────────────────────
  const { error: doneErr } = await supabase
    .from('meal_plans').update({ status: 'done' }).eq('id', planId);
  if (doneErr) return giveUp('献立を仕上げられませんでした。', doneErr.message);

  return NextResponse.redirect(new URL(`/plan?plan=${planId}&imported=1`, req.url), 303);
}

/** 直せるように、間違いを名前付きで画面へ返す。 */
function back(req: NextRequest, errors: string[]) {
  const url = new URL('/plan/import', req.url);
  url.searchParams.set('e', errors.slice(0, MAX_ERRORS).join('\n'));
  return NextResponse.redirect(url, 303);
}
