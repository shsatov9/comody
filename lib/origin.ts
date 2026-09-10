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
 * 戻り先は同じサイトの中だけ。
 *
 * '/' で始まるものだけを通し、2文字目が区切りのものは弾く。
 *
 * '//evil.example' は「プロトコル相対」で、ブラウザは別サイトとして解釈する。
 * バックスラッシュも同じ扱いにしないといけない。URL の仕様は http(s) のような
 * scheme で '\' を '/' に畳むので、'/\evil.example' は new URL() を通した時点で
 * ホストが evil.example になる。'//' だけを見ていると、ここから外に出られる。
 *
 * 外に出られると、ログインした直後の人を別サイトに着地させられる。セッションは
 * Cookie にあるので鍵は渡らないが、「入れた直後の画面」を装う土台にはなる。
 */
export function safeNext(v: unknown): string {
  const s = String(v ?? '');
  return /^\/(?![/\\])/.test(s) ? s : '/';
}
