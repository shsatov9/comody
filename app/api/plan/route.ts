/**
 * 献立から記録を起こす・取り消す口。
 *
 * 素の <form> から POST される。画面にクライアント JavaScript を置かない方針なので、
 * Server Action ではなくここで受けて、認可も自分で確かめる。
 *
 * ## /api は proxy.ts の対象外
 *
 * あちらのリダイレクトは 307 で POST が POST のまま飛ぶ。ここで自分で getUser() を
 * 見て、303 で送り返す。
 *
 * ## 献立を差し替える口は無い
 *
 * 代替に入れ替える intent を置いていないのは、unique (plan_id, day, slot) があるため
 * 2行の slot を入れ替えるのに一時的な値が要るから。そもそも要らない — 代替を食べた日は
 * その代替に「これ食べた」を押せばよく、記録は実際に食べたものを指す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { timeZone } from '@/lib/config';
import { instantOf } from '@/lib/meal';
import { currentViewer } from '@/lib/household';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** 夕食だけを組む献立なので、記録の時刻は 19:00 に置く。 */
const DINNER_AT = '19:00';

export async function POST(req: NextRequest) {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.redirect(new URL('/login?next=%2Fplan', req.url), 303);
  if (!viewer.household) return NextResponse.redirect(new URL('/onboarding', req.url), 303);

  const form = await req.formData().catch(() => null);
  if (!form) return back(req, { e: 'storage_failed' });

  const id = String(form.get('id') ?? '');
  if (!id) return back(req, { e: 'storage_failed' });

  return String(form.get('intent') ?? '') === 'undo'
    ? undo(req, id)
    : eat(req, id, viewer.household.id, viewer.userId);
}

/**
 * 献立の1品を、食べた記録として起こす。
 *
 * 栄養値は献立側の推定をそのまま写すが、source に 'plan' を立てて、手で入れた値と
 * 見分けが付く状態にしておく。ここを曖昧にすると「合計を信用しすぎない」が壊れる。
 */
async function eat(req: NextRequest, id: string, householdId: string, userId: string) {
  const supabase = await supabaseServer();

  // 他所帯の id を指定しても、RLS が 0 行に絞るので何も起きない。
  const { data: item, error: readErr } = await supabase
    .from('meal_plan_items')
    .select('id, day, title, kcal, protein_g, fat_g, carb_g, salt_g, meal_id')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('献立の読み出しに失敗', readErr.message);
    return back(req, { e: 'storage_failed' });
  }
  if (!item) return back(req, { e: 'not_in_plan' });
  if (item.meal_id) return back(req, { day: item.day, e: 'already_eaten' });

  const { data: meal, error: insErr } = await supabase
    .from('meals')
    .insert({
      household_id: householdId,
      created_by: userId,
      day: item.day,
      at: instantOf(item.day, DINNER_AT, timeZone()).toISOString(),
      title: item.title,
      kcal: item.kcal,
      protein_g: item.protein_g,
      fat_g: item.fat_g,
      carb_g: item.carb_g,
      salt_g: item.salt_g,
      source: 'plan',
    })
    .select('id')
    .maybeSingle();

  if (insErr || !meal) {
    console.error('献立からの記録に失敗', insErr?.message);
    return back(req, { day: item.day, e: 'storage_failed' });
  }

  // 記録は起きたので、ここが失敗しても「食べたのに残っていない」にはならない。
  // 献立側の印が付かないだけなので、画面で気付けるよう文言を分ける。
  const { error: linkErr } = await supabase
    .from('meal_plan_items')
    .update({ meal_id: meal.id })
    .eq('id', id);

  if (linkErr) {
    console.error('献立と記録の紐づけに失敗', linkErr.message);
    return back(req, { day: item.day, e: 'link_failed' });
  }
  return back(req, { day: item.day, ate: '1' });
}

/** 押し間違いを戻す。記録は論理削除し、献立側の印を外す。 */
async function undo(req: NextRequest, id: string) {
  const supabase = await supabaseServer();

  const { data: item, error: readErr } = await supabase
    .from('meal_plan_items')
    .select('id, day, meal_id')
    .eq('id', id)
    .maybeSingle();

  if (readErr || !item) {
    console.error('献立の読み出しに失敗', readErr?.message);
    return back(req, { e: 'storage_failed' });
  }
  if (!item.meal_id) return back(req, { day: item.day });

  // 先に印を外す。記録の削除に失敗しても、押し直せる状態には戻る。
  const { error: unlinkErr } = await supabase
    .from('meal_plan_items').update({ meal_id: null }).eq('id', id);
  if (unlinkErr) {
    console.error('紐づけの解除に失敗', unlinkErr.message);
    return back(req, { day: item.day, e: 'storage_failed' });
  }

  const { error: delErr } = await supabase
    .from('meals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', item.meal_id)
    .is('deleted_at', null);

  if (delErr) {
    console.error('記録の取り消しに失敗', delErr.message);
    return back(req, { day: item.day, e: 'undo_partial' });
  }
  return back(req, { day: item.day, undone: '1' });
}

/** 成功も失敗も 303 で画面へ。リロードで再送信されないように。 */
function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/plan', req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}
