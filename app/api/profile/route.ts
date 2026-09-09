/**
 * 自分の設定を保存する。目標値と、妊娠中かどうか。
 *
 * 目標を入れていないあいだ、画面に判定は一切出さない。勝手に目標を決めて
 * 色を付けると、入れていない人にとっては意味のない印になる。
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseNumberField } from '@/lib/meal';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url), 303);

  const form = await req.formData().catch(() => null);
  const kcal = parseNumberField(form?.get('target_kcal'));
  const protein = parseNumberField(form?.get('target_protein_g'));
  if (!kcal.ok || !protein.ok) {
    return NextResponse.redirect(new URL('/settings?e=bad_target', req.url), 303);
  }

  const name = String(form?.get('display_name') ?? '').trim().slice(0, 60);
  const { error } = await supabase.from('profiles').upsert({
    user_id: user.id,
    display_name: name || null,
    pregnant: form?.get('pregnant') === 'on',
    // 空欄は「目標を外した」なので、そのまま null を書く。
    target_kcal: kcal.value == null ? null : Math.round(kcal.value),
    target_protein_g: protein.value,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('設定の保存に失敗', error.message);
    return NextResponse.redirect(new URL('/settings?e=storage_failed', req.url), 303);
  }
  return NextResponse.redirect(new URL('/settings?saved=1', req.url), 303);
}
