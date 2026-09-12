/**
 * 貼り付けた JSON から、献立1回ぶんを組み立てる。DB にも React にも依存しない。
 *
 * 献立を組むのは Claude（`.claude/skills/meal-plan`）で、その結果を DB に入れる
 * のがここ。以前は手で SQL を書いていた（`supabase/seed/` がその名残）。
 *
 * ## 黙って直さない
 *
 * 足りない欄を既定値で埋めたり、数に見える文字列を数へ寄せたりしない。献立は
 * 週に1回しか入らないので、**間違ったまま入るほうがずっと高くつく**。おかしい
 * ところは全部集めて名前を付けて返し、人に直してもらう。
 *
 * ## 間違いは1つずつ返さない
 *
 * 最初の1件で止めると、貼り直しが errors の数だけ要る。JSON は機械が出すので
 * 間違うときはまとめて間違う。**見つかったものを全部返す。**
 */
import { diffDays, isDay } from './day.ts';

/** 返すエラーの上限。URL に載せて画面まで持っていくので、無制限にはしない。 */
export const MAX_ERRORS = 8;
/** 1件あたりの長さ。同上。 */
export const MAX_ERROR_LEN = 120;

const MAX_NAME = 200;
const MAX_STORE = 60;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SLOTS = ['main', 'alt1', 'alt2'] as const;

/** flyer_items.category の check 制約と同じ並び。片方だけ増えると入らなくなる。 */
const CATEGORIES = new Set([
  'produce', 'meat', 'seafood', 'deli', 'dairy', 'grocery', 'drink', 'sweets', 'other',
]);

export type Slot = (typeof SLOTS)[number];

export type ImportFlyerItem = {
  key: string | null;
  name: string;
  price_yen: number | null;
  price_tax_in: number | null;
  unit: string | null;
  discount_note: string | null;
  category: string | null;
  origin: string | null;
  valid_from: string | null;
  valid_to: string | null;
  limit_note: string | null;
  confidence: number;
  raw: unknown;
};

export type ImportFlyer = {
  store: string | null;
  valid_from: string | null;
  valid_to: string | null;
  image_path: string;
  image_sha256: string;
  items: ImportFlyerItem[];
};

export type ImportShoppingItem = {
  key: string | null;
  name: string;
  qty: string;
  amount_yen: number | null;
  to_freeze: boolean;
  flyerItemKey: string | null;
};

export type ImportIngredient = {
  name: string;
  qty: string | null;
  is_main: boolean;
  shoppingKey: string | null;
};

export type ImportItem = {
  day: string;
  slot: Slot;
  title: string;
  cook_minutes: number | null;
  prep_note: string | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  salt_g: number | null;
  ingredients: ImportIngredient[];
};

export type ImportPlan = {
  shopping_on: string;
  starts_on: string;
  ends_on: string;
  /** 既に入っているチラシに紐づけるとき。flyer と同時には指定できない。 */
  flyerId: string | null;
  flyer: ImportFlyer | null;
  shopping: ImportShoppingItem[];
  items: ImportItem[];
  /** そのまま meal_plans.raw へ。あとで「何を貼ったか」を見返せるように。 */
  raw: unknown;
};

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; errors: string[] };

// ── 小物 ────────────────────────────────────────────────────────

function add(errors: string[], message: string): void {
  if (errors.length < MAX_ERRORS) errors.push(message.slice(0, MAX_ERROR_LEN));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 任意の文字列。空欄は null。数値や真偽値が来たら見なかったことにはしない。 */
function optText(v: unknown, path: string, errors: string[], max = MAX_NAME): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') {
    add(errors, `${path} は文字列で入れてください。`);
    return null;
  }
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) {
    add(errors, `${path} が長すぎます（${max} 文字まで）。`);
    return s.slice(0, max);
  }
  return s;
}

/** 必須の文字列。 */
function needText(v: unknown, path: string, errors: string[], max = MAX_NAME): string {
  const s = text(v);
  if (!s) {
    add(errors, `${path} が空です。`);
    return '';
  }
  if (s.length > max) {
    add(errors, `${path} が長すぎます（${max} 文字まで）。`);
    return s.slice(0, max);
  }
  return s;
}

type NumOpts = { int?: boolean; min?: number; max?: number };

/**
 * 数。文字列は受けない。
 *
 * '89' を 89 として通すと、**引用符の付け忘れが黙って直る**。出しているのが
 * 機械である以上、形が違うことのほうが情報なので、そこで止める。
 */
function optNumber(v: unknown, path: string, errors: string[], opts: NumOpts = {}): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    add(errors, `${path} は数で入れてください。`);
    return null;
  }
  if (opts.int && !Number.isInteger(v)) {
    add(errors, `${path} は整数で入れてください。`);
    return null;
  }
  const min = opts.min ?? 0;
  if (v < min) {
    add(errors, `${path} は ${min} 以上で入れてください。`);
    return null;
  }
  if (opts.max != null && v > opts.max) {
    add(errors, `${path} は ${opts.max} 以下で入れてください。`);
    return null;
  }
  return v;
}

function needDay(v: unknown, path: string, errors: string[]): string {
  const s = text(v);
  if (!isDay(s)) {
    add(errors, `${path} は 'YYYY-MM-DD' の実在する日付で入れてください。`);
    return '';
  }
  return s;
}

function optDay(v: unknown, path: string, errors: string[]): string | null {
  if (v === null || v === undefined || text(v) === '') return null;
  const s = text(v);
  if (!isDay(s)) {
    add(errors, `${path} は 'YYYY-MM-DD' の実在する日付で入れてください。`);
    return null;
  }
  return s;
}

function optBool(v: unknown, path: string, errors: string[]): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v !== 'boolean') {
    add(errors, `${path} は true か false で入れてください。`);
    return false;
  }
  return v;
}

function asArray(v: unknown, path: string, errors: string[]): unknown[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) {
    add(errors, `${path} は配列で入れてください。`);
    return [];
  }
  return v;
}

// ── 本体 ────────────────────────────────────────────────────────

/** 貼り付けられた文字列から組み立てる。JSON として読めない時点で終わる。 */
export function parsePlanJson(source: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, errors: ['JSON として読めません。貼り付けが途中で切れていないか見てください。'] };
  }
  return buildPlan(raw);
}

export function buildPlan(raw: unknown): ImportResult {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ['いちばん外側は { } のオブジェクトで入れてください。'] };
  }

  const shopping_on = needDay(raw.shopping_on, 'shopping_on（買い物に行く日）', errors);
  const starts_on = needDay(raw.starts_on, 'starts_on（週のはじめ）', errors);
  const ends_on = needDay(raw.ends_on, 'ends_on（週のおわり）', errors);

  // 表の check 制約と同じことを、入る前に人の言葉で言う。
  if (starts_on && ends_on && diffDays(starts_on, ends_on) < 0) {
    add(errors, 'ends_on が starts_on より前です。');
  }
  if (shopping_on && starts_on && diffDays(shopping_on, starts_on) <= 0) {
    add(errors, 'shopping_on は starts_on より前の日にしてください（買ってから食べる）。');
  }

  const flyerId = optText(raw.flyer_id, 'flyer_id', errors, 36);
  const flyer = parseFlyer(raw.flyer, errors);
  if (flyerId && flyer) {
    add(errors, 'flyer と flyer_id は同時に指定できません。取り込み済みなら flyer_id だけにしてください。');
  }

  const flyerKeys = new Set<string>();
  for (const it of flyer?.items ?? []) if (it.key) flyerKeys.add(it.key);

  const shopping = parseShopping(raw.shopping, flyerKeys, Boolean(flyer), errors);
  const shoppingKeys = new Set<string>();
  for (const s of shopping) if (s.key) shoppingKeys.add(s.key);

  const items = parseDays(raw.days, starts_on, ends_on, shoppingKeys, errors);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: { shopping_on, starts_on, ends_on, flyerId, flyer, shopping, items, raw },
  };
}

function parseFlyer(v: unknown, errors: string[]): ImportFlyer | null {
  if (v === null || v === undefined) return null;
  if (!isObject(v)) {
    add(errors, 'flyer は { } のオブジェクトで入れてください。');
    return null;
  }

  // 画像そのものは別に上げる。ここが持つのは置き場所と、二度取り込まないための指紋。
  const image_path = needText(v.image_path, 'flyer.image_path', errors, 400);
  const image_sha256 = text(v.image_sha256).toLowerCase();
  if (!SHA256_RE.test(image_sha256)) {
    add(errors, "flyer.image_sha256 は 64 桁の 16 進数で入れてください（shasum -a 256 の出力）。");
  }

  const rows = asArray(v.items, 'flyer.items', errors);
  if (rows.length === 0) add(errors, 'flyer.items が空です。商品が無いチラシは取り込めません。');

  const seen = new Set<string>();
  const items: ImportFlyerItem[] = rows.map((row, i) => {
    const at = `flyer.items[${i}]`;
    if (!isObject(row)) {
      add(errors, `${at} は { } のオブジェクトで入れてください。`);
      return emptyFlyerItem();
    }
    const key = optText(row.key, `${at}.key`, errors, 60);
    if (key) {
      if (seen.has(key)) add(errors, `${at}.key「${key}」が重複しています。`);
      seen.add(key);
    }
    const category = optText(row.category, `${at}.category`, errors, 20);
    if (category && !CATEGORIES.has(category)) {
      add(errors, `${at}.category「${category}」は使えません（${[...CATEGORIES].join(' / ')}）。`);
    }
    // 自信は必ず出させる。無いものを 1.0 として入れると、読み間違いが
    // 「確かめた値」と同じ顔で並ぶ。
    const confidence = optNumber(row.confidence, `${at}.confidence`, errors, { max: 1 });
    if (confidence == null) add(errors, `${at}.confidence が要ります（0.0〜1.0）。`);

    return {
      key,
      name: needText(row.name, `${at}.name`, errors),
      price_yen: optNumber(row.price_yen, `${at}.price_yen`, errors, { int: true }),
      price_tax_in: optNumber(row.price_tax_in, `${at}.price_tax_in`, errors, { int: true }),
      unit: optText(row.unit, `${at}.unit`, errors),
      discount_note: optText(row.discount_note, `${at}.discount_note`, errors),
      category,
      origin: optText(row.origin, `${at}.origin`, errors),
      valid_from: optDay(row.valid_from, `${at}.valid_from`, errors),
      valid_to: optDay(row.valid_to, `${at}.valid_to`, errors),
      limit_note: optText(row.limit_note, `${at}.limit_note`, errors),
      confidence: confidence ?? 0,
      raw: row,
    };
  });

  return {
    store: optText(v.store, 'flyer.store', errors, MAX_STORE),
    valid_from: optDay(v.valid_from, 'flyer.valid_from', errors),
    valid_to: optDay(v.valid_to, 'flyer.valid_to', errors),
    image_path,
    image_sha256,
    items,
  };
}

function emptyFlyerItem(): ImportFlyerItem {
  return {
    key: null, name: '', price_yen: null, price_tax_in: null, unit: null,
    discount_note: null, category: null, origin: null, valid_from: null,
    valid_to: null, limit_note: null, confidence: 0, raw: null,
  };
}

function parseShopping(
  v: unknown,
  flyerKeys: Set<string>,
  hasFlyer: boolean,
  errors: string[],
): ImportShoppingItem[] {
  const rows = asArray(v, 'shopping', errors);
  const seen = new Set<string>();

  return rows.map((row, i) => {
    const at = `shopping[${i}]`;
    if (!isObject(row)) {
      add(errors, `${at} は { } のオブジェクトで入れてください。`);
      return { key: null, name: '', qty: '', amount_yen: null, to_freeze: false, flyerItemKey: null };
    }
    const key = optText(row.key, `${at}.key`, errors, 60);
    if (key) {
      if (seen.has(key)) add(errors, `${at}.key「${key}」が重複しています。`);
      seen.add(key);
    }
    const flyerItemKey = optText(row.flyer_item, `${at}.flyer_item`, errors, 60);
    if (flyerItemKey && !flyerKeys.has(flyerItemKey)) {
      add(errors, hasFlyer
        ? `${at}.flyer_item「${flyerItemKey}」に当たる flyer.items が見つかりません。`
        : `${at}.flyer_item が指せません。flyer を一緒に入れてください。`);
    }
    return {
      key,
      name: needText(row.name, `${at}.name`, errors),
      // '500g' と '1パック' は意味が違うので、数に落とさず文字のまま持つ。
      qty: needText(row.qty, `${at}.qty`, errors, 60),
      amount_yen: optNumber(row.amount_yen, `${at}.amount_yen`, errors, { int: true }),
      to_freeze: optBool(row.to_freeze, `${at}.to_freeze`, errors),
      flyerItemKey,
    };
  });
}

function parseDays(
  v: unknown,
  startsOn: string,
  endsOn: string,
  shoppingKeys: Set<string>,
  errors: string[],
): ImportItem[] {
  const rows = asArray(v, 'days', errors);
  if (rows.length === 0) add(errors, 'days が空です。作る日が1日も無い献立は取り込めません。');

  const out: ImportItem[] = [];
  const seenDays = new Set<string>();

  rows.forEach((row, i) => {
    const at = `days[${i}]`;
    if (!isObject(row)) {
      add(errors, `${at} は { } のオブジェクトで入れてください。`);
      return;
    }
    const day = needDay(row.day, `${at}.day`, errors);
    if (!day) return;

    if (seenDays.has(day)) add(errors, `${at}.day「${day}」が重複しています。`);
    seenDays.add(day);

    // 期間の外に置くと、byDay() が畳むときに落ちて画面から消える。
    if (startsOn && endsOn && (diffDays(startsOn, day) < 0 || diffDays(day, endsOn) < 0)) {
      add(errors, `${at}.day「${day}」が starts_on〜ends_on の外です。`);
    }

    if (!isObject(row.main)) {
      add(errors, `${at}.main が要ります。作らない日は days に書かず、行を作りません。`);
    } else {
      out.push(parseItem(row.main, day, 'main', `${at}.main`, shoppingKeys, errors));
    }

    const alts = asArray(row.alts, `${at}.alts`, errors);
    if (alts.length > 2) add(errors, `${at}.alts は2つまでです（main / alt1 / alt2）。`);
    alts.slice(0, 2).forEach((alt, j) => {
      const path = `${at}.alts[${j}]`;
      if (!isObject(alt)) {
        add(errors, `${path} は { } のオブジェクトで入れてください。`);
        return;
      }
      out.push(parseItem(alt, day, SLOTS[j + 1], path, shoppingKeys, errors));
    });
  });

  return out;
}

function parseItem(
  row: Record<string, unknown>,
  day: string,
  slot: Slot,
  at: string,
  shoppingKeys: Set<string>,
  errors: string[],
): ImportItem {
  const ingredients = asArray(row.ingredients, `${at}.ingredients`, errors).map((ing, i) => {
    const path = `${at}.ingredients[${i}]`;
    if (!isObject(ing)) {
      add(errors, `${path} は { } のオブジェクトで入れてください。`);
      return { name: '', qty: null, is_main: false, shoppingKey: null };
    }
    const shoppingKey = optText(ing.shopping, `${path}.shopping`, errors, 60);
    // 家にある米や調味料は買わないので、指せないこと自体は正しい。指した先が
    // 無いときだけ止める。
    if (shoppingKey && !shoppingKeys.has(shoppingKey)) {
      add(errors, `${path}.shopping「${shoppingKey}」に当たる shopping が見つかりません。`);
    }
    return {
      name: needText(ing.name, `${path}.name`, errors),
      qty: optText(ing.qty, `${path}.qty`, errors, 60),
      is_main: optBool(ing.is_main, `${path}.is_main`, errors),
      shoppingKey,
    };
  });

  return {
    day,
    slot,
    title: needText(row.title, `${at}.title`, errors),
    // 30分は材料を出してから食卓に出るまで。解凍は数えない。
    cook_minutes: optNumber(row.cook_minutes, `${at}.cook_minutes`, errors, { int: true, min: 1, max: 180 }),
    prep_note: optText(row.prep_note, `${at}.prep_note`, errors, 400),
    kcal: optNumber(row.kcal, `${at}.kcal`, errors),
    protein_g: optNumber(row.protein_g, `${at}.protein_g`, errors),
    fat_g: optNumber(row.fat_g, `${at}.fat_g`, errors),
    carb_g: optNumber(row.carb_g, `${at}.carb_g`, errors),
    salt_g: optNumber(row.salt_g, `${at}.salt_g`, errors),
    ingredients,
  };
}
