/**
 * 食品カテゴリと、カテゴリ単位のフォールバック値。
 *
 * 個々の食品エントリが自前の値を持たないときに、ここが最後の砦になる。
 * 食品が一致しなかったとき（未収録）も、カテゴリすら分からないので
 * それぞれの `default` が使われる。
 */

/** @typedef {keyof typeof CATEGORIES} Category */
export const CATEGORIES = {
  vegetable: '野菜',
  fruit: '果物',
  meat: '肉',
  fish: '魚',
  seafood: '魚介',
  egg: '卵',
  dairy: '乳製品',
  tofu: '豆腐・大豆製品',
  soy: '豆類',
  grain: '穀物',
  noodle: '麺',
  bread: 'パン',
  mushroom: 'きのこ',
  seaweed: '海藻',
  nuts: '種実',
  oil: '油脂',
  seasoning_salt: '塩・塩系調味料',
  seasoning_liquid: '液体調味料',
  seasoning_sweet: '甘味料',
  seasoning_dry: '粉末調味料・香辛料',
  seasoning_paste: 'ペースト状調味料',
  sauce: 'ソース類',
  alcohol: '酒類',
  powder: '粉類',
  sweet: '菓子・甘味',
  herb_garnish: '香味野菜・薬味',
  topping: 'トッピング',
  water: '水',
  other: 'その他',
};

export const CATEGORY_KEYS = Object.freeze(Object.keys(CATEGORIES));

/**
 * 「少々」「適量」などの曖昧な分量を、何グラムとみなすか（カテゴリ単位）。
 *
 * 食品エントリの `estimates` → ここ → `default` の順で解決される。
 * ここに載る値はすべて推定であり、UIには必ず「推定」バッジが付く。
 */
export const CATEGORY_ESTIMATES = {
  //                    少々   ひとつまみ  適量   適宜   たっぷり
  seasoning_salt: { sukoshi: 0.5, hitotsumami: 0.5, tekiryo: 1, tekigi: 1, takusan: 3 },
  seasoning_dry: { sukoshi: 0.3, hitotsumami: 0.3, tekiryo: 1, tekigi: 1, takusan: 2 },
  seasoning_liquid: { sukoshi: 2, hitotsumami: 1, tekiryo: 6, tekigi: 6, takusan: 15 },
  seasoning_sweet: { sukoshi: 1, hitotsumami: 1, tekiryo: 5, tekigi: 5, takusan: 12 },
  seasoning_paste: { sukoshi: 2, hitotsumami: 1, tekiryo: 6, tekigi: 6, takusan: 15 },
  sauce: { sukoshi: 2, hitotsumami: 1, tekiryo: 8, tekigi: 8, takusan: 20 },
  oil: { sukoshi: 2, hitotsumami: 1, tekiryo: 6, tekigi: 6, takusan: 15 },
  alcohol: { sukoshi: 3, hitotsumami: 1, tekiryo: 10, tekigi: 10, takusan: 20 },
  vegetable: { sukoshi: 5, hitotsumami: 2, tekiryo: 30, tekigi: 20, takusan: 80 },
  herb_garnish: { sukoshi: 1, hitotsumami: 1, tekiryo: 5, tekigi: 3, takusan: 10 },
  topping: { sukoshi: 1, hitotsumami: 1, tekiryo: 5, tekigi: 3, takusan: 10 },
  seaweed: { sukoshi: 0.5, hitotsumami: 0.5, tekiryo: 3, tekigi: 2, takusan: 6 },
  nuts: { sukoshi: 2, hitotsumami: 3, tekiryo: 10, tekigi: 8, takusan: 20 },
  powder: { sukoshi: 1, hitotsumami: 1, tekiryo: 10, tekigi: 8, takusan: 25 },
  dairy: { sukoshi: 3, hitotsumami: 1, tekiryo: 15, tekigi: 10, takusan: 40 },
  meat: { sukoshi: 10, hitotsumami: 5, tekiryo: 50, tekigi: 40, takusan: 100 },
  fish: { sukoshi: 10, hitotsumami: 5, tekiryo: 50, tekigi: 40, takusan: 100 },
  sweet: { sukoshi: 2, hitotsumami: 2, tekiryo: 10, tekigi: 8, takusan: 25 },
  // 水は成分がすべてゼロなので、いくつと推定しても合計に影響しない。
  water: { sukoshi: 0, hitotsumami: 0, tekiryo: 0, tekigi: 0, takusan: 0 },
  default: { sukoshi: 1, hitotsumami: 0.5, tekiryo: 10, tekigi: 5, takusan: 20 },
};

/**
 * ml → g の換算に使う密度（カテゴリ単位）。
 * 食品エントリが `density_g_per_ml` も `tbsp_g` も持たないときのみ使う。
 */
export const CATEGORY_DENSITY = {
  oil: 0.92,
  seasoning_liquid: 1.15, // 醤油・みりん等は塩分/糖分で水より重い
  seasoning_sweet: 1.3,
  seasoning_paste: 1.1,
  sauce: 1.1,
  dairy: 1.03,
  alcohol: 0.99,
  powder: 0.55,
  water: 1.0,
  default: 1.0,
};

/**
 * 「1個」「1本」などの個数 → g（カテゴリ単位）。
 * 食品エントリの `pieces` / `defaultPieceGrams` の次に参照される。
 */
export const CATEGORY_PIECE = {
  vegetable: { ko: 120, hon: 120, mai: 30, kabu: 200, taba: 200, fukuro: 200 },
  fruit: { ko: 150, fusa: 120, hon: 120 },
  meat: { mai: 60, kire: 80, pack: 250, hon: 60 },
  fish: { kire: 80, bi: 100, sasu: 150, pack: 150 },
  seafood: { bi: 20, ko: 20, pack: 150 },
  egg: { ko: 50, tama: 50 },
  tofu: { cho: 300, pack: 150, ko: 300 },
  mushroom: { pack: 100, kabu: 100, hon: 15, fukuro: 100 },
  dairy: { ko: 20, mai: 18, pack: 200 },
  bread: { mai: 60, kire: 60, ko: 60 },
  noodle: { tama: 130, taba: 100, fukuro: 150, pack: 150 },
  seaweed: { mai: 3, fukuro: 10 },
  herb_garnish: { kake: 5, ko: 5, hon: 10, taba: 50 },
  sweet: { ko: 20, mai: 10, fukuro: 50 },
  default: {},
};

/**
 * 最後の砦。カテゴリすら分からない（未収録の食品）ときに使う。
 * これがあるので個数指定から「解釈不能」が出ることはほぼない。
 * 空欄を出すより、印を付けた推定値を出すほうが親切だという判断。
 */
export const GLOBAL_PIECE = {
  ko: 100, hon: 100, mai: 20, tama: 150, cho: 300, kabu: 200, kake: 5,
  fukuro: 100, pack: 150, can: 190, bi: 100, kire: 80, fusa: 120,
  taba: 100, wa: 250, sasu: 150,
};

/** 曖昧語のキー。CATEGORY_ESTIMATES の各エントリはこれらを持つ。 */
export const VAGUE_KEYS = Object.freeze(['sukoshi', 'hitotsumami', 'tekiryo', 'tekigi', 'takusan']);
