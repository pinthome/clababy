// Workerテスト: fetchハンドラを直接実行し、リダイレクトとAssets委譲を検証
import worker, { isDatacenter } from '../src/worker.js';

// HTMLRewriterはWorkers専用グローバル。Node実行では最小スタブで「変換したか」だけ見る。
// worker.js は fetch 内でしか参照しないので、import後に生やせば間に合う
globalThis.HTMLRewriter = class {
  constructor() { this.selectors = []; }
  on(sel) { this.selectors.push(sel); return this; }
  transform(res) { res.transformedBy = this.selectors; return res; }
};

let failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('ok:', msg); }
  else { console.error('FAIL:', msg); failed = 1; }
};

const makeEnv = dev => {
  const calls = [];
  const env = {
    ASSETS: { fetch: req => { calls.push(req.url); return Promise.resolve(new Response('asset-body')); } },
  };
  if (dev !== undefined) env.DEV = dev;
  return { env, calls };
};

// 本番: httpはhttpsへ301（パス・クエリを維持）し、Assetsには委譲しない
{
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request('http://clababy.com/foo?a=1'), env);
  assert(res.status === 301, `本番http: 301リダイレクト（実際: ${res.status}）`);
  assert(res.headers.get('location') === 'https://clababy.com/foo?a=1', `本番http: Locationがhttps＋パス維持（実際: ${res.headers.get('location')}）`);
  assert(calls.length === 0, '本番http: Assetsに委譲しない');
}

// 本番: httpsはそのままAssetsに委譲する
{
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request('https://clababy.com/'), env);
  assert(res.status === 200 && await res.text() === 'asset-body', '本番https: Assetsのレスポンスを返す');
  assert(calls.length === 1, '本番https: Assetsに1回委譲する');
}

// wrangler dev: request.urlが本番ドメインのhttpに見えてもDEVフラグでリダイレクトしない（無限リダイレクト再発防止）
{
  const { env, calls } = makeEnv('true');
  const res = await worker.fetch(new Request('http://clababy.com/'), env);
  assert(res.status === 200 && calls.length === 1, 'DEV時: httpでもリダイレクトせずAssetsに委譲する');
}

// localhost/127.0.0.1のhttpはDEVフラグなしでもリダイレクトしない
for (const host of ['localhost:8787', '127.0.0.1:8787']) {
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request(`http://${host}/`), env);
  assert(res.status === 200 && calls.length === 1, `${host}: httpでもリダイレクトしない`);
}

// ---- 旧ドメイン（kosodate.pint-home.com）→ 新ドメインへの301 ----
{
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request('https://kosodate.pint-home.com/'), env);
  assert(res.status === 301 && res.headers.get('location') === 'https://clababy.com/' && calls.length === 0, '旧ドメイン: トップを301転送');
}
{
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request('https://kosodate.pint-home.com/setagaya-ku/?utm_source=ig'), env);
  assert(res.status === 301 && res.headers.get('location') === 'https://clababy.com/setagaya-ku/?utm_source=ig' && calls.length === 0, '旧ドメイン: パス・クエリ維持で301転送');
}
{
  const { env } = makeEnv();
  const res = await worker.fetch(new Request('http://kosodate.pint-home.com/foo'), env);
  assert(res.status === 301 && res.headers.get('location') === 'https://kosodate.pint-home.com/foo', '旧ドメインhttp: まずhttps化（次のリクエストで新ドメインへ）');
}

// ---- AIクローラーのUAブロック ----
for (const ua of ['GPTBot/1.0 (+https://openai.com/gptbot)', 'Mozilla/5.0 AppleWebKit compatible; ClaudeBot/1.0', 'CCBot/2.0', 'PerplexityBot/1.0', 'Bytespider']) {
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request('https://clababy.com/', { headers: { 'user-agent': ua } }), env);
  assert(res.status === 403 && calls.length === 0, `AIボット拒否: ${ua.split('/')[0]} は403`);
}
// 通常ブラウザ・検索エンジンは通す
for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)']) {
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request('https://clababy.com/', { headers: { 'user-agent': ua } }), env);
  assert(res.status === 200 && calls.length === 1, `通常UA許可: ${ua.slice(0, 40)}...`);
}

// ---- データセンター由来アクセスの計測抑止（GA4のボット汚染対策） ----
// Assetsがtext/htmlを返す版（本番のHTML配信を模す）
const makeHtmlEnv = () => ({
  ASSETS: { fetch: () => Promise.resolve(new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) },
});
// 本番では request.cf をCloudflareランタイムが付ける。Nodeのnew Requestはinitから引き継がないため後付けする
const withAsn = (url, asn) => Object.assign(new Request(url), { cf: { asn } });

// ASN判定: クラウド事業者はtrue、一般ISPとcf無し（dev/テスト）はfalse
for (const [asn, want, label] of [[16509, true, 'AWS'], [15169, true, 'Google Cloud'], [24940, true, 'Hetzner'], [2516, false, 'KDDI'], [4713, false, 'NTT OCN'], [17676, false, 'SoftBank']]) {
  assert(isDatacenter(withAsn('https://clababy.com/', asn)) === want, `ASN判定: ${label}(${asn}) は ${want}`);
}
assert(isDatacenter(new Request('https://clababy.com/')) === false, 'ASN判定: cf無し（wrangler dev・テスト）は計測する');

// データセンター＋HTML → __NOTRACK を注入するためhead要素を変換する
{
  const res = await worker.fetch(withAsn('https://clababy.com/', 16509), makeHtmlEnv());
  assert(res.transformedBy?.includes('head'), 'データセンター＋HTML: head を変換して __NOTRACK を注入');
}
// 通常ISP＋HTML → 変換せずそのまま返す（実ユーザーは計測する）
{
  const res = await worker.fetch(withAsn('https://clababy.com/', 2516), makeHtmlEnv());
  assert(res.transformedBy === undefined, '通常ISP＋HTML: 変換せずそのまま返す');
}
// データセンターでもHTML以外（画像・JS等）は変換しない
{
  const { env } = makeEnv(); // asset-body は text/plain
  const res = await worker.fetch(withAsn('https://clababy.com/img/logo.png', 16509), env);
  assert(res.transformedBy === undefined, 'データセンター＋非HTML: 変換しない');
}
// UAブロック対象のボットはASN判定より前に403（計測抑止以前に配信しない）
{
  const { env, calls } = makeEnv();
  const req = Object.assign(new Request('https://clababy.com/', { headers: { 'user-agent': 'Amazonbot/0.1' } }), { cf: { asn: 16509 } });
  const res = await worker.fetch(req, env);
  assert(res.status === 403 && calls.length === 0, 'Amazonbot: ASN判定に到達せず403');
}

// ---- /api/prefs: 同一オリジンのfetchのみ許可 ----
const API = 'https://clababy.com/api/prefs';

// Sec-Fetch-Site: same-origin → 200＋212自治体のJSON
{
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request(API, { headers: { 'sec-fetch-site': 'same-origin' } }), env);
  assert(res.status === 200, `API: same-originで200（実際: ${res.status}）`);
  const prefs = await res.json();
  const total = Object.values(prefs).reduce((s, c) => s + c.munis.length, 0);
  assert(total === 212, `API: 212自治体を返す（実際: ${total}）`);
  assert(res.headers.get('cache-control') === 'private, max-age=3600', 'API: 共有キャッシュに載らないcache-control');
  assert(res.headers.get('cross-origin-resource-policy') === 'same-origin', 'API: CORPヘッダーで他サイト埋め込みを禁止');
  assert(calls.length === 0, 'API: Assetsに委譲しない');
}

// Sec-Fetch-Siteなし＋自サイトReferer → 200（旧ブラウザ向けフォールバック）
{
  const { env } = makeEnv();
  const res = await worker.fetch(new Request(API, { headers: { referer: 'https://clababy.com/' } }), env);
  assert(res.status === 200, `API: 自サイトRefererで200（実際: ${res.status}）`);
}

// ヘッダなし（curl等の直接アクセス） → 403
{
  const { env } = makeEnv();
  const res = await worker.fetch(new Request(API), env);
  assert(res.status === 403, `API: ヘッダなしは403（実際: ${res.status}）`);
}

// クロスサイト（他サイトからの埋め込み・直リンク） → 403
{
  const { env } = makeEnv();
  const res = await worker.fetch(new Request(API, { headers: { 'sec-fetch-site': 'cross-site', referer: 'https://evil.example.com/' } }), env);
  assert(res.status === 403, `API: クロスサイトは403（実際: ${res.status}）`);
}

// Refererの前方一致偽装（clababy.com.evil.com） → 403
{
  const { env } = makeEnv();
  const res = await worker.fetch(new Request(API, { headers: { referer: 'https://clababy.com.evil.example.com/' } }), env);
  assert(res.status === 403, `API: 類似ドメインRefererは403（実際: ${res.status}）`);
}

// DEV時はチェックなしで200（wrangler devでの動作確認用）
{
  const { env } = makeEnv('true');
  const res = await worker.fetch(new Request('http://localhost:8787/api/prefs'), env);
  assert(res.status === 200, `API: DEV時はRefererなしでも200（実際: ${res.status}）`);
}

process.exit(failed);
