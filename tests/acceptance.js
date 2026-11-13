/* Unravel — browser acceptance checks (Build Spec v5, plus the v3/v4 promises they still bind).
   Run:   node tests/acceptance.js            (needs Playwright with Chromium; ffmpeg for the film checks)
   Starts its own static server on a free port, so nothing else needs to be running.
   The film checks use a 30-second test clip made with ffmpeg at run time and served in place of
   assets/video/data-journey.mp4; the real file is never touched. With no ffmpeg those checks are skipped, and say so. */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seaad-mtg.json'), 'utf8'));
const WIDTHS = (process.env.WIDTHS || '390,820,1440').split(',').map(Number);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

/* ---------- a static server with Range support, and a switch for the film ---------- */
let filmMode = 'real';   // 'real' | 'fixture' | 'missing'
let fixture = null;
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      let file = path.join(ROOT, url === '/' ? 'index.html' : url);
      let type = TYPES[path.extname(file)] || 'application/octet-stream';
      if (url === '/' + DATA.video.src) {
        if (filmMode === 'missing') { res.writeHead(404); res.end(); return; }
        if (filmMode === 'fixture') { file = fixture; type = 'video/webm'; }
      }
      if (!file.startsWith(ROOT) && file !== fixture) { res.writeHead(403); res.end(); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
        const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Number(range[2]) : st.size - 1;
          res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(file, { start, end }).pipe(res);
          return;
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).pipe(res);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function makeFixture() {
  try {
    const out = path.join(os.tmpdir(), 'unravel-film-fixture.webm');
    if (!fs.existsSync(out)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=30', '-c:v', 'libvpx-vp9', '-b:v', '200k', out]);
    return out;
  } catch (e) { return null; }
}

/* ---------- reporting ---------- */
const results = [];
function record(n, name, ok, detail) {
  results.push({ n, name, ok, detail });
  console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`);
}

/* ---------- colour maths ---------- */
const TOKENS = { bg: '#0E0E10', card: '#1A1A1D', cream: '#FBE9CF', muted: '#A8A29A', coral: '#F28B74', peri: '#8F92E6', rose: '#E9A3A0', line: '#6B6B70', lilac: '#C9C2F2', sand: '#D9B98C' };
const hexRgb = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
const ALLOWED = Object.values(TOKENS).map((x) => hexRgb(x).join(','));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* in-page helpers, injected once */
const PAGE_HELPERS = () => {
  window.__parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3).map(Math.round), a: p.length > 3 ? p[3] : 1 }; };
  window.__visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
};

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }
async function openPage(browser, width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : width < 1000 ? 1180 : 900 }, serviceWorkers: 'block', reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__prevented = [];
    const orig = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () { window.__prevented.push(this.type); return orig.call(this); };
  });
  await page.addInitScript(PAGE_HELPERS);
  await page.goto(`${BASE}/${opts.hash || ''}`);
  await page.waitForSelector('main .sec, main .page');
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 300);
  return { ctx, page, requests, errors };
}
// visit every home section so that reveals have run and each part is laid out
async function walk(page) {
  const ids = await page.$$eval('main .sec', (a) => a.map((x) => x.id));
  for (const id of ids) { await page.evaluate((i) => { document.getElementById(i).scrollIntoView(); }, id); await settle(page, 250); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 200);
  return ids;
}
async function labToStep1(page) {
  await page.evaluate(() => document.getElementById('lab').scrollIntoView());
  if (!(await page.$('#lab [data-k^="pred-"]'))) return;
  await page.click('#lab [data-k^="pred-"]');
  await page.click('#lab .pill[data-k="next"]');
  await settle(page, 600);
}

let BASE = '';
(async () => {
  const srv = await serve();
  BASE = `http://127.0.0.1:${srv.address().port}`;
  fixture = makeFixture();
  const browser = await chromium.launch();
  const fail = {};
  const note = (n, w, msg) => { (fail[n] = fail[n] || []).push(`${w}px: ${msg}`); };

  filmMode = 'fixture';
  const contrastRows = new Map();

  for (const w of WIDTHS) {
    const { ctx, page, requests, errors } = await openPage(browser, w);
    await walk(page);
    if (errors.length) note(0, w, 'page errors: ' + errors.join(' | '));

    // 1 · one-line title, no horizontal scroll anywhere
    const overflow = [];
    for (const hash of ['', '#prize', '#ucas', '#teachers']) {
      if (hash) { await page.evaluate((x) => { location.hash = x; }, hash); await settle(page, 500); } else await walk(page);
      const sw = await page.evaluate(async () => { let worst = 0; const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += innerHeight / 2) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); worst = Math.max(worst, document.documentElement.scrollWidth - innerWidth); } return worst; });
      if (sw > 0) overflow.push(`${hash || 'home'} +${sw}px`);
    }
    if (overflow.length) note(1, w, 'horizontal scroll: ' + overflow.join(', '));
    await page.evaluate(() => { location.hash = '#question'; }); await settle(page, 600);

    // 3 · colours: background, border and text only from the token list (any alpha), or transparent
    for (const hash of ['#question', '#prize', '#ucas', '#teachers']) {
      await page.evaluate((x) => { location.hash = x; }, hash); await settle(page, 500);
      if (hash === '#question') { await walk(page); await labToStep1(page); }
      const bad = await page.evaluate((allowed) => {
        const out = new Set();
        for (const el of document.querySelectorAll('body, body *')) {
          if (el.closest('svg') || el.closest('noscript') || el.tagName === 'SCRIPT') continue;
          const cs = getComputedStyle(el);
          const props = ['color', 'backgroundColor'];
          ['Top', 'Right', 'Bottom', 'Left'].forEach((s) => { if (parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none') props.push('border' + s + 'Color'); });
          for (const p of props) { const c = __parse(cs[p]); if (!c || c.a === 0) continue; if (!allowed.includes(c.rgb.join(','))) out.add(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${p} ${cs[p]}`); }
        }
        return [...out].slice(0, 12);
      }, ALLOWED);
      if (bad.length) note(3, w, `${hash}: ${bad.join('; ')}`);
    }
    await page.evaluate(() => { location.hash = '#question'; }); await settle(page, 600);
    await walk(page);

    // 2 · the title face, and nothing leaves the site
    const font = await page.$eval('h1.title', (el) => ({ fam: getComputedStyle(el).fontFamily, loaded: document.fonts.check('40px "Bagel Fat One"') || document.fonts.check('40px "Lilita One"') }));
    if (!/^"?(Bagel Fat One|Lilita One)/.test(font.fam) || !font.loaded) note(2, w, `h1 font ${font.fam}, loaded ${font.loaded}`);
    const outside = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'));
    if (outside.length) note(2, w, 'outside requests: ' + outside.join(', '));

    // 4 · Instrument Serif nowhere
    const serif = await page.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /Instrument/i.test(r.cssText)); } catch (e) { return false; } }) || [...document.querySelectorAll('*')].some((el) => /Instrument/i.test(getComputedStyle(el).fontFamily)));
    if (serif) note(4, w, 'Instrument Serif found in a stylesheet or computed style');

    // 5 · the title screen: one h1, one paragraph, one button, one mono label
    const t = await page.$eval('#question', (sec) => ({ h1: sec.querySelectorAll('h1').length, p: sec.querySelectorAll('p').length, btn: sec.querySelectorAll('button, a').length, label: sec.querySelectorAll('.label').length, inputs: sec.querySelectorAll('input, select, textarea').length }));
    if (t.h1 !== 1 || t.p !== 1 || t.btn !== 1 || t.label !== 1 || t.inputs) note(5, w, JSON.stringify(t));

    // 6 · exactly one coral pill in each journey section
    const pills = await page.$$eval('main .sec', (secs) => secs.map((x) => [x.id, x.querySelectorAll('.pill').length]));
    pills.filter(([, c]) => c !== 1).forEach(([id, c]) => note(6, w, `${id} has ${c} pills`));

    // 7 · no mode switch, helper or explanation toggle
    const toggles = await page.evaluate(() => {
      const hits = [];
      document.querySelectorAll('[role="switch"], .switch, input[type="checkbox"]').forEach((el) => hits.push(el.outerHTML.slice(0, 60)));
      document.querySelectorAll('button, a, summary').forEach((el) => { if (/\b(explain this|help|hint|sandbox|guided|translator|show me the answer|a-level terms|research terms)\b/i.test(el.textContent)) hits.push(el.textContent.trim().slice(0, 40)); });
      return hits;
    });
    if (toggles.length) note(7, w, toggles.join(', '));

    // 8 · every chart followed by three visible, non-empty explanation lines
    await labToStep1(page);
    await page.evaluate(() => document.getElementById('explore').scrollIntoView()); await settle(page, 500);
    const ex = await page.evaluate(() => [...document.querySelectorAll('.chart')].map((c) => { const dl = c.parentElement.querySelector('.explain'); if (!dl || !(c.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'no explanation after chart'; const dd = [...dl.querySelectorAll('dd')]; return dd.length === 3 && dd.every((d) => d.textContent.trim() && __visible(d)) ? 'ok' : `${dd.length} lines, some empty or hidden`; }));
    if (!ex.length) note(8, w, 'no charts found');
    ex.filter((x) => x !== 'ok').forEach((x) => note(8, w, x));

    // 9 · a p-value only inside a closed For the curious drawer
    const pv = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/p-value|\bp\s*[<=]\s*0?\.\d/i.test(n.nodeValue)) continue;
        const d = n.parentElement.closest('details.curious');
        if (!d || d.open) out.push(n.nodeValue.slice(0, 40));
      }
      return { bad: out, drawers: document.querySelectorAll('details.curious').length, open: document.querySelectorAll('details.curious[open]').length, folds: document.querySelectorAll('details:not(.curious)').length };
    });
    if (pv.bad.length || pv.open || pv.folds || !pv.drawers) note(9, w, JSON.stringify(pv));

    // 15 · contrast of every text/background pair, and chart marks
    const pairs = await page.evaluate(() => {
      const out = [];
      const solid = (el) => { for (let e = el; e; e = e.parentElement) { const c = __parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c.rgb; } return [14, 14, 16]; };
      for (const el of document.querySelectorAll('main *, .topbar *, .credits *')) {
        if (el.closest('svg') || !__visible(el) || el.disabled || el.closest('[disabled]')) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
        const c = __parse(getComputedStyle(el).color);
        const bg = solid(el);
        const fg = c.rgb.map((v, i) => Math.round(v * c.a + bg[i] * (1 - c.a)));
        out.push({ kind: 'text', fg, bg, where: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] });
      }
      document.querySelectorAll('.chart svg').forEach((svg) => {
        const bg = (() => { for (let e = svg.parentElement; e; e = e.parentElement) { const c = __parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c.rgb; } return [14, 14, 16]; })();
        svg.querySelectorAll('.dot').forEach((d) => { const f = d.getAttribute('fill'); out.push({ kind: 'mark', fg: [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16)).map((v, i) => Math.round(v * 0.85 + bg[i] * 0.15)), bg, where: 'chart dot' }); });
        svg.querySelectorAll('text').forEach((t) => { const f = t.getAttribute('fill'); if (f && f[0] === '#') out.push({ kind: 'text', fg: [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16)), bg, where: 'chart text' }); });
      });
      document.querySelectorAll('.orb').forEach((o) => out.push({ kind: 'text', fg: __parse(getComputedStyle(o).color).rgb, bg: [26, 26, 29], where: 'orb label (on --card)' }));
      return out;
    });
    for (const p of pairs) {
      const r = ratio(p.fg, p.bg);
      const key = `${p.kind} rgb(${p.fg}) on rgb(${p.bg})`;
      const prev = contrastRows.get(key);
      if (!prev || r < prev.r) contrastRows.set(key, { r, kind: p.kind, where: p.where });
      if (r < (p.kind === 'mark' ? 3 : 4.5)) note(15, w, `${p.where}: ${key} = ${r.toFixed(2)}`);
    }

    // 16 · Tab reaches every control in reading order with a visible ring; orbs are a radio group
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement.blur(); });
    const stops = [];
    for (let i = 0; i < 260; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const r = el.getBoundingClientRect();
        return { id: el.dataset.k || el.className || el.tagName, ring, w: r.width, h: r.height, order: [...document.querySelectorAll('*')].indexOf(el), inFooter: !!el.closest('.credits') };
      });
      if (!info) break;
      stops.push(info);
      if (info.inFooter) break;
    }
    const noRing = stops.filter((x) => !x.ring).map((x) => x.id);
    if (noRing.length) note(16, w, 'no visible focus ring: ' + [...new Set(noRing)].slice(0, 6).join(', '));
    const small = stops.filter((x) => x.w < 44 || x.h < 44).map((x) => `${x.id} ${Math.round(x.w)}×${Math.round(x.h)}`);
    if (small.length) note(16, w, 'targets under 44px: ' + [...new Set(small)].slice(0, 8).join(', '));
    const backwards = stops.filter((x, i) => i > 0 && x.order < stops[i - 1].order && !/rdot|brand|navlinks|menu/.test(stops[i - 1].id + x.id));
    if (backwards.length) note(16, w, 'out of reading order at: ' + backwards.map((x) => x.id).slice(0, 4).join(', '));
    if (!stops.some((x) => /^orb-/.test(x.id))) note(16, w, 'orbs not reached by Tab');
    await page.selectOption('#explore select[data-k="metric"]', 'abundance'); await settle(page, 300);
    await page.focus('#explore .orb[aria-checked="true"]');
    const before = await page.$eval('#explore .orb[aria-checked="true"]', (o) => o.dataset.k);
    await page.keyboard.press('ArrowRight'); await settle(page, 200);
    const after = await page.evaluate(() => ({ checked: document.querySelector('#explore .orb[aria-checked="true"]').dataset.k, focused: document.activeElement.dataset.k }));
    if (after.checked === before || after.focused !== after.checked) note(16, w, `arrow key on orbs: ${before} → ${JSON.stringify(after)}`);

    // 10 · Start arrives at the next section in 900–1300ms
    await page.evaluate(() => window.scrollTo(0, 0)); await settle(page, 300);
    const ms = await page.evaluate(() => new Promise((resolve) => { const target = document.querySelector('main .sec:nth-of-type(2)'); const t0 = performance.now(); document.querySelector('#question .pill').click(); const poll = () => { if (Math.abs(target.getBoundingClientRect().top) < 2) resolve(performance.now() - t0); else if (performance.now() - t0 > 4000) resolve(-1); else requestAnimationFrame(poll); }; requestAnimationFrame(poll); }));
    if (!(ms >= 900 && ms <= 1300)) note(10, w, `Start took ${Math.round(ms)}ms`); else note('10ok', w, `${Math.round(ms)}ms`);

    // 11 · wheel and touch are never prevented; snapping is y proximity
    const y0 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(w / 2, 400); await page.mouse.wheel(0, 600); await settle(page, 500);
    const sc = await page.evaluate(() => ({ y: window.scrollY, snap: getComputedStyle(document.documentElement).scrollSnapType,  // Chromium serialises "y proximity" as "y" (proximity is the default)
      prevented: window.__prevented.filter((t) => /wheel|touch|scroll/.test(t)) }));
    if (sc.y === y0 || !/^y( proximity)?$/.test(sc.snap) || sc.prevented.length) note(11, w, JSON.stringify(sc));

    // 12/13 · the film, with the test clip in place of the real file
    if (fixture) {
      const v0 = await page.evaluate(() => { window.scrollTo(0, 0); const v = document.querySelector('#video video'); return { paused: v.paused, muted: v.muted }; });
      await settle(page, 600);
      const early = await page.evaluate(() => document.querySelector('#video video').paused);
      await page.evaluate(() => document.querySelector('#video .frame').scrollIntoView({ block: 'center' })); await settle(page, 1500);
      const playing = await page.evaluate(() => { const v = document.querySelector('#video video'); return !v.paused && v.currentTime > 0; });
      await page.evaluate(() => document.getElementById('lab').scrollIntoView()); await settle(page, 600);
      const pausedAway = await page.evaluate(() => document.querySelector('#video video').paused);
      if (!v0.muted || !early || !playing || !pausedAway) note(12, w, JSON.stringify({ muted: v0.muted, pausedBefore60: early, playsAt60: playing, pausesWhenAway: pausedAway }));
      // captions
      await page.evaluate(() => document.querySelector('#video .frame').scrollIntoView({ block: 'center' })); await settle(page, 300);
      for (const at of [3, 9, 15, 21, 27]) {
        const got = await page.evaluate((t) => new Promise((resolve) => { const v = document.querySelector('#video video'); v.pause(); v.currentTime = t; setTimeout(() => { const caps = [...document.querySelectorAll('#video .caption')].filter((c) => c.classList.contains('on') && getComputedStyle(c).opacity > 0.5); resolve(caps.map((c) => c.textContent)); }, 900); }), at);
        const want = DATA.video.captions.find((c) => at >= c.from && at < c.to);
        const expect = want && want.text.replace('{{donorTotal}}', new Intl.NumberFormat('en-GB').format(DATA.meta.donorTotal.value)).replace('{{cellsTotal}}', new Intl.NumberFormat('en-GB').format(DATA.meta.cellsTotal.value));
        if (got.length !== 1 || got[0] !== expect) note(13, w, `at ${at}s: ${JSON.stringify(got)} (want ${JSON.stringify(expect)})`);
      }
    }
    await ctx.close();
  }

  // 1 · at 360px the title still sits on one line, inside the 16px gutters
  {
    const { ctx, page } = await openPage(browser, 360);
    await settle(page, 1500);
    const r = await page.$eval('h1.title', (el) => { const ls = [...el.querySelectorAll('.l')].map((s) => s.getBoundingClientRect()); const fs = parseFloat(getComputedStyle(el).fontSize); return { lines: new Set(ls.map((b) => Math.round(b.top / (fs * 0.5)))).size, left: Math.min(...ls.map((b) => b.left)), right: Math.max(...ls.map((b) => b.right)), sw: document.documentElement.scrollWidth - innerWidth }; });
    if (r.lines !== 1 || r.left < 16 - 4 || r.right > 360 - 16 + 4 || r.sw > 0) note(1, 360, JSON.stringify(r));
    await ctx.close();
  }

  // 10 & 12 under reduced motion
  {
    const { ctx, page } = await openPage(browser, 1440, { reduced: true });
    const ms = await page.evaluate(() => new Promise((resolve) => { const target = document.querySelector('main .sec:nth-of-type(2)'); const t0 = performance.now(); document.querySelector('#question .pill').click(); const poll = () => { if (Math.abs(target.getBoundingClientRect().top) < 2) resolve(performance.now() - t0); else if (performance.now() - t0 > 4000) resolve(-1); else requestAnimationFrame(poll); }; requestAnimationFrame(poll); }));
    if (!(ms >= 0 && ms < 100)) note(10, 'reduced', `Start took ${Math.round(ms)}ms`); else note('10ok', 'reduced', `${Math.round(ms)}ms`);
    if (fixture) {
      await page.evaluate(() => document.querySelector('#video .frame').scrollIntoView({ block: 'center' })); await settle(page, 1500);
      const r = await page.evaluate(() => ({ paused: document.querySelector('#video video').paused, transcript: !document.querySelector('#video .transcript').hidden }));
      if (!r.paused || !r.transcript) note(12, 'reduced', JSON.stringify(r));
    }
    await ctx.close();
  }

  // 14 · the film file missing
  filmMode = 'missing';
  {
    const { ctx, page } = await openPage(browser, 390, { hash: '#video#check' });
    await settle(page, 1200);
    const r = await page.evaluate(() => { const sec = document.getElementById('video'); const pillEl = sec.querySelector('.pill'); return { heading: !!sec.querySelector('h2') && __visible(sec.querySelector('h2')), transcript: __visible(sec.querySelector('.transcript')), button: !!pillEl && __visible(pillEl), check: (document.getElementById('phcount') || {}).textContent || '' }; });
    if (!r.heading || !r.transcript || !r.button || !/Video file missing/i.test(r.check)) note(14, 390, JSON.stringify(r));
    await ctx.close();
  }
  filmMode = 'fixture';

  // 17 · the contract checker
  let contract = '';
  try { contract = execSync('python3 notebook/validate_contract.py data/seaad-mtg.json', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { note(17, '-', 'validate_contract.py failed: ' + (e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).join(' | ')); }

  await browser.close();
  srv.close();

  console.log(`\nUnravel v5 acceptance checks at ${WIDTHS.join(', ')}px\n`);
  if (fail[0]) record(0, 'No script errors on the page', false, fail[0].join(' / '));
  const names = {
    1: 'Title on one line at every width, no horizontal scroll', 2: 'Title face is Bagel Fat One (or Lilita One); no outside requests', 3: 'Only token colours on background, border and text',
    4: 'Instrument Serif appears nowhere', 5: 'Title screen: one h1, one paragraph, one button, one mono label', 6: 'Exactly one coral pill per section',
    7: 'No mode switch, helper or explanation toggle', 8: 'Every chart has three visible explanation lines', 9: 'p-values only inside a closed "For the curious" drawer',
    10: 'Start: 900–1300ms; under reduced motion under 100ms', 11: 'Wheel and touch never prevented; snap is y proximity', 12: 'Film: plays at 60% visible, pauses away, muted, never under reduced motion',
    13: 'Film captions at 3, 9, 15, 21 and 27 seconds', 14: 'Film missing: heading, transcript, button, and a #check failure', 15: 'Contrast: text 4.5:1, chart marks 3:1',
    16: 'Keyboard: reading order, visible ring, 44px targets, orbs as a radio group', 17: 'validate_contract.py passes',
  };
  for (let n = 1; n <= 17; n += 1) {
    const skip = (n === 12 || n === 13) && !fixture;
    record(n, names[n], skip ? null : !fail[n], skip ? 'no ffmpeg to make the test clip' : fail[n] ? fail[n].join(' / ') : n === 10 ? (fail['10ok'] || []).join(', ') : '');
  }
  console.log('\nContrast table (lowest ratio per colour pair):');
  [...contrastRows.entries()].sort((a, b) => a[1].r - b[1].r).forEach(([k, v]) => console.log(`  ${v.r.toFixed(2).padStart(6)} : 1   ${k}   (${v.where})`));
  if (contract) console.log('\n' + contract.split('\n').filter((l) => /^(OK|ERROR)/.test(l)).join('\n'));
  process.exit(results.some((r) => r.ok === false) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
