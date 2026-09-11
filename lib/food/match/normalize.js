/**
 * 材料名の正規化。
 *
 * ## なぜ「候補生成」なのか
 *
 * 素朴に情報を削っていくと壊れる。`おろしにんにく` を別名表に当てる前に
 * `にんにく` へ潰してはいけないし、`無塩バター` を `バター` にしてもいけない
 * （栄養が違う別の食品なので）。
 *
 * そこで、**保存度の高い順に並んだ候補リスト**を返し、照合側が順に試す。
 * 一番保存度の高い候補が当たればそれが使われ、当たらなければ徐々に情報を
 * 落とした候補へ降りていく。
 */
import { normalizeWidth, foldKey } from '../util/kana.js';

/** 材料名の頭に付くグループ記号。クックパッドのユーザーが多用する。 */
const LEADING_MARKS = /^[\s★☆●○◎◯■□◆◇▲△▼▽♦♥♡※・＊*+＋\-‐–—~〜:：]+/u;

/** `【A】` `(A)` `「☆」` のような短いグループタグ。 */
const LEADING_TAG = /^[（(【\[「『]\s*[A-Za-zＡ-Ｚ①-⑳一二三四五六七八九IVXｱ-ﾝ★☆●○◎■◆▲]{1,2}\s*[）)】\]」』]\s*/u;

/** 括弧で括られた注釈。中身は notes に退避する。 */
const BRACKETED = /[（(【\[〈《「『][^）)】\]〉》」』]{0,24}[）)】\]〉》」』]/gu;

/** `※` から末尾までの注釈。 */
const NOTE_SUFFIX = /※.*$/u;

/** 調理法の接尾辞。食品の同一性は変えないので落としてよい。 */
const PREP_SUFFIX = /(?:の|・|\s)?(?:みじん切り|千切り|せん切り|細切り|薄切り|小口切り|輪切り|乱切り|くし切り|くし形切り|ざく切り|角切り|一口大|ひとくち大|食べやすい大きさ|すりおろし|おろし|刻み|きざみ|みじん|下茹で|下ゆで|茹で|ゆで|水煮|solid)+$/u;

/**
 * 語中に挟まる調理法。`豚薄切り肉` のように調理法が名前の**途中**に入ると
 * PREP_SUFFIX（末尾固定）では落とせず、`豚肉` に届かない。
 *
 * 接尾辞版より対象を絞ってある。末尾なら削って安全な `茹で` `水煮` の類も、
 * 語中では別の食品の一部でありうるため（`水煮` を落とすと `トマト水煮缶` の
 * 缶詰と生トマトが混ざる）ここでは扱わない。切り方だけに限定する。
 */
const PREP_INFIX = /(?:みじん切り|千切り|せん切り|細切り|薄切り|小口切り|輪切り|乱切り|くし形切り|くし切り|ざく切り|角切り|すりおろし)/gu;

/** 調理法の接頭辞。 */
const PREP_PREFIX = /^(?:おろし|すりおろし|刻み|きざみ|茹で|ゆで|冷凍|乾燥|干し|蒸し|焼き|生の)/u;

/**
 * 修飾語。**最後に試す**。
 * `無塩` `薄口` などは栄養的に意味があるので、まず専用エントリに当たる機会を与える。
 */
const QUALIFIER = /^(?:新|国産|市販の|市販|お好みの|好みの|あれば|なくても可|無添加|粗|あら|うすくち|薄口|濃口|こいくち|有塩|無塩|減塩|甘口|辛口|温かい|冷たい)/u;

/** 末尾のゴミ。 */
const TRAILING_JUNK = /(?:[\s・、,，:：]+|など|等|類)+$/u;

/**
 * @typedef {object} NormalizeResult
 * @property {string[]} candidates 保存度の高い順。照合側が先頭から試す
 * @property {string} display      UIに出す名前
 * @property {string[]} notes      括弧や※で書かれていた注釈
 */

/**
 * @param {string} raw 材料名の生テキスト
 * @returns {NormalizeResult}
 */
export function normalizeName(raw) {
  const notes = [];
  let s = normalizeWidth(raw);

  // グループ記号とタグを剥がす（何重にも付いていることがある）
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(LEADING_MARKS, '').replace(LEADING_TAG, '').trim();
    if (s === before) break;
  }

  // 注釈を退避
  s = s.replace(NOTE_SUFFIX, (m) => { notes.push(m.replace(/^※\s*/, '').trim()); return ''; });
  s = s.replace(BRACKETED, (m) => {
    const inner = m.slice(1, -1).trim();
    if (inner) notes.push(inner);
    return '';
  });

  s = s.replace(TRAILING_JUNK, '').trim();
  // 剥がしすぎて空になったら、元のテキストに戻す（何も出せないよりはまし）
  const display = s || normalizeWidth(raw);

  return { candidates: buildCandidates(display), display, notes: notes.filter(Boolean) };
}

/**
 * 保存度の高い順に候補を並べる。
 * 元の表記をそのまま最初に置くのが肝で、これがないと
 * `おろしにんにく` のような専用の別名を持つ語を取りこぼす。
 */
function buildCandidates(display) {
  const out = [];
  const push = (v) => {
    const t = (v ?? '').trim();
    if (t && !out.includes(t)) out.push(t);
  };

  push(display);

  const noSuffix = display.replace(PREP_SUFFIX, '').trim();
  push(noSuffix);

  const noPrefix = stripRepeated(display, PREP_PREFIX);
  push(noPrefix);

  const noBoth = stripRepeated(noSuffix, PREP_PREFIX);
  push(noBoth);

  // 語中の切り方を落とす。接尾辞・接頭辞では届かない `豚薄切り肉` → `豚肉` のため。
  for (const base of [display, noBoth]) {
    const inner = base.replace(PREP_INFIX, '').trim();
    if (inner !== base && inner.length >= 2) push(inner);
  }

  // 丁寧語の「お」「ご」。落とした結果が短くなりすぎる場合は行わない。
  for (const base of [display, noBoth]) {
    if (/^[おごオ]/.test(base) && base.length >= 3) push(base.slice(1));
  }

  // 修飾語は最後。専用エントリ（無塩バター等）に当たる機会を先に与えるため。
  for (const base of [display, noBoth]) {
    const q = stripRepeated(base, QUALIFIER);
    if (q !== base) push(q);
  }

  // 折り畳んだ鍵も候補に加える（カタカナ/ひらがなの揺れを吸収する）
  for (const c of [...out]) push(foldKey(c));

  return out.slice(0, 12);
}

function stripRepeated(s, re) {
  let t = s;
  for (let i = 0; i < 3; i++) {
    const next = t.replace(re, '').trim();
    if (next === t || next.length < 2) break;
    t = next;
  }
  return t;
}
