/**
 * 献立の並べ方。
 *
 * 栄養値は献立を組んだときの推定なので、手で入れた記録と同じ顔をさせない。
 * 「推定」と添えるのはそのため。
 */
import { dayLabel } from '@/lib/day';
import { gram, kcal, n0 } from '@/lib/format';
import { PEOPLE, perMealYen } from '@/lib/plan';
import type { PlanDay, PlanItem, ShoppingItem, ShoppingTotal, WeekAverage } from '@/lib/plan';

/** 押すと記録が1行起きる。押し間違いは同じ場所から戻せる。 */
function EatButton({ item, eaten }: { item: PlanItem; eaten: boolean }) {
  return (
    <form method="post" action="/api/plan">
      <input type="hidden" name="intent" value={eaten ? 'undo' : 'eat'} />
      <input type="hidden" name="id" value={item.id} />
      <button type="submit" aria-label={`${item.title} を${eaten ? '取り消す' : '食べたことにする'}`}>
        {eaten ? '取り消す' : '食べた'}
      </button>
    </form>
  );
}

function Macros({ item }: { item: PlanItem }) {
  const parts: string[] = [];
  if (item.protein_g != null) parts.push(`P ${item.protein_g.toFixed(1)}`);
  if (item.fat_g != null) parts.push(`F ${item.fat_g.toFixed(1)}`);
  if (item.carb_g != null) parts.push(`C ${item.carb_g.toFixed(1)}`);
  if (item.salt_g != null) parts.push(`塩 ${item.salt_g.toFixed(1)}`);
  return <>{parts.length ? ` ・ ${parts.join(' ')}` : ''}</>;
}

export function Day({ day, today }: { day: PlanDay; today: string }) {
  const isToday = day.day === today;
  return (
    <section className={`plan-day${isToday ? ' is-today' : ''}`}>
      <h2>
        <span>
          {dayLabel(day.day)}
          {isToday && <span className="verdict">今日</span>}
        </span>
        {day.main?.cook_minutes != null && (
          <span className="sum">{day.main.cook_minutes} 分</span>
        )}
      </h2>

      {!day.main ? (
        // 3日ぶんしか組まないので、残りの2日はここに来る。「無い」ではなく
        // 「作らない」と書く。欠落との見分けは、週の平均の「献立のある日」で付く。
        <p className="empty">作らない日。</p>
      ) : (
        <ul className="with-action">
          <li className={day.eatenId === day.main.id ? 'is-eaten' : undefined}>
            <span className="name">
              {day.main.title}
              <span className="sub">
                1人前の推定
                <Macros item={day.main} />
              </span>
            </span>
            <span className="kcal">{kcal(day.main.kcal)}</span>
            <span className="row-action">
              {/* その日の別の品を食べていたら、本命は押せない状態にする */}
              {day.eatenId && day.eatenId !== day.main.id
                ? <span className="note">—</span>
                : <EatButton item={day.main} eaten={day.eatenId === day.main.id} />}
            </span>
          </li>
        </ul>
      )}

      {day.main?.prep_note && (
        <p className="prep">前夜に：{day.main.prep_note}</p>
      )}

      {day.alts.length > 0 && (
        <details open={day.eatenId != null && day.eatenId !== day.main?.id}>
          <summary>ほかの案（同じ買い物で作れます）</summary>
          <ul className="with-action alts">
            {day.alts.map((a) => (
              <li key={a.id} className={day.eatenId === a.id ? 'is-eaten' : undefined}>
                <span className="name">
                  {a.title}
                  <span className="sub">
                    {a.cook_minutes != null ? `${a.cook_minutes} 分` : ''}
                    <Macros item={a} />
                  </span>
                </span>
                <span className="kcal">{kcal(a.kcal)}</span>
                <span className="row-action">
                  {day.eatenId && day.eatenId !== a.id
                    ? <span className="note">—</span>
                    : <EatButton item={a} eaten={day.eatenId === a.id} />}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 今夜やっておくこと。これが読まれないと、翌日の献立が成立しない。 */
export function TonightPrep({
  prep,
}: {
  prep: { day: string; title: string; note: string };
}) {
  return (
    <p className="notice prep-notice">
      <strong>今夜：{prep.note}</strong>
      <span className="sub">{dayLabel(prep.day)}の「{prep.title}」のためです。</span>
    </p>
  );
}

export function ShoppingList({
  items,
  total,
  shoppingOn,
  cookDays,
}: {
  items: ShoppingItem[];
  total: ShoppingTotal;
  shoppingOn: string;
  /** 作る日の数。1食あたりを出すのに要る。週によって変わるので決め打ちにしない。 */
  cookDays: number;
}) {
  if (items.length === 0) return <p className="empty">買い物リストはまだありません。</p>;
  const freeze = items.filter((i) => i.to_freeze);
  return (
    <>
      <p className="hint">
        {dayLabel(shoppingOn)}に買います。{PEOPLE}人分・{cookDays}日ぶん。
      </p>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <span className="name">
              {i.name}
              <span className="sub">
                {i.qty}
                {i.flyer_item_id ? ' ・ 特売' : ' ・ 通常価格'}
                {i.to_freeze ? ' ・ 冷凍する' : ''}
              </span>
            </span>
            <span className="kcal">{i.amount_yen == null ? '—' : `${n0(i.amount_yen)} 円`}</span>
          </li>
        ))}
      </ul>
      <dl className="figures">
        <div><dt>合計</dt><dd>{n0(total.yen)} 円</dd></div>
        <div><dt>品数</dt><dd>{n0(total.count)} 点</dd></div>
        <div><dt>1食あたり</dt><dd>{n0(perMealYen(total.yen, cookDays))} 円</dd></div>
      </dl>
      {total.missingPrice > 0 && (
        <p className="note">
          （金額未入力 {total.missingPrice}件。合計はその分だけ少なく出ています）
        </p>
      )}
      {freeze.length > 0 && (
        <p className="hint">
          <strong>帰宅後に小分け冷凍：</strong>
          {freeze.map((i) => `${i.name}（${i.qty}）`).join('、')}
        </p>
      )}
    </>
  );
}

export function WeekSummary({ avg }: { avg: WeekAverage }) {
  return (
    <>
      <dl className="figures">
        <div><dt>1日あたり</dt><dd>{kcal(avg.kcal)}</dd></div>
        <div><dt>たんぱく質</dt><dd>{gram(avg.proteinG)}</dd></div>
        <div><dt>脂質</dt><dd>{gram(avg.fatG)}</dd></div>
        <div><dt>炭水化物</dt><dd>{gram(avg.carbG)}</dd></div>
        <div><dt>食塩相当量</dt><dd>{gram(avg.saltG)}</dd></div>
        <div><dt>献立のある日</dt><dd>{n0(avg.days)} 日</dd></div>
      </dl>
      <p className="note">
        すべて1人前の推定です。献立を組んだときの値で、実際に作ったものとは限りません。
        {avg.missing > 0 && `（栄養値の無い品 ${avg.missing}件。平均はその分だけ低く出ています）`}
      </p>
    </>
  );
}
