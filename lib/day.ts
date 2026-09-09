/**
 * 'YYYY-MM-DD' の日付計算。
 *
 * 日付は最後まで文字列のまま扱い、Date は足し算のためだけに使う。しかも
 * **UTC の正午** に置いて計算する。ローカル時刻で持つと、サーバのタイムゾーンや
 * 夏時間の切り替わりで「1日足したのに同じ日」「2日進む」が起きる。正午に
 * 置いておけば、±12時間ずれても日付は動かない。
 *
 * ## 「今日」はサーバの時計では決まらない
 *
 * Vercel は UTC で動くので、素朴に new Date() を使うと日本時間の朝9時まで
 * 「今日」が前日になる。表示する側のタイムゾーンを COMODY_TIMEZONE で決める。
 */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 期間を展開するときの上限。壊れた入力で無限にループしないための歯止め。 */
export const MAX_SPAN_DAYS = 400;

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 実在する日付か。
 *
 * 形だけを見て通すと '2026-02-30' が素通りする。JavaScript の Date は
 * これを 3月2日に**繰り上げて**受け取るので、'2026-02-30' の見出しで
 * 3月2日の記録が並ぶ画面ができてしまう。書き戻して一致するかまで見る。
 */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && toDay(d) === v;
}

/** 'YYYY-MM-DD' → その日の UTC 正午。 */
export function toDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** UTC の日付部分を取り出す。toDate と対で使う。 */
export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}

/** b - a の日数。同じ日なら 0。 */
export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** from から to までを1日ずつ。to を含む。逆順で渡されたら空を返す。 */
export function eachDay(from: string, to: string): string[] {
  const n = diffDays(from, to);
  if (n < 0) return [];
  const out: string[] = [];
  for (let i = 0; i <= Math.min(n, MAX_SPAN_DAYS - 1); i++) out.push(addDays(from, i));
  return out;
}

/**
 * 表示に使うタイムゾーンでの「今日」。
 *
 * 'sv-SE' ロケールの日付が 'YYYY-MM-DD' そのものなので、これで切り出す。
 * 未知のタイムゾーン名を渡すと Intl は例外を投げるので、その場合は UTC に落とす。
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(now);
  } catch {
    return toDay(now);
  }
}

/** '9/9(水)'。年をまたぐ一覧でも縦に揃うよう、年は入れない。 */
export function dayLabel(day: string): string {
  const d = toDate(day);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY_JA[d.getUTCDay()]})`;
}
