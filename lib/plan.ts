/**
 * 献立1回ぶんの組み立て。DB にも React にも依存しない純粋関数だけを置く。
 *
 * 表から来た行を「日ごとの1品＋代替」に畳み直すところと、「今夜やっておくこと」を
 * 出すところが本体。どちらも間違えると静かにずれるので、テストの当てやすい形に
 * 切り出しておく。
 */
import { eachDay } from './day.ts';

export type Slot = 'main' | 'alt1' | 'alt2';

/** meal_plan_items の1行。列名（snake_case）に揃えてある。 */
export type PlanItem = {
  id: string;
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
  /** 「これ食べた」で起きた記録。null なら、まだ食べていない。 */
  meal_id: string | null;
};

/** shopping_items の1行。 */
export type ShoppingItem = {
  id: string;
  name: string;
  qty: string;
  amount_yen: number | null;
  to_freeze: boolean;
  flyer_item_id: string | null;
};

export type PlanDay = {
  day: string;
  main: PlanItem | null;
  alts: PlanItem[];
  /** その日のどれかを食べたか。本命とは限らない（代替を食べた日もある）。 */
  eatenId: string | null;
};

const SLOT_ORDER: Record<Slot, number> = { main: 0, alt1: 1, alt2: 2 };

/**
 * 行を日ごとに畳む。期間内の日は、品が無くても必ず1つ返す。
 *
 * 欠けた日を落とすと「木曜が抜けている」ことに気付けない。空の日として並べる。
 */
export function byDay(items: PlanItem[], startsOn: string, endsOn: string): PlanDay[] {
  return eachDay(startsOn, endsOn).map((day) => {
    const ofDay = items
      .filter((i) => i.day === day)
      .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
    const eaten = ofDay.find((i) => i.meal_id);
    return {
      day,
      main: ofDay.find((i) => i.slot === 'main') ?? null,
      alts: ofDay.filter((i) => i.slot !== 'main'),
      eatenId: eaten?.id ?? null,
    };
  });
}

/**
 * 今夜やっておくこと。
 *
 * 30分で作る・作り置きしない・後半は冷凍から回す、が揃うと、前夜に冷蔵庫へ移す
 * 作業が献立の一部になる。木曜の夕方に凍った肉を見つけた時点で、その日の献立は
 * 成立しない。だから「今日の献立」と同じ画面に、明日のぶんを出す。
 *
 * 明日の本命に prep_note があればそれを返す。無ければ null。
 */
export function tonightPrep(
  days: PlanDay[],
  today: string,
): { day: string; title: string; note: string } | null {
  const i = days.findIndex((d) => d.day === today);
  const next = i >= 0 ? days[i + 1] : undefined;
  const item = next?.main;
  if (!item?.prep_note) return null;
  return { day: next!.day, title: item.title, note: item.prep_note };
}

export type ShoppingTotal = {
  count: number;
  yen: number;
  /** 金額が入っていない品数。合計はその分だけ少なく出る。 */
  missingPrice: number;
  freezeCount: number;
};

/**
 * 買い物リストの合計。
 *
 * 金額の無い品を 0 として足すので、欠けている件数を必ず一緒に返す。
 * 黙って 0 を足して揃っているように見せると、合計を信用しすぎることになる。
 */
export function shoppingTotal(items: ShoppingItem[]): ShoppingTotal {
  const t: ShoppingTotal = { count: items.length, yen: 0, missingPrice: 0, freezeCount: 0 };
  for (const i of items) {
    if (i.amount_yen == null) t.missingPrice++;
    else t.yen += i.amount_yen;
    if (i.to_freeze) t.freezeCount++;
  }
  return t;
}

export type WeekAverage = {
  days: number;
  /** 栄養値が1つでも欠けている品数。平均はその分だけ低く出る。 */
  missing: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  saltG: number;
};

/**
 * 週の平均。食べた日ではなく、本命が置かれている日で割る。
 *
 * 品の無い日を 0 kcal として混ぜると平均が下がるので、分母から外す。
 */
export function weekAverage(days: PlanDay[]): WeekAverage | null {
  const mains = days.map((d) => d.main).filter((m): m is PlanItem => m != null);
  if (mains.length === 0) return null;
  const add = (k: keyof PlanItem) =>
    mains.reduce((s, m) => s + ((m[k] as number | null) ?? 0), 0) / mains.length;
  return {
    days: mains.length,
    missing: mains.filter((m) => m.kcal == null).length,
    kcal: add('kcal'),
    proteinG: add('protein_g'),
    fatG: add('fat_g'),
    carbG: add('carb_g'),
    saltG: add('salt_g'),
  };
}

/** 所帯の人数。夫婦2人で1つの食卓を囲む前提（§2「なぜ所帯を挟むか」）。 */
export const PEOPLE = 2;

/**
 * 1食あたりの食費。
 *
 * 割る数を「5日×2人」で決め打ちにしない。作る日は週によって変わるうえ、
 * 3日に減らしたときに黙って半分近くずれる。
 *
 * 買った量が使う量より多いこと（特売はパック単位なので3日だと余る）は直さない。
 * 余りごと割った値が、その週に実際に出ていく金額なので。
 */
export function perMealYen(yen: number, cookDays: number): number | null {
  const meals = cookDays * PEOPLE;
  return meals > 0 ? yen / meals : null;
}
