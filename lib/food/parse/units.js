/**
 * 分量表記に出てくる単位の定義。
 *
 * `forms` は表記ゆれの列挙。**最長一致**でマップ化するので、
 * `大さじ` が `さじ` に、`kg` が `g` に負けることはない。
 */

/** @typedef {'mass'|'volume'|'piece'|'vague'} UnitKind */

export const UNITS = [
  // ── 質量: そのままグラムになる。最も確度が高い ──
  { key: 'kg', kind: 'mass', grams: 1000, forms: ['kg', 'キロ', 'キログラム'] },
  { key: 'g', kind: 'mass', grams: 1, forms: ['g', 'グラム', 'gr'] },
  { key: 'mg', kind: 'mass', grams: 0.001, forms: ['mg', 'ミリグラム'] },

  // ── 体積: グラムにするには食材の密度・大さじ重量が要る ──
  { key: 'l', kind: 'volume', ml: 1000, forms: ['l', 'リットル', 'ℓ'] },
  { key: 'ml', kind: 'volume', ml: 1, forms: ['ml', 'cc', 'ミリリットル', 'ミリ'] },
  { key: 'cup', kind: 'volume', ml: 200, spoon: 'cup', prefixOk: true, forms: ['カップ', 'cup', 'カップ'] },
  { key: 'tbsp', kind: 'volume', ml: 15, spoon: 'tbsp', prefixOk: true, forms: ['大さじ', '大匙', '大サジ', 'おおさじ', 'tbsp'] },
  { key: 'tsp', kind: 'volume', ml: 5, spoon: 'tsp', prefixOk: true, forms: ['小さじ', '小匙', '小サジ', 'こさじ', 'tsp'] },
  { key: 'go', kind: 'volume', ml: 180, forms: ['合'] },
  { key: 'sho', kind: 'volume', ml: 1800, forms: ['升'] },
  { key: 'otama', kind: 'volume', ml: 60, prefixOk: true, forms: ['お玉', 'おたま', 'オタマ'] },

  // ── 個数: 食材ごとの1個あたり重量が要る ──
  { key: 'ko', kind: 'piece', forms: ['個', 'コ', 'こ', 'ヶ', 'ケ', '箇'] },
  { key: 'hon', kind: 'piece', forms: ['本'] },
  { key: 'mai', kind: 'piece', forms: ['枚'] },
  { key: 'tama', kind: 'piece', forms: ['玉'] },
  { key: 'cho', kind: 'piece', forms: ['丁'] },
  { key: 'kabu', kind: 'piece', forms: ['株'] },
  { key: 'kake', kind: 'piece', forms: ['片', 'かけ', 'カケ', '欠片'] },
  { key: 'fukuro', kind: 'piece', forms: ['袋'] },
  { key: 'pack', kind: 'piece', forms: ['パック'] },
  { key: 'can', kind: 'piece', forms: ['缶', 'カン'] },
  { key: 'bi', kind: 'piece', forms: ['尾', '匹'] },
  { key: 'kire', kind: 'piece', forms: ['切れ', 'きれ', '切'] },
  { key: 'fusa', kind: 'piece', forms: ['房', 'ふさ'] },
  { key: 'taba', kind: 'piece', forms: ['束', '把', 'たば'] },
  { key: 'wa', kind: 'piece', forms: ['羽'] },
  { key: 'sasu', kind: 'piece', forms: ['さく', '柵'] },

  // ── 曖昧単位: 数値は付くが量は感覚的 ──
  { key: 'tsumami', kind: 'vague', grams: 0.5, forms: ['つまみ', '摘み'] },
  { key: 'tsukami', kind: 'vague', grams: 15, forms: ['つかみ', '掴み'] },
];

/** 個数単位のキー（食品エントリの `pieces` で使えるキー）。db-invariants テストが参照する。 */
export const PIECE_KEYS = Object.freeze(UNITS.filter((u) => u.kind === 'piece').map((u) => u.key));

/**
 * 表記 → 単位定義。**長い表記から順に**並べてあるので、
 * 先頭から線形に走査すれば最長一致になる。
 */
export const UNIT_FORMS = (() => {
  const rows = [];
  for (const u of UNITS) for (const f of u.forms) rows.push({ form: f.toLowerCase(), unit: u });
  rows.sort((a, b) => b.form.length - a.form.length);
  return rows;
})();

/** 前置できる単位（`大さじ2` のように単位が先に来るもの）。長い順。 */
export const PREFIX_UNIT_FORMS = UNIT_FORMS.filter((r) => r.unit.prefixOk);

/**
 * セル全体を置き換える曖昧語 → CATEGORY_ESTIMATES のキー。
 * `zero` だけは特別で、0g（「なし」）を意味する。
 */
export const VAGUE = {
  少々: 'sukoshi',
  少: 'sukoshi',
  少量: 'sukoshi',
  ひとつまみ: 'hitotsumami',
  一つまみ: 'hitotsumami',
  '1つまみ': 'hitotsumami',
  ふたつまみ: 'futatsumami',
  二つまみ: 'futatsumami',
  ひとつかみ: 'hitotsukami',
  一つかみ: 'hitotsukami',
  適量: 'tekiryo',
  各適量: 'tekiryo',
  適当: 'tekiryo',
  適宜: 'tekigi',
  お好みで: 'tekigi',
  お好み: 'tekigi',
  好みで: 'tekigi',
  好みの量: 'tekigi',
  お好きなだけ: 'tekigi',
  たっぷり: 'takusan',
  多め: 'takusan',
  少なめ: 'sukuname',
  なし: 'zero',
  不要: 'zero',
  '': 'tekigi',
  '-': 'tekigi',
  '‐': 'tekigi',
  '—': 'tekigi',
  '–': 'tekigi',
  '―': 'tekigi',
  '〜': 'tekigi',
  '･': 'tekigi',
};

/**
 * VAGUE の値のうち、CATEGORY_ESTIMATES に直接キーがないものの解決方法。
 * `[基になるキー, 倍率]`。
 */
export const VAGUE_DERIVED = {
  futatsumami: ['hitotsumami', 2],
  hitotsukami: ['takusan', 1],
  sukuname: ['tekiryo', 0.5],
};

/** 分量の前後に付く「およそ」を表す語。取り除いたうえで approx フラグを立てる。 */
export const APPROX_PREFIXES = ['約', 'およそ', 'ほぼ'];
export const APPROX_SUFFIXES = ['ほど', 'くらい', 'ぐらい', '位', '程度', '程', '弱', '強'];
