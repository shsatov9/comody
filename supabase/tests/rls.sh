#!/usr/bin/env bash
#
# RLS が所帯を隔てているかを、攻撃側から確かめる。
#
# このアプリは anon キー + 利用者のセッションで Postgres に入るので、
# **行を絞っているのは RLS だけ**。アプリのコードは権限判定をしない。
# ここが緩ければ画面をいくら作り込んでも意味がないので、独立して試せるようにする。
#
#   PGDATABASE=comody_test ./supabase/tests/rls.sh
#
# psql が繋がる空のデータベースが要る。中身は消される。
set -euo pipefail

DB="${PGDATABASE:-comody_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PSQL=(psql -d "$DB" -v ON_ERROR_STOP=1 -tAq)

fail=0
check() { # check <見出し> <期待> <実際>
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"
  else
    printf '  FAIL %s\n       期待: %s\n       実際: %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

# 利用者 <uid> として1文流す。失敗したらエラー行を返す。
as() {
  "${PSQL[@]}" 2>&1 <<SQL || true
begin;
set local request.jwt.claims = '{"sub":"$1"}';
set local role authenticated;
$2
commit;
SQL
}
anon_sql() { "${PSQL[@]}" 2>&1 <<SQL || true
begin; set local role anon; $1 commit;
SQL
}
first() { head -1 | cut -c1-120; }

echo "スキーマを作り直す"
"${PSQL[@]}" -c 'drop schema if exists public cascade; create schema public;' \
             -c 'drop schema if exists auth cascade;' > /dev/null
"${PSQL[@]}" -f "$HERE/supabase-stub.sql" > /dev/null
for f in "$HERE"/../migrations/*.sql; do "${PSQL[@]}" -f "$f" > /dev/null; done

A=$("${PSQL[@]}" -c "insert into auth.users(email) values ('a@example.com') returning id")
B=$("${PSQL[@]}" -c "insert into auth.users(email) values ('b@example.com') returning id")
HA=$(as "$A" "select public.create_household('A家');" | first)
HB=$(as "$B" "select public.create_household('B家');" | first)

as "$A" "insert into public.meals(household_id, created_by, day, at, title, kcal)
         values ('$HA','$A','2026-09-09', now(), 'A家の晩ごはん', 640);" > /dev/null
as "$B" "insert into public.meals(household_id, created_by, day, at, title, kcal)
         values ('$HB','$B','2026-09-09', now(), 'B家の晩ごはん', 500);" > /dev/null

echo "所帯の仕切り"
check "自分の所帯の記録だけが見える" \
  "A家の晩ごはん" "$(as "$A" "select string_agg(title, ',') from public.meals;" | first)"
check "他所帯へは書き込めない" "ERROR" \
  "$(as "$A" "insert into public.meals(household_id,created_by,day,at,title)
              values ('$HB','$A','2026-09-09',now(),'侵入');" | grep -o ERROR | first)"
check "created_by を他人に偽装できない" "ERROR" \
  "$(as "$A" "insert into public.meals(household_id,created_by,day,at,title)
              values ('$HA','$B','2026-09-09',now(),'なりすまし');" | grep -o ERROR | first)"
check "他所帯の記録は書き換わらない" "0" \
  "$(as "$A" "update public.meals set title='書き換え' where household_id='$HB';
              select count(*) from public.meals where title='書き換え';" | first)"
check "他所帯の名前は変えられない" "0" \
  "$(as "$A" "update public.households set name='乗っ取り' where id='$HB';
              select count(*) from public.households where name='乗っ取り';" | first)"
check "household_members に直接入れない" "ERROR" \
  "$(as "$A" "insert into public.household_members(household_id,user_id) values ('$HB','$A');" \
     | grep -o ERROR | first)"

echo "設定は本人だけ"
as "$B" "insert into public.profiles(user_id,target_kcal) values ('$B',2200);" > /dev/null
check "他人の設定は見えない" "0" "$(as "$A" "select count(*) from public.profiles;" | first)"

echo "ログイン前"
check "anon は meals を読めない" "ERROR" \
  "$(anon_sql "select count(*) from public.meals;" | grep -o ERROR | first)"
check "anon は households を読めない" "ERROR" \
  "$(anon_sql "select count(*) from public.households;" | grep -o ERROR | first)"

# 関数は PUBLIC に execute が付いた状態で生まれる。ロールを名指しした revoke では
# それが外れない。実行してみても auth.uid() が null で落ちるだけなので、エラーの
# 有無では「取り上げられているか」を見分けられない。権限そのものを見る。
for fn in 'create_household(text)' 'join_household(text)' 'my_household_ids()' 'new_join_code()'; do
  check "anon は $fn を呼べない" "f" \
    "$("${PSQL[@]}" -c "select has_function_privilege('anon','public.$fn','execute');" | first)"
done
# 逆にこれを取り上げると、ポリシーの using 節ごと落ちる。上と対で押さえておく。
check "authenticated は my_household_ids を呼べる" "t" \
  "$("${PSQL[@]}" -c "select has_function_privilege('authenticated','public.my_household_ids()','execute');" | first)"

echo "合い言葉"
check "違う合い言葉では入れない" "ERROR" \
  "$(as "$A" "select public.join_household('ZZZZZZZZ');" | grep -o ERROR | first)"
CODE=$("${PSQL[@]}" -c "select join_code from public.households where id='$HA'")
as "$B" "select public.join_household('$CODE');" > /dev/null
check "合い言葉が合えば相手の記録も見える" "A家の晩ごはん,B家の晩ごはん" \
  "$(as "$B" "select string_agg(title, ',' order by title) from public.meals;" | first)"
check "入られた側に相手の記録は増えない" "A家の晩ごはん" \
  "$(as "$A" "select string_agg(title, ',') from public.meals;" | first)"

echo
[ "$fail" = 0 ] && echo "すべて通った" || { echo "失敗あり"; exit 1; }
