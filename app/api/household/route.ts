/**
 * 所帯を作る・入る。
 *
 * どちらも Postgres 側の security definer 関数を呼ぶだけ。households と
 * household_members に insert のポリシーを置いていないので、この経路以外から
 * 所帯は増えないし、入れない（supabase/migrations の説明を参照）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url), 303);

  const form = await req.formData().catch(() => null);
  const intent = String(form?.get('intent') ?? 'create');

  if (intent === 'join') {
    const code = String(form?.get('code') ?? '').trim();
    const { error } = await supabase.rpc('join_household', { p_code: code });
    if (error) {
      // 合い言葉が違うのか、DB が落ちているのかは画面で区別しない。
      console.error('所帯への参加に失敗', error.message);
      return NextResponse.redirect(new URL('/onboarding?e=bad_code', req.url), 303);
    }
    return NextResponse.redirect(new URL('/', req.url), 303);
  }

  const name = String(form?.get('name') ?? '').trim();
  const { error } = await supabase.rpc('create_household', { p_name: name || null });
  if (error) {
    console.error('所帯の作成に失敗', error.message);
    return NextResponse.redirect(new URL('/onboarding?e=storage_failed', req.url), 303);
  }
  return NextResponse.redirect(new URL('/', req.url), 303);
}
