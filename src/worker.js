// http→https 強制リダイレクト＋制度データAPI＋静的アセット配信
// 注: wrangler dev では custom_domain 設定により request.url が本番ドメインの
// http:// に見えるため、.dev.vars の DEV フラグでリダイレクトを抑止する
import PREFS from './prefs.json' with { type: 'json' };

const PREFS_BODY = JSON.stringify(PREFS);
const CANONICAL_HOST = 'clababy.com';
// 旧ドメイン。SEO評価の引き継ぎのため301で新ドメインへ転送する（ルートは残し続けること）
const LEGACY_HOSTS = ['kosodate.pint-home.com'];
const ALLOWED_ORIGINS = ['https://clababy.com'];

// AI学習・スクレイピング用クローラーはUAレベルでブロック（robots.txtは助言に過ぎないため強制する）。
// Google-Extended / Applebot-Extended はUAを持たないrobots.txt専用トークンなのでここには含めない。
const AI_BOT_UA = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|Claude-User|anthropic-ai|CCBot|Bytespider|meta-externalagent|FacebookBot|PerplexityBot|Perplexity-User|Diffbot|omgili|cohere-ai|AI2Bot|ImagesiftBot|Timpibot|DuckAssistBot|PanguBot|SemrushBot-OCOB/i;

// サイト内からのfetchのみ許可する簡易チェック。
// Sec-Fetch-Site（モダンブラウザ）を優先し、なければReferer/Originで判定。
// ヘッダ偽装での取得は防げないが、HTML保存・別サイトからの直接埋め込みを弾く。
function isSameSiteRequest(request, isLocal) {
  if (isLocal) return true;
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs) return sfs === 'same-origin';
  const ref = request.headers.get('referer') || request.headers.get('origin') || '';
  return ALLOWED_ORIGINS.some(o => ref === o || ref.startsWith(o + '/'));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isLocal = env.DEV || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (AI_BOT_UA.test(request.headers.get('user-agent') || '')) {
      return new Response('Forbidden', { status: 403 });
    }
    if (url.protocol === 'http:' && !isLocal) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    // 旧ドメインは全パス維持で新ドメインへ301（kosodate.pint-home.com/setagaya-ku/ → clababy.com/setagaya-ku/）
    if (LEGACY_HOSTS.includes(url.hostname)) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/api/prefs') {
      if (!isSameSiteRequest(request, isLocal)) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(PREFS_BODY, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // ブラウザには1時間キャッシュさせ、共有キャッシュ（CDN等）には載せない
          'cache-control': 'private, max-age=3600',
          'x-robots-tag': 'noindex',
          'cross-origin-resource-policy': 'same-origin',
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
