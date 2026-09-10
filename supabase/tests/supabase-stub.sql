-- 本番の Supabase には既にあるもののうち、マイグレーションが依存する最小限。
-- 手元の素の Postgres で RLS を試すためだけに使う。migrations には入れない。
create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- PostgREST が request.jwt.claims に JWT を入れる。Supabase の auth.uid() と同じ。
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public, auth to anon, authenticated;
grant select on auth.users to authenticated;

-- Supabase は public スキーマの既定権限として、あとから作られた関数の execute を
-- anon / authenticated にも与える。これを再現しないと、権限の試験が本番より甘くなる
-- （PUBLIC の分だけ外せば通ってしまい、本番では anon が呼べるままになる）。
alter default privileges in schema public grant execute on functions to anon, authenticated;
