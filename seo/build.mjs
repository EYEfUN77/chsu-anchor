// 앵커사업단 홈페이지 검색엔진 최적화(SEO) 빌드 스크립트
// - 원본 index.html(해시 주소 방식)은 그대로 두고, 배포본(_site)에
//   페이지별 실제 주소(/overview/ 등) + 미리 렌더링한 본문 + 메타태그 +
//   sitemap.xml · robots.txt · rss.xml 을 생성한다.
// - GitHub Actions(.github/workflows/pages.yml)에서 push 할 때마다 자동 실행된다.
// 사용법: node seo/build.mjs [출력폴더=_site]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.resolve(ROOT, process.argv[2] || '_site');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/seo.config.json'), 'utf8'));
const DOMAIN = (fs.existsSync(path.join(ROOT, 'CNAME')) ? fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim() : '') || 'chsu-anchor.eyefun.org';
const ORIGIN = 'https://' + DOMAIN;
const EXCLUDE = new Set(['.git', '.github', 'seo', '_site', 'node_modules', 'README.md', 'package.json', 'package-lock.json', '.gitignore']);

let lastmod;
try { lastmod = execSync('git log -1 --format=%cI', { cwd: ROOT }).toString().trim(); } catch { lastmod = new Date().toISOString(); }

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };
const urlOf = r => ORIGIN + (r ? '/' + r + '/' : '/');

// 1) 원본 파일 복사
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(ROOT)) if (!EXCLUDE.has(f)) fs.cpSync(path.join(ROOT, f), path.join(OUT, f), { recursive: true });
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 2) 원본을 로컬 서버로 띄워 각 화면을 렌더링
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(); }
  if (/\.mp4$/i.test(fp)) { res.writeHead(204); return res.end(); } // 영상은 렌더링에 불필요
  res.writeHead(200, { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const LOCAL = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => (r.request().resourceType() === 'document' ? r.abort() : r.continue()));
await page.goto(LOCAL, { waitUntil: 'load' });
await page.waitForTimeout(500);

const menu = await page.evaluate(() => MENU.map(m => ({ t: m.t, c: m.c.map(c => [c[0], c[1]]) })));
const boards = await page.evaluate(() => { const o = {}; try { for (const k of Object.keys(BOARD)) o[k] = BOARD[k].map(p => ({ t: p.t, d: p.d, src: p.src || '' })); } catch {} return o; });

const chrome = await page.evaluate(() => ({ gnb: document.querySelector('#gnb')?.innerHTML || '', smap: document.querySelector('#smap')?.innerHTML || '' }));
const pages = new Map();
const queue = [''];
for (const m of menu) for (const c of m.c) queue.push(c[0]);
while (queue.length) {
  const r = queue.shift();
  if (pages.has(r)) continue;
  await page.evaluate(h => { location.hash = h; }, '#/' + r);
  await page.waitForTimeout(r ? 150 : 400);
  const d = await page.evaluate(() => {
    const app = document.querySelector('#app');
    const cont = app.querySelector('.cont') || app;
    const th = /\/\d+$/.test(location.hash) ? cont.querySelector('.tbl th.l, .eqd h4, h4') : null;
    const cl = cont.cloneNode(true); cl.querySelectorAll('.stit, script, style').forEach(e => e.remove());
    document.body.appendChild(cl); const text = cl.innerText; cl.remove();
    const links = [...document.querySelectorAll('a[href^="#/"]')].map(a => a.getAttribute('href').replace(/^#\/?/, '').replace(/\/$/, ''));
    const img = [...cont.querySelectorAll('img')].map(i => i.getAttribute('src')).find(s => s && !/\.svg$/i.test(s));
    return { html: app.innerHTML, title: document.title, detail: th ? th.textContent.trim() : '', text, links, img };
  });
  // 게시물 상세 주소가 목록 주소와 같은 화면을 보여주면(없는 번호) 건너뜀
  pages.set(r, d);
  for (const l of d.links) if (!pages.has(l) && !queue.includes(l) && /^[a-z0-9_-]+(\/\d+)?$/i.test(l)) queue.push(l);
}
await browser.close();
server.close();

// 3) 페이지별 HTML 생성
const label = id => { for (const m of menu) for (const c of m.c) if (c[0] === id) return [m.t, c[1]]; return null; };
const APP_TAG = '<main id="app"></main>';
const iApp = SRC.indexOf(APP_TAG);
const iScript = SRC.indexOf('<script>', iApp);
if (iApp < 0 || iScript < 0) throw new Error('index.html 구조(<main id="app"></main> 또는 <script>)를 찾지 못했습니다.');
const ROUTE_ORIG = "function route(){const h=location.hash.replace(/^#\\/?/,'')";
const routePatchable = SRC.includes(ROUTE_ORIG);
if (!routePatchable) console.warn('⚠ route() 형태가 바뀌어 대체 방식(주소에 #경로 추가)을 사용합니다.');

const relink = html => html.replace(/href="#\/([^"]*)"/g, (_, p) => { p = p.replace(/\/$/, ''); return `href="/${p ? p + '/' : ''}" data-r="${p}"`; });
const fillAlt = (html, alt) => html.replace(/<img\b(?![^>]*\balt=)([^>]*)>/g, `<img alt="${esc(alt)}"$1>`).replace(/<img\b([^>]*?)\balt=""/g, `<img$1alt="${esc(alt)}"`);

function build(r, d, { notFound = false } = {}) {
  const [id, idx] = r.split('/');
  const lab = id ? label(id) : null;
  let title, desc;
  if (!r) { title = `${cfg.siteName} | 지역성장 인재양성체계(앵커) 사업`; desc = cfg.description; }
  else {
    const name = d.detail || (lab ? lab[1] : '');
    title = `${name}${d.detail && lab ? ' - ' + lab[1] : ''} | ${cfg.siteName}`;
    const t = d.text.replace(/\s+/g, ' ').trim();
    desc = clip(t.startsWith(name) ? t : `${name} — ${t}`, 155);
  }
  const canonical = urlOf(notFound ? '' : r);
  const ogImg = ORIGIN + '/' + (d.img && !/^https?:/.test(d.img) ? d.img : cfg.ogImage).replace(/^\//, '');
  const v = cfg.verification || {};
  const ld = !r ? `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Organization', name: cfg.siteName, alternateName: cfg.siteNameEn, url: ORIGIN + '/',
    logo: ORIGIN + '/apple-touch-icon.png', telephone: cfg.telephone,
    address: { '@type': 'PostalAddress', streetAddress: cfg.address, addressCountry: 'KR' },
    parentOrganization: { '@type': 'CollegeOrUniversity', name: cfg.parentOrganization, url: cfg.parentUrl }
  })}</script>` : `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'HOME', item: ORIGIN + '/' },
      ...(lab ? [{ '@type': 'ListItem', position: 2, name: lab[1], item: urlOf(id) }] : []),
      ...(idx != null && d.detail ? [{ '@type': 'ListItem', position: 3, name: d.detail, item: urlOf(r) }] : [])]
  })}</script>`;
  const head = [
    r || notFound ? '<base href="/">' : '',
    `<script>window.__SEO_PATH=${JSON.stringify(notFound ? '' : r)};window.__SEO_TITLE=${JSON.stringify(title)};document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-r]');if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button)return;e.preventDefault();location.hash='#/'+a.getAttribute('data-r')},true);${routePatchable ? '' : "if(__SEO_PATH&&!location.hash)history.replaceState(null,'',location.pathname+'#/'+__SEO_PATH);"}</script>`,
    notFound ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow">',
    `<meta name="keywords" content="${esc(cfg.keywords)}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<link rel="alternate" type="application/rss+xml" title="${esc(cfg.siteName)} 소식" href="${ORIGIN}/rss.xml">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(cfg.siteName)}">`,
    `<meta property="og:locale" content="ko_KR">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${esc(ogImg)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    v.google ? `<meta name="google-site-verification" content="${esc(v.google)}">` : '',
    v.naver ? `<meta name="naver-site-verification" content="${esc(v.naver)}">` : '',
    ld
  ].filter(Boolean).join('\n');

  let pre = SRC.slice(0, iApp), post = SRC.slice(iScript);
  pre = pre.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<head>/, '<head>\n' + head);
  const body = SRC.slice(SRC.indexOf('<body'), iApp);
  pre = pre.slice(0, pre.indexOf('<body')) + relink(body
    .replace('<ul class="gnb" id="gnb"></ul>', `<ul class="gnb" id="gnb">${chrome.gnb}</ul>`)
    .replace('<div class="smap" id="smap"></div>', `<div class="smap" id="smap">${chrome.smap}</div>`));
  const mid = SRC.slice(iApp + APP_TAG.length, iScript);
  const app = `<main id="app">${fillAlt(relink(d.html), title.split(' | ')[0])}</main>`;
  if (routePatchable) post = post.replace(ROUTE_ORIG, "function route(){const h=(location.hash.replace(/^#\\/?/,'')||window.__SEO_PATH||'')");
  post = post.replace(/<\/body>/, `<script>if(!location.hash&&window.__SEO_TITLE)document.title=__SEO_TITLE;</script>\n</body>`);
  return pre + app + relink(mid) + post;
}

const routes = [...pages.keys()];
for (const r of routes) {
  const file = path.join(OUT, r, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, build(r, pages.get(r)));
}
fs.writeFileSync(path.join(OUT, '404.html'), build('', pages.get(''), { notFound: true }));

// 4) sitemap.xml · robots.txt · rss.xml
const pri = r => (!r ? '1.0' : r.includes('/') ? '0.5' : '0.8');
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(r => `  <url><loc>${urlOf(r)}</loc><lastmod>${lastmod}</lastmod><priority>${pri(r)}</priority></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`);
const rfc = d => { const t = new Date((d || '').replace(/\./g, '-').replace(/-$/, '') + 'T09:00:00+09:00'); return isNaN(t) ? new Date(lastmod).toUTCString() : t.toUTCString(); };
const items = [];
for (const k of ['notice', 'call', 'press']) (boards[k] || []).forEach((p, i) => { if (pages.has(`${k}/${i}`)) items.push({ k, i, ...p }); });
items.sort((a, b) => String(b.d).localeCompare(String(a.d)));
fs.writeFileSync(path.join(OUT, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(cfg.siteName)}</title><link>${ORIGIN}/</link><description>${esc(cfg.description)}</description><language>ko</language>
${items.slice(0, 50).map(p => `<item><title>${esc(p.t)}</title><link>${urlOf(p.k + '/' + p.i)}</link><guid>${urlOf(p.k + '/' + p.i)}</guid><pubDate>${rfc(p.d)}</pubDate><description>${esc((label(p.k) || ['', ''])[1] + ' · ' + (p.src || cfg.siteName))}</description></item>`).join('\n')}
</channel></rss>
`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`✔ ${routes.length}개 페이지 생성 (${ORIGIN}) · RSS ${Math.min(items.length, 50)}건 · route 패치 ${routePatchable ? '적용' : '대체방식'}`);
