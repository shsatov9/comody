/** 献立1回ぶんの畳み方と、前夜の準備。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { byDay, perMealYen, shoppingTotal, tonightPrep, weekAverage } from '../lib/plan.ts';
import type { PlanItem, ShoppingItem, Slot } from '../lib/plan.ts';

const item = (over: Partial<PlanItem> & { id: string; day: string; slot: Slot }): PlanItem => ({
  title: `${over.day} の ${over.slot}`,
  cook_minutes: 20, prep_note: null,
  kcal: 600, protein_g: 30, fat_g: 25, carb_g: 65, salt_g: 2.5,
  meal_id: null,
  ...over,
});

const WEEK = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];

test('日ごとに畳む。品の無い日も落とさない', () => {
  const days = byDay(
    [item({ id: 'a', day: WEEK[0], slot: 'main' }), item({ id: 'b', day: WEEK[2], slot: 'main' })],
    WEEK[0], WEEK[4],
  );
  // 欠けた日を落とすと「木曜が抜けている」ことに気付けない
  assert.equal(days.length, 5);
  assert.equal(days[0].main?.id, 'a');
  assert.equal(days[1].main, null);
  assert.equal(days[2].main?.id, 'b');
});

test('代替は slot の順に並ぶ', () => {
  const days = byDay([
    item({ id: 'c', day: WEEK[0], slot: 'alt2' }),
    item({ id: 'a', day: WEEK[0], slot: 'main' }),
    item({ id: 'b', day: WEEK[0], slot: 'alt1' }),
  ], WEEK[0], WEEK[0]);
  assert.equal(days[0].main?.id, 'a');
  assert.deepEqual(days[0].alts.map((i) => i.id), ['b', 'c']);
});

test('食べたのが代替のこともある', () => {
  const days = byDay([
    item({ id: 'a', day: WEEK[0], slot: 'main' }),
    item({ id: 'b', day: WEEK[0], slot: 'alt1', meal_id: 'm1' }),
  ], WEEK[0], WEEK[0]);
  assert.equal(days[0].eatenId, 'b');
});

test('今夜やることは、明日の本命の prep_note', () => {
  const days = byDay([
    item({ id: 'a', day: WEEK[0], slot: 'main' }),
    item({ id: 'b', day: WEEK[1], slot: 'main', prep_note: '鶏ももを冷凍庫から冷蔵庫へ' }),
  ], WEEK[0], WEEK[4]);
  const prep = tonightPrep(days, WEEK[0]);
  assert.equal(prep?.day, WEEK[1]);
  assert.equal(prep?.note, '鶏ももを冷凍庫から冷蔵庫へ');
});

test('明日に準備が要らなければ、何も出さない', () => {
  const days = byDay([item({ id: 'b', day: WEEK[1], slot: 'main' })], WEEK[0], WEEK[4]);
  assert.equal(tonightPrep(days, WEEK[0]), null);
  // 週の外・最終日の翌日も、黙って null
  assert.equal(tonightPrep(days, WEEK[4]), null);
  assert.equal(tonightPrep(days, '2026-01-01'), null);
});

test('買い物の合計は、金額の無い品数を必ず添える', () => {
  const s = (over: Partial<ShoppingItem> & { id: string }): ShoppingItem =>
    ({ name: 'x', qty: '1', amount_yen: 100, to_freeze: false, flyer_item_id: null, ...over });
  const t = shoppingTotal([
    s({ id: '1', amount_yen: 960, to_freeze: true }),
    s({ id: '2', amount_yen: 378 }),
    s({ id: '3', amount_yen: null }),   // 定番品で値段を入れていない
  ]);
  assert.equal(t.yen, 1338);          // 欠けを 0 として足した値
  assert.equal(t.missingPrice, 1);    // それを黙らせない
  assert.equal(t.freezeCount, 1);
  assert.equal(t.count, 3);
});

test('週の平均は、品が置かれている日だけで割る', () => {
  const days = byDay([
    item({ id: 'a', day: WEEK[0], slot: 'main', kcal: 500 }),
    item({ id: 'b', day: WEEK[1], slot: 'main', kcal: 700 }),
  ], WEEK[0], WEEK[4]);
  const avg = weekAverage(days);
  // 空の3日を 0 kcal として混ぜると 240 になる。それはしない
  assert.equal(avg?.days, 2);
  assert.equal(avg?.kcal, 600);
});

test('栄養値の欠けた品は、件数として出す', () => {
  const days = byDay([
    item({ id: 'a', day: WEEK[0], slot: 'main', kcal: 600 }),
    item({ id: 'b', day: WEEK[1], slot: 'main', kcal: null }),
  ], WEEK[0], WEEK[4]);
  assert.equal(weekAverage(days)?.missing, 1);
});

test('品が1つも無ければ平均を出さない', () => {
  assert.equal(weekAverage(byDay([], WEEK[0], WEEK[4])), null);
});

test('1食あたりは、作る日の数で割る', () => {
  // 3日×2人 = 6食。「5日×2人」で決め打ちにすると、3日に減らしたとき黙ってずれる
  assert.equal(perMealYen(2400, 3), 400);
  assert.equal(perMealYen(2400, 5), 240);
  // 作る日が無ければ割らない。0 除算で Infinity を出さない
  assert.equal(perMealYen(2400, 0), null);
});
