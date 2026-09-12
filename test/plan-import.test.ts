/**
 * 貼り付けた JSON の検め方。
 *
 * 献立は週に1回しか入らないので、**間違ったまま入るほうがずっと高くつく**。
 * 黙って直さないこと、間違いをまとめて返すことを、ここで押さえておく。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, parsePlanJson } from '../lib/plan-import.ts';

/** 通る最小の1回ぶん。各テストはここから1か所だけ崩す。 */
function base(): Record<string, unknown> {
  return {
    shopping_on: '2026-09-13',
    starts_on: '2026-09-14',
    ends_on: '2026-09-18',
    shopping: [
      { key: 'chicken', name: '若鶏もも肉', qty: '約1,000g', amount_yen: 960, to_freeze: true },
    ],
    days: [
      {
        day: '2026-09-16',
        main: {
          title: '鶏もものトマト煮',
          cook_minutes: 25,
          prep_note: '鶏ももを冷凍庫から冷蔵庫へ移す',
          kcal: 638, protein_g: 32.3, fat_g: 30.0, carb_g: 64.5, salt_g: 1.8,
          ingredients: [{ name: '鶏もも肉', qty: '330g', is_main: true, shopping: 'chicken' }],
        },
        alts: [{ title: '鶏とトマトのチーズ焼き', cook_minutes: 25 }],
      },
    ],
  };
}

const errorsOf = (raw: unknown): string[] => {
  const r = buildPlan(raw);
  return r.ok ? [] : r.errors;
};

test('最小の1回ぶんが通り、本命と代替が slot に割り振られる', () => {
  const r = buildPlan(base());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.items.map((i) => i.slot), ['main', 'alt1']);
  assert.equal(r.plan.items[0].ingredients[0].shoppingKey, 'chicken');
  assert.equal(r.plan.flyer, null);
});

test('JSON として読めないものは、そこで終わる', () => {
  const r = parsePlanJson('{ "starts_on": ');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.errors.length, 1);
});

test('期間の前後が逆なら止める', () => {
  const raw = { ...base(), ends_on: '2026-09-10' };
  assert.ok(errorsOf(raw).some((m) => m.includes('ends_on')));
});

test('買い物が週のあとなら止める（買ってから食べる）', () => {
  const raw = { ...base(), shopping_on: '2026-09-15' };
  assert.ok(errorsOf(raw).some((m) => m.includes('shopping_on')));
});

test('期間の外の日は止める。落として黙って減らさない', () => {
  const b = base();
  (b.days as Record<string, unknown>[])[0].day = '2026-09-30';
  assert.ok(errorsOf(b).some((m) => m.includes('2026-09-30')));
});

test('実在しない日付は形が合っていても止める', () => {
  const raw = { ...base(), starts_on: '2026-02-30' };
  assert.ok(errorsOf(raw).some((m) => m.includes('starts_on')));
});

test("数のつもりの文字列は通さない。'89' を 89 に寄せない", () => {
  const b = base();
  (b.shopping as Record<string, unknown>[])[0].amount_yen = '960';
  assert.ok(errorsOf(b).some((m) => m.includes('amount_yen')));
});

test('指した先が無い合い札は止める', () => {
  const b = base();
  const main = (b.days as Record<string, unknown>[])[0].main as Record<string, unknown>;
  (main.ingredients as Record<string, unknown>[])[0].shopping = 'pork';
  assert.ok(errorsOf(b).some((m) => m.includes('pork')));
});

test('買わない食材は、どこも指していなくてよい', () => {
  const b = base();
  const main = (b.days as Record<string, unknown>[])[0].main as Record<string, unknown>;
  main.ingredients = [{ name: '醤油', qty: '大さじ2' }];
  const r = buildPlan(b);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.items[0].ingredients[0].shoppingKey, null);
});

test('本命の無い日は止める。作らない日は days に書かない', () => {
  const b = base();
  delete (b.days as Record<string, unknown>[])[0].main;
  assert.ok(errorsOf(b).some((m) => m.includes('main')));
});

test('代替は2つまで', () => {
  const b = base();
  (b.days as Record<string, unknown>[])[0].alts = [
    { title: 'あ' }, { title: 'い' }, { title: 'う' },
  ];
  assert.ok(errorsOf(b).some((m) => m.includes('alts')));
});

test('同じ日を二度置けない', () => {
  const b = base();
  const days = b.days as Record<string, unknown>[];
  b.days = [days[0], { ...days[0] }];
  assert.ok(errorsOf(b).some((m) => m.includes('重複')));
});

test('調理時間は 180 分まで。解凍を数えた値が紛れ込まないように', () => {
  const b = base();
  const main = (b.days as Record<string, unknown>[])[0].main as Record<string, unknown>;
  main.cook_minutes = 240;
  assert.ok(errorsOf(b).some((m) => m.includes('cook_minutes')));
});

test('間違いは1件ずつではなく、まとめて返す', () => {
  const errors = errorsOf({ shopping_on: 'x', starts_on: 'y', ends_on: 'z', days: [] });
  assert.ok(errors.length >= 3, `まとめて返っていない: ${errors.length}`);
});

test('チラシを一緒に入れると、合い札で買い物リストから指せる', () => {
  const b = base();
  b.flyer = {
    store: 'コモディイイダ',
    image_path: 'flyers/2026-09-12.webp',
    image_sha256: 'a'.repeat(64),
    items: [{ key: 'chicken', name: '若鶏もも肉', price_yen: 89, category: 'meat', confidence: 0.9 }],
  };
  (b.shopping as Record<string, unknown>[])[0].flyer_item = 'chicken';
  const r = buildPlan(b);
  assert.equal(r.ok, true, errorsOf(b).join(' / '));
  if (!r.ok) return;
  assert.equal(r.plan.shopping[0].flyerItemKey, 'chicken');
});

test('読み取りの自信は必ず要る。無いものを確かめた値と同じ顔にしない', () => {
  const b = base();
  b.flyer = {
    image_path: 'flyers/x.webp',
    image_sha256: 'a'.repeat(64),
    items: [{ name: '若鶏もも肉', category: 'meat' }],
  };
  assert.ok(errorsOf(b).some((m) => m.includes('confidence')));
});

test('表に無い分類は止める', () => {
  const b = base();
  b.flyer = {
    image_path: 'flyers/x.webp',
    image_sha256: 'a'.repeat(64),
    items: [{ name: '若鶏もも肉', category: 'niku', confidence: 0.9 }],
  };
  assert.ok(errorsOf(b).some((m) => m.includes('niku')));
});

test('指紋が 64 桁の 16 進でなければ止める', () => {
  const b = base();
  b.flyer = {
    image_path: 'flyers/x.webp',
    image_sha256: 'ZZZ',
    items: [{ name: '鶏', confidence: 0.9 }],
  };
  assert.ok(errorsOf(b).some((m) => m.includes('image_sha256')));
});

test('チラシと flyer_id は同時に指定できない', () => {
  const b = base();
  b.flyer_id = '436e95c8-4675-41eb-abb4-645a962fd026';
  b.flyer = {
    image_path: 'flyers/x.webp',
    image_sha256: 'a'.repeat(64),
    items: [{ name: '鶏', confidence: 0.9 }],
  };
  assert.ok(errorsOf(b).some((m) => m.includes('flyer_id')));
});
