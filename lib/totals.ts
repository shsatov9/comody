/**
 * 合計と、目標との比べ方。DB にも React にも依存しない。
 *
 * 合計は「未入力を 0 として足した値」なので、欠けている件数を必ず一緒に返す。
 * 黙って 0 を足して揃っているように見せると、合計を信用しすぎることになる。
 */

export type MealLike = {
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  salt_g: number | null;
};

export type Totals = {
  count: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  saltG: number;
  /** PFC・食塩のどれかが未入力の件数。 */
  missingMacros: number;
};

export function totalsOf(meals: MealLike[]): Totals {
  const t: Totals = { count: meals.length, kcal: 0, proteinG: 0, fatG: 0, carbG: 0, saltG: 0, missingMacros: 0 };
  for (const m of meals) {
    t.kcal += m.kcal ?? 0;
    t.proteinG += m.protein_g ?? 0;
    t.fatG += m.fat_g ?? 0;
    t.carbG += m.carb_g ?? 0;
    t.saltG += m.salt_g ?? 0;
    if (m.protein_g == null || m.fat_g == null || m.carb_g == null || m.salt_g == null) t.missingMacros++;
  }
  return t;
}

export type Verdict = 'ok' | 'tight' | 'over';

/**
 * 目標に対してどうか。
 *
 * 目標が入っていなければ何も言わない（hasTarget=false）。勝手に目標を
 * 決めて判定を出すと、入れていない人にとっては意味のない色が付くだけになる。
 */
export function judgeKcal(total: number, target: number | null | undefined) {
  if (target == null || !Number.isFinite(target) || target <= 0) {
    return { hasTarget: false as const, target: null, remaining: null, verdict: 'ok' as Verdict };
  }
  const remaining = target - total;
  const verdict: Verdict = remaining < 0 ? 'over' : remaining < target * 0.15 ? 'tight' : 'ok';
  return { hasTarget: true as const, target, remaining, verdict };
}

/** たんぱく質は「下限」なので、超えたぶんではなく足りないぶんを出す。 */
export function proteinShortfall(total: number, target: number | null | undefined): number | null {
  if (target == null || !Number.isFinite(target) || target <= 0) return null;
  const short = target - total;
  return short > 0 ? short : 0;
}
