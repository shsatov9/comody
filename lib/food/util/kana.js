/**
 * 日本語文字列の正規化ユーティリティ。
 *
 * ここでの目的は「表記ゆれを1つの鍵に畳む」こと。
 * 読みの知識は持たないので、漢字→かなの変換はできない（`玉ねぎ` → `たまねぎ` は畳めない）。
 * 漢字表記は食品エントリの `aliases` に手で列挙する前提。
 */

const KATAKANA_START = 0x30a1; // ァ
const KATAKANA_END = 0x30f6; // ヶ
const KANA_OFFSET = 0x60; // カタカナ - ひらがな

/** カタカナをひらがなに変換する（ヴやヶも含む）。 */
export function katakanaToHiragana(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    out += code >= KATAKANA_START && code <= KATAKANA_END
      ? String.fromCodePoint(code - KANA_OFFSET)
      : ch;
  }
  return out;
}

/**
 * NFKC 正規化 + 全角空白の変換 + 空白の畳み込み + 前後の除去。
 * 全角英数（`１００ｇ`）や半角カナがここで揃う。
 */
export function normalizeWidth(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/　/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 照合用の鍵を作る。表記ゆれを吸収するために情報を落とす、非可逆な変換。
 *
 * `タマネギ` `たまねぎ` `タマネギ` → いずれも `たまねぎ`
 * `オリーブ・オイル` `オリーブオイル` → いずれも `おりーぶおいる` → `おりぶおいる`
 *
 * 表示には絶対に使わないこと（表示用は normalize.js の `display`）。
 */
export function foldKey(s) {
  return katakanaToHiragana(normalizeWidth(s))
    .toLowerCase()
    .replace(/[ーーｰ]/g, '') // 長音符（全角・半角）
    .replace(/[・･]/g, '') // 中黒
    .replace(/\s+/g, ''); // 残った空白
}

/** 文字bigramの集合。3文字未満の文字列では不安定なので matcher 側で使用を制限している。 */
export function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Dice係数。0（無関係）〜1（同一）。 */
export function diceCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}
