/**
 * 日本語の分量表記をグラムに変換する。
 *
 * ## 順序の制約（重要）
 *
 * `大さじ1` が何グラムかは食材で決まる（醤油18g / 砂糖9g / 油12g）。
 * `1個` も同様（卵50g / 玉ねぎ200g）。したがってパイプラインは必ず
 *
 *     抽出 → 名前の正規化 → 食材の照合 → parseQuantity(分量, {food}) → 計算
 *
 * の順で、**照合が先**でなければならない。
 * `food: null` でも動作し、カテゴリ／全体のフォールバックに劣化する
 * （未収録の食材はこの経路を通る）。
 *
 * ## 確度
 *
 *  - `exact`     セルが直接グラムを示している（`100g` / `1袋(200g)`）
 *  - `derived`   食材固有のテーブルで換算した（`大さじ2` → 36g）
 *  - `estimated` カテゴリ／全体のフォールバック、範囲の中間値、曖昧語
 *  - `unknown`   解釈不能。grams は null で、合計から除外される
 */
import { normalizeWidth } from '../util/kana.js';
import { parseNumberToken } from './numbers.js';
import { UNIT_FORMS, PREFIX_UNIT_FORMS, VAGUE, VAGUE_DERIVED, APPROX_PREFIXES, APPROX_SUFFIXES } from './units.js';
import { CATEGORY_ESTIMATES, CATEGORY_DENSITY, CATEGORY_PIECE, GLOBAL_PIECE } from '../data/categories.js';

/**
 * @typedef {object} QtyResult
 * @property {number|null} grams       confidence が 'unknown' のときだけ null
 * @property {boolean} isEstimated     推定バッジを出すかどうか
 * @property {'exact'|'derived'|'estimated'|'unknown'} confidence
 * @property {string} raw              入力そのまま
 * @property {string} reason           機械可読な由来（'volume:tbsp:food'など）
 * @property {string} note             日本語の説明。UIのツールチップに出す
 * @property {{value:number, unit:string, unitKind:string}|null} parsed
 */

/**
 * @param {string} text 分量セルの生テキスト
 * @param {{food?: object|null}} ctx 照合済みの食品エントリ
 * @returns {QtyResult}
 */
export function parseQuantity(text, ctx = {}) {
  const raw = String(text ?? '');
  try {
    return parseInner(raw, ctx.food ?? null);
  } catch (err) {
    // パーサがポップアップを落とすことは絶対にあってはならない。
    return unknown(raw, `exception:${err?.message ?? 'unknown'}`, '分量を解釈できませんでした');
  }
}

function parseInner(raw, food) {
  let s = normalizeWidth(raw);

  // ── 1. 括弧内・末尾の明示的な質量を最優先で拾う ──
  // 「1袋(200g)」「1本 約150g」は、ほかのどの解釈より確かなので先に確定させる。
  const explicit = findExplicitMass(s);
  if (explicit) {
    return {
      grams: explicit.grams, isEstimated: false, confidence: 'exact', raw,
      reason: 'mass:explicit', note: `${explicit.matched} をそのまま採用`,
      parsed: { value: explicit.grams, unit: 'g', unitKind: 'mass' },
    };
  }

  // ── 2. 「約」「ほど」などを剥がす ──
  const { text: stripped, approx } = stripApproximators(s);
  s = stripped;

  // ── 3. セル全体が曖昧語 ──
  const vagueKey = VAGUE[s];
  if (vagueKey !== undefined) return resolveVague(vagueKey, food, raw, s);

  // ── 4. 範囲は中間値に畳む ──
  // 多数の材料を合算する以上、下限で固定すると下方バイアスが累積する。
  const range = parseRange(s);
  if (range) {
    const out = fromValueAndUnit(range.value, range.unitForm, food, raw);
    return degrade(out, 'estimated', `range:midpoint:${out.reason}`,
      `${range.label} の中間値 ${trim(range.value)} で計算`);
  }

  // ── 5. 前置ユニット（大さじ2 / カップ1/2 / お玉1）──
  const prefixed = matchPrefixUnit(s);
  if (prefixed) {
    const out = fromValueAndUnit(prefixed.value, prefixed.unitForm, food, raw);
    return prefixed.vague ? degrade(out, 'estimated', `vaguecount:${out.reason}`, out.note) : approxNote(out, approx);
  }

  // ── 6. 後置ユニット（100g / 2個 / 1個半 / 1/2本）──
  const suffixed = matchSuffixUnit(s);
  if (suffixed) {
    const out = fromValueAndUnit(suffixed.value, suffixed.unitForm, food, raw);
    return suffixed.vague ? degrade(out, 'estimated', `vaguecount:${out.reason}`, out.note) : approxNote(out, approx);
  }

  // ── 7. 複合（大さじ1と小さじ1 / 100g+50g）──
  const compound = parseCompound(s, food, raw);
  if (compound) return compound;

  // ── 8. 単位のない裸の数値 ──
  const bare = parseNumberToken(s);
  if (bare) {
    const out = fromValueAndUnit(bare.value, null, food, raw);
    if (out.confidence !== 'unknown') {
      return degrade(out, out.confidence === 'derived' ? 'derived' : 'estimated',
        `bare:${out.reason}`, `単位がないため個数として解釈: ${out.note}`);
    }
  }

  return unknown(raw, 'nomatch', '分量を解釈できませんでした');
}

// ────────────────────────────────────────────────────────────────────────
// 前処理
// ────────────────────────────────────────────────────────────────────────

/**
 * 括弧内や末尾に書かれた明示的な質量を探す。
 * セル全体が質量のときは通常の経路に任せるので、ここでは拾わない。
 */
function findExplicitMass(s) {
  // 足し算の式は複合として別途処理する。ここで拾うと '100g+50g' の後半だけを
  // 取って 50g と誤読してしまう。
  if (/[+＋]/.test(s)) return null;

  const re = /[（(]?\s*(?:約|およそ)?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cc|l|リットル|グラム)\s*[）)]?/gi;
  for (const m of s.matchAll(re)) {
    if (m[0].trim() === s.trim()) continue; // セル全体が質量 → 通常経路へ
    const value = Number(m[1]);
    const unit = m[2].toLowerCase();
    // 「補足として書かれた質量」と言えるのは、括弧で括られているか、
    // 前のトークンから空白で区切られている場合だけ。
    const isParenthesized = /^[（(]/.test(m[0].trim()) || /[）)]$/.test(m[0].trim());
    // 正規表現が先頭の空白ごと飲み込むことがあるので、マッチ自身の先頭も見る。
    const isSeparated = m.index > 0
      && (/^[\s　]/.test(m[0]) || /[\s　]/.test(s[m.index - 1] ?? ''));
    if (!isParenthesized && !isSeparated) continue;
    const grams = unit === 'kg' ? value * 1000
      : unit === 'l' || unit === 'リットル' ? value * 1000
        : value; // ml/cc は水と同じ密度とみなす（明示質量の文脈では実用上十分）
    return { grams, matched: m[0].trim() };
  }
  return null;
}

function stripApproximators(s) {
  let t = s;
  let approx = false;
  for (const p of APPROX_PREFIXES) {
    if (t.startsWith(p)) { t = t.slice(p.length).trim(); approx = true; }
  }
  for (const suf of APPROX_SUFFIXES) {
    if (t.endsWith(suf)) { t = t.slice(0, -suf.length).trim(); approx = true; }
  }
  // 末尾の飾り（大さじ1杯 / 100g。 / 2個〜）
  t = t.replace(/[杯。、,．・〜~～]+$/u, '').trim();
  return { text: t, approx };
}

// ────────────────────────────────────────────────────────────────────────
// 各パターン
// ────────────────────────────────────────────────────────────────────────

const NUM_SRC = '(?:\\d+(?:\\.\\d+)?(?:\\s*[/／∕⁄]\\s*\\d+(?:\\.\\d+)?)?|[〇一二三四五六七八九十百千]+|半分|半|数)';

/** `2〜3本` `大さじ1〜2` を中間値に畳む。両辺が数値として読めることを要求する。 */
function parseRange(s) {
  // 後置: 2〜3本
  let m = s.match(new RegExp(`^(${NUM_SRC})\\s*[〜~～ー–—-]\\s*(${NUM_SRC})\\s*(.*)$`, 'u'));
  if (m) {
    const a = parseNumberToken(m[1]);
    const b = parseNumberToken(m[2]);
    if (a && b) {
      return { value: (a.value + b.value) / 2, unitForm: m[3].trim() || null, label: `${m[1]}〜${m[2]}` };
    }
  }
  // 前置: 大さじ1〜2
  for (const { form } of PREFIX_UNIT_FORMS) {
    if (!s.toLowerCase().startsWith(form)) continue;
    const rest = s.slice(form.length).trim();
    const r = rest.match(new RegExp(`^(${NUM_SRC})\\s*[〜~～ー–—-]\\s*(${NUM_SRC})$`, 'u'));
    if (!r) continue;
    const a = parseNumberToken(r[1]);
    const b = parseNumberToken(r[2]);
    if (a && b) {
      return { value: (a.value + b.value) / 2, unitForm: form, label: `${r[1]}〜${r[2]}` };
    }
  }
  return null;
}

/** `大さじ2` のように単位が先に来る形。 */
function matchPrefixUnit(s) {
  const lower = s.toLowerCase();
  for (const { form } of PREFIX_UNIT_FORMS) {
    if (!lower.startsWith(form)) continue;
    const rest = s.slice(form.length).trim();
    if (!rest) return { value: 1, unitForm: form, vague: false }; // 「大さじ」だけ → 1杯
    const n = parseNumberToken(rest);
    if (n) return { value: n.value, unitForm: form, vague: n.vague };
  }
  return null;
}

/** `100g` `2個` `1個半` `1/2本` のように単位が後に来る形。 */
function matchSuffixUnit(s) {
  const lower = s.toLowerCase();
  for (const { form } of UNIT_FORMS) {
    const idx = lower.lastIndexOf(form);
    if (idx <= 0) continue;
    const head = s.slice(0, idx).trim();
    const tail = s.slice(idx + form.length).trim();

    // 単位の後ろに「半」だけが残る形（1個半 = 1.5個）
    let bonus = 0;
    if (tail === '半' || tail === '半分') bonus = 0.5;
    else if (tail !== '') continue;

    const n = parseNumberToken(head);
    if (n) return { value: n.value + bonus, unitForm: form, vague: n.vague };
  }
  return null;
}

/** `大さじ1と小さじ1` `100g+50g` のように足し合わせる形。 */
function parseCompound(s, food, raw) {
  const parts = s.split(/[+＋]|と(?=[^\d]*[大小カ])/u).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  let total = 0;
  let worst = 'exact';
  const notes = [];
  for (const part of parts) {
    const r = parseInner(part, food);
    if (r.confidence === 'unknown' || r.grams == null) return null;
    total += r.grams;
    worst = worseOf(worst, r.confidence);
    notes.push(`${part}=${trim(r.grams)}g`);
  }
  return {
    grams: total, isEstimated: worst === 'estimated', confidence: worst, raw,
    reason: 'compound:sum', note: notes.join(' + '), parsed: null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 単位 → グラム
// ────────────────────────────────────────────────────────────────────────

function fromValueAndUnit(value, unitForm, food, raw) {
  const unit = unitForm ? findUnit(unitForm) : null;

  if (!unit) {
    // 単位なし。食材に個数の重量があれば「個」として扱う。
    const piece = gramsFromPiece(value, 'ko', food);
    if (piece.grams == null) return unknown(raw, 'bare:no-piece-weight', '単位が読み取れませんでした');
    return mk(piece.grams, piece.confidence, raw, `piece:ko:${piece.src}`, piece.note, value, 'ko', 'piece');
  }

  if (unit.kind === 'mass') {
    const g = value * unit.grams;
    return mk(g, 'exact', raw, `mass:${unit.key}`, `${trim(value)}${unitForm} = ${trim(g)}g`, value, unit.key, 'mass');
  }

  if (unit.kind === 'vague') {
    const g = value * unit.grams;
    return mk(g, 'estimated', raw, `vagueunit:${unit.key}`,
      `${trim(value)}${unitForm}を${trim(g)}gとして推定`, value, unit.key, 'vague');
  }

  if (unit.kind === 'volume') {
    const ml = value * unit.ml;
    const r = gramsFromVolume(ml, unit.spoon, food);
    return mk(r.grams, r.confidence, raw, `volume:${unit.key}:${r.src}`,
      `${trim(value)}${unitForm} = ${trim(r.grams)}g（${r.how}）`, value, unit.key, 'volume');
  }

  // piece
  const r = gramsFromPiece(value, unit.key, food);
  if (r.grams == null) return unknown(raw, `piece:${unit.key}:unknown`, `${unitForm} の重量が分かりませんでした`);
  return mk(r.grams, r.confidence, raw, `piece:${unit.key}:${r.src}`, r.note, value, unit.key, 'piece');
}

function findUnit(form) {
  const f = form.toLowerCase();
  return UNIT_FORMS.find((r) => r.form === f)?.unit ?? null;
}

/**
 * ml → g。食材固有の大さじ重量を最優先し、なければ密度、最後にカテゴリ密度。
 * 大さじ重量から密度を逆算する経路があるので、`density_g_per_ml` が無くても
 * 醤油や油はきちんと重くなる。
 */
function gramsFromVolume(ml, spoon, food) {
  const w = food?.weights;
  if (spoon === 'tbsp' && w?.tbsp_g) return { grams: (w.tbsp_g * ml) / 15, confidence: 'derived', src: 'food.tbsp_g', how: `大さじ1=${w.tbsp_g}g` };
  if (spoon === 'tsp' && w?.tsp_g) return { grams: (w.tsp_g * ml) / 5, confidence: 'derived', src: 'food.tsp_g', how: `小さじ1=${w.tsp_g}g` };
  if (spoon === 'tsp' && w?.tbsp_g) return { grams: (w.tbsp_g / 3 * ml) / 5, confidence: 'derived', src: 'food.tbsp_g/3', how: `大さじ1=${w.tbsp_g}g から換算` };
  if (spoon === 'cup' && w?.cup_g) return { grams: (w.cup_g * ml) / 200, confidence: 'derived', src: 'food.cup_g', how: `カップ1=${w.cup_g}g` };
  if (w?.density_g_per_ml) return { grams: ml * w.density_g_per_ml, confidence: 'derived', src: 'food.density', how: `密度${w.density_g_per_ml}` };
  if (w?.tbsp_g) return { grams: ml * (w.tbsp_g / 15), confidence: 'derived', src: 'density<-tbsp', how: `大さじ1=${w.tbsp_g}g から密度を逆算` };

  const d = CATEGORY_DENSITY[food?.category] ?? CATEGORY_DENSITY.default;
  return { grams: ml * d, confidence: 'estimated', src: 'category-density', how: `${food ? 'カテゴリ' : '既定'}密度${d}で推定` };
}

/**
 * 個数 → g。全体フォールバックが必ず当たるので、個数指定から「解釈不能」は事実上出ない。
 * 空欄を出すより、印を付けた推定値を出すほうが親切だという判断。
 */
function gramsFromPiece(n, pieceKey, food) {
  const p = food?.weights?.pieces;
  if (p && p[pieceKey] != null) {
    return { grams: n * p[pieceKey], confidence: 'derived', src: 'food.pieces', note: `1${pieceKey}=${p[pieceKey]}g（食品テーブル）` };
  }
  if (food?.weights?.defaultPieceGrams != null) {
    const g = food.weights.defaultPieceGrams;
    return { grams: n * g, confidence: 'derived', src: 'food.defaultPiece', note: `1個=${g}g（食品テーブル）` };
  }
  const cat = CATEGORY_PIECE[food?.category]?.[pieceKey];
  if (cat != null) return { grams: n * cat, confidence: 'estimated', src: 'category-piece', note: `1個=${cat}g として推定（カテゴリ既定）` };

  const glob = GLOBAL_PIECE[pieceKey];
  if (glob != null) return { grams: n * glob, confidence: 'estimated', src: 'global-piece', note: `1個=${glob}g として推定（全体既定）` };

  return { grams: null, confidence: 'unknown', src: 'none', note: '' };
}

/** 曖昧語（少々・適量）を、食品 → カテゴリ → 既定 の順で解決する。 */
function resolveVague(key, food, raw, label) {
  if (key === 'zero') {
    return mk(0, 'estimated', raw, 'vague:zero', '「なし」として0gで計算', 0, 'none', 'vague');
  }

  let lookupKey = key;
  let factor = 1;
  if (VAGUE_DERIVED[key]) [lookupKey, factor] = VAGUE_DERIVED[key];

  const table = CATEGORY_ESTIMATES[food?.category] ?? CATEGORY_ESTIMATES.default;
  const grams = (food?.estimates?.[lookupKey]
    ?? table[lookupKey]
    ?? CATEGORY_ESTIMATES.default[lookupKey]
    ?? CATEGORY_ESTIMATES.default.tekiryo) * factor;

  return mk(grams, 'estimated', raw, `vague:${key}`,
    `「${label}」を${trim(grams)}gとして推定`, grams, 'none', 'vague');
}

// ────────────────────────────────────────────────────────────────────────
// 小道具
// ────────────────────────────────────────────────────────────────────────

const RANK = { exact: 0, derived: 1, estimated: 2, unknown: 3 };
const worseOf = (a, b) => (RANK[a] >= RANK[b] ? a : b);

function mk(grams, confidence, raw, reason, note, value, unit, unitKind) {
  return {
    grams, confidence, isEstimated: confidence === 'estimated' || confidence === 'unknown',
    raw, reason, note, parsed: { value, unit, unitKind },
  };
}

function unknown(raw, reason, note) {
  return { grams: null, confidence: 'unknown', isEstimated: true, raw, reason, note, parsed: null };
}

/** 確度を（悪い方向にだけ）落とす。 */
function degrade(result, to, reason, note) {
  if (result.confidence === 'unknown') return result;
  const confidence = worseOf(result.confidence, to);
  return { ...result, confidence, isEstimated: confidence === 'estimated', reason, note };
}

/** 「約」が付いていた場合に注記だけ足す（値は動かさない）。 */
function approxNote(result, approx) {
  if (!approx || result.confidence === 'unknown') return result;
  return { ...result, note: `${result.note}（「約」表記）` };
}

/** 表示用に末尾のゼロを落とす。 */
function trim(n) {
  if (n == null) return '?';
  return Number(n.toFixed(2)).toString();
}
