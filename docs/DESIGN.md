# 設計

チラシの価格と、食べたものの栄養を1本の記録に繋ぐ。

---

## 1. 何を作るか

3つの部分からなる。真ん中の「紐づけ」がこのアプリの理由で、上と下だけなら
既存のアプリで足りる。

```
チラシを読む          画像 → 商品名・本体価格・税込価格・単位
      ↓
   紐づけ             作った料理に、使った食材と金額をぶら下げる
      ↓
食べたものを記録       日付・料理名・カロリー・PFC → 栄養と食費を同時に集計
```

### 画面

| | |
|---|---|
| `/` | 今日。食べたもの、合計、目標との差 |
| `/record` | 記録する。料理名だけ必須 |
| `/flyers` | 取り込んだチラシの一覧 |
| `/flyers/[id]` | 1枚の中身。商品と価格、読み取りの直し |
| `/menu` | 特売品からの献立の提案 |
| `/stats` | 集計。栄養と食費を並べる |

---

## 2. データの持ち方

Supabase の Postgres。すべて `household_id` で仕切り、RLS で他所帯から見えなくする。

```
households            所帯
household_members     所帯の人（auth.users と紐づく）
profiles              1人ぶんの設定（目標値・妊娠中かどうか）

flyers                チラシ1枚（画像・店舗・期間・取り込み状態・画像のハッシュ）
flyer_items           そこから読み取った商品

meals                 食べたもの1件
meal_ingredients      その料理に使った食材（flyer_items への参照 or 自由入力）
```

### なぜ所帯を挟むか

夫婦2人で1つの記録を見る。ユーザー単位の RLS にすると、相手の記録が見えない
アプリになる。逆に所帯を持たず全員で共有すると、他人の記録まで見える。
**所帯は、このアプリで複雑さを足す価値のある唯一の場所。**

### `flyer_items` の形

```sql
create table flyer_items (
  id            uuid primary key default gen_random_uuid(),
  flyer_id      uuid not null references flyers(id) on delete cascade,
  household_id  uuid not null references households(id),

  name          text not null,          -- '和牛肩うす切り'
  price_yen     integer,                -- 599   本体価格
  price_tax_in  integer,                -- 646   税込
  unit          text,                   -- '100g当り' / '1パック' / '1個'
  discount_note text,                   -- '3割引' のような、額で表せないもの
  category      text,                   -- 'meat' / 'produce' / ...
  origin        text,                   -- '北海道産'

  confidence    real not null,          -- 0.0-1.0 読み取りの自信
  verified_at   timestamptz,            -- 人が確認した時刻。null なら未確認
  raw           jsonb not null,         -- モデルが返した生の1件
  created_at    timestamptz not null default now()
);
```

**金額は `integer` で持つ。** 円に小数は要らない。`numeric` でも正しいが、
`real`/`float` で持つと合計が 1 円ずれて、その原因を探す日が必ず来る。

**本体価格と税込を両方持つ。** チラシは「599円（税込646円）」の形で出す。
片方だけ持って後から計算すると、税率の異なる品（酒類・イートイン）で合わなくなる。

**`unit` は必須に近い。** 「各980円」「100g当り129円」「1ネット128円」は
全部意味が違う。単位を落とすと、あとで金額を合計しても何の合計か分からない。

**`discount_note`。** 「北の白雲ポーク全品 3割引」のように、額が決まらない
表示がある。`price_yen` を null にして、この欄に文字で残す。無理に数値へ
落とすと、嘘の金額が集計に混ざる。

---

## 3. チラシを読む

### 手順

```
画像をアップロード
  → Storage に保存、flyers に status='pending' で1行
  → バックグラウンドで Claude を呼ぶ
  → flyer_items に書き込み、status='done'
  → 画面が更新される
```

**リクエストの中で抽出しない。** チラシ1枚の読み取りは数十秒かかりうる。
Vercel の関数のタイムアウトに当たるし、当たらなくてもアップロードの
ボタンが数十秒固まる画面は使われなくなる。

### モデルの呼び方

`claude-opus-5`（1M コンテキスト、入力 $5 / 出力 $25 per MTok）。
小さい文字の商品名を大量に読むので、ここは安いモデルに落とさない。
読み間違いは静かに混ざり、あとから気付けない。

構造化出力（`messages.parse()` + Zod）で受ける。JSON を自分で
パースしない — モデルの出力が schema に合うことを API 側に保証させる。

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const FlyerItem = z.object({
  name: z.string(),
  price_yen: z.number().int().nullable(),
  price_tax_in: z.number().int().nullable(),
  unit: z.string().nullable(),
  discount_note: z.string().nullable(),
  category: z.enum(["produce", "meat", "seafood", "deli", "dairy",
                    "grocery", "drink", "sweets", "other"]),
  origin: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const Flyer = z.object({
  store: z.string().nullable(),
  valid_from: z.string().nullable(),   // 'YYYY-MM-DD'
  valid_to: z.string().nullable(),
  items: z.array(FlyerItem),
});

const client = new Anthropic();

const res = await client.messages.parse({
  model: "claude-opus-5",
  max_tokens: 32000,
  // Opus 5 は既定で adaptive thinking。密な読み取りなので effort は高めに。
  output_config: { format: zodOutputFormat(Flyer), effort: "high" },
  // 安全分類で断られたときに別モデルへ回す。既定で入れておく。
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  messages: [{
    role: "user",
    content: [
      { type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64 } },
      { type: "text", text: PROMPT },
    ],
  }],
});

if (res.stop_reason === "refusal") { /* 断られた。status='refused' で残す */ }
const flyer = res.parsed_output;   // 失敗すると null。必ず見る
```

出力が長いので `.stream()` + `.finalMessage()` を使う。32000 トークンを
非ストリーミングで待つと HTTP のタイムアウトに当たる。

### 画像の渡し方 — 署名付き URL を使わない

Supabase Storage の署名付き URL には有効期限がある。抽出をやり直したく
なったとき（プロンプトを直した、失敗した）に切れていて、再実行できない。

**base64 で渡すか、Files API に上げて `file_id` を再利用する。** 同じチラシを
何度も読み直すなら後者のほうが安い。初版は base64 で十分。

### 費用の見積り

チラシ1枚（2000×1414px → 長辺 1568px に縮小されて約 2,300 トークン）。

| | トークン | 円 |
|---|---|---|
| 入力（画像 + プロンプト） | 約 2,900 | 約 2 円 |
| 出力（70品の JSON + 思考） | 8,000〜20,000 | 30〜75 円 |
| **1枚あたり** | | **30〜80 円** |

週1枚として月 120〜320 円。**これは見積りで、実測していない。** 思考トークンが
支配的なので、`effort` を `medium` に下げると半分近くになる。まず `high` で
精度を確かめ、落とせるか測る。

### 読み間違いをどう扱うか

**ここが一番大事。** モデルは、自信のない箇所も自信のある箇所と同じ調子で
出力する。チラシの小さい文字（内容量、正式な商品名）は実際に読めないことが
あり、それが黙って「読めた」形で入ってくる。

対策は3つ。

1. **`confidence` を必ず出させる。** 低いものは一覧で「要確認」の印を付け、
   集計から外すか、外していることを画面に書く。
2. **必ず人が直せる。** 商品名も価格も、一覧からその場で直せること。
   直したら `verified_at` を立て、以降は確認済みとして扱う。
3. **元の画像を捨てない。** 直すときに原本を見る。読み取り結果しか無いと、
   間違いに気付いても正しい値が分からない。

`raw` に生の出力を残すのは、あとでプロンプトを直したときに「前は何を
返していたか」を比べるため。

### 同じチラシを二度取り込まない

画像の SHA-256 を `flyers.image_sha256` に持ち、`unique` を張る。
2回目のアップロードは既存の1枚に案内して終わる。

期間が重なる別の号（週末限定の折込など）は別物なので、ハッシュが違えば通す。

### 取り込み方は画像アップロードから

店舗サイトやチラシサイトから自動で取ってくるのは、規約と HTML 構造の
変化の両方が問題になる。**まず手元の画像をアップロードする形だけ作る。**
スマホで撮った写真でも、ダウンロードした画像でも同じように通る。

---

## 4. 記録する

`food` リポジトリの `server/` で作った `/new` の形をそのまま持ってくる。
あちらで実際に動かして確かめてある部分。

- 料理名だけ必須。カロリーも PFC も任意（分からないから記録しない、が一番もったいない）
- 日付と時刻は入力したタイムゾーンの壁時計として解釈する。
  `new Date('2026-09-08T19:30')` はサーバの時刻になるので、Vercel（UTC）だと
  日本時間の夕食が翌朝 4:30 になる
- 素の `<form>` で送る。クライアント JavaScript を持たない

**`food` には無い部分**が `meal_ingredients`。作った料理に、使った食材を
ぶら下げる。

```sql
create table meal_ingredients (
  id            uuid primary key default gen_random_uuid(),
  meal_id       uuid not null references meals(id) on delete cascade,
  household_id  uuid not null references households(id),

  flyer_item_id uuid references flyer_items(id) on delete set null,
  name          text not null,      -- 参照が無いときの自由入力。参照があっても控えとして持つ
  amount_g      real,
  cost_yen      integer,            -- 使ったぶんの金額
  created_at    timestamptz not null default now()
);
```

`flyer_item_id` は `on delete set null`。チラシを消しても、食べた記録と
そのときの金額は残さないといけない。**`name` と `cost_yen` を控えとして
持つのはそのため** — 参照が切れても「何をいくらで食べたか」は残る。

---

## 5. 献立の提案

`flyer_items` のうち期間内のものを Claude に渡して、献立を返させる。
`profiles` の「妊娠中」フラグが立っていれば、生もの・非加熱食品を外し、
葉酸・鉄・カルシウムを厚くする指示をプロンプトに足す。

**これは最後に作る。** 上の3つが動いていないと、提案しても記録に繋がらない。

---

## 6. 認証と RLS

Supabase Auth のマジックリンク。パスワードを持たない。

**RLS は必須で、後回しにできない。** Supabase は `public` スキーマのテーブルを
PostgREST で自動的に REST API として公開し、既定で `anon` ロールに権限を与える。
`anon` キーはブラウザに埋め込む前提の公開キーなので、秘密にすることでは守れない。
テーブルを作った時点で、キーを知っていれば誰でも読み書きできる状態になる。

全テーブルで `enable row level security` し、`household_id` が
自分の所属所帯と一致する行だけを通すポリシーを張る。

```sql
create policy "所帯の中だけ" on flyer_items
  for all using (
    household_id in (
      select household_id from household_members where user_id = auth.uid()
    )
  );
```

---

## 7. 作る順

| | 中身 | 目安 |
|---|---|---|
| 1 | 認証・所帯・RLS・記録する / 見返す | 2日 |
| 2 | チラシの取り込みと、読み取り結果の修正 | 3日 |
| 3 | 料理と食材の紐づけ、食費の集計 | 2日 |
| 4 | 献立の提案 | 1日 |

**1 と 2 で一度止めて使ってみる。** 3 の紐づけは、毎食やると続かない可能性が
高い。1と2を実際に何週間か使って、紐づけをどこまで省けるか（レシートから
一括で入れる、材料を選ばず金額だけ入れる、など）を見てから決めたい。
先に作り込むと、使われない画面が残る。

---

## 8. 決めていないこと

- **レシートからの取り込み。** チラシより確実に金額が分かる。同じビジョンの
  仕組みで読めるが、紐づけの設計が変わる（チラシは「買う前」、レシートは
  「買った後」）。3 の前に考え直す
- **`food` の Chrome 拡張との関係。** レシピページからの栄養計算はあちらが
  持っている。API で受けるか、割り切って別物にするか
- **`effort` をどこまで下げられるか。** 費用の大半が思考トークン。精度を
  測ってから決める
