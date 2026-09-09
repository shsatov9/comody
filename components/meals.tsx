/**
 * 記録の並べ方と、その日の合計。
 *
 * 合計は「未入力を 0 として足した値」なので、PFC が欠けている記録が混ざって
 * いたらその件数を添える。黙って 0 を足して揃っているように見せると、
 * 合計を信用しすぎることになる。
 */
import { gram, kcal, n0, signed, timeOfDay } from '@/lib/format';
import { judgeKcal, proteinShortfall } from '@/lib/totals';
import type { Totals } from '@/lib/totals';

export type MealRow = {
  id: string;
  day: string;
  at: string;
  title: string;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  salt_g: number | null;
};

export function MealList({
  meals,
  timeZone,
  day,
}: {
  meals: MealRow[];
  timeZone: string;
  day: string;
}) {
  if (meals.length === 0) return <p className="empty">この日の記録はまだありません。</p>;
  return (
    <ul className="with-action">
      {meals.map((m) => (
        <li key={m.id}>
          <span className="name">
            {m.title}
            <span className="sub">
              {timeOfDay(m.at, timeZone)}
              {macros(m)}
            </span>
          </span>
          <span className="kcal">{kcal(m.kcal)}</span>
          <span className="row-action">
            <form method="post" action="/api/meals">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="day" value={day} />
              <button type="submit" aria-label={`${m.title} を消す`}>
                消す
              </button>
            </form>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** その日の合計と、目標との差。目標が無ければ判定は一切出さない。 */
export function TotalsSummary({
  totals,
  targetKcal,
  targetProteinG,
}: {
  totals: Totals;
  targetKcal: number | null;
  targetProteinG: number | null;
}) {
  const judged = judgeKcal(totals.kcal, targetKcal);
  const short = proteinShortfall(totals.proteinG, targetProteinG);
  return (
    <span className="sum">
      {n0(totals.kcal)} kcal
      {judged.hasTarget && (
        <span className={`verdict ${judged.verdict}`}>
          目標 {n0(judged.target)} / 残り {signed(judged.remaining)}
        </span>
      )}
      {short != null && short > 0 && (
        <span className="verdict">たんぱく質あと {gram(short)}</span>
      )}
      {totals.missingMacros > 0 && (
        <span className="note" title="PFC が未入力の記録があります。合計はその分だけ少なく出ます。">
          （PFC未入力 {totals.missingMacros}件）
        </span>
      )}
    </span>
  );
}

/**
 * PFC の熱量比。グラム比ではなく熱量比で描くのは、脂質だけ 1g あたりの
 * 熱量が倍以上あり、グラムで並べると実態より軽く見えるため。
 */
export function PfcBar({ totals }: { totals: Totals }) {
  const p = totals.proteinG * 4;
  const f = totals.fatG * 9;
  const c = totals.carbG * 4;
  const sum = p + f + c;
  if (sum <= 0) return null;

  const pw = (p / sum) * 100;
  const fw = (f / sum) * 100;
  const cw = 100 - pw - fw;

  return (
    <div>
      <svg className="pfc-bar" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="PFCの熱量比">
        <rect className="pfc-p" x="0" y="0" width={pw} height="10" />
        <rect className="pfc-f" x={pw} y="0" width={fw} height="10" />
        <rect className="pfc-c" x={pw + fw} y="0" width={cw} height="10" />
      </svg>
      <ul className="pfc-legend">
        <li><span className="swatch pfc-p" />たんぱく質 {Math.round(pw)}%</li>
        <li><span className="swatch pfc-f" />脂質 {Math.round(fw)}%</li>
        <li><span className="swatch pfc-c" />炭水化物 {Math.round(cw)}%</li>
      </ul>
    </div>
  );
}

function macros(m: MealRow): string {
  const parts: string[] = [];
  if (m.protein_g != null) parts.push(`P ${m.protein_g.toFixed(1)}`);
  if (m.fat_g != null) parts.push(`F ${m.fat_g.toFixed(1)}`);
  if (m.carb_g != null) parts.push(`C ${m.carb_g.toFixed(1)}`);
  if (m.salt_g != null) parts.push(`塩 ${m.salt_g.toFixed(1)}`);
  return parts.length ? ` ・ ${parts.join(' ')}` : '';
}
