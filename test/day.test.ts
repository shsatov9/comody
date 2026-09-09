/** 日付の計算。ここが1日ずれると、記録も合計も全部ずれる。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayLabel, diffDays, eachDay, isDay, todayIn } from '../lib/day.ts';

test('月と年をまたいで1日ずつ動く', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29'); // 閏年
});

test('夏時間の切り替わる日でもずれない', () => {
  // ローカル時刻で計算すると、この日は 23 時間しかない地域がある。
  // UTC の正午に置いているので、どのタイムゾーンで動かしても結果は変わらない。
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(diffDays('2026-03-07', '2026-03-09'), 2);
});

test('実在しない日付は通さない', () => {
  assert.ok(isDay('2026-09-09'));
  assert.ok(!isDay('2026-02-30')); // Date は 3/2 に繰り上げる
  assert.ok(!isDay('2026-13-01'));
  assert.ok(!isDay('2026-9-9'));
  assert.ok(!isDay(''));
  assert.ok(!isDay(null));
});

test('期間の展開は両端を含み、逆順なら空', () => {
  assert.deepEqual(eachDay('2026-08-31', '2026-09-02'), ['2026-08-31', '2026-09-01', '2026-09-02']);
  assert.deepEqual(eachDay('2026-09-02', '2026-09-01'), []);
});

test('「今日」はサーバの時計ではなくタイムゾーンで決まる', () => {
  // UTC では 9/8 の 23:30 だが、日本ではもう 9/9。
  const at = new Date('2026-09-08T23:30:00.000Z');
  assert.equal(todayIn('UTC', at), '2026-09-08');
  assert.equal(todayIn('Asia/Tokyo', at), '2026-09-09');
});

test('知らないタイムゾーン名でも落ちない', () => {
  const at = new Date('2026-09-08T23:30:00.000Z');
  assert.equal(todayIn('Mars/Olympus', at), '2026-09-08');
});

test('曜日つきの見出し', () => {
  assert.equal(dayLabel('2026-09-09'), '9/9(水)');
});
