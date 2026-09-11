/**
 * 数値トークンの解釈。`parseQuantity` から単位を取り除いた残りがここに来る。
 *
 * 対応: 12 / 1.5 / １２ / ½ / 1/2 / 1と1/2 / 1 1/2 / 三 / 十五 / 二十 / 半 / 数
 */
import { normalizeWidth } from '../util/kana.js';

/**
 * Unicodeの分数文字。
 *
 * NFKC 正規化は '½' を '1⁄2'（U+2044 FRACTION SLASH）に分解してしまうので、
 * `parseNumberToken` 経由ではこの表は通常ヒットしない（分数として読まれる）。
 * 正規化していない文字列を直接渡された場合の保険として残してある。
 */
const VULGAR_FRACTIONS = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅐': 1 / 7, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
export const VULGAR_FRACTION_CHARS = Object.keys(VULGAR_FRACTIONS).join('');

const KANJI_DIGITS = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** かな・漢字で書かれた個数の言い回し。 */
const WORD_NUMBERS = {
  半: 0.5, 半分: 0.5,
  ひとつ: 1, 一つ: 1, ひとり: 1, 一人: 1,
  ふたつ: 2, 二つ: 2, ふたり: 2, 二人: 2,
  みっつ: 3, 三つ: 3,
  よっつ: 4, 四つ: 4,
  いつつ: 5, 五つ: 5,
};

/**
 * 曖昧な数量語。値が出せるので数値として扱うが、**必ず推定扱いにする**。
 * `parseQuantity` 側が `estimated` を立てる目印として使う。
 */
export const VAGUE_COUNTS = {
  数: 3, 幾つか: 3, いくつか: 3, 何: 2,
};

/**
 * `十五` `二十` `百` のような位取りのある漢数字を解釈する。
 * @returns {number|null}
 */
export function parseKansuji(s) {
  if (!s || !/^[〇一二三四五六七八九十百千]+$/.test(s)) return null;
  let total = 0;
  let section = 0;
  let current = 0;
  let sawAny = false;

  for (const ch of s) {
    if (ch in KANJI_DIGITS) {
      current = KANJI_DIGITS[ch];
      sawAny = true;
    } else if (ch === '十') {
      section += (current || 1) * 10;
      current = 0;
      sawAny = true;
    } else if (ch === '百') {
      section += (current || 1) * 100;
      current = 0;
      sawAny = true;
    } else if (ch === '千') {
      total += (section + (current || 1)) * 1000;
      section = 0;
      current = 0;
      sawAny = true;
    }
  }
  return sawAny ? total + section + current : null;
}

/**
 * 数値トークンを数に変換する。
 *
 * @param {string} raw
 * @returns {{value:number, vague:boolean}|null} 解釈できなければ null
 */
export function parseNumberToken(raw) {
  const s = normalizeWidth(raw).replace(/[,，]/g, '');
  if (!s) return null;

  // 曖昧な数量語（数本 / いくつか）
  for (const [word, value] of Object.entries(VAGUE_COUNTS)) {
    if (s === word) return { value, vague: true };
  }

  // 言い回し（半分 / ひとつ）。長いものから照合する。
  const words = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length);
  for (const w of words) {
    if (s === w) return { value: WORD_NUMBERS[w], vague: false };
  }

  // 帯分数: 1と1/2 / 1 1/2 / 1・1/2 / 1と½ / 1と半分
  //
  // 区切り文字は必須。省略可にすると '12' が '1' と '2' に分解されて 3 になる。
  // 後半も分数系に限る（'1 2' のような入力を 3 と読まないため）。
  const mixed = s.match(/^(\d+(?:\.\d+)?)\s*(?:と|・|\s)\s*(.+)$/);
  if (mixed) {
    const rest = parseFractionOnly(mixed[2]);
    if (rest != null) return { value: Number(mixed[1]) + rest, vague: false };
  }

  const simple = parseSimpleFraction(s);
  if (simple != null) return { value: simple, vague: false };

  const kansuji = parseKansuji(s);
  if (kansuji != null) return { value: kansuji, vague: false };

  return null;
}

/**
 * 帯分数の後半として妥当なものだけを解釈する。
 * 整数・小数は受け付けない（'1 2' を 3 と読まないため）。
 */
function parseFractionOnly(s) {
  const t = s.trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return null;
  return parseSimpleFraction(t);
}

/** 分数・小数・整数を解釈する。 */
function parseSimpleFraction(s) {
  const t = s.trim();
  if (!t) return null;

  if (t in VULGAR_FRACTIONS) return VULGAR_FRACTIONS[t];
  if (t === '半' || t === '半分') return 0.5;

  const frac = t.match(/^(\d+(?:\.\d+)?)\s*[/／∕⁄]\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const denom = Number(frac[2]);
    if (denom === 0) return null; // ゼロ除算は解釈不能として扱う
    return Number(frac[1]) / denom;
  }

  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);

  // 漢数字の分数（三分の一）までは追わない。実レシピでほぼ出ないため。
  return null;
}
