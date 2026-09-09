/** 合計と目標。未入力を 0 として足したことを、画面に隠さず伝えられるか。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeKcal, proteinShortfall, totalsOf } from '../lib/totals.ts';

const meal = (o: Partial<Record<string, number | null>> = {}) => ({
  kcal: null, protein_g: null, fat_g: null, carb_g: null, salt_g: null, ...o,
});

test('未入力は 0 として足すが、欠けた件数を必ず返す', () => {
  const t = totalsOf([
    meal({ kcal: 640, protein_g: 28, fat_g: 18, carb_g: 88, salt_g: 2.4 }),
    meal({ kcal: 95 }), // PFC が無い
  ]);
  assert.equal(t.count, 2);
  assert.equal(t.kcal, 735);
  assert.equal(t.proteinG, 28);
  // ここが 0 だと、合計が揃っているように見えてしまう。
  assert.equal(t.missingMacros, 1);
});

test('記録が無ければ全部 0', () => {
  const t = totalsOf([]);
  assert.equal(t.count, 0);
  assert.equal(t.kcal, 0);
  assert.equal(t.missingMacros, 0);
});

test('目標を入れていないあいだは何も判定しない', () => {
  for (const target of [null, undefined, 0, NaN]) {
    assert.equal(judgeKcal(1500, target as number | null).hasTarget, false);
  }
});

test('目標に対する残りと、その色分け', () => {
  assert.deepEqual(judgeKcal(1200, 2200), { hasTarget: true, target: 2200, remaining: 1000, verdict: 'ok' });
  // 残りが目標の 15% を切ったら「そろそろ」。
  assert.equal(judgeKcal(2000, 2200).verdict, 'tight');
  assert.equal(judgeKcal(2400, 2200).verdict, 'over');
  assert.equal(judgeKcal(2400, 2200).remaining, -200);
});

test('たんぱく質は下限なので、足りないぶんだけ出す', () => {
  assert.equal(proteinShortfall(62, 90), 28);
  assert.equal(proteinShortfall(120, 90), 0); // 超えていても「あと -30」とは言わない
  assert.equal(proteinShortfall(62, null), null);
});
