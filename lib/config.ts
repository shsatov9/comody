/**
 * 環境変数から決まる設定。読み方を1か所に集めて、既定値の重複を防ぐ。
 *
 * 関数にしてあるのは、サーバレスで環境変数が読み込まれる前にモジュールが
 * 評価される場合に備えて。トップレベルで固めると undefined が焼き付く。
 */

/**
 * 「今日」がどの日か、入力した時刻がどの瞬間かを決めるタイムゾーン。
 *
 * Vercel は UTC で動く。ここを設定しないと、日本時間の朝9時までサーバの
 * 「今日」が前日になり、夕食の 19:30 は翌朝 4:30 として保存される。
 */
export function timeZone(): string {
  return process.env.COMODY_TIMEZONE || 'Asia/Tokyo';
}

/** Supabase の接続先。どちらもブラウザに出る前提の公開値。守るのは RLS の側。 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
