/**
 * 献立を貼り付けて取り込む。
 *
 * 組むのは Claude（`.claude/skills/meal-plan`）で、ここはその結果を受ける口。
 * 手で SQL を書かずに済ませるためだけの画面なので、飾らない。
 *
 * JavaScript は置かない。素の <form> から /api/plan/import に POST する。
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentViewer } from '@/lib/household';
import { Nav } from '@/components/nav';

export const dynamic = 'force-dynamic';

/** 形を思い出すための最小の1枚。欄の意味は docs/DESIGN.md §5。 */
const SHAPE = `{
  "shopping_on": "2026-09-13",
  "starts_on": "2026-09-14",
  "ends_on": "2026-09-18",
  "flyer": {
    "store": "コモディイイダ",
    "valid_from": "2026-09-12", "valid_to": "2026-09-15",
    "image_path": "flyers/2026-09-12.webp",
    "image_sha256": "<shasum -a 256 の 64 桁>",
    "items": [
      { "key": "chicken", "name": "若鶏もも肉",
        "price_yen": 89, "price_tax_in": 96, "unit": "100g当り",
        "category": "meat", "origin": "国産",
        "valid_from": "2026-09-13", "valid_to": "2026-09-13",
        "limit_note": "4枚以上", "confidence": 0.9 }
    ]
  },
  "shopping": [
    { "key": "chicken", "flyer_item": "chicken", "name": "若鶏もも肉",
      "qty": "4枚 約1,000g（660g 使用、残りは翌週へ）",
      "amount_yen": 960, "to_freeze": true }
  ],
  "days": [
    { "day": "2026-09-16",
      "main": {
        "title": "鶏もものトマト煮", "cook_minutes": 25,
        "prep_note": "鶏ももを冷凍庫から冷蔵庫へ移す",
        "kcal": 638, "protein_g": 32.3, "fat_g": 30.0,
        "carb_g": 64.5, "salt_g": 1.8,
        "ingredients": [
          { "name": "鶏もも肉", "qty": "330g", "is_main": true, "shopping": "chicken" },
          { "name": "オリーブオイル", "qty": "大さじ1" }
        ]
      },
      "alts": [ { "title": "鶏とトマトのチーズ焼き", "cook_minutes": 25 } ] }
  ]
}`;

export default async function PlanImportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/login?next=%2Fplan%2Fimport');
  if (!viewer.household) redirect('/onboarding');

  const sp = await searchParams;
  const raw = typeof sp.e === 'string' ? sp.e : '';
  const errors = raw ? raw.split('\n').filter(Boolean) : [];

  return (
    <main>
      <Nav current="plan" />
      <h1>献立を取り込む</h1>

      {errors.length > 0 && (
        <div className="warn">
          <p>
            <strong>入れられませんでした。</strong>直してから貼り直してください。
          </p>
          <ul>
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="hint">
        献立を組むのは Claude（<code>.claude/skills/meal-plan</code>）です。出てきた
        JSON をそのまま貼ってください。<strong>作る日だけ</strong> <code>days</code> に
        並べます（作らない日は書きません）。
      </p>

      <form method="post" action="/api/plan/import" className="entry-form">
        <label htmlFor="plan">献立の JSON</label>
        <textarea id="plan" name="plan" rows={16} required spellCheck={false} autoFocus />
        <button type="submit">取り込む</button>
      </form>

      <details>
        <summary>欄の形</summary>
        <pre className="shape">{SHAPE}</pre>
        <p className="note">
          <code>key</code> は取り込むあいだだけの合い札です。買い物リストから
          チラシの商品を <code>flyer_item</code> で、食材から買い物リストを{' '}
          <code>shopping</code> で指します。家にある米や調味料は買わないので、
          指さなくて構いません。
        </p>
        <p className="note">
          チラシが既に入っているなら、<code>flyer</code> の代わりに{' '}
          <code>&quot;flyer_id&quot;</code> を書きます。同じ画像は二度取り込めません。
        </p>
      </details>

      <p className="hint">
        入れたものは<Link href="/plan">献立の画面</Link>に出ます。間違えて入れた回は、
        そのまま置いておいて新しく入れ直して構いません（<code>?plan=</code> で
        行き来できます）。
      </p>
    </main>
  );
}
