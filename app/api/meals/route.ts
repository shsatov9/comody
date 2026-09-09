/**
 * 記録を足す・消す口。
 *
 * 素の <form> から POST される application/x-www-form-urlencoded を受ける。
 * 画面にクライアント JavaScript を置かない方針なので、Server Action ではなく
 * ここで受けて、認可も自分で確かめる。
 *
 * 成功しても失敗しても 303 で画面に戻す。リロードで再送信されないように。
 * 失敗のときは入力を URL に載せて返す。打ち直しになるのが一番おっくうなので。
 */
import { NextRequest, NextResponse } from 'next/server';
import { timeZone } from '@/lib/config';
import { isDay } from '@/lib/day';
import { MAX_TITLE, parseMealForm } from '@/lib/meal';
import { currentViewer } from '@/lib/household';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** 失敗したときに書き戻す欄。ここに無いものは打ち直しになる。 */
const KEPT = ['title', 'day', 'time', 'kcal', 'protein_g', 'fat_g', 'carb_g', 'salt_g'] as const;

export async function POST(req: NextRequest) {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.redirect(new URL('/login?next=%2Frecord', req.url), 303);
  if (!viewer.household) return NextResponse.redirect(new URL('/onboarding', req.url), 303);

  const form = await req.formData().catch(() => null);
  if (!form) return back(req, '/record', { e: 'storage_failed' });

  return String(form.get('intent') ?? 'create') === 'delete'
    ? remove(req, form)
    : create(req, form, viewer.household.id);
}

async function create(req: NextRequest, form: FormData, householdId: string) {
  const parsed = parseMealForm(
    {
      title: form.get('title'), day: form.get('day'), time: form.get('time'),
      kcal: form.get('kcal'), protein_g: form.get('protein_g'),
      fat_g: form.get('fat_g'), carb_g: form.get('carb_g'), salt_g: form.get('salt_g'),
    },
    timeZone(),
  );
  if (!parsed.ok) return back(req, '/record', { e: parsed.error, ...kept(form) });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url), 303);

  // household_id と created_by は RLS の with check でも確かめられる。
  // ここで詰めるのは書き込む値を決めるためで、正しさの保証はあちら側。
  const { error } = await supabase
    .from('meals')
    .insert({ ...parsed.meal, household_id: householdId, created_by: user.id });

  if (error) {
    console.error('記録の保存に失敗', error.message);
    return back(req, '/record', { e: 'storage_failed', ...kept(form) });
  }

  // 入れた記録が並んでいるところに着地させる。合計と目標の判定もそこで見える。
  return back(req, '/', { day: parsed.meal.day, added: '1' });
}

async function remove(req: NextRequest, form: FormData) {
  const id = String(form.get('id') ?? '');
  const dayRaw = String(form.get('day') ?? '');
  const day = isDay(dayRaw) ? dayRaw : '';
  const to = '/';

  if (!id) return back(req, to, { e: 'not_deletable', ...(day && { day }) });

  const supabase = await supabaseServer();
  // 物理削除にしないのは、消したことを後から追えるようにするため。
  // 他所帯の行を指定しても、RLS が 0 行に絞るので何も起きない。
  const { data, error } = await supabase
    .from('meals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('記録の削除に失敗', error.message);
    return back(req, to, { e: 'storage_failed', ...(day && { day }) });
  }
  return back(req, to, {
    ...(day && { day }),
    ...(data && data.length > 0 ? { removed: '1' } : { e: 'not_deletable' }),
  });
}

/** 打ち直しを避けるため、入力をそのまま持ち帰る。 */
function kept(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEPT) {
    const v = String(form.get(k) ?? '').slice(0, MAX_TITLE);
    if (v) out[k] = v;
  }
  return out;
}

function back(req: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}
