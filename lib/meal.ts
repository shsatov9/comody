/**
 * 記録1件の組み立て。DB にも React にも依存しない純粋関数だけを置く。
 *
 * 画面から来た文字列を、そのまま DB に入る形にするところまでをここで完結させる。
 * 「未入力」と 0 の区別、壁時計から瞬間への変換など、間違えると静かにずれる
 * 決まりごとが集まっているので、テストの当てやすい形に切り出しておく。
 */
import { isDay } from './day.ts';

export const MAX_TITLE = 200;

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v);
}

/**
 * 人が打った数値。空欄は null、それ以外で数にならなければ失敗させる。
 *
 * 黙って null にしないのは、打ち間違えたカロリーが「未入力」として静かに
 * 消えると、合計がずれたことに気付けないため。0 は「本当に 0」なので通す。
 */
export function parseNumberField(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null };
  const s = String(v).trim();
  if (s === '') return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

/**
 * そのタイムゾーンでの壁時計を 'YYYY-MM-DDTHH:mm:ss' で返す。
 * 'sv-SE' の書式が ISO とほぼ同じなので、区切りだけ直して使う。
 */
function wallClock(timeZone: string, at: Date): string {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return f.format(at).replace(' ', 'T');
}

/** そのタイムゾーンが UTC から何ミリ秒ずれているか。夏時間があるので瞬間ごとに変わる。 */
export function offsetMsAt(timeZone: string, at: Date): number {
  try {
    return Date.parse(`${wallClock(timeZone, at)}Z`) - at.getTime();
  } catch {
    return 0; // 知らないタイムゾーン名。todayIn と同じく UTC に落とす。
  }
}

/**
 * 「その地域の 9/9 19:30」が指す実際の瞬間。
 *
 * new Date('2026-09-09T19:30') はサーバのタイムゾーンで解釈される。Vercel は
 * UTC で動くので、そのまま入れると日本時間の夕食が記録上は翌朝 4:30 になる。
 * 日付は day 列に別で持っているのに、時刻だけずれることになる。
 *
 * ずれを引くには、その瞬間のずれ幅が要る。ずれ幅は瞬間によって変わる（夏時間）
 * ので、一度仮に置いてから引き直す。2回で収まる。
 */
export function instantOf(day: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(naive)) return new Date(NaN);
  const once = naive - offsetMsAt(timeZone, new Date(naive));
  return new Date(naive - offsetMsAt(timeZone, new Date(once)));
}

/** フォームの初期値に使う 'HH:mm'。 */
export function timeInZone(timeZone: string, at: Date = new Date()): string {
  try {
    return wallClock(timeZone, at).slice(11, 16);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** meals の1行。DB の列名（snake_case）に揃えてあり、そのまま insert できる。 */
export type NewMeal = {
  day: string;
  at: string;
  title: string;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  salt_g: number | null;
};

export type ParseError = 'bad_title' | 'bad_day' | 'bad_time' | 'bad_kcal' | 'bad_macro';
export type ParseResult = { ok: true; meal: NewMeal } | { ok: false; error: ParseError };

export type RawMealForm = {
  title?: unknown; day?: unknown; time?: unknown; kcal?: unknown;
  protein_g?: unknown; fat_g?: unknown; carb_g?: unknown; salt_g?: unknown;
};

/**
 * フォームの入力から記録を1件作る。
 *
 * 料理名だけが必須。カロリーも空でよい（「何を食べたか」だけ残す使い方を
 * 潰さない）。栄養値の無い記録は合計に 0 として足されるが、画面は
 * 「PFC未入力 n件」を添えるので、合計を信用しすぎることにはならない。
 */
export function parseMealForm(raw: RawMealForm, timeZone: string): ParseResult {
  const title = String(raw.title ?? '').trim().slice(0, MAX_TITLE);
  if (!title) return { ok: false, error: 'bad_title' };

  const day = String(raw.day ?? '');
  if (!isDay(day)) return { ok: false, error: 'bad_day' };

  const time = String(raw.time ?? '');
  if (!isTime(time)) return { ok: false, error: 'bad_time' };

  const kcal = parseNumberField(raw.kcal);
  if (!kcal.ok) return { ok: false, error: 'bad_kcal' };

  const macros = [raw.protein_g, raw.fat_g, raw.carb_g, raw.salt_g].map(parseNumberField);
  if (macros.some((m) => !m.ok)) return { ok: false, error: 'bad_macro' };
  const [p, f, c, s] = macros as { ok: true; value: number | null }[];

  return {
    ok: true,
    meal: {
      day,
      at: instantOf(day, time, timeZone).toISOString(),
      title,
      kcal: kcal.value,
      protein_g: p.value,
      fat_g: f.value,
      carb_g: c.value,
      salt_g: s.value,
    },
  };
}

export function errorMessage(e: string): string {
  switch (e) {
    case 'bad_title': return '料理名を入れてください。';
    case 'bad_day': return '日付が正しくありません。';
    case 'bad_time': return '時刻が正しくありません。';
    case 'bad_kcal': return 'カロリーは 0 以上の数で入れてください。';
    case 'bad_macro': return 'PFC・食塩は 0 以上の数で入れてください。';
    case 'not_deletable': return 'その記録は消せませんでした。';
    case 'storage_failed': return '保存できませんでした。時間をおいて試してください。';
    case 'bad_code': return '合い言葉が違います。';
    default: return '';
  }
}
