/**
 * サーバ側から使う Supabase クライアント。
 *
 * 利用者のセッション（Cookie）を積んで anon キーで繋ぐ。**サービスロールの
 * キーは使わない。** あれは RLS を全部素通りするので、1か所でも取り違えると
 * 所帯の仕切りが消える。行を絞っているのは RLS だけ、という状態を保つ。
 */
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseConfig } from '@/lib/config';

export async function supabaseServer() {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定');

  const jar = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Server Component からは Cookie を書けない。セッションの更新は
          // proxy.ts が毎リクエストで済ませているので、ここは黙って落としてよい。
        }
      },
    },
  });
}
