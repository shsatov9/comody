/**
 * 照合用の索引を組み立てる。
 *
 * 274件で1ms程度なのでポップアップを開くたびに作り直してよく、
 * キャッシュの複雑さを持ち込む必要がない。
 */
import { FOODS } from '../data/foods.js';
import { ALIASES, STOP_KEYS } from '../match/aliases.js';
import { foldKey, bigrams } from '../util/kana.js';

/**
 * @typedef {object} FoodIndex
 * @property {Map<string,object>} byId
 * @property {Map<string,object>} byRaw       正式名と別名（畳まない）
 * @property {Map<string,object>} byFolded    foldKey → エントリ
 * @property {Map<string,object>} byAlias     ALIASES 由来（foldKey済み）
 * @property {Map<string,string>} userAliases foldKey → foodId
 * @property {Array} keys                     部分一致用。長い順
 * @property {Map<string,Set<string>>} bigrams
 * @property {number} size
 */

/**
 * @param {object[]} foods
 * @param {{userAliases?: Record<string,string>, aliases?: Record<string,string>}} opts
 * @returns {FoodIndex}
 */
export function buildIndex(foods = FOODS, opts = {}) {
  const aliases = opts.aliases ?? ALIASES;
  const byId = new Map();
  const byRaw = new Map();
  const byFolded = new Map();
  const keys = [];
  const bg = new Map();

  for (const f of foods) {
    byId.set(f.id, f);
    bg.set(f.id, bigrams(foldKey(f.name)));

    for (const key of [f.name, ...(f.aliases ?? [])]) {
      // 先に登録されたものを優先する。db-invariants テストが衝突を禁じているので、
      // ここで上書きが起きることは通常ない。
      if (!byRaw.has(key)) byRaw.set(key, f);
      const folded = foldKey(key);
      if (!byFolded.has(folded)) byFolded.set(folded, f);
      keys.push({ key, folded, food: f, isStop: STOP_KEYS.has(key) || STOP_KEYS.has(folded) });
    }
  }

  // 部分一致では常に「最も長いキー」を採りたい。
  // これがないと 豚バラ肉 が 豚肉 に当たってしまう。
  keys.sort((a, b) => b.folded.length - a.folded.length);

  const byAlias = new Map();
  for (const [key, id] of Object.entries(aliases)) {
    const food = byId.get(id);
    if (food) byAlias.set(foldKey(key), food);
  }

  const userAliases = new Map();
  for (const [key, id] of Object.entries(opts.userAliases ?? {})) {
    if (byId.has(id)) userAliases.set(foldKey(key), id);
  }

  return { byId, byRaw, byFolded, byAlias, userAliases, keys, bigrams: bg, size: foods.length };
}

/** 選択UI用に、正式名を五十音順で並べた一覧を返す。 */
export function listFoods(index) {
  return [...index.byId.values()]
    .map((f) => ({ id: f.id, name: f.name, category: f.category, note: f.note ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
