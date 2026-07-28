// app/index.html（可読ソース）→ public/index.html（配信用）を生成する。
// - インラインJS: esbuildでミニファイ＋モジュールスコープの識別子をマングル
// - インラインCSS: esbuildでミニファイ
// - HTMLコメント除去・行頭インデント除去
// - 著作権バナーを先頭に付与
// public/index.html は生成物なので直接編集しないこと（.gitignore済み）。
import { readFileSync, writeFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SRC = new URL('../app/index.html', import.meta.url);
const OUT = new URL('../public/index.html', import.meta.url);

const BANNER = '<!-- (c) 2026 クラベビー（kosodate.pint-home.com） All rights reserved. '
  + '本サイトのコード・データの無断転載・複製・自動取得（スクレイピング）を禁じます。 -->';

let html = readFileSync(SRC, 'utf8');

// インラインJSをミニファイ（type="module"なのでトップレベル識別子もマングルされる）
html = html.replace(/(<script type="module">)([\s\S]*?)(<\/script>)/, (_, open, js, close) => {
  const out = transformSync(js, { minify: true, format: 'esm', target: 'es2022', charset: 'utf8' });
  return open + out.code.trimEnd() + close;
});

// インラインCSSをミニファイ
html = html.replace(/(<style>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) => {
  const out = transformSync(css, { loader: 'css', minify: true, charset: 'utf8' });
  return open + out.code.trimEnd() + close;
});

// HTMLコメント除去＋行頭インデント除去（pre/textareaは無いこと前提）
html = html.replace(/<!--[\s\S]*?-->/g, '');
html = html.split('\n').map(l => l.replace(/^\s+/, '')).filter(l => l !== '').join('\n');

// バナーをDOCTYPE直後に挿入
html = html.replace(/^<!DOCTYPE html>/i, m => m + '\n' + BANNER);

writeFileSync(OUT, html);
console.log(`built public/index.html (${Buffer.byteLength(html)} bytes)`);
