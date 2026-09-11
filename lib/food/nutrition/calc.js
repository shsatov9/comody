/**
 * 栄養価の集計。純粋関数なので、ブラウザなしで全部テストできる。
 *
 * 内部は全精度で保持し、丸めは描画時にだけ行う。
 * 行ごとに丸めてから足すと、材料が多いレシピで誤差が積み上がるため。
 */
import { matchFood } from '../match/matcher.js';
import { parseQuantity } from '../parse/quantity.js';

const NUTRIENTS = ['kcal', 'protein_g', 'fat_g', 'carb_g', 'salt_g'];

/**
 * @typedef {object} RawItem
 * @property {string} name    材料名（生テキスト）
 * @property {string} quantity 分量（生テキスト）
 *
 * @typedef {object} Override
 * @property {number} [grams]  グラム数の手動指定
 * @property {string} [foodId] 食品の選び直し
 *
 * @typedef {object} CalcResult
 * @property {object} totals     全体の合計
 * @property {object} perServing 1人分
 * @property {number} servings
 * @property {{p:number,f:number,c:number}} pfcRatio 熱量比。合計1
 * @property {object[]} rows
 * @property {object} counts
 * @property {{name:string, reason:string}[]} excluded
 */

/**
 * 材料リストを解決する（照合 → 分量解釈）。
 *
 * 照合が先でなければならない。大さじ→g も 個→g も食材に依存するため。
 *
 * @param {RawItem[]} items
 * @param {import('./db.js').FoodIndex} index
 * @param {Record<string, Override>} overrides キーは itemKey()
 * @returns {object[]} 解決済みの行
 */
export function resolveItems(items, index, overrides = {}) {
  return items.map((item, i) => {
    const key = itemKey(item.name, i);
    const override = overrides[key] ?? {};

    let match = matchFood(item.name, index);
    // 食品を選び直された場合は、その食品で分量を解釈し直す必要がある
    // （大さじ→g が食材依存なので、単に成分だけ差し替えては駄目）。
    if (override.foodId && index.byId.has(override.foodId)) {
      match = { ...match, food: index.byId.get(override.foodId), method: 'manual', confidence: 'high', score: 1 };
    }

    const qty = parseQuantity(item.quantity, { food: match.food });
    const grams = override.grams != null ? Number(override.grams) : qty.grams;
    const gramsOverridden = override.grams != null;

    return {
      key,
      index: i,
      rawName: item.name,
      rawQuantity: item.quantity,
      name: match.display,
      match,
      qty,
      grams: Number.isFinite(grams) ? grams : null,
      gramsOverridden,
      foodOverridden: Boolean(override.foodId),
    };
  });
}

/**
 * 解決済みの行から合計を出す。
 *
 * @param {object[]} rows resolveItems の戻り値
 * @param {number} servings
 * @returns {CalcResult}
 */
export function calculateRecipe(rows, servings = 1) {
  const totals = { grams: 0, kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, salt_g: 0 };
  const excluded = [];
  const counts = {
    total: rows.length, included: 0, exact: 0, derived: 0,
    estimated: 0, lowConfidence: 0, unmatched: 0,
  };

  const out = rows.map((row) => {
    const food = row.match.food;
    const grams = row.grams;

    if (!food) {
      counts.unmatched++;
      excluded.push({ name: row.name, reason: '未収録' });
      return { ...row, included: false, badge: 'unmatched', nutrients: zeroNutrients() };
    }
    if (grams == null || !Number.isFinite(grams)) {
      excluded.push({ name: row.name, reason: '分量を解釈できませんでした' });
      return { ...row, included: false, badge: 'unparsed', nutrients: zeroNutrients() };
    }

    const nutrients = {};
    for (const k of NUTRIENTS) nutrients[k] = (food.per100g[k] * grams) / 100;

    totals.grams += grams;
    for (const k of NUTRIENTS) totals[k] += nutrients[k];
    counts.included++;

    // 手動でグラム数を指定した行は、パーサの確度ではなくユーザーの意思を尊重する。
    const conf = row.gramsOverridden ? 'exact' : row.qty.confidence;
    if (conf === 'exact') counts.exact++;
    else if (conf === 'derived') counts.derived++;
    else if (conf === 'estimated') counts.estimated++;
    if (row.match.confidence === 'low') counts.lowConfidence++;

    return { ...row, included: true, badge: badgeFor(row, conf), nutrients };
  });

  const n = Math.max(1, Number(servings) || 1);
  const perServing = {};
  for (const k of NUTRIENTS) perServing[k] = totals[k] / n;
  perServing.grams = totals.grams / n;

  return {
    totals, perServing, servings: n, pfcRatio: pfcRatio(totals),
    rows: out, counts, excluded,
  };
}

/** 行に出すバッジ。優先度の高いものから1つだけ。 */
function badgeFor(row, conf) {
  if (row.match.method === 'remote') return 'remote';
  if (row.match.confidence === 'low') return 'lowmatch';
  if (conf === 'estimated') return 'estimated';
  if (conf === 'derived') return 'derived';
  return null;
}

/**
 * PFCの熱量比。たんぱく質4 / 脂質9 / 炭水化物4 kcal/g で按分する。
 * 合計がゼロのときは 0/0/0 を返す（水だけのレシピなど）。
 */
export function pfcRatio(totals) {
  const p = totals.protein_g * 4;
  const f = totals.fat_g * 9;
  const c = totals.carb_g * 4;
  const sum = p + f + c;
  if (!(sum > 0)) return { p: 0, f: 0, c: 0 };
  return { p: p / sum, f: f / sum, c: c / sum };
}

/**
 * 補正を保存するときのキー。
 *
 * インデックスと正規化した名前の両方を使うので、材料が並べ替えられても
 * 追加・削除されても、名前が同じなら補正が追随する。
 */
export function itemKey(name, index) {
  return `${index}:${String(name ?? '').trim()}`;
}

/**
 * 保存済みの補正を、現在の材料リストに割り当て直す。
 * まず名前で探し、無ければ同じ位置のものを使う。
 */
export function remapOverrides(stored = {}, items = []) {
  const byName = new Map();
  const byIndex = new Map();
  for (const [key, value] of Object.entries(stored)) {
    const sep = key.indexOf(':');
    if (sep < 0) continue;
    byIndex.set(key.slice(0, sep), value);
    byName.set(key.slice(sep + 1), value);
  }

  const out = {};
  items.forEach((item, i) => {
    const name = String(item.name ?? '').trim();
    const hit = byName.get(name) ?? byIndex.get(String(i));
    if (hit) out[itemKey(name, i)] = hit;
  });
  return out;
}

function zeroNutrients() {
  return { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, salt_g: 0 };
}

/** 表示用の丸め。kcal は整数、それ以外は小数1桁。 */
export function roundForDisplay(value, kind = 'macro') {
  if (value == null || !Number.isFinite(value)) return null;
  if (kind === 'kcal') return Math.round(value);
  if (kind === 'grams') return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return Math.round(value * 10) / 10;
}
