/** 戻り先の絞り込み。ここが緩いと、ログイン直後の人を外に出せる。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../lib/origin.ts';

/** 実際の着地先。safeNext を通したものが new URL に渡る、その通りに確かめる。 */
const landsOn = (v: unknown) => new URL(safeNext(v), 'https://comody.example/auth/callback').href;

test('同じサイトの中はそのまま通す', () => {
  assert.equal(safeNext('/'), '/');
  assert.equal(safeNext('/record'), '/record');
  assert.equal(safeNext('/?day=2026-09-09'), '/?day=2026-09-09');
});

test('別サイトに出られる形は全部 / に落とす', () => {
  assert.equal(safeNext('//evil.example'), '/');
  // '\' は http(s) では '/' に畳まれる。'//' だけ見ていると素通りする。
  assert.equal(safeNext('/\\evil.example'), '/');
  assert.equal(safeNext('/\\\\evil.example'), '/');
  assert.equal(safeNext('\\/evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.equal(safeNext(''), '/');
  assert.equal(safeNext(null), '/');
});

test('通したものは、URL にしても自分のサイトから出ない', () => {
  const cases = ['//evil.example', '/\\evil.example', 'https://evil.example', '/record'];
  for (const v of cases) {
    assert.equal(new URL(landsOn(v)).host, 'comody.example', `${v} が外に出た`);
  }
});
