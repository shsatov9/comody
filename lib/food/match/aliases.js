/**
 * 商品名・表記ゆれの別名テーブル。
 *
 * ここに置くのは、食品エントリの `aliases` に入れるのが不自然なもの:
 * 商品名（ほんだし・ウェイパー）、略称（マヨ）、レシピ特有の言い回し。
 * 栄養データとは更新の頻度が違うのでファイルを分けてある。
 *
 * キーは生の文字列でよい。索引を作るときに foldKey() で畳まれるので、
 * カタカナ/ひらがなの揺れは書かなくてよい。
 *
 * ## 育て方
 *
 * ポップアップで食品を選び直すとき「今後もこの食品として扱う」に
 * チェックすると chrome.storage.local の userAliases に書かれ、
 * この表の上に重ねられる（照合カスケードの最上位で常に勝つ）。
 * 設定の「別名テーブルを書き出す」で貼り付け可能な形で吐けるので、
 * 溜まったものをここに昇格させる。
 */
export const ALIASES = {
  // ── だし・スープの素 ──
  ほんだし: 'dashi_powder',
  だしの素: 'dashi_powder',
  ダシの素: 'dashi_powder',
  和風顆粒だし: 'dashi_powder',
  ウェイパー: 'chicken_stock_powder',
  味覇: 'chicken_stock_powder',
  中華あじ: 'chicken_stock_powder',
  丸鶏がらスープ: 'chicken_stock_powder',
  コンソメキューブ: 'consomme_powder',
  固形ブイヨン: 'consomme_powder',
  顆粒コンソメ: 'consomme_powder',

  // ── 調味料の略称・商品名 ──
  マヨ: 'mayonnaise',
  ケチャ: 'ketchup',
  味の素: 'umami_seasoning',
  うま味調味料: 'umami_seasoning',
  ほんつゆ: 'mentsuyu_3x',
  '2倍濃縮めんつゆ': 'mentsuyu_2x',
  '3倍濃縮めんつゆ': 'mentsuyu_3x',
  ストレートめんつゆ: 'mentsuyu_straight',
  味ぽん: 'ponzu',
  ぽんず: 'ponzu',
  お好みソース: 'chuno_sauce',
  とんかつソース: 'chuno_sauce',
  ブルドックソース: 'chuno_sauce',
  ソース: 'chuno_sauce',
  オイスター: 'oyster_sauce',

  // ── 油 ──
  サラダオイル: 'salad_oil',
  EVオイル: 'olive_oil',
  エキストラバージンオイル: 'olive_oil',
  ピュアオリーブオイル: 'olive_oil',
  太白ごま油: 'sesame_oil',

  // ── チューブ・おろし系 ──
  チューブにんにく: 'garlic',
  にんにくチューブ: 'garlic',
  おろしニンニク: 'garlic',
  チューブしょうが: 'ginger',
  しょうがチューブ: 'ginger',
  おろし生姜: 'ginger',
  チューブわさび: 'wasabi',
  練りワサビ: 'wasabi',
  チューブからし: 'karashi',

  // ── 肉の略称 ──
  豚こま: 'pork_komagire',
  豚小間: 'pork_komagire',
  豚こま肉: 'pork_komagire',
  豚切り落とし肉: 'pork_komagire',
  // 部位を書かない「薄切り」。切り方を落とすと1文字になってしまうので表で拾う。
  豚薄切り: 'pork_komagire',
  牛薄切り: 'beef_komagire',
  鶏薄切り: 'chicken_breast',
  牛こま肉: 'beef_komagire',
  牛切り落とし肉: 'beef_komagire',
  鶏もも: 'chicken_thigh',
  とりもも肉: 'chicken_thigh',
  鶏むね: 'chicken_breast',
  とりむね肉: 'chicken_breast',
  合い挽き: 'mixed_mince',
  あいびき: 'mixed_mince',

  // ── 調味料の混合表記 ──
  塩コショウ: 'salt_pepper_mix',
  塩・胡椒: 'salt_pepper_mix',
  クレイジーソルト: 'salt_pepper_mix',
  アジシオ: 'salt',
  粗塩: 'salt',

  // ── その他よく出る表記 ──
  白すりごま: 'sesame',
  黒すりごま: 'sesame',
  炒りごま: 'sesame',
  カットわかめ乾燥: 'wakame_dried',
  乾燥ワカメ: 'wakame_dried',
  刻みのり: 'nori',
  きざみ海苔: 'nori',
  絹豆腐: 'tofu_kinu',
  木綿とうふ: 'tofu_momen',
  シーチキン缶: 'tuna_can_oil',
  ツナ缶詰: 'tuna_can_oil',
  むきエビ: 'shrimp',
  冷凍エビ: 'shrimp',
  ピザチーズ: 'cheese_shred',
  溶けるチーズ: 'cheese_shred',
  粉チーズパルメザン: 'parmesan',
  スパゲティー: 'pasta_dry',
  マカロニパスタ: 'pasta_dry',
  中華蒸し麺: 'chuka_men',
  焼そば麺: 'chuka_men',
  絹さや: 'snap_pea',
  ミニトマトプチトマト: 'mini_tomato',
  白ごはん: 'rice_cooked',
  温かいご飯: 'rice_cooked',
  炊きたてご飯: 'rice_cooked',
  お湯: 'water',
  熱湯: 'water',
  氷水: 'water',
};

/**
 * 部分一致（カスケードの level 4）で単独では使わせないキー。
 *
 * これがないと `豚バラ肉` が `肉` に、`お酒のつまみ` が `酒` に、
 * `ごま油` が `油` に当たってしまう。完全一致・別名一致では使ってよい。
 */
export const STOP_KEYS = new Set([
  '酒', '油', '粉', '塩', '水', '肉', '魚', '汁', '素', '皮', '身', '実', '葉', '茶',
  'だし', 'たれ', 'タレ', 'あん', 'つゆ', 'もと', 'こな',
]);
