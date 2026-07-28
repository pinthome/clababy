// 自治体別の静的ページを public/<slug>/index.html に生成する（SEO用ランディング）。
// あわせて public/sitemap.xml を生成し、ビルド済み public/index.html のフッターに全ページへのリンクを注入する。
// データは src/prefs.json のみ。生成物は素のHTMLで、/api/prefs には依存しない。
// scripts/build.mjs（本体ビルド）の後に実行すること（npm run build が順に実行する）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const TRIAL = null; // ['世田谷区'] のように絞ると試作モード

const PREFS = JSON.parse(readFileSync(new URL('../src/prefs.json', import.meta.url), 'utf8'));
const ORIGIN = 'https://kosodate.pint-home.com';

// ---- よみがな（ひらがな）→ ヘボン式ローマ字（スラッグ用の簡易版） ----
const DIGRAPH = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',
  にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',
  りゃ:'rya',りゅ:'ryu',りょ:'ryo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',じゃ:'ja',じゅ:'ju',じょ:'jo',
  びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
};
const MONO = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',
  わ:'wa',を:'o',ん:'n',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',
  だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ー:'',
};
export function romaji(kana) {
  let out = '', i = 0, prev = '';
  while (i < kana.length) {
    if (kana[i] === 'っ') { // 促音: 次の音の子音を重ねる（chはtch）
      const next = DIGRAPH[kana.slice(i + 1, i + 3)] || MONO[kana[i + 1]] || '';
      out += next.startsWith('ch') ? 't' : next[0] || '';
      prev = 'っ'; i++; continue;
    }
    // 長音の「う」: 拗音（ちゅ・じゅ等）・ゆ・う の直後だけ省略（府中=fuchu・九十九里=kujukuri）。
    // く・つ等の後は形態素境界の可能性が高いので残す（勝浦=katsuura）
    if (kana[i] === 'う' && (prev === 'う' || prev === 'ゆ' || (DIGRAPH[prev] || '').endsWith('u'))) { i++; continue; }
    const two = DIGRAPH[kana.slice(i, i + 2)];
    if (two) { out += two; prev = two && kana.slice(i, i + 2); i += 2; continue; }
    out += MONO[kana[i]] ?? '';
    prev = kana[i];
    i++;
  }
  // お段・あ段の長音の簡略化（こうとう→koto、おおた→ota）。えい(ei)は残す
  return out.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/aa/g, 'a');
}

const SUFFIX = { 区: ['く', 'ku'], 市: ['し', 'shi'], 村: ['むら', 'mura'] };
export function slugOf(m) {
  const kind = m.name.at(-1);
  if (kind === '町') {
    const tail = m.yomi.endsWith('ちょう') ? 'ちょう' : 'まち';
    return romaji(m.yomi.slice(0, -tail.length)) + '-' + (tail === 'まち' ? 'machi' : 'cho');
  }
  const [yomi, roma] = SUFFIX[kind] || ['', ''];
  return romaji(yomi ? m.yomi.slice(0, -yomi.length) : m.yomi) + (roma ? '-' + roma : '');
}

// ---- 表示ヘルパー ----
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const man = n => n >= 10000 && n % 10000 === 0 ? `${n / 10000}万円` : `${n.toLocaleString('ja-JP')}円`;
const amounts3 = a => {
  if (!a || !a.length) return '';
  const [a1, a2, a3] = a;
  if (a1 === a2 && a2 === a3) return `子ども1人につき ${man(a1)}`;
  return `第1子 ${man(a1)}／第2子 ${man(a2)}／第3子以降 ${man(a3)}`;
};
const nl2p = s => esc(s).split('\n').filter(Boolean).map(l => `<p>${l}</p>`).join('');
// 金額・ポイント表現をコーラル色で強調（esc済みテキストに適用すること）
const mny = s => s.replace(/([0-9０-９][0-9０-９,，]*(?:\.[0-9]+)?万?円(?:相当)?(?:分)?|[0-9][0-9,]*万?ポイント)/g, '<b class="m">$1</b>');
// 「名称　説明」の全角スペース区切り行を <b>名称</b>: 説明 に変換
const nameDetail = line => {
  const i = line.search(/[　]/);
  return i > 0 ? `<b>${esc(line.slice(0, i))}</b>：${mny(esc(line.slice(i + 1).trim()))}` : mny(esc(line));
};
const layerGroup = (cls, badge, title, items) => items.length
  ? `<div class="lgroup"><span class="lay ${cls}">${badge}</span><span class="lg-t">${esc(title)}</span></div><ul>${items.join('')}</ul>` : '';
// 「、」「。」区切りの列挙文を項目に分割する（括弧の中は区切らない）
function splitItems(text) {
  const out = [];
  let buf = '', depth = 0;
  for (const ch of text) {
    if (ch === '（' || ch === '(') depth++;
    if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === '、' || ch === '。') && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
const MUSHO_LABEL = { first: '第1子から独自に無償化', second: '第2子から独自に無償化', third: '第3子以降を独自に無償化' };
const TAG_LABELS = { sango: '産後ケア', helper: '家事・育児ヘルパー', byoji: '病児保育', ichiji: '一時預かり', jutaku: '住宅支援', ido: '移動支援', goods: '育児用品の支給', book: '絵本などのプレゼント', sitter: 'ベビーシッター補助' };

function section(title, body) {
  return body ? `<section><h2>${esc(title)}</h2>${body}</section>` : '';
}

// keizaiテキストを 国／自治体独自 の2層に分けて整形する（都県共通分は「◯◯の共通制度」節に譲る）。
// birth/bday の構造化データと重複する行は構造化側（金額の内訳つき）を優先する
function renderKeizai(m, pref) {
  const kuni = [], muni = [];
  const ownLabels = [...(m.birth || []), ...(m.bday || [])].map(b => b.label);
  for (const line of (m.keizai || '').split('\n').filter(Boolean)) {
    if (line.startsWith('【都】') || line.startsWith('【県】')) continue;
    if (line.startsWith('【国】')) { kuni.push(`<li>${nameDetail(line.replace('【国】', '').trim())}</li>`); continue; }
    if (ownLabels.some(l => line.startsWith(l))) continue;
    muni.push(`<li>${nameDetail(line)}</li>`);
  }
  const own = [
    ...(m.birth || []).map(b => `<li><b>${esc(b.label)}</b>：${mny(esc(amounts3(b.amounts)))}</li>`),
    ...(m.bday || []).map(b => `<li><b>${esc(b.label)}</b>（${b.age}歳のお誕生日）：${mny(esc(amounts3(b.amounts)))}</li>`),
    ...muni,
  ];
  return [
    layerGroup('l-muni', '独自', `${m.name}の独自給付・支援`, own),
    layerGroup('l-kuni', '国', '全国共通', kuni),
    `<p class="note">このほか、${esc(pref)}共通の給付は下の「${esc(pref)}の共通制度」をご覧ください。</p>`,
  ].join('');
}

// bsテキスト（「対象児童」「補助金額」の2見出し構成）をラベル付きの行に整形する
function renderBs(bs) {
  if (!bs) return '';
  const parts = { intro: [], 対象児童: [], 補助金額: [], notes: [] };
  let cur = 'intro';
  for (const line of bs.split('\n').filter(Boolean)) {
    if (line === '対象児童' || line === '補助金額') { cur = line; continue; }
    if (/^[（(]/.test(line)) { parts.notes.push(line.replace(/^[（(]|[）)]$/g, '')); continue; }
    parts[cur].push(line);
  }
  // 金額行: 「児童一人1時間当たり」は単位注記。金額部分を強調表示する
  const priceRows = [];
  let unit = '';
  for (const line of parts['補助金額']) {
    if (/当たり$/.test(line) || !/[0-9０-９]/.test(line)) { unit = line; continue; }
    // 「時間帯　金額円（注記）」形式。時間帯なし（金額のみ）や金額を含まない行にも対応
    const mm = line.match(/^(.*?)[　\s]*([0-9,０-９，]+円)[　\s]*(（.*）)?$/);
    if (mm) {
      priceRows.push(`<div class="bs-price"><span>${esc(mm[1] || unit || '補助額')}</span><b>${esc(mm[2])}</b></div>`
        + (mm[3] ? `<p class="note">※ ${esc(mm[3].replace(/^（|）$/g, ''))}</p>` : ''));
    } else {
      priceRows.push(`<p>${esc(line)}</p>`);
    }
  }
  return [
    parts.intro.length ? `<p>${esc(parts.intro.join('。'))}</p>` : '',
    `<div class="krow"><span class="k">対象</span><span>${esc(parts['対象児童'].join('、'))}</span></div>`,
    `<div class="krow"><span class="k">補助額</span><div>${unit ? `<p class="note" style="margin:0 0 4px">${esc(unit)}</p>` : ''}${priceRows.join('')}</div></div>`,
    parts.notes.length ? `<p class="note">※ ${esc(parts.notes.join('。'))}</p>` : '',
  ].join('');
}

function renderPage(m, pref, prefItems, slug) {
  const url = `${ORIGIN}/${slug}/`;
  const updated = m.checked || '2026-07';
  const chips = [
    ['医療費', m.iryoChip], ['給食', m.kyushokuChip],
    ['保育所待機児童', m.hoiku != null ? `${m.hoiku}人` : null],
    ['学童クラブ待機', m.gakudo != null ? `${m.gakudo}人` : null],
  ].filter(([, v]) => v);
  const desc = `${m.name}の子育て支援制度まとめ。医療費助成は${m.iryoChip}、給食は${m.kyushokuChip}、保育所待機児童は${m.hoiku}人。妊娠・出産の給付や独自支援を一覧で確認できます（${updated}時点）。`;

  const tagChips = (m.tags || []).map(t => TAG_LABELS[t]).filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join('');
  const refLinks = (m.refs || []).map(r => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('');
  const prefList = (prefItems || []).map(i => `<li>${mny(esc(i[0]))}</li>`).join('');

  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'クラベビー', item: ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: `${m.name}の子育て支援`, item: url },
      ]},
      { '@type': 'WebPage', name: `${m.name}の子育て支援制度まとめ`, url, dateModified: updated,
        description: desc, isPartOf: { '@type': 'WebSite', name: 'クラベビー', url: ORIGIN + '/' } },
    ],
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.name)}の子育て支援制度まとめ（${updated}時点）｜クラベビー</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="192x192" href="/img/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(m.name)}の子育て支援制度まとめ">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/img/onb-1.jpg">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${ld}</script>
<style>
:root{--ground:#FBF6EE;--tint:#F5F1E8;--surface:#FFF;--ink:#14264E;--muted:#5A6B7E;--line:#EAE4D9;--joy:#BE4E4A;--joy-soft:#FBEBEA;--r:18px}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"Hiragino Maru Gothic ProN","ヒラギノ丸ゴ ProN",ui-rounded,"Hiragino Kaku Gothic ProN",sans-serif;line-height:1.75;font-size:15px}
main{max-width:720px;margin:0 auto;padding:20px 16px 48px}
.crumb{font-size:12px;color:var(--muted)}.crumb a{color:var(--muted)}
h1{font-size:24px;line-height:1.4;margin:10px 0 4px}
.sub{color:var(--muted);font-size:13px;margin:0 0 14px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.st{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13px}
.st b{color:var(--joy)}
section{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;margin:0 0 14px}
h2{font-size:16px;margin:0 0 10px;padding-left:10px;border-left:4px solid var(--joy)}
p{margin:6px 0}ul{margin:6px 0;padding-left:20px}li{margin:4px 0}
.chip{display:inline-block;background:var(--tint);border-radius:999px;padding:3px 12px;font-size:12.5px;margin:2px 4px 2px 0}
.note{font-size:12px;color:var(--muted)}
.krow{display:flex;gap:12px;padding:8px 0;border-top:1px dashed var(--line)}
.krow:first-of-type{border-top:0}
.krow .k{flex:0 0 58px;font-weight:700;font-size:13px;color:var(--muted)}
.bs-price{display:flex;justify-content:space-between;gap:10px;max-width:340px;padding:3px 0}
.bs-price b{color:var(--joy);font-variant-numeric:tabular-nums;white-space:nowrap}
b.m{color:var(--joy);font-variant-numeric:tabular-nums}
.lgroup{display:flex;align-items:center;gap:8px;margin:14px 0 4px}
.lgroup:first-child{margin-top:0}
.lg-t{font-size:13px;font-weight:700}
.lay{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:2px 10px;line-height:1.6}
.l-kuni{background:#7E90A3}.l-to{background:#14264E}.l-muni{background:var(--joy)}
.cta{display:block;text-align:center;background:linear-gradient(135deg,#2A4173,#14264E);color:#fff;text-decoration:none;border-radius:999px;padding:15px 20px;font-weight:700;margin:22px 0 10px}
a{color:#2A4173}
footer{font-size:11.5px;color:var(--muted);text-align:center;padding:8px 16px 32px}
</style>
</head>
<body>
<main>
<nav class="crumb"><a href="/">クラベビー</a> › ${esc(pref)} › ${esc(m.name)}</nav>
<h1>${esc(m.name)}の子育て支援制度まとめ</h1>
<p class="sub">${esc(pref)}${m.area ? '・' + esc(m.area) : ''}／${updated}時点の公表情報にもとづく</p>
<div class="chips">${chips.map(([k, v]) => `<span class="st">${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>

${section('子ども医療費の助成', `<p>${mny(esc(m.iryo))}</p>`)}
${section('学校給食費', `<p>${mny(esc(m.kyushoku))}</p>`)}
${section('保育・幼稚園', [
  m.hoiku != null ? `<div class="krow"><span class="k">待機児童</span><span>保育所 <b class="m">${m.hoiku}人</b>${m.gakudo != null ? `／学童クラブ <b class="m">${m.gakudo}人</b>` : ''}</span></div>` : '',
  m.hoikuMusho && MUSHO_LABEL[m.hoikuMusho] ? `<div class="krow"><span class="k">保育料</span><span>${MUSHO_LABEL[m.hoikuMusho]}</span></div>` : '',
  m.ninsho ? `<div class="krow"><span class="k">認可外</span><span>${mny(esc(m.ninsho))}</span></div>` : '',
  m.yochien ? `<div class="krow"><span class="k">幼稚園</span><span>${mny(esc(m.yochien))}</span></div>` : '',
].join(''))}
${section('妊娠・出産・子育てでもらえるもの', renderKeizai(m, pref))}
${section('ベビーシッター利用支援', renderBs(m.bs))}
${section(`${m.name}ならではの支援`, m.sonota ? `<ul>${splitItems(m.sonota).map(s => `<li>${mny(esc(s))}</li>`).join('')}</ul>` : '')}
${section('そのほかの制度（公表情報からの抽出）', tagChips ? `<p>${tagChips}</p><p class="note">公表資料のキーワードから機械抽出したものです。実施状況は公式サイトでご確認ください。</p>` : '')}
${section(`${esc(pref)}の共通制度`, prefList ? `<ul>${prefList}</ul>` : '')}
${section('出典・公式情報', `<ul><li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)} 子育て支援 公式ページ</a></li>${refLinks}</ul><p class="note">確認日: ${updated}。制度は変更される場合があります。最新情報は必ず公式サイトでご確認ください。</p>`)}

<a class="cta" href="/">${esc(m.name)}をほかの自治体とくらべてみる →</a>
<p class="note">「クラベビー」では、1都3県212市区町村の子育て支援を、ご家族の条件に合わせた受給見込み額つきで比較できます。</p>
</main>
<footer>© クラベビー｜掲載情報は${updated}時点の概要です。金額・要件の正確な内容は各自治体の公式情報をご確認ください。</footer>
</body>
</html>
`;
}

// ---- 生成 ----
let count = 0;
const slugs = new Map();
const sitemapEntries = [`  <url>
    <loc>${ORIGIN}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>`];
const linkGroups = [];
for (const [pref, conf] of Object.entries(PREFS)) {
  const links = [];
  for (const m of conf.munis) {
    const slug = slugOf(m);
    if (slugs.has(slug)) throw new Error(`スラッグ重複: ${slug} (${slugs.get(slug)} / ${m.name})`);
    slugs.set(slug, m.name);
    if (TRIAL && !TRIAL.includes(m.name)) continue;
    const dir = new URL(`../public/${slug}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('index.html', dir), renderPage(m, pref, conf.prefItems, slug));
    sitemapEntries.push(`  <url>
    <loc>${ORIGIN}/${slug}/</loc>${m.checked ? `
    <lastmod>${m.checked}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
    links.push(`<a href="/${slug}/">${esc(m.name)}</a>`);
    count++;
  }
  if (links.length) linkGroups.push(`<b>${esc(pref)}</b><p class="mlinks">${links.join('')}</p>`);
}

// sitemap.xml
writeFileSync(new URL('../public/sitemap.xml', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.join('\n')}\n</urlset>\n`);

// ビルド済みトップページのフッターに自治体リンクを注入（クローラの導線）
const indexPath = new URL('../public/index.html', import.meta.url);
const indexHtml = readFileSync(indexPath, 'utf8');
const marker = /<div id="muniLinks">\s*<\/div>/;
if (!marker.test(indexHtml)) throw new Error('public/index.html に <div id="muniLinks"></div> が見つかりません（先に scripts/build.mjs を実行してください）');
writeFileSync(indexPath, indexHtml.replace(marker, `<div id="muniLinks">${linkGroups.join('')}</div>`));

console.log(`pages: ${count} generated, slugs: ${slugs.size} unique, sitemap: ${sitemapEntries.length} URLs, links injected`);
