-- Phase 1: 所帯・利用者・食べたものの記録。
--
-- ## RLS はここでの防御そのもの
--
-- Supabase は public スキーマのテーブルを PostgREST で自動的に REST API として
-- 公開する。anon キーはブラウザに埋め込む前提の公開キーなので、秘密にすることで
-- 守ることはできない。テーブルを作った時点で、キーを知っていれば誰でも
-- 読み書きできる状態になる。
--
-- このアプリは anon キー + 利用者のセッションで Postgres に入る（サービスロールを
-- 使わない）ので、**行を絞っているのは RLS だけ**。アプリ側のコードは
-- 権限判定をしない。ここが緩ければ、画面をいくら作り込んでも意味がない。

create extension if not exists pgcrypto;

-- ── 所帯 ──────────────────────────────────────────────────────
--
-- 夫婦2人で1つの記録を見る。利用者ごとに仕切ると相手の記録が見えないアプリに
-- なり、仕切らないと他人の記録まで見える。所帯は、このアプリで複雑さを足す
-- 価値のある唯一の場所。

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  -- 相手を招く合い言葉。uuid を渡す形にすると、URL やチャットに貼った
  -- ものがそのまま鍵になる。口で言える長さにして、紛らわしい文字を外す。
  join_code  text not null unique check (join_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members(user_id);

-- ── 利用者ごとの設定 ──────────────────────────────────────────

create table public.profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  display_name    text check (display_name is null or char_length(display_name) <= 60),
  -- 献立の提案と、目標値の見え方に効く。Phase 4 まで使い道は無いが、
  -- 後から足すと既存の行の意味が変わるので先に置く。
  pregnant        boolean not null default false,
  target_kcal     integer check (target_kcal is null or target_kcal between 0 and 10000),
  target_protein_g real   check (target_protein_g is null or target_protein_g between 0 and 1000),
  updated_at      timestamptz not null default now()
);

-- ── 食べたもの ────────────────────────────────────────────────

create table public.meals (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,

  -- 地域の日付。時刻から導出しない。「今日」がどの日かは端末側の事実で、
  -- サーバ（Vercel は UTC）の時計で決めると日本時間の朝9時まで前日になる。
  day          date not null,
  at           timestamptz not null,
  title        text not null check (char_length(title) between 1 and 200),

  -- すべて nullable。未入力と 0 を区別する。カロリーが分からないから
  -- 記録しない、が一番もったいないので、料理名だけで記録できるようにする。
  kcal         real check (kcal is null or kcal >= 0),
  protein_g    real check (protein_g is null or protein_g >= 0),
  fat_g        real check (fat_g is null or fat_g >= 0),
  carb_g       real check (carb_g is null or carb_g >= 0),
  salt_g       real check (salt_g is null or salt_g >= 0),

  -- 論理削除。消した記録も日の詳細では追えるようにする。
  -- 読み出しは必ず deleted_at is null で絞る。
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index meals_household_day_idx
  on public.meals(household_id, day) where deleted_at is null;

-- ── 自分の所帯 ────────────────────────────────────────────────
--
-- ポリシーの中から household_members を直接引くと、household_members 自身の
-- ポリシーがまた household_members を引いて「infinite recursion detected in
-- policy」で落ちる。security definer にすると関数の中では RLS が効かないので、
-- 再帰しない。
--
-- search_path を空にして全部修飾するのは、security definer 関数の定石。
-- 呼び出し側が search_path を差し替えて、別スキーマの同名テーブルを
-- 読ませることを防ぐ。

create or replace function public.my_household_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

-- ── 所帯を作る・入る ──────────────────────────────────────────
--
-- households / household_members に insert のポリシーを置かないのは、
-- 「自分を追加してよい」を素直に書くと、所帯の id さえ分かれば誰でも
-- 入れてしまうため。作成と参加はこの2つの関数からだけ通す。

create or replace function public.new_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  loop
    select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                             (floor(random() * 32) + 1)::int, 1), '')
      into v_code
      from generate_series(1, 8);
    exit when not exists (select 1 from public.households where join_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.create_household(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;

  insert into public.households (name, join_code, created_by)
  values (coalesce(nullif(btrim(p_name), ''), 'わが家'), public.new_join_code(), v_uid)
  returning id into v_id;

  insert into public.household_members (household_id, user_id) values (v_id, v_uid);
  return v_id;
end;
$$;

create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;

  select id into v_id
    from public.households
   where join_code = upper(btrim(p_code));

  if v_id is null then
    -- 合い言葉が合っているかどうか以上のことは返さない。
    raise exception '合い言葉が違います' using errcode = 'P0002';
  end if;

  insert into public.household_members (household_id, user_id)
  values (v_id, v_uid)
  on conflict do nothing;

  return v_id;
end;
$$;

-- ── 権限 ──────────────────────────────────────────────────────
--
-- Supabase は既定で anon にも権限を与える。RLS で止まるとはいえ、
-- 与える必要が無いので明示的に外す。ログイン前に読むものは1つも無い。

revoke all on public.households, public.household_members, public.profiles, public.meals from anon;
revoke all on public.households, public.household_members, public.profiles, public.meals from authenticated;

grant select, update on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.meals to authenticated;

revoke all on function public.create_household(text), public.join_household(text),
                     public.my_household_ids(), public.new_join_code() from anon, authenticated;
grant execute on function public.create_household(text), public.join_household(text) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles          enable row level security;
alter table public.meals             enable row level security;

-- 所帯そのもの。名前は変えられるが、作成と削除は関数か管理者だけ。
create policy households_select on public.households
  for select to authenticated
  using (id in (select public.my_household_ids()));

create policy households_update on public.households
  for update to authenticated
  using (id in (select public.my_household_ids()))
  with check (id in (select public.my_household_ids()));

-- 誰が同じ所帯にいるか。抜けるのは自分の行だけ。
create policy household_members_select on public.household_members
  for select to authenticated
  using (household_id in (select public.my_household_ids()));

create policy household_members_delete on public.household_members
  for delete to authenticated
  using (user_id = auth.uid());

-- 設定は本人だけ。同じ所帯でも他人の目標値は見せない。
create policy profiles_own on public.profiles
  for select to authenticated using (user_id = auth.uid());

create policy profiles_insert on public.profiles
  for insert to authenticated with check (user_id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 記録は所帯で共有する。書くときも自分の所帯にしか置けない。
create policy meals_select on public.meals
  for select to authenticated
  using (household_id in (select public.my_household_ids()));

create policy meals_insert on public.meals
  for insert to authenticated
  with check (
    household_id in (select public.my_household_ids())
    and created_by = auth.uid()
  );

-- 消すのは論理削除（update）。物理削除の権限は与えていない。
create policy meals_update on public.meals
  for update to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));
