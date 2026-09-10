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

meal_plans            平日5日の献立1回ぶん（買い物日・期間・元のチラシ）
meal_plan_items       その1日1品（本命と代替2案）
meal_plan_item_ingredients  その料理に使う食材（特売品への参照 or 名前だけ）
shopping_items        その回の買い物リスト

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

  -- チラシの期間と商品の期間は別物（下記）
  valid_from    date,                   -- 商品ごとの売出し開始。null ならチラシと同じ
  valid_to      date,                   -- 同・終了。単日特売は from = to
  limit_note    text,                   -- '1家族様各1点限り' / '16時からの夕方できたて市'

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

**チラシの期間と商品の期間は別物。** 実物を1枚読んで分かったことで、`flyers` の
期間だけでは足りない。同じ紙面に「9/9 水 限り」（単日）、「9/10 木より販売」
（途中から）、「16時からの夕方できたて市」（時間帯）、「1家族様各1点限り」
（数量）が並ぶ。しかも**生鮮の主力が単日特売**だった。ここを商品側に持たないと、
買い物に行く日にはもう終わっている品が、黙って献立と買い物リストに混ざる。

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

チラシの特売品から、**平日5日の夕食**を組む。土日に1回買い物へ行き、月曜から
金曜まで、1日1品。

出すものは2つで1組。

| | |
|---|---|
| 献立 | 5日ぶんの夕食。1日につき本命1つと代替2つ |
| 買い物リスト | 土日に買うもの。2人分・5日ぶん。冷凍する指示つき |

栄養は**1人前の推定**で出し、分量と金額は**2人分**で出す。同じ料理を2人で
食べて、目標を持っているのは1人だけなので、比べる相手（1人前）と買う量
（2人分）は別物になる。目標は `profiles` にあるものをそのまま使う。

### 夕食だけにする

朝は固定で、昼は弁当か外食になる。モデルに考えさせる価値が薄いわりに、出力と
それを見る手間だけ3倍になる。

### 価格が効くのは買い物の瞬間だけ

**チラシの期間と献立の期間は別物でよい。** 特売価格が有効なのは土日に店へ行く
瞬間だけで、月曜から金曜に何を食べるかと価格は関係がない。

```
チラシ（土日に有効）→ 買い物リスト   ← 価格の世界はここだけ
                    → 月〜金の献立   ← ここに価格は要らない
```

おかげで「チラシの有効期間に平日が収まるか」を気にしなくてよくなる。週の途中で
切り替わる号があっても、買い物に行く日に有効な1枚だけ見ればいい。

### 5日ぶんは「5回の提案」ではなく「1回の買い物の割り付け」

ここを外すと機能ごと無駄になる。5日を独立に組ませると買い物リストが5日ぶん
ばらけて、1回の買い物で回らなくなる。月曜に豚こま、火曜に鶏もも、水曜に鮭を
別々に買うなら、チラシを読んだ意味がない。

渡す制約は3つ。

- **同じ食材を複数日にまたがって使い切る**（豚こま 500g を水と木に割る）
- **傷みやすさで順番を決める**（魚は買った翌日まで、生の肉は2日、冷凍なら後半）
- **1回の買い物で回る**

### 特売をメインに、足りないものは通常価格で

特売品だけでは献立は組めない。実際のチラシは野菜が長ねぎ1品だけ、ということが
起きる。**定番品（通常価格）を買い物リストに混ぜてよい。**

ただし「足りないものは足してよい」とだけ渡すと、モデルは楽なほうへ流れて、
特売を使わない献立を出してくる。線引きが要る。

> **主菜のたんぱく源は特売品から取る。** 副菜・薬味・米・調味料は通常価格でよい。

**金額の比率で縛らない。** 「特売が買い物の◯割以上」は根拠のない数字になるうえ、
モデルが安定して当てられない。実際に組んでみると、肉と魚だけで買い物の半分を
超える。金額の大半は最初からたんぱく源にあるので、**そこさえ特売なら食費は効く。**
野菜を何割特売にしたかは、ほとんど響かない。

役割で書くと機械的に確かめられるのも利点で、「各日の主菜が特売品を1つ以上
使っているか」を見れば済む（→ 表の形の `is_main`）。

### 土日に買って、金曜に食べるまで6日ある

作り置きはしない。土日の作業は**小分け冷凍だけ**。そのぶん後半2日は、冷凍して
おいた肉か、日持ちする根菜・乾物になる。

**冷凍するかどうかは買い物リスト側に持つ。** 冷凍するかは買った瞬間の判断で、
献立を見る木曜には間に合わない。

```
豚こま切れ肉 500g  →  土曜に 250g ずつ小分け冷凍（水・木で使用）
```

### 前夜の解凍を、アプリが言う

平日の調理は30分。**30分は材料を出してから食卓に出るまでで、解凍時間を含まない。**
ここを曖昧にすると「解凍30分＋調理20分」を30分と言ってくる。

30分で作る・作り置きしない・後半は冷凍肉、が揃うと、**前夜に冷蔵庫へ移す作業が
献立の一部**になる。木曜の夕方に凍った肉を見つけた時点で、その日の献立は成立
しない。

だから `meal_plan_items` に前夜の準備を1行持ち、**今日の画面に「明日のための
準備」を出す。** 献立を見る動機が「今日何を作るか」だけだと、この一行は読まれない。

### 週の形は、型ではなく規則で渡す

土日買い物・作り置きなしだと、自然にこうなる。

| | |
|---|---|
| 月 | 魚 |
| 火・水 | 生の肉、葉物野菜 |
| 木・金 | 冷凍しておいた肉、根菜、乾物 |

**この並びを型として固定はしない。** 毎週同じ形になって飽きる。傷みやすさの
規則だけ渡して、並びは結果として決まるようにする。特売が魚だらけの週は、月火が
魚になっていい。

### 食べないものは自由文で持つ

`households` に自由文で1欄持つ。夕食は2人で食べるので、片方が嫌いなものは食卓に
出ない。人ごとではなく所帯の制約になる。

**分類（enum）にしない。** 「キノコ類」を分類で持つと必ず取りこぼす。しめじ・
エリンギ・なめこ・マッシュルーム、貝なら牡蠣・あさり・ホタテ、そして**出汁**。
「しじみの味噌汁」は外すが「かつお出汁」は通す、「オイスターソース」はどちらか
— この境界は分類語では書けない。自由文をそのまま渡すほうが正確で、外れたら文言を
足せばいい。

自由文をプロンプトに入れる以上、そこは**データであって指示ではない**扱いが要る。
所帯の中の人しか書けないので実害はほぼないが、囲わずに混ぜない。

### 計画と記録を同じ表に入れない

`meals` に「まだ食べていない」フラグを足すのが一番小さい変更だが、これはやらない。
合計は渡された行を全部足すので、**食べていない料理が合計に入る。** 未入力と 0 を
区別し、PFC の欠けを必ず画面に添えてきたのに、そこで崩れる。

別の表に持ち、**「これ食べた」で `meals` に1行起こす。**

副次的にこれが一番効く。記録が「料理名を打つ」から「押す」に変わる。毎食の入力は
Phase 1 で一番摩擦の大きいところなので、献立は記録の負担を増やす側ではなく減らす
側に回る。

### 栄養値が推定であることを持ち続ける

モデルが出す1人前の kcal・PFC は推定でしかない。献立から記録を起こすときにその
まま `meals` へ入れると、**手で入れた値と見分けがつかなくなる。**

`flyer_items` に `confidence` と `verified_at` を置いたのと同じ考えで、`meals` にも
出どころ（手入力か、献立からの推定か）を持たせて画面で区別する。ここを曖昧にすると、
Phase 1 で積み上げた「合計を信用しすぎない」が静かに壊れる。

### 表の形

```sql
create table meal_plans (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  flyer_id     uuid references flyers(id) on delete set null,

  shopping_on  date not null,   -- 買い物に行く土日
  starts_on    date not null,   -- 月曜
  ends_on      date not null,   -- 金曜

  status       text not null,   -- 'pending' / 'done' / 'failed' / 'refused'
  raw          jsonb,           -- モデルが返した生の1件
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table meal_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references meal_plans(id) on delete cascade,
  household_id uuid not null references households(id),

  day          date not null,
  -- 本命と代替2つ。組み直さずに差し替えられるようにする
  slot         text not null check (slot in ('main', 'alt1', 'alt2')),

  title        text not null,
  cook_minutes integer,
  prep_note    text,            -- 「前夜に冷蔵庫へ移す」。無ければ null

  -- 1人前の推定。手で入れた値ではないので、記録に起こすときも推定として扱う
  kcal      real, protein_g real, fat_g real, carb_g real, salt_g real,

  meal_id      uuid references meals(id) on delete set null,  -- 「これ食べた」で起きた記録
  created_at   timestamptz not null default now(),
  unique (plan_id, day, slot)
);

create table shopping_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references meal_plans(id) on delete cascade,
  household_id  uuid not null references households(id),
  flyer_item_id uuid references flyer_items(id) on delete set null,

  name       text not null,
  qty        text not null,             -- '500g' / '1パック'。数値に落とさない
  amount_yen integer,                   -- 2人分・5日ぶんの見込み
  freeze     boolean not null default false,
  created_at timestamptz not null default now()
);

create table meal_plan_item_ingredients (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references meal_plan_items(id) on delete cascade,
  household_id     uuid not null references households(id),
  -- 買わない材料（家にある米・調味料）は null のまま、名前だけ残る
  shopping_item_id uuid references shopping_items(id) on delete set null,

  name    text not null,   -- '豚ロース生姜焼き用'
  qty     text,            -- '200g'。unit と同じ理由で数値に落とさない
  -- 主菜のたんぱく源。ここが特売品（shopping_item 経由で flyer_item）を
  -- 指しているかで「特売をメインに使えているか」を判定する
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
```

`qty` を数値に落とさないのは `flyer_items.unit` と同じ理由で、「500g」「1パック」
「1ネット」は意味が違うため。

`slot` で**代替案を最初から2つ持つ。** あとから「水曜だけ変えたい」で組み直すと
買い物リストごと変わってしまう。同じ買い物リストで成立する代替案を、生成の1回目に
一緒に出させる。呼び直すより安く、待ち時間も無い。

`meal_plan_items.meal_id` が、献立から起きた記録を指す。ここと
`meal_plan_item_ingredients` が揃うと、**その料理に使った食材と金額を料理単位で
辿れる。** 献立を通して食べたぶんについては、紐づけを人が入力する必要がなくなる。
**§7 で紐づけを献立より後ろに回したのはこれが理由。**

### 買い物リストは献立から導出しない

モデルに別途出させる。導出だと「豚こま 500g を水と木で使い切る」の整合をこちら側で
取り直すことになるが、モデルに合計まで意識させたほうが正確になる。

そのうえで、**献立に出る食材が全部リストにあるか**だけ機械的に照合する。欠けていたら
人に見せる。

### モデルの呼び方

§3 と同じ形。`claude-opus-5`、構造化出力、ストリーミング。

入力は小さい（期間内の `flyer_items`、直近の記録、目標、食べないもの）ので
3,000〜5,000 トークン。出力は5日ぶん＋代替案＋買い物リストで、思考込み
10,000〜25,000 トークン。1回 30〜80 円の見込み。**これは見積りで、実測していない。**
週1回なので、費用が問題になる規模ではない。

直近2週間の `meals` を渡して、**先週と同じ料理を避ける。** これを入れないと、特売の
中身が似ている週は毎回同じ献立が出る。

`profiles` の「妊娠中」フラグが立っていれば、生もの・非加熱食品を外し、葉酸・鉄・
カルシウムを厚くする指示を足す。

### まだ決めていない

- **献立を外れた日をどう扱うか。** 外食した、もらいものを食べた、面倒で別のものを
  作った。記録は起きるが献立とは繋がらない。何週間か使ってから決める
- **生成の引き金。** チラシを取り込んだら自動で作るか、人が押すか。チラシの発行
  周期が分かっていないので、まず押す形にする

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
| 3 | 献立の提案と、そこから記録を起こす | 2日 |
| 4 | 料理と食材の紐づけ、食費の集計 | 2日 |

**1 と 2 で一度止めて使ってみる。**

**紐づけと献立の順を入れ替えた。** 紐づけを先に置いていたのは、食費の集計に要る
から。しかし食べた後に思い出して紐づける形は、毎食やると続かない可能性が高い。
献立を先に作れば「この料理にこの特売品を使う」は献立を組んだ時点で決まっている
ので、記録を献立から起こすだけで紐づけが副産物として手に入る（§5）。

4 に残したのは、献立を通さずに食べたぶん — 外食、もらいもの、献立を外れた日 —
の扱い。ここは何週間か使ってから決めたい。先に作り込むと、使われない画面が残る。

---

## 8. 決めていないこと

- **レシートからの取り込み。** チラシより確実に金額が分かる。同じビジョンの
  仕組みで読めるが、紐づけの設計が変わる（チラシは「買う前」、レシートは
  「買った後」）。3 の前に考え直す
- **`food` の Chrome 拡張との関係。** レシピページからの栄養計算はあちらが
  持っている。API で受けるか、割り切って別物にするか
- **`effort` をどこまで下げられるか。** 費用の大半が思考トークン。精度を
  測ってから決める
