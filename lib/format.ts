/** 表示用の数の整え方をここに集める。桁区切りと「未入力の—」の扱いを揃えるため。 */

/** 未入力（null）は 0 ではなく '—'。合計を信用しすぎないための約束。 */
export function n0(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('ja-JP');
}

export function kcal(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${n0(v)} kcal`;
}

export function gram(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)} g`;
}

/** 符号を付ける。目標との差のように「多い/少ない」が意味を持つ場所で使う。 */
export function signed(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.round(v);
  return r > 0 ? `+${r.toLocaleString('ja-JP')}` : r.toLocaleString('ja-JP');
}

/**
 * 記録した時刻。表示するタイムゾーンは呼び出し側が渡す。
 * サーバの時計（Vercel なら UTC）で描くと、日本時間の夕食が翌日の朝に見える。
 */
export function timeOfDay(at: string | Date, timeZone: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  try {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}
