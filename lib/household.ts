/**
 * 「今このリクエストを出しているのは誰で、どの所帯か」を1か所で解く。
 *
 * 画面はここが返したものだけを見る。所帯の判定を各ページに散らすと、
 * いつか1枚だけ絞り忘れる。とはいえ**これは利便のためで、防御ではない**。
 * 行を絞っているのは RLS で、ここが間違っていても他所帯の行は返ってこない。
 */
import { supabaseServer } from '@/lib/supabase/server';

export type Household = { id: string; name: string; join_code: string };
export type Profile = {
  user_id: string;
  display_name: string | null;
  pregnant: boolean;
  target_kcal: number | null;
  target_protein_g: number | null;
};

export type Viewer = {
  userId: string;
  email: string | null;
  household: Household | null;
  profile: Profile | null;
};

/**
 * ログイン中の利用者。未ログインなら null。
 *
 * getUser() を使う（getSession() ではない）。getSession は Cookie の中身を
 * そのまま信じるが、getUser は Supabase 側に問い合わせて確かめる。
 */
export async function currentViewer(): Promise<Viewer | null> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // 所帯は RLS で自分のものしか返らないので、絞り込みを書く必要がない。
  // 2つ以上に属していることもある（相手の所帯にも入った場合）。最初の1つを使う。
  const [{ data: households }, { data: profile }] = await Promise.all([
    supabase
      .from('households')
      .select('id, name, join_code')
      .order('created_at', { ascending: true })
      .limit(1),
    supabase
      .from('profiles')
      .select('user_id, display_name, pregnant, target_kcal, target_protein_g')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  return {
    userId: user.id,
    email: user.email ?? null,
    household: households?.[0] ?? null,
    profile: profile ?? null,
  };
}
