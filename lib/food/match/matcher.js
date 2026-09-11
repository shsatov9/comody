/**
 * 材料名を食品エントリに照合する。
 *
 * 保存度の高い候補から順に、確度の高い方法から順に試す。最初に当たったものが勝つ。
 */
import { normalizeName } from './normalize.js';
import { foldKey, bigrams, diceCoefficient } from '../util/kana.js';

/**
 * @typedef {object} MatchResult
 * @property {object|null} food
 * @property {number} score        0〜1
 * @property {'user'|'exact'|'normalized'|'alias'|'substring'|'bigram'|'remote'|'none'} method
 * @property {'high'|'medium'|'low'|'none'} confidence
 * @property {string|null} matchedKey どの表記で当たったか（ツールチップに出す）
 * @property {{food:object, score:number}[]} candidates 選び直しUI用の上位5件
 * @property {string} display
 * @property {string[]} notes
 */

/** 部分一致の下限。これを下回るとノイズのほうが多くなる。 */
const SUBSTRING_MIN_KEY_LEN = 2;
/** Dice係数の下限。 */
const BIGRAM_MIN_SCORE = 0.55;
/** 短い文字列の Dice は不安定なので、この長さ未満のキーでは使わない。 */
const BIGRAM_MIN_KEY_LEN = 3;

/**
 * @param {string} rawName
 * @param {import('../nutrition/db.js').FoodIndex} index
 * @returns {MatchResult}
 */
export function matchFood(rawName, index) {
  const { candidates, display, notes } = normalizeName(rawName);
  const base = { display, notes, candidates: [] };

  for (const cand of candidates) {
    const folded = foldKey(cand);

    // level 0: ユーザーが「今後もこの食品として扱う」と決めたもの。常に最優先。
    const userId = index.userAliases.get(folded);
    if (userId && index.byId.has(userId)) {
      return done(base, index.byId.get(userId), 1, 'user', cand, index);
    }

    // level 1: 正式名または別名に完全一致
    const exact = index.byRaw.get(cand);
    if (exact) return done(base, exact, 1, 'exact', cand, index);

    // level 2: 表記を畳んだ上で一致（カタカナ/ひらがなの揺れ）
    const norm = index.byFolded.get(folded);
    if (norm) return done(base, norm, 0.98, 'normalized', cand, index);

    // level 3: 商品名・略称の別名表
    const alias = index.byAlias.get(folded);
    if (alias) return done(base, alias, 0.95, 'alias', cand, index);
  }

  // level 4: 部分一致。最長のキーを採る。
  const sub = bestSubstring(candidates, index);
  if (sub) return done(base, sub.food, sub.score, 'substring', sub.key, index);

  // level 5: 文字bigramのDice係数
  const bi = bestBigram(candidates, index);
  if (bi) return done(base, bi.food, bi.score, 'bigram', bi.key, index);

  return { ...base, food: null, score: 0, method: 'none', confidence: 'none', matchedKey: null, candidates: topCandidates(display, index) };
}

/**
 * 部分一致。全エントリの中で**最も長い**キーを採るのが肝。
 * STOP_KEYS のキーは、候補そのものと完全一致するときだけ通す
 * （`豚バラ肉` が `肉` に、`ごま油` が `油` に当たらないように）。
 */
function bestSubstring(candidates, index) {
  for (const cand of candidates) {
    const folded = foldKey(cand);
    if (folded.length < SUBSTRING_MIN_KEY_LEN) continue;

    // index.keys は長い順に並んでいるので、最初に当たったものが最長。
    for (const entry of index.keys) {
      if (entry.folded.length < SUBSTRING_MIN_KEY_LEN) break;

      const contains = folded.includes(entry.folded);
      const reverse = entry.folded.includes(folded);
      if (!contains && !reverse) continue;

      // ストップキーは丸ごと一致のときだけ。
      if (entry.isStop && folded !== entry.folded) continue;

      const longer = Math.max(folded.length, entry.folded.length);
      const score = 0.55 + 0.4 * (entry.folded.length / longer);
      return { food: entry.food, score: Math.min(score, 0.94), key: entry.key };
    }
  }
  return null;
}

function bestBigram(candidates, index) {
  let best = null;
  for (const cand of candidates) {
    const folded = foldKey(cand);
    if (folded.length < BIGRAM_MIN_KEY_LEN) continue;
    const gs = bigrams(folded);

    for (const [id, foodGrams] of index.bigrams) {
      const food = index.byId.get(id);
      if (foldKey(food.name).length < BIGRAM_MIN_KEY_LEN) continue;
      const score = diceCoefficient(gs, foodGrams);
      if (score >= BIGRAM_MIN_SCORE && (!best || score > best.score)) {
        best = { food, score, key: food.name };
      }
    }
  }
  return best;
}

/** 選び直しUI用に、それらしい候補を上位5件返す。 */
function topCandidates(display, index, exclude = null) {
  const folded = foldKey(display);
  if (folded.length < 2) return [];
  const gs = bigrams(folded);
  const scored = [];
  for (const [id, foodGrams] of index.bigrams) {
    if (id === exclude) continue;
    const score = diceCoefficient(gs, foodGrams);
    if (score > 0.2) scored.push({ food: index.byId.get(id), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

function done(base, food, score, method, matchedKey, index) {
  return {
    ...base,
    food,
    score,
    method,
    confidence: toConfidence(score),
    matchedKey,
    candidates: topCandidates(base.display, index, food.id),
  };
}

/**
 * スコアをUIに出す4段階に落とす。
 * 生の数値は見出しに出さない（持っていない精度を示唆してしまうため）。
 */
export function toConfidence(score) {
  if (score >= 0.95) return 'high';
  if (score >= 0.75) return 'medium';
  if (score >= 0.55) return 'low';
  return 'none';
}

/** ツールチップ用の説明文。 */
export function describeMatch(m) {
  if (!m.food) return '該当する食品が見つかりませんでした';
  const how = {
    user: 'ユーザー設定', exact: '完全一致', normalized: '表記ゆれ一致',
    alias: '別名', substring: '部分一致', bigram: '類似', remote: '外部DB',
  }[m.method] ?? m.method;
  return `照合: 「${m.matchedKey ?? m.display}」→ ${m.food.name} (${how})`;
}
