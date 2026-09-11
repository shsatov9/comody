-- Phase 2-3: チラシと、そこから組む献立。
--
-- 足すのは6つ。チラシ側（flyers / flyer_items）と、献立側（meal_plans /
-- meal_plan_items / meal_plan_item_ingredients / shopping_items）。
-- 設計は docs/DESIGN.md の §2・§3・§5。
--
-- ## 防御は init と同じ
--
-- 行を絞っているのは RLS だけ。すべて household_id を持ち、my_household_ids()
-- で絞る。アプリ側のコードは権限判定をしない。anon には何も渡さない。

-- ── チラシ1枚 ────────────────────────────────────────────────

create table public.flyers (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,

  store        text check (store is null or char_length(store) <= 60),

  -- チラシ全体の売出し期間。商品ごとの限定は flyer_items 側に持つ（下記）
  valid_from   date,
  valid_to     date,

  -- Storage のパス。署名付き URL を持たないのは、期限が切れると読み直せなく
  -- なるため。プロンプトを直して取り込み直したいときに困る。
  image_path   text not null,

  -- 同じチラシを二度取り込まない。期間が重なる別の号（週末の折込など）は
  -- 別物なので、ハッシュが違えば通る。
  --
  -- unique を所帯ごとにしてあるのは、別の所帯が同じチラシを上げたときに
  -- 弾かれないようにするため。DESIGN.md は列そのものに unique と書いているが、
  -- それだと先に上げた所帯だけが取り込める。
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),

  status       text not null default 'pending'
                 check (status in ('pending', 'done', 'failed', 'refused')),
  error_note   text,
  raw          jsonb,

  created_at   timestamptz not null default now(),
  read_at      timestamptz,

  unique (household_id, image_sha256)
);

create index flyers_household_idx on public.flyers(household_id, valid_to desc nulls last);

-- ── 読み取った商品 ────────────────────────────────────────────

create table public.flyer_items (
  id            uuid primary key default gen_random_uuid(),
  flyer_id      uuid not null references public.flyers(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,

  name          text not null check (char_length(name) between 1 and 200),

  -- 金額は integer。円に小数は要らない。real で持つと合計が1円ずれて、
  -- その原因を探す日が必ず来る。
  price_yen     integer check (price_yen is null or price_yen >= 0),
  price_tax_in  integer check (price_tax_in is null or price_tax_in >= 0),

  -- 「各980円」「100g当り129円」「1ネット128円」は全部意味が違う。
  -- 単位を落とすと、あとで金額を合計しても何の合計か分からない。
  unit          text,

  -- 「全品3割引」のように額が決まらない表示。price_yen を null にしてここへ。
  -- 無理に数値へ落とすと、嘘の金額が集計に混ざる。
  discount_note text,

  category      text check (category is null or category in
                  ('produce', 'meat', 'seafood', 'deli', 'dairy',
                   'grocery', 'drink', 'sweets', 'other')),
  origin        text,

  -- チラシの期間と商品の期間は別物。同じ紙面に「9/9 水 限り」（単日、from = to）
  -- 「9/10 木より販売」（途中から）が並ぶ。しかも生鮮の主力が単日特売だった。
  -- ここを持たないと、買い物に行く日には終わっている品が黙って献立に混ざる。
  valid_from    date,
  valid_to      date,
  limit_note    text,          -- '1家族様各1点限り' / '16時からの夕方できたて市'

  -- モデルは自信の無い箇所も同じ調子で出力する。低いものは要確認の印を付ける。
  confidence    real not null check (confidence between 0 and 1),
  verified_at   timestamptz,   -- 人が確認した時刻。null なら未確認

  -- あとでプロンプトを直したとき「前は何を返していたか」を比べるため
  raw           jsonb not null,
  created_at    timestamptz not null default now()
);

create index flyer_items_flyer_idx on public.flyer_items(flyer_id);
create index flyer_items_household_idx on public.flyer_items(household_id, valid_to);

-- ── 献立1回ぶん ──────────────────────────────────────────────

create table public.meal_plans (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  -- チラシを消しても献立は残す。価格が効くのは買い物の瞬間だけなので、
  -- 買ったあとの献立は元のチラシが無くても意味を持つ。
  flyer_id     uuid references public.flyers(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,

  shopping_on  date not null,   -- 買い物に行く土日
  starts_on    date not null,   -- 月曜
  ends_on      date not null,   -- 金曜

  status       text not null default 'pending'
                 check (status in ('pending', 'done', 'failed', 'refused')),
  error_note   text,
  raw          jsonb,
  created_at   timestamptz not null default now(),

  check (starts_on <= ends_on),
  check (shopping_on < starts_on)   -- 買ってから食べる
);

create index meal_plans_household_idx on public.meal_plans(household_id, starts_on desc);

-- ── その1日1品 ───────────────────────────────────────────────

create table public.meal_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.meal_plans(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,

  day          date not null,
  -- 本命と代替2つ。あとから「水曜だけ変えたい」で組み直すと買い物リストごと
  -- 変わってしまうので、同じ買い物で成立する代替案を生成の1回目に出させる。
  slot         text not null check (slot in ('main', 'alt1', 'alt2')),

  title        text not null check (char_length(title) between 1 and 200),
  cook_minutes integer check (cook_minutes is null or cook_minutes between 1 and 180),

  -- 「前夜に冷凍庫から冷蔵庫へ移す」。30分・作り置きなし・後半は冷凍肉、が
  -- 揃うと解凍が献立の一部になる。木曜の夕方に凍った肉を見つけた時点で、
  -- その日の献立は成立しない。
  prep_note    text,

  -- 1人前の推定。手で入れた値ではないので、記録に起こすときも推定として扱う
  kcal         real check (kcal is null or kcal >= 0),
  protein_g    real check (protein_g is null or protein_g >= 0),
  fat_g        real check (fat_g is null or fat_g >= 0),
  carb_g       real check (carb_g is null or carb_g >= 0),
  salt_g       real check (salt_g is null or salt_g >= 0),

  -- 「これ食べた」で起きた記録。埋まっていれば、その料理に使った食材と金額を
  -- 料理単位で辿れる（§7 で紐づけを献立より後ろに回した根拠）。
  meal_id      uuid references public.meals(id) on delete set null,

  created_at   timestamptz not null default now(),
  unique (plan_id, day, slot)
);

create index meal_plan_items_plan_idx on public.meal_plan_items(plan_id, day);

-- ── その回の買い物リスト ──────────────────────────────────────

create table public.shopping_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.meal_plans(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,

  -- 定番品（通常価格）は null。特売品だけでは献立が組めない —
  -- 野菜が長ねぎ1品、という週が実際にある。
  flyer_item_id uuid references public.flyer_items(id) on delete set null,

  name       text not null check (char_length(name) between 1 and 200),
  qty        text not null,   -- '500g' / '1パック'。unit と同じ理由で数値にしない
  amount_yen integer check (amount_yen is null or amount_yen >= 0),  -- 2人分・5日ぶん

  -- 冷凍するかは買った瞬間の判断で、献立を見る木曜には間に合わない。
  -- だから献立側ではなく買い物リスト側に持つ。
  -- freeze は Postgres の予約語（type_func_name_keyword）で、引用符なしでは
  -- 列名にできない。毎回 "freeze" と書くより名前を変える。
  to_freeze  boolean not null default false,
  created_at timestamptz not null default now()
);

create index shopping_items_plan_idx on public.shopping_items(plan_id);

-- ── 料理と食材を繋ぐ ─────────────────────────────────────────

create table public.meal_plan_item_ingredients (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.meal_plan_items(id) on delete cascade,
  household_id     uuid not null references public.households(id) on delete cascade,
  -- 家にある米・調味料は買わないので null。名前だけ残す。
  shopping_item_id uuid references public.shopping_items(id) on delete set null,

  name    text not null check (char_length(name) between 1 and 200),
  qty     text,

  -- 主菜のたんぱく源。ここが特売品（shopping_item 経由で flyer_item）を
  -- 指しているかで「特売をメインに使えているか」を判定する。
  is_main boolean not null default false,

  created_at timestamptz not null default now()
);

create index meal_plan_item_ingredients_item_idx
  on public.meal_plan_item_ingredients(item_id);

-- ── 記録の出どころ ───────────────────────────────────────────
--
-- 献立から起こした記録の栄養値はモデルの推定で、手で入れた値ではない。
-- 見分けがつかなくなると、「未入力と 0 を区別する」「PFC の欠けを必ず添える」と
-- 積み上げてきた「合計を信用しすぎない」が静かに壊れる。
--
-- 既存の行は全部手入力なので、既定値は 'manual' でよい。

alter table public.meals
  add column source text not null default 'manual'
    check (source in ('manual', 'plan'));

-- ── 権限 ──────────────────────────────────────────────────────
--
-- Supabase は public スキーマの既定権限で、新しく作った表の権限を
-- anon / authenticated にも与える。要らないものは明示的に外す。
-- ログイン前に読むものは1つも無い。
--
-- 関数は1つも足していないので、init で踏んだ execute の穴（PUBLIC への
-- 既定付与）はここには無い。

revoke all on public.flyers, public.flyer_items, public.meal_plans,
              public.meal_plan_items, public.meal_plan_item_ingredients,
              public.shopping_items from anon;
revoke all on public.flyers, public.flyer_items, public.meal_plans,
              public.meal_plan_items, public.meal_plan_item_ingredients,
              public.shopping_items from authenticated;

-- meals と違って delete を渡す。こちらはモデルが作った導出データで、
-- 「何を食べたか」の記録ではない。取り込み直しと組み直しで作り直せる必要がある。
grant select, insert, update, delete on public.flyers to authenticated;
grant select, insert, update, delete on public.flyer_items to authenticated;
grant select, insert, update, delete on public.meal_plans to authenticated;
grant select, insert, update, delete on public.meal_plan_items to authenticated;
grant select, insert, update, delete on public.meal_plan_item_ingredients to authenticated;
grant select, insert, update, delete on public.shopping_items to authenticated;

-- ── RLS ───────────────────────────────────────────────────────

alter table public.flyers                     enable row level security;
alter table public.flyer_items                enable row level security;
alter table public.meal_plans                 enable row level security;
alter table public.meal_plan_items            enable row level security;
alter table public.shopping_items             enable row level security;
alter table public.meal_plan_item_ingredients enable row level security;

-- init では動作ごとにポリシーを分けたが、それは meals の insert だけ
-- created_by = auth.uid() を足す必要があったため。こちらは4つの動作で条件が
-- 同じなので、表ごとに1本にまとめる。with check を省かず書くのは、
-- 既定に頼ると insert の条件が読んだだけで分からなくなるため。

create policy flyers_household on public.flyers
  for all to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy flyer_items_household on public.flyer_items
  for all to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy meal_plans_household on public.meal_plans
  for all to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy meal_plan_items_household on public.meal_plan_items
  for all to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy shopping_items_household on public.shopping_items
  for all to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

create policy meal_plan_item_ingredients_household on public.meal_plan_item_ingredients
  for all to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));
