/**
 * どの画面からでも同じ場所に出る案内。
 * リンクだけで完結させる（クライアント側の JavaScript を持たない）。
 */
import Link from 'next/link';

export function Nav({ current }: { current: 'today' | 'plan' | 'record' | 'settings' }) {
  return (
    <nav className="nav">
      <div className="nav-links">
        <Link href="/" aria-current={current === 'today' ? 'page' : undefined}>
          今日
        </Link>
        <Link href="/plan" aria-current={current === 'plan' ? 'page' : undefined}>
          献立
        </Link>
        <Link className="add" href="/record" aria-current={current === 'record' ? 'page' : undefined}>
          ＋記録
        </Link>
        <Link href="/settings" aria-current={current === 'settings' ? 'page' : undefined}>
          設定
        </Link>
      </div>
      <form method="post" action="/auth/signout" className="logout">
        <button type="submit">ログアウト</button>
      </form>
    </nav>
  );
}
