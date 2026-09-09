/**
 * このリクエストが届いた先の URL の根っこ。
 *
 * new URL(req.url).origin だけだと、Vercel のようにプロキシの内側で動く場所で
 * 内部のホスト名（localhost:3000 など）になる。マジックリンクの戻り先に
 * それが入ると、メールのリンクを踏んでも自分のサイトに帰ってこない。
 */
export function originOf(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * 戻り先は同じサイトの中だけ。'//evil.example' のような「プロトコル相対」も
 * 弾く（ブラウザは別サイトとして解釈する）。
 */
export function safeNext(v: unknown): string {
  const s = String(v ?? '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}
