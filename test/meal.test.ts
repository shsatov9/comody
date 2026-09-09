/** 記録1件の組み立て。壁時計から瞬間への変換と、未入力の扱い。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  instantOf, isTime, offsetMsAt, parseMealForm, parseNumberField, timeInZone,
} from '../lib/meal.ts';

const TOKYO = 'Asia/Tokyo';

test('人の入力は黙って落とさず、失敗として返す', () => {
  assert.deepEqual(parseNumberField(''), { ok: true, value: null });
  assert.deepEqual(parseNumberField('  '), { ok: true, value: null });
  assert.deepEqual(parseNumberField('0'), { ok: true, value: 0 }); // 「本当に 0」
  assert.deepEqual(parseNumberField('513.5'), { ok: true, value: 513.5 });
  // 打ち間違えたカロリーが「未入力」として静かに消えると、ずれに気付けない。
  assert.deepEqual(parseNumberField('五百'), { ok: false });
  assert.deepEqual(parseNumberField('-1'), { ok: false });
});

test('時刻は 24 時間表記だけ', () => {
  assert.ok(isTime('00:00'));
  assert.ok(isTime('23:59'));
  assert.ok(!isTime('24:00'));
  assert.ok(!isTime('7:30')); // 0 埋めしていない
  assert.ok(!isTime('19:60'));
});

test('日本時間の夕食は UTC で9時間前の瞬間になる', () => {
  // ここを取り違えると、サーバ（Vercel は UTC）で描いたときに翌朝 4:30 に見える。
  assert.equal(instantOf('2026-09-09', '19:30', TOKYO).toISOString(), '2026-09-09T10:30:00.000Z');
  assert.equal(instantOf('2026-09-09', '00:00', TOKYO).toISOString(), '2026-09-08T15:00:00.000Z');
});

test('夏時間のある地域でも、その時期のずれ幅で戻す', () => {
  // ずれ幅は瞬間によって変わるので、一度仮に置いてから引き直している。
  assert.equal(instantOf('2026-07-01', '12:00', 'America/New_York').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(instantOf('2026-01-15', '12:00', 'America/New_York').toISOString(), '2026-01-15T17:00:00.000Z');
});

test('知らないタイムゾーン名でも落ちず、UTC として扱う', () => {
  assert.equal(offsetMsAt('Mars/Olympus', new Date()), 0);
  assert.equal(instantOf('2026-09-09', '19:30', 'Mars/Olympus').toISOString(), '2026-09-09T19:30:00.000Z');
});

test('フォームの初期値はその地域の今の時刻', () => {
  const at = new Date('2026-09-09T10:30:00.000Z');
  assert.equal(timeInZone(TOKYO, at), '19:30');
  assert.equal(timeInZone('UTC', at), '10:30');
});

const FULL = {
  title: ' 十勝風 豚丼 ',
  day: '2026-09-09', time: '19:30',
  kcal: '640', protein_g: '28', fat_g: '18', carb_g: '88', salt_g: '2.4',
};

test('入力から記録が1件できる', () => {
  const r = parseMealForm(FULL, TOKYO);
  assert.ok(r.ok);
  assert.equal(r.meal.title, '十勝風 豚丼'); // 前後の空白は落とす
  assert.equal(r.meal.day, '2026-09-09');
  assert.equal(r.meal.at, '2026-09-09T10:30:00.000Z');
  assert.equal(r.meal.kcal, 640);
  assert.equal(r.meal.salt_g, 2.4);
});

test('料理名だけで記録できる', () => {
  const r = parseMealForm({ title: '外食', day: '2026-09-09', time: '12:00' }, TOKYO);
  assert.ok(r.ok);
  assert.equal(r.meal.kcal, null);
  assert.equal(r.meal.protein_g, null);
});

test('0 kcal は未入力ではない', () => {
  const r = parseMealForm({ ...FULL, kcal: '0' }, TOKYO);
  assert.ok(r.ok);
  assert.equal(r.meal.kcal, 0);
});

test('直せるように、どの欄が悪かったかを返す', () => {
  const bad = (over: Record<string, string>) => parseMealForm({ ...FULL, ...over }, TOKYO);
  assert.deepEqual(bad({ title: '   ' }), { ok: false, error: 'bad_title' });
  assert.deepEqual(bad({ day: '2026-02-30' }), { ok: false, error: 'bad_day' });
  assert.deepEqual(bad({ time: '25:00' }), { ok: false, error: 'bad_time' });
  assert.deepEqual(bad({ kcal: '-5' }), { ok: false, error: 'bad_kcal' });
  assert.deepEqual(bad({ salt_g: 'ちょっと' }), { ok: false, error: 'bad_macro' });
});

test('料理名は長さで打ち切る（DB の check に合わせる）', () => {
  const r = parseMealForm({ ...FULL, title: 'あ'.repeat(300) }, TOKYO);
  assert.ok(r.ok);
  assert.equal(r.meal.title.length, 200);
});
