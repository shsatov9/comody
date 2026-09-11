-- 2026-09-14(月)・16(水)・18(金) の夕食。最初の1週ぶんの種データ。
--
-- はじめ平日5日で組んだが「5日間自炊はつらい」ので3日にした。作らない日を
-- 後から諦めるのではなく最初から織り込む（docs/DESIGN.md §5）。
-- 火・木は行を作らない。画面が「作らない日」と出す。
--
-- チラシの取り込みも献立の生成もまだ実装が無いので手で入れる。実装ができたら
-- 要らなくなるファイル。
--
-- 栄養値は lib/food（food リポジトリから写した成分表）で計算した1人前。
-- 代替案は計算していないので null のまま入れる。0 を入れると平均が狂う。
--
-- 何度流しても同じ状態になるよう、先に消してから入れる。

begin;

-- ── 前に入れたぶんを落とす（meal_plans から下は cascade で消える）──
delete from public.meal_plans where starts_on = '2026-09-14';
delete from public.flyers where image_sha256 = '588395cb3b802da8f00db92635ab10c81e6491ff62f7e46b7c821238bd45e472';

-- ── チラシ ──
-- image_path の先の Storage はまだ作っていない。パスは決めだけ置いておく。
insert into public.flyers (id, household_id, created_by, store, valid_from, valid_to,
                           image_path, image_sha256, status, read_at)
values ('746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), (select user_id from public.household_members order by joined_at limit 1), 'コモディイイダ', '2026-09-12', '2026-09-15',
        'flyers/2026-09-12.webp', '588395cb3b802da8f00db92635ab10c81e6491ff62f7e46b7c821238bd45e472', 'done', now());

-- ── 読み取った商品（9/13 日限り。大きい表示のものだけ）──
insert into public.flyer_items (id, flyer_id, household_id, name, price_yen, price_tax_in,
                               unit, category, origin, valid_from, valid_to, limit_note,
                               confidence, raw) values
  ('6c66d49b-91bc-44dc-911f-0395494a06a2', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '若鶏もも肉', 89, 96, '100g当り', 'meat', '国産', '2026-09-13', '2026-09-13', '4枚以上。解凍品を含む', 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('e1e1cc80-61f3-4ff4-8616-c4090f433e64', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '和牛肩焼肉盛合わせ(ミスジ入り)', 599, 646, '100g当り', 'meat', '国産', '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('a28f4858-2757-4269-96ca-801bfabf8f97', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), 'トマトパック', 350, 378, '1パック', 'produce', '岩手産他', '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('eb58182b-b470-43e1-bc1a-cb0ba81014bd', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), 'シャインマスカット 大房', 1000, 1080, '1房', 'produce', '山梨産他', '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('17ffc966-eda6-4007-804f-44a580de8432', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), 'まぐろたたき刺身用', 598, 645, '200g入1パック', 'seafood', null, '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('99155c07-fbbf-4dd7-b2c5-5545e8ba61ed', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), 'まぐろ中落ち刺身用', 880, 950, '200g入1パック', 'seafood', null, '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('1e19341d-dea7-4cdf-8bc5-26b3a9368dfe', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '養殖真鯛刺身用', 479, 517, '100g当り', 'seafood', '愛媛産他', '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('93f6dec4-09cc-42db-ab77-02e42f52dc81', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '刻みめかぶ', 139, 150, '100g当り', 'other', '宮城県原料', '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('ca05bd1e-ca11-4719-ba96-93f9679cbb47', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '炙り焼きチキン', 550, 594, '10個入1パック', 'deli', null, '2026-09-13', '2026-09-13', null, 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('d384db95-81ac-40e7-9972-fdeb1ba00352', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), 'かどや 純正ごま油(200g)', 258, 278, '1本', 'grocery', null, '2026-09-13', '2026-09-13', '1家族様1点限り', 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('5447c7ef-8f6a-4907-95ce-9f5d3601b6d6', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '茨城県産 新米コシヒカリ(5kg)', 2180, 2354, '1袋', 'grocery', '茨城県産', '2026-09-13', '2026-09-13', '先着100名様限定・1家族様1点限り', 0.9, '{"source":"9/13 日限り"}'::jsonb),
  ('ada45f80-06d2-4d47-bd1d-a6ad63a8e9b0', '746d7588-3b58-46e3-a670-a32015511152', (select id from public.households order by created_at limit 1), '大阪王将 羽根つき餃子(318g)', 158, 170, '1袋', 'deli', null, '2026-09-13', '2026-09-13', '1家族様各2点限り', 0.9, '{"source":"9/13 日限り"}'::jsonb);

-- ── 献立1回ぶん。starts_on/ends_on は作らない日を含んだ週の幅 ──
insert into public.meal_plans (id, household_id, flyer_id, created_by,
                              shopping_on, starts_on, ends_on, status)
values ('436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '746d7588-3b58-46e3-a670-a32015511152', (select user_id from public.household_members order by joined_at limit 1), '2026-09-13', '2026-09-14', '2026-09-18', 'done');

-- ── 作る日だけ行を置く（月・水・金）──
insert into public.meal_plan_items (id, plan_id, household_id, day, slot, title,
                                   cook_minutes, prep_note, kcal, protein_g, fat_g,
                                   carb_g, salt_g) values
  ('661288f7-562b-453c-9fea-a2da0c63c355', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-14', 'main', 'まぐろたたきの漬け丼 / めかぶ / わかめ味噌汁', 10, null, 448, 33.2, 2.6, 75.4, 3.1),
  ('ac9071e7-888c-4e2c-9396-ca46b31df680', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-14', 'alt1', 'まぐろの軽い焼きステーキ', 15, null, null, null, null, null, null),
  ('67bb6857-ef32-4c02-b147-bf881ccb4c1a', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-14', 'alt2', 'まぐろの山かけ丼', 10, null, null, null, null, null, null),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-16', 'main', '鶏もものトマト煮', 25, '鶏ももを冷凍庫から冷蔵庫へ移す', 638, 32.3, 30.0, 64.5, 1.8),
  ('92cff698-4033-4c41-b637-8592baaf3174', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-16', 'alt1', '鶏とトマトのチーズ焼き', 25, '鶏ももを冷凍庫から冷蔵庫へ移す', null, null, null, null, null),
  ('a5b41aba-8aa4-4a98-9428-593c4d6216d9', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-16', 'alt2', '鶏のトマト南蛮', 25, '鶏ももを冷凍庫から冷蔵庫へ移す', null, null, null, null, null),
  ('8a70069a-1838-4de5-8863-b06041344354', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-18', 'main', '鶏ももの照り焼き / キャベツ千切り', 20, '鶏ももを冷凍庫から冷蔵庫へ移す', 653, 33.6, 27.0, 70.2, 2.9),
  ('ca5d71d7-4289-4384-a784-3cf3423a317a', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-18', 'alt1', '鶏の唐揚げ風（揚げ焼き）', 25, '鶏ももを冷凍庫から冷蔵庫へ移す', null, null, null, null, null),
  ('548cf69d-b02d-4033-961b-fe22a1554cf8', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '2026-09-18', 'alt2', '鶏ももの照り焼き丼', 20, '鶏ももを冷凍庫から冷蔵庫へ移す', null, null, null, null, null);

-- ── 買い物リスト（2人分・3日ぶん）──
insert into public.shopping_items (id, plan_id, household_id, flyer_item_id,
                                  name, qty, amount_yen, to_freeze) values
  ('83d056bf-9200-4eaf-acb2-d38b98764fab', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '6c66d49b-91bc-44dc-911f-0395494a06a2', '若鶏もも肉', '4枚 約1,000g（660g 使用、残りは翌週へ）', 960, true),
  ('dbc2eec6-0556-4b82-9db5-6e0421adabfc', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '17ffc966-eda6-4007-804f-44a580de8432', 'まぐろたたき', '200g入1パック', 645, false),
  ('78781438-d025-46bf-97cc-6f16e68a9563', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), 'a28f4858-2757-4269-96ca-801bfabf8f97', 'トマトパック', '1パック', 378, false),
  ('fac146c7-0553-4120-8098-ab57028a6e3c', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), '93f6dec4-09cc-42db-ab77-02e42f52dc81', '刻みめかぶ', '100g', 150, false),
  ('633fc85f-c487-49f8-93ee-ac72cd4c008b', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), null, '玉ねぎ', '2個', 140, false),
  ('24c0e0eb-e792-49cb-a299-b71394dc3a1f', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), null, 'キャベツ', '1/2玉', 150, false),
  ('52c3a1dd-a13f-4238-9382-3d96a42726db', '436e95c8-4675-41eb-abb4-645a962fd026', (select id from public.households order by created_at limit 1), null, '長ねぎ', '1束', 200, false);

-- ── 料理と食材（本命のぶんだけ）──
-- is_main が特売品を指しているかで「特売をメインに使えているか」が分かる。
insert into public.meal_plan_item_ingredients (item_id, household_id, shopping_item_id,
                                              name, qty, is_main) values
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), 'dbc2eec6-0556-4b82-9db5-6e0421adabfc', 'まぐろ', '200g', true),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), null, 'ごはん', '360g', false),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), null, '醤油', '大さじ1', false),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), null, 'みりん', '大さじ1', false),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), 'fac146c7-0553-4120-8098-ab57028a6e3c', 'めかぶ', '100g', false),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), null, '味噌', '大さじ1', false),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), null, '乾燥わかめ', '2g', false),
  ('661288f7-562b-453c-9fea-a2da0c63c355', (select id from public.households order by created_at limit 1), '52c3a1dd-a13f-4238-9382-3d96a42726db', '長ねぎ', '20g', false),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', (select id from public.households order by created_at limit 1), '83d056bf-9200-4eaf-acb2-d38b98764fab', '鶏もも肉', '330g', true),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', (select id from public.households order by created_at limit 1), '78781438-d025-46bf-97cc-6f16e68a9563', 'トマト', '200g', false),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', (select id from public.households order by created_at limit 1), '633fc85f-c487-49f8-93ee-ac72cd4c008b', '玉ねぎ', '100g', false),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', (select id from public.households order by created_at limit 1), null, 'オリーブオイル', '大さじ1', false),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', (select id from public.households order by created_at limit 1), null, '塩', '小さじ1/2', false),
  ('8a6a407b-0165-4c53-846c-eb928347b79e', (select id from public.households order by created_at limit 1), null, 'ごはん', '300g', false),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), '83d056bf-9200-4eaf-acb2-d38b98764fab', '鶏もも肉', '330g', true),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), null, '醤油', '大さじ2', false),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), null, 'みりん', '大さじ2', false),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), null, '砂糖', '小さじ1', false),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), null, 'サラダ油', '大さじ1/2', false),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), '24c0e0eb-e792-49cb-a299-b71394dc3a1f', 'キャベツ', '150g', false),
  ('8a70069a-1838-4de5-8863-b06041344354', (select id from public.households order by created_at limit 1), null, 'ごはん', '300g', false);

commit;
