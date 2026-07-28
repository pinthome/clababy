// スモークテスト: ソースHTML構造・制度データ・計算ロジック・CSP整合・ビルド生成物を検証
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const built = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const prefs = JSON.parse(readFileSync(new URL('../src/prefs.json', import.meta.url), 'utf8'));
let failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('ok:', msg); }
  else { console.error('FAIL:', msg); failed = 1; }
};

assert(html.startsWith('<!DOCTYPE html>'), 'DOCTYPE宣言がある');
assert(html.includes('<html lang="ja">'), 'lang="ja"が指定されている');
assert(html.includes('</body>') && html.includes('</html>'), 'body/htmlが閉じている');

// ---- 制度データ（src/prefs.json） ----
{
  const names = Object.keys(prefs);
  assert(names.length === 4, '4都県が存在する');
  const total = Object.values(prefs).reduce((s, c) => s + c.munis.length, 0);
  assert(total === 212, `212自治体・島しょ部含む（実際: ${total}）`);
  const islands = ['大島町', '利島村', '新島村', '神津島村', '三宅村', '御蔵島村', '八丈町', '青ヶ島村', '小笠原村'];
  const tokyoNames = new Set(prefs['東京都'].munis.map(d => d.name));
  assert(islands.every(n => tokyoNames.has(n)), '島しょ部9自治体が収録されている');
  for (const [pref, conf] of Object.entries(prefs)) {
    const bad = conf.munis.filter(d => !d.name || !d.iryoChip || !d.kyushokuChip || !Array.isArray(d.birth) || !Array.isArray(d.bday));
    assert(bad.length === 0, `${pref}: 全自治体に必須フィールドがある${bad.length ? '（欠落: ' + bad.map(d => d.name).join(',') + '）' : ''}`);
  }
  const all = Object.values(prefs).flatMap(c => c.munis);

  // よみがな（かな検索用）が全自治体でひらがな設定済み
  const badYomi = all.filter(d => !/^[ぁ-ゖー]+$/.test(d.yomi || ''));
  assert(badYomi.length === 0, `yomiが全自治体でひらがな${badYomi.length ? '（不正: ' + badYomi.map(d => d.name).join(',') + '）' : ''}`);
  const setagaya = all.find(d => d.name === '世田谷区');
  assert(setagaya && setagaya.yomi === 'せたがやく', '世田谷区のyomiがせたがやく');

  // 待機児童数（保育所）が全自治体で設定済み
  const noHoiku = all.filter(d => d.hoiku == null);
  assert(noHoiku.length === 0, `保育所待機児童数が全自治体で非null${noHoiku.length ? '（欠落: ' + noHoiku.map(d => d.name).join(',') + '）' : ''}`);

  // 医療費チップと詳細の既知の矛盾が再発していないこと
  const kyonan = all.find(d => d.name === '鋸南町');
  assert(kyonan && /18歳|高/.test(kyonan.iryoChip), '鋸南町の医療費が高校生（18歳年度末）まで拡大済み');
  const noda = all.find(d => d.name === '野田市');
  assert(noda && noda.iryoChip.includes('500円'), '野田市のチップが基準日時点の500円/回になっている');
  const shibayama = all.find(d => d.name === '芝山町');
  assert(shibayama && shibayama.iryoChip.includes('300円') && shibayama.iryo.includes('300円'), '芝山町の自己負担が300円になっている');

  // データ品質の不変条件
  const httpUrls = all.filter(d => d.url && !d.url.startsWith('https://'));
  assert(httpUrls.length === 0, `公式リンクがすべてHTTPS${httpUrls.length ? '（違反: ' + httpUrls.map(d => d.name).join(',') + '）' : ''}`);
  const unbalanced = all.filter(d => {
    const s = String(d.iryoChip) + String(d.kyushokuChip);
    return (s.match(/（/g) || []).length !== (s.match(/）/g) || []).length;
  });
  assert(unbalanced.length === 0, `チップの括弧が閉じている${unbalanced.length ? '（違反: ' + unbalanced.map(d => d.name).join(',') + '）' : ''}`);
}

// ---- ソースHTML: データはAPIから取得（埋め込みなし） ----
const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
assert(scripts.length === 1, 'インラインスクリプト（module）が1つだけ');
assert(html.includes("fetch('/api/prefs')"), 'PREFSを/api/prefsから取得している');
assert(html.includes('ァ-ヶ') && html.includes('yomi'), 'かな検索（カタカナ正規化＋yomi照合）が組み込まれている');
assert(/#BE4E4A/i.test(html) && !/#EE8A86/i.test(html), '合計タイルがWCAG AA準拠の濃いコーラル（白文字4.5:1以上）');
assert(html.includes('docs.google.com/forms/d/e/1FAIpQLSczD3gyWyhpAA6B8xoomtCn5SQ406knoqNQ_vF8qM8zmvf3Cw/viewform'), '誤り報告フォームへのリンクがある');
assert(html.includes('report_form'), '報告フォームクリックのGA計測がある');

// ---- 自治体別ページ（scripts/build-pages.mjs） ----
{
  const { readdirSync, existsSync } = await import('node:fs');
  const dirs = readdirSync(new URL('../public/', import.meta.url), { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'img' && existsSync(new URL(`../public/${d.name}/index.html`, import.meta.url)));
  assert(dirs.length === 212, `自治体別ページが212枚ある（実際: ${dirs.length}）`);
  const setagayaPage = readFileSync(new URL('../public/setagaya-ku/index.html', import.meta.url), 'utf8');
  assert(setagayaPage.includes('世田谷区の子育て支援制度まとめ'), '世田谷区ページにタイトルがある');
  assert(setagayaPage.includes('<link rel="canonical" href="https://kosodate.pint-home.com/setagaya-ku/">'), '世田谷区ページにcanonicalがある');
  assert(setagayaPage.includes('バースデーサポート'), '世田谷区ページに独自給付がある');
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  assert((sitemap.match(/<loc>/g) || []).length === 213, `sitemapにトップ＋212ページのURLがある（実際: ${(sitemap.match(/<loc>/g) || []).length}）`);
  assert(sitemap.includes('https://kosodate.pint-home.com/setagaya-ku/'), 'sitemapに世田谷区ページがある');
  assert(built.includes('href="/setagaya-ku/"'), 'トップページのフッターに自治体ページへのリンクが注入されている');
}
assert(!/^const PREFS = \{/m.test(html), 'ソースにPREFSデータが埋め込まれていない');
assert(!/script-src/.test(headers), 'CSPにscript-srcがない（本番事故防止・README運用メモ参照）');
assert(/object-src 'none'/.test(headers), "CSPにobject-src 'none'がある");
assert(/Permissions-Policy:/.test(headers), 'Permissions-Policyヘッダーがある');
{
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'PerplexityBot', 'Bytespider', 'Google-Extended', 'Applebot-Extended']) {
    assert(new RegExp(`User-agent: ${bot}\\nDisallow: /`).test(robots), `robots.txt: ${bot} を拒否している`);
  }
  assert(robots.includes('Disallow: /api/'), 'robots.txt: /api/ をクロール禁止');
}

// ---- Google アナリティクス（GA4） ----
assert(html.includes('G-191KRRCF6H'), 'GA4の測定IDが埋め込まれている');
assert(/googletagmanager\.com\/gtag\/js/.test(html), 'gtag.jsを読み込んでいる');
assert(/hostname === 'localhost'/.test(html), 'localhostでは計測しない条件がある');
assert(/img-src[^;]*google-analytics\.com/.test(headers), 'CSPのimg-srcでGAのビーコンを許可している');
assert(html.includes('Google アナリティクス'), 'プライバシーポリシーにGoogle アナリティクスの記載がある');
assert(html.includes('tools.google.com/dlpage/gaoptout'), 'オプトアウト手段を案内している');
assert(/function track\(name, params\)/.test(html), 'gtag未読込でも落ちないtrackヘルパーがある');
for (const ev of ['select_muni', 'open_compare', 'share', 'view_detail', 'click_official', 'click_cta', 'browse_all', 'onb_complete']) {
  assert(html.includes(`track('${ev}'`), `イベント ${ev} を計測している`);
}
assert(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script type="module">[\s\S]*?<\/script>/, '')), 'インラインイベントハンドラがない');

// ---- ビルド生成物（public/index.html） ----
assert(built.startsWith('<!DOCTYPE html>'), 'ビルド生成物にDOCTYPEがある');
assert(built.includes('All rights reserved'), 'ビルド生成物に著作権バナーがある');
assert(built.includes('/api/prefs'), 'ビルド生成物がAPIからデータ取得する');
assert(!/const PREFS = \{"東京都"/.test(built), 'ビルド生成物にPREFSデータが埋め込まれていない');
assert(!built.includes('function calcStages'), 'ビルド生成物の識別子がマングルされている');

// ---- SEO: meta / OGP / canonical / 構造化データ（ソースとビルド生成物の両方） ----
for (const [label, doc] of [['ソース', html], ['ビルド', built]]) {
  assert(/<meta name="description" content="[^"]{50,}">/.test(doc), `${label}: meta descriptionがある`);
  assert(doc.includes('<link rel="canonical" href="https://kosodate.pint-home.com/">'), `${label}: canonicalがある`);
  assert(doc.includes('property="og:title"') && doc.includes('property="og:image"'), `${label}: OGP（og:title/og:image）がある`);
  assert(doc.includes('name="twitter:card"'), `${label}: Twitterカードがある`);
  const ld = doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(!!ld, `${label}: JSON-LD構造化データがある`);
  if (ld) { try { JSON.parse(ld[1]); assert(true, `${label}: JSON-LDが正しいJSON`); } catch { assert(false, `${label}: JSON-LDが正しいJSON`); } }
}
assert(built.includes('https://kosodate.pint-home.com/img/onb-1.jpg'), 'OGP画像URLが絶対パスで指定されている');

// ---- サービス名（クラベビー） ----
for (const [label, doc] of [['ソース', html], ['ビルド', built]]) {
  assert(doc.includes('<title>クラベビー｜'), `${label}: titleがクラベビー`);
  assert(doc.includes('くらべて、暮らしをごきげんに。'), `${label}: タグラインがある`);
  assert(doc.includes('img/logo.png'), `${label}: ロゴ画像を使っている`);
  assert(doc.includes('/favicon.ico') && doc.includes('/apple-touch-icon.png'), `${label}: ファビコンのlinkがある`);
  assert(!doc.includes('引っ越し先の子育て支援くらべ'), `${label}: 旧サービス名が残っていない`);
}
{
  const page = readFileSync(new URL('../public/setagaya-ku/index.html', import.meta.url), 'utf8');
  assert(page.includes('｜クラベビー</title>') && !page.includes('引っ越し先の子育て支援くらべ'), '自治体別ページもクラベビー表記');
}

// ---- 比較の上限と並び替え ----
assert(/const MAX_CMP = 6;/.test(html), '比較上限が6（MAX_CMP定数）');
assert(!/compare\.length >= 3\b/.test(html), '比較上限のハードコード3が残っていない');
assert(html.includes('data-mv='), '選択チップに並び替えボタンがある');

// ---- 多子世帯の入力上限: 第5子以降も入力できること ----
const maxKids = html.match(/const MAX_KIDS = (\d+);/);
assert(maxKids && +maxKids[1] >= 10, `MAX_KIDSが10以上（実際: ${maxKids && maxKids[1]}）`);

// ---- 計算ロジック: calcStagesをソースHTMLから抽出して実行 ----
const calcSrc = html.match(/function calcStages\(d, kids\)\{[\s\S]*?\n\}/);
assert(!!calcSrc, 'calcStages関数を抽出できる');
if (calcSrc) {
  const makeCalc = care => new Function('state', calcSrc[0] + '\nreturn calcStages;')({ care });
  const calc = makeCalc('none');
  const stub = extra => ({ pref: '千葉県', birth: [], bday: [], ...extra });

  // 児童手当: 第3子以降は月3万円、上の子が22歳到達で毎年再判定される
  // [10,8,0]歳: 第3子は12年間3万円→以降1万円。未就学=216万、小中高=96+120+288万
  let r = calc(stub(), [{ age: 10 }, { age: 8 }, { age: 0 }]);
  assert(r.pre === 2_160_000, `児童手当・第3子判定（未就学分）: ${r.pre} === 2160000`);
  assert(r.school === 5_040_000, `児童手当・第3子判定（小中高分）: ${r.school} === 5040000`);

  // [21,20,0]歳: 上2人が順次22歳に到達し、第3子は3万→1.5万→1万と減額される
  r = calc(stub(), [{ age: 21 }, { age: 20 }, { age: 0 }]);
  assert(r.pre === 1_080_000, `児童手当・22歳到達で減額（未就学分）: ${r.pre} === 1080000`);
  assert(r.school === 1_440_000, `児童手当・22歳到達後（小中高分）: ${r.school} === 1440000`);

  // 中学給食費: 残り年数（最大3年）×年6万円で換算される
  r = calc(stub({ chuKyushoku: 'all' }), [{ age: 13 }]);
  assert(r.muni === 120_000, `中学給食費・13歳は残り2年分: ${r.muni} === 120000`);
  r = calc(stub({ chuKyushoku: 'all' }), [{ age: 0 }]);
  assert(r.muni === 180_000, `中学給食費・0歳は上限3年分: ${r.muni} === 180000`);

  // 5人きょうだい: 第3子以降が複数いても各人に月3万円が計上される
  r = calc(stub(), [{ age: 10 }, { age: 8 }, { age: 6 }, { age: 4 }, { age: 0 }]);
  assert(r.pre === 2_880_000, `児童手当・5人きょうだい（未就学分）: ${r.pre} === 2880000`);
  assert(r.school === 14_640_000, `児童手当・5人きょうだい（小中高分）: ${r.school} === 14640000`);

  // 第3子以降のみ無償の自治体では第1・2子に給食費が付かない
  r = calc(stub({ chuKyushoku: 'third' }), [{ age: 10 }, { age: 8 }, { age: 0 }]);
  assert(r.muni === 180_000, `中学給食費・第3子のみ無償: ${r.muni} === 180000`);

  // 月額給付（tsuki）: from歳以上to歳未満に月額を計上（未就学/小中高に按分）
  const tsukiMuni = stub({ tsuki: [{ label: 'クーポン', from: 0, to: 15, monthly: 5000 }] });
  r = calc(tsukiMuni, [{ age: 0 }]);
  assert(r.muni === 900_000, `月額給付・0歳で15年分: ${r.muni} === 900000`);
  r = calc(tsukiMuni, [{ age: 13 }]);
  assert(r.muni === 120_000, `月額給付・13歳で残り2年分: ${r.muni} === 120000`);
  r = calc(stub({ tsuki: [{ label: '乳児用品', from: 0, to: 3, monthly: 5500 }] }), [{ age: -1 }]);
  assert(r.muni === 198_000, `月額給付・妊娠中で3年分: ${r.muni} === 198000`);
}

process.exit(failed);
