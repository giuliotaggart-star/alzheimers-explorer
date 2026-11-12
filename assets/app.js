/* Alzheimer's Explorer — all behaviour.
   Every word of subject content, every number, unit, colour and address on screen is read from
   data/seaad-mtg.json. The only English in this file is page furniture (UI below), and the data
   file can override that too through its optional "ui" object.
   Nothing about the visitor is stored: progress lives in memory and is gone on reload. */
(() => {
  'use strict';

  const DATA_URL = 'data/seaad-mtg.json';

  // Page furniture only. Nothing here says anything about the science.
  const UI = {
    next: 'Next',
    back: 'Back',
    start: 'Start',
    journey: 'Steps',
    stepDone: 'done',
    showAnswer: 'Show me the answer',
    choose: 'choose',
    tried: 'tried',
    copy: 'Copy',
    copied: 'Copied',
    copySelected: 'Selected — copy it with your device',
    newTab: '(opens in a new tab)',
    unitMissing: '[unit missing]',
    loadFailTitle: 'The data did not load',
    loadFailHelp: 'If you opened this page straight from a folder, serve the folder instead: run “python3 -m http.server” in it and open http://localhost:8000.',
  };
  const ui = (key) => (data && data.ui && data.ui[key]) || UI[key];

  // The two groups are fixed by the data contract's keys; what they are called comes from the data.
  const GROUPS = [{ key: 'normal', cls: 'a' }, { key: 'dementia', cls: 'b' }];
  // Used only when a cell type has no colour of its own in the data.
  const FALLBACK_COLOURS = ['#c8553d', '#0e8a8a', '#b3741a', '#b8479f', '#3f9142', '#4f7cc4', '#8a6d3b', '#5b8c5a'];

  const main = document.getElementById('main');
  const crumbs = document.getElementById('crumbs');
  const notice = document.getElementById('notice');
  const credits = document.getElementById('credits');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let data = null;
  let routes = new Map();            // hash -> { cell, gene }
  let current = { kind: '', cell: null, gene: null };
  const visited = new Set();         // journey steps seen this visit
  const cloze = new Map();           // passage key -> { done: Map(blank id -> 'right'|'shown'), tried: Map(blank id -> Set), active, last }
  const mapState = { sorted: false, focus: null };
  let firstRender = true;

  /* ---------- small helpers ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false || kid === '') continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  function s(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : []);
  const slug = (v) => String(v).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Rounds for display, but never rounds a real difference away to zero.
  function num(v, digits = 1) {
    if (!isNum(v)) return '';
    let d = digits;
    while (v !== 0 && d < 6 && Number(v.toFixed(d)) === 0) d += 1;
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: d }).format(v);
  }

  // A number never appears without its unit. If the data gives none, say so on screen.
  function qty(v, unit, digits = 1) {
    const shown = isNum(v) ? num(v, digits) : isText(v) ? v : '';
    if (shown === '') return '';
    const u = isText(unit) ? unit : ui('unitMissing');
    return shown + (/^[%°]/.test(u) ? '' : ' ') + u;
  }
  const qv = (obj, digits = 0) => (obj && (isNum(obj.value) || isText(obj.value)) ? qty(obj.value, obj.unit, digits) : '');

  function fmtDate(value) {
    if (!isText(value)) return '';
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // A "nice" axis that always starts at zero and is never zoomed to flatter the data.
  function niceAxis(maxValue) {
    const max = maxValue > 0 ? maxValue : 1;
    const rough = max / 5;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((c) => c >= rough);
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let t = 0; t <= top + step / 2; t += step) ticks.push(Number(t.toPrecision(10)));
    return { max: top, ticks };
  }

  const PAD = 3; // % of track width kept clear at each end so dots at the edges are not clipped
  const xPct = (v, axis) => PAD + (Math.max(0, v) / axis.max) * (100 - 2 * PAD);
  const unitScale = () => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;

  /* ---------- data access, tolerant of gaps ---------- */

  const stage = (id) => (data.stages && data.stages[id]) || null;
  const measure = () => data.measure || {};
  const dec = () => (isNum(measure().decimals) ? measure().decimals : 1);
  const geneMeasure = () => data.geneMeasure || {};
  const geneDec = () => (isNum(geneMeasure().decimals) ? geneMeasure().decimals : 2);
  const groupName = (key, short) => {
    const g = (data.groups && data.groups[key]) || {};
    return (short && g.short) || g.label || g.short || key;
  };
  const groupOf = (obj, key) => (obj && obj.values && obj.values[key]) || {};
  const donorsOf = (g) => (Array.isArray(g.donorValues) ? g.donorValues.filter(isNum) : []);
  const hasDonors = (cell) => GROUPS.some((g) => donorsOf(groupOf(cell, g.key)).length > 0);
  const diffOf = (cell) => {
    const e = cell.effect || {};
    if (isNum(e.difference)) return e.difference;
    const a = groupOf(cell, 'normal').mean;
    const b = groupOf(cell, 'dementia').mean;
    return isNum(a) && isNum(b) ? b - a : 0;
  };
  const colourOf = (cell) => {
    if (cell && /^#[0-9a-fA-F]{3,8}$/.test(cell.colour || '')) return cell.colour;
    const i = Math.max(0, data.cellTypes.indexOf(cell));
    return FALLBACK_COLOURS[i % FALLBACK_COLOURS.length];
  };
  const genesOf = (cell) => list(cell && cell.topGenes).filter((g) => g && g.symbol);

  function extentOf(item) {
    let max = 0;
    for (const g of GROUPS) {
      const v = groupOf(item, g.key);
      for (const d of donorsOf(v)) max = Math.max(max, d);
      if (isNum(v.mean)) max = Math.max(max, v.mean + (isNum(v.sd) ? v.sd : 0));
    }
    return max;
  }

  function geneRatio(gene) {
    const a = groupOf(gene, 'normal').mean;
    const b = groupOf(gene, 'dementia').mean;
    if (!isNum(a) || !isNum(b) || a <= 0) return null;
    const r = b / a;
    const hit = list(geneMeasure().ratioWords).find((w) => !isNum(w.below) || r < w.below);
    if (!hit || !isText(hit.text)) return null;
    return { same: !!hit.same, text: hit.text.replace(/\{\{\s*ratio\s*\}\}/g, num(Math.round(r), 0)) };
  }

  /* ---------- tokens: sentences in the data can quote live values, so text and chart cannot drift ---------- */

  function tokenValue(name, c) {
    const m = measure();
    const meta = data.meta || {};
    const cell = c.cell;
    const gene = c.gene;
    const e = (cell && cell.effect) || {};
    const a = groupOf(cell, 'normal');
    const b = groupOf(cell, 'dementia');
    const out = (v) => (v === '' || v === null || v === undefined ? undefined : String(v));
    if (c.extra && Object.prototype.hasOwnProperty.call(c.extra, name)) return out(c.extra[name]);
    switch (name) {
      case 'cellLabel': return out(cell && cell.label);
      case 'cellLabelLower': return out(cell && isText(cell.label) ? cell.label.toLowerCase() : '');
      case 'measureLabel': return out(m.label);
      case 'unit': return out(m.unit);
      case 'higherMeans': return out(m.higherMeans);
      case 'difference': return out(num(e.difference, dec()));
      case 'differenceWithUnit': return out(qty(e.difference, e.unit || m.unit, dec()));
      case 'direction': return out(((data.cellScreen || {}).directionWords || {})[e.direction] || e.direction);
      case 'cohensD': return out(num(e.cohensD, 2));
      case 'effectSize': return out(e.plainSize);
      case 'meanNormal': return out(qty(a.mean, m.unit, dec()));
      case 'meanDementia': return out(qty(b.mean, m.unit, dec()));
      case 'nNormal': return out(qty(a.n, a.nUnit, 0));
      case 'nDementia': return out(qty(b.n, b.nUnit, 0));
      case 'nTotal': return out(isNum(a.n) && isNum(b.n) ? qty(a.n + b.n, a.nUnit || b.nUnit, 0) : '');
      case 'nUnit': return out(a.nUnit || b.nUnit);
      case 'genesChanged': return out(qv(cell && cell.genesChanged));
      case 'region': return out(meta.region);
      case 'regionPlain': return out(meta.regionPlain);
      case 'donorTotal': return out(qv(meta.donorTotal));
      case 'cellsTotal': return out(qv(meta.cellsTotal));
      case 'groupNormal': return out(groupName('normal'));
      case 'groupDementia': return out(groupName('dementia'));
      case 'groupNormalShort': return out(groupName('normal', true));
      case 'groupDementiaShort': return out(groupName('dementia', true));
      case 'geneSymbol': return out(gene && gene.symbol);
      case 'geneChange': { const r = gene && geneRatio(gene); return out(r && r.text); }
      case 'geneMeasureLabel': return out(geneMeasure().label);
      case 'geneUnit': return out((gene && gene.unit) || geneMeasure().unit || ui('unitMissing'));
      case 'wordLimit': return out(isNum((data.challenge || {}).wordLimit) ? (data.challenge || {}).wordLimit : '');
      case 'deadline': return out(fmtDate((data.config || {}).entryDeadline));
      default: return undefined;
    }
  }

  const TOKEN = /\{\{\s*([A-Za-z0-9]+)\s*\}\}/g;
  const ctx = (cell, gene, extra) => ({ cell: cell || null, gene: gene || null, extra: extra || null });

  // As plain text. A token that cannot be resolved is left exactly as written.
  function fill(template, c) {
    if (!isText(template)) return '';
    return template.replace(TOKEN, (whole, name) => { const v = tokenValue(name, c || ctx()); return v === undefined ? whole : v; });
  }

  // As DOM nodes. A token that cannot be resolved is left as written and visibly marked, so a typo cannot hide.
  function fillNodes(template, c, strong) {
    if (!isText(template)) return [];
    const nodes = [];
    let last = 0;
    template.replace(TOKEN, (whole, name, at) => {
      if (at > last) nodes.push(template.slice(last, at));
      const v = tokenValue(name, c || ctx());
      if (v === undefined) nodes.push(h('mark', { class: 'badtoken', text: whole }));
      else if (strong && strong[name]) nodes.push(h('b', { class: strong[name], text: v }));
      else nodes.push(v);
      last = at + whole.length;
      return whole;
    });
    if (last < template.length) nodes.push(template.slice(last));
    return nodes;
  }

  const para = (template, cls, c, strong) => (isText(template) ? h('p', { class: cls || null }, fillNodes(template, c, strong)) : null);
  const paras = (arr, cls, c) => list(arr).map((t) => para(t, cls, c));

  /* ---------- the journey: which screens exist, and their order ---------- */

  function sharedPassage() { const w = data.writeUp || {}; return w.shared && list(w.shared.parts).length ? w.shared : null; }
  function passageFor(cell) {
    const own = cell && cell.writeUp && list(cell.writeUp.parts).length ? cell.writeUp : null;
    return own || sharedPassage();
  }
  function headlineCell() {
    const id = (data.writeUp || {}).headlineCell;
    return data.cellTypes.find((c) => c.id === id) || [...data.cellTypes].sort((p, q) => Math.abs(diffOf(q)) - Math.abs(diffOf(p)))[0];
  }
  const hasWriteUp = () => !!sharedPassage() || data.cellTypes.some((c) => passageFor(c));

  function steps() {
    const out = [];
    if (stage('data')) out.push({ id: 'data', route: 'data', label: stage('data').navLabel || stage('data').heading });
    if (stage('mapping')) out.push({ id: 'mapping', route: 'mapping', label: stage('mapping').navLabel || stage('mapping').heading });
    const an = stage('analysis') || {};
    out.push({ id: 'analysis', route: 'top', label: an.navLabel || an.heading || (data.meta || {}).title });
    if (hasWriteUp()) out.push({ id: 'writeup', route: 'writeup', label: (data.writeUp || {}).navLabel || (data.writeUp || {}).heading });
    return out;
  }
  const stepAfter = (id) => { const all = steps(); const i = all.findIndex((x) => x.id === id); return i >= 0 ? all[i + 1] || null : null; };
  const stepBefore = (id) => { const all = steps(); const i = all.findIndex((x) => x.id === id); return i > 0 ? all[i - 1] : null; };
  const stepOf = (kind) => (kind === 'cell' || kind === 'gene' ? 'analysis' : kind);

  const button = (href, label, cls) => (isText(label) ? h('a', { class: 'btn' + (cls ? ' ' + cls : ''), href: '#' + href }, h('span', { text: label }), h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' })) : null);
  const backLink = (href, label) => h('a', { class: 'backlink', href: '#' + href }, h('span', { 'aria-hidden': 'true', text: '← ' }), label || ui('back'));
  const swatch = (cell) => h('span', { class: 'dot', style: `background:${colourOf(cell)}`, 'aria-hidden': 'true' });

  function nextButton(id, label) {
    const next = stepAfter(id);
    return next ? button(next.route, label || `${ui('next')}: ${next.label}`) : null;
  }
  function backToStep(id) {
    const prev = stepBefore(id);
    if (prev) return backLink(prev.route, prev.label);
    return data.intro ? backLink('start', (data.meta || {}).shortTitle || ui('back')) : null;
  }

  /* ---------- shared pieces ---------- */

  function figureCards(items) {
    const cards = list(items).filter((f) => f && (isNum(f.value) || isText(f.value)));
    if (!cards.length) return null;
    return h('ul', { class: 'figures' }, cards.map((f) => h('li', { class: 'figure-card' },
      h('span', { class: 'fvalue', text: isNum(f.value) ? num(f.value, isNum(f.decimals) ? f.decimals : 0) : f.value }),
      h('span', { class: 'funit', text: isText(f.unit) ? f.unit : ui('unitMissing') }),
      isText(f.label) && h('span', { class: 'flabel', text: f.label }),
      isText(f.note) && h('span', { class: 'fnote', text: f.note }))));
  }

  function picture(img, cls) {
    if (!img || !isText(img.src)) return null;
    return h('figure', { class: 'picture' + (cls ? ' ' + cls : '') },
      h('img', { src: img.src, alt: img.alt || '', loading: 'lazy', decoding: 'async' }),
      isText(img.caption) && h('figcaption', { class: 'small', text: img.caption }));
  }

  /* ---------- the dumbbell: used on every screen so the picture never changes ---------- */

  function buildTrack(item, axis, size) {
    const u = unitScale();
    const big = size === 'big';
    const H = (big ? 150 : 66) * u;
    const mid = H / 2;
    const meanR = (big ? 12 : 8) * u;
    const lane = (big ? 46 : 20) * u;       // height of each donor lane
    const gap = (big ? 18 : 10) * u;        // clear space between the centre line and a lane
    const svg = s('svg', { height: H, role: 'img', 'aria-hidden': 'true', focusable: 'false' });

    axis.ticks.forEach((t) => {
      const x = xPct(t, axis) + '%';
      svg.append(s('line', { class: t === 0 ? 'grid-line zero' : 'grid-line', x1: x, x2: x, y1: 0, y2: H }));
    });

    GROUPS.forEach((g, gi) => {
      const v = groupOf(item, g.key);
      const donors = donorsOf(v);
      const dir = gi === 0 ? -1 : 1;        // group A sits above the centre line, group B below
      if (donors.length) {
        const many = donors.length > 400;
        const r = (big ? 4.5 : 2.8) * u * (many ? 0.6 : 1);
        const opacity = many ? 0.25 : donors.length > 120 ? 0.45 : 0.7;
        donors.forEach((d, i) => {
          const jitter = (i * 0.61803398875) % 1;   // deterministic, so the picture is stable between visits
          svg.append(s('circle', {
            class: 'donor ' + g.cls, r, 'fill-opacity': opacity,
            cx: xPct(d, axis) + '%', cy: mid + dir * (gap + jitter * lane),
          }));
        });
      } else if (isNum(v.mean) && isNum(v.sd)) {
        const y = mid + dir * (gap + lane / 2);
        const cap = 5 * u;
        const x1 = xPct(v.mean - v.sd, axis) + '%';
        const x2 = xPct(v.mean + v.sd, axis) + '%';
        const xm = xPct(v.mean, axis) + '%';
        svg.append(s('line', { class: 'whisker ' + g.cls, x1, x2, y1: y, y2: y, 'stroke-width': 2.5 * u }));
        svg.append(s('line', { class: 'whisker ' + g.cls, x1, x2: x1, y1: y - cap, y2: y + cap, 'stroke-width': 2.5 * u }));
        svg.append(s('line', { class: 'whisker ' + g.cls, x1: x2, x2, y1: y - cap, y2: y + cap, 'stroke-width': 2.5 * u }));
        svg.append(s('line', { class: 'whisker ' + g.cls, x1: xm, x2: xm, y1: mid, y2: y, 'stroke-width': 1.5 * u }));
      }
    });

    const a = groupOf(item, 'normal').mean;
    const b = groupOf(item, 'dementia').mean;
    if (isNum(a) && isNum(b)) {
      svg.append(s('line', { class: 'link', x1: xPct(a, axis) + '%', x2: xPct(b, axis) + '%', y1: mid, y2: mid, 'stroke-width': (big ? 5 : 3.5) * u }));
    }
    GROUPS.forEach((g) => {
      const m = groupOf(item, g.key).mean;
      if (!isNum(m)) return;
      svg.append(s('circle', { class: 'mean ' + g.cls, cx: xPct(m, axis) + '%', cy: mid, r: meanR, 'stroke-width': (g.cls === 'a' ? 3.5 : 2) * u }));
    });
    return svg;
  }

  function buildTicks(axis, unit) {
    const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' });
    axis.ticks.forEach((t, i) => {
      const label = i === axis.ticks.length - 1 && unit && /^[%°]/.test(unit) ? num(t, 2) + unit.charAt(0) : num(t, 2);
      ticks.append(h('span', { style: `left:${xPct(t, axis)}%`, text: label }));
    });
    return ticks;
  }

  function legend() {
    return h('p', { class: 'legend' },
      GROUPS.map((g) => h('span', {}, h('span', { class: 'swatch ' + g.cls, 'aria-hidden': 'true' }), groupName(g.key))));
  }

  const axisTitle = () => [measure().label, measure().unit || ui('unitMissing')].filter(Boolean).join(' — ');
  const sharedAxis = () => niceAxis(Math.max(...data.cellTypes.map(extentOf)));
  const sortedCells = () => [...data.cellTypes].sort((p, q) => Math.abs(diffOf(q)) - Math.abs(diffOf(p)));

  // The enlarged chart for one cell type: same axis as the full chart, so it reads as a zoom.
  function cellFigure(cell, heading) {
    const cs = data.cellScreen || {};
    const axis = sharedAxis();
    const track = h('div', { class: 'track' }, buildTrack(cell, axis, 'big'));
    const caption = fill(hasDonors(cell) ? cs.figCaptionDonors || cs.figCaption : cs.figCaption, ctx(cell)) || axisTitle();
    const fig = h('figure', { class: 'hero' },
      heading && h('p', { class: 'figtitle' }, swatch(cell), heading),
      legend(),
      h('div', { class: 'axis' }, buildTicks(axis, measure().unit)),
      track,
      h('figcaption', { class: 'small', text: caption }));
    return { fig, track };
  }

  /* ---------- opening screen ---------- */

  function renderStart() {
    const intro = data.intro || {};
    const all = steps();
    const first = all[0];
    return h('section', { class: 'view start' },
      h('div', { class: 'start-head' },
        h('h1', { tabindex: '-1', text: intro.heading || (data.meta || {}).title || '' }),
        para(intro.pitch, 'lede')),
      h('div', { class: 'block' },
        isText(intro.stepsHeading) && h('h2', { class: 'kicker', text: intro.stepsHeading }),
        h('ol', { class: 'path' }, all.map((st, i) => h('li', {},
          h('a', { href: '#' + st.route },
            h('span', { class: 'n', 'aria-hidden': 'true', text: String(i + 1) }),
            h('span', { class: 'plabel', text: st.label }),
            isText((intro.steps || {})[st.id]) && h('span', { class: 'ptext', text: intro.steps[st.id] })))))),
      h('div', { class: 'start-go' },
        first && button(first.route, intro.startLabel || ui('start'), 'big'),
        para(intro.timeNote, 'small')));
  }

  /* ---------- stage 1: data ---------- */

  function renderData() {
    const st = stage('data');
    return h('section', { class: 'view' },
      backToStep('data'),
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1', text: st.heading || st.navLabel || '' }),
        paras(st.body, 'lede')),
      figureCards(st.figures),
      picture(st.image, 'wide'),
      h('div', { class: 'actions' }, nextButton('data', st.nextLabel)));
  }

  /* ---------- stage 2: mapping — the site draws the map itself and sorts it in front of the student ---------- */

  function mapPoints() {
    const src = (data.map && data.map.points) || null;
    if (!src || typeof src !== 'object') return null;
    const groups = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
    for (const [id, pts] of Object.entries(src)) {
      const clean = list(pts).filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
      if (!clean.length) continue;
      for (const p of clean) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      groups.push({ id, cell: data.cellTypes.find((c) => c.id === id) || null, pts: clean });
      count += clean.length;
    }
    if (!count) return null;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const M = 0.07;                         // margin, as a share of the canvas
    let seed = 20261112;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const g of groups) {
      let sx = 0, sy = 0;
      g.sorted = g.pts.map((p) => {
        const x = M + ((p[0] - minX) / spanX) * (1 - 2 * M);
        const y = 1 - (M + ((p[1] - minY) / spanY) * (1 - 2 * M));   // up is up
        sx += x; sy += y;
        return [x, y];
      });
      g.centre = [sx / g.pts.length, sy / g.pts.length];
      g.mixed = g.pts.map(() => {            // a jumble: everything in one round heap
        const r = 0.4 * Math.sqrt(rand());
        const t = rand() * Math.PI * 2;
        return [0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t)];
      });
      g.delay = g.pts.map(() => rand() * 0.35);
    }
    return groups;
  }

  function mapFigure(st) {
    const groups = mapPoints();
    if (!groups) return { node: picture(st.image), setFocus: null };

    const canvas = h('canvas', { role: 'img', 'aria-label': st.mapAlt || (st.image || {}).alt || '' });
    const labels = h('div', { class: 'maplabels', 'aria-hidden': 'true' },
      groups.filter((g) => g.cell).map((g) => h('span', { style: `left:${g.centre[0] * 100}%;top:${g.centre[1] * 100}%`, text: g.cell.label })));
    const frame = h('div', { class: 'mapframe' + (mapState.sorted ? ' sorted' : '') }, canvas, labels);
    const caption = h('figcaption', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const toggle = h('button', { type: 'button', class: 'btn quiet' });
    let t = mapState.sorted ? 1 : 0;        // 0 = jumbled, 1 = sorted
    let raf = 0;

    const draw = () => {
      const css = getComputedStyle(document.documentElement);
      const grey = css.getPropertyValue('--ink-soft').trim() || '#777';
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const hgt = canvas.clientHeight;
      if (!w || !hgt) return;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(hgt * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(hgt * ratio); }
      const g2 = canvas.getContext('2d');
      g2.setTransform(ratio, 0, 0, ratio, 0, 0);
      g2.clearRect(0, 0, w, hgt);
      const r = Math.max(1.4, Math.min(w, hgt) / 210);
      const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const pass = (g, colour, alpha) => {
        if (alpha <= 0.004) return;
        g2.globalAlpha = alpha;
        g2.fillStyle = colour;
        g2.beginPath();
        for (let i = 0; i < g.pts.length; i += 1) {
          const local = ease(Math.min(1, Math.max(0, (t - g.delay[i]) / 0.65)));
          const x = (g.mixed[i][0] + (g.sorted[i][0] - g.mixed[i][0]) * local) * w;
          const y = (g.mixed[i][1] + (g.sorted[i][1] - g.mixed[i][1]) * local) * hgt;
          g2.moveTo(x + r, y);
          g2.arc(x, y, r, 0, Math.PI * 2);
        }
        g2.fill();
      };
      for (const g of groups) {
        const focused = mapState.focus === g.id;
        const dim = mapState.focus && !focused ? 0.22 : 1;
        const tint = !g.cell ? 0 : focused ? 1 : ease(Math.min(1, t * 1.4));   // a chosen type shows its colour even in the jumble
        pass(g, grey, 0.55 * (1 - tint) * dim);
        if (g.cell) pass(g, colourOf(g.cell), 0.85 * tint * dim);
      }
      g2.globalAlpha = 1;
    };

    const sync = () => {
      frame.classList.toggle('sorted', t >= 1);
      toggle.textContent = (mapState.sorted ? st.unsortLabel : st.sortLabel) || '';
      toggle.hidden = !toggle.textContent;
      caption.textContent = (mapState.sorted ? st.captionSorted : st.captionUnsorted) || '';
      caption.hidden = !caption.textContent;
    };

    const animate = () => {
      cancelAnimationFrame(raf);
      const target = mapState.sorted ? 1 : 0;
      if (reducedMotion.matches) { t = target; sync(); draw(); return; }
      frame.classList.remove('sorted');
      const from = t;
      const began = performance.now();
      const length = 1500 * Math.abs(target - from) || 1;
      const tick = (now) => {
        if (!canvas.isConnected) return;
        const k = Math.min(1, (now - began) / length);
        t = from + (target - from) * k;
        draw();
        if (k < 1) raf = requestAnimationFrame(tick); else sync();
      };
      raf = requestAnimationFrame(tick);
    };

    toggle.addEventListener('click', () => { mapState.sorted = !mapState.sorted; sync(); animate(); });
    sync();
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (canvas.isConnected) draw(); }).observe(canvas);
    requestAnimationFrame(draw);

    return {
      node: h('figure', { class: 'mapfig' }, frame, h('div', { class: 'maptools' }, toggle), caption),
      setFocus: (id) => { mapState.focus = id; draw(); },
    };
  }

  function renderMapping() {
    const st = stage('mapping');
    const map = mapFigure(st);
    const keyButtons = [];
    const key = h('ul', { class: 'key' }, data.cellTypes.map((cell) => {
      const body = [swatch(cell), h('span', { class: 'kname', text: cell.label }), isText(cell.shortRole) && h('span', { class: 'krole', text: cell.shortRole })];
      if (!map.setFocus) return h('li', {}, h('span', { class: 'keyitem' }, body));
      const b = h('button', {
        type: 'button', class: 'keyitem', 'aria-pressed': mapState.focus === cell.id ? 'true' : 'false',
        onclick: () => {
          const on = mapState.focus !== cell.id;
          map.setFocus(on ? cell.id : null);
          keyButtons.forEach((x) => x.setAttribute('aria-pressed', x === b && on ? 'true' : 'false'));
        },
      }, body);
      keyButtons.push(b);
      return h('li', {}, b);
    }));
    const aside = st.aside && isText(st.aside.heading) && list(st.aside.body).length
      ? h('details', { class: 'drawer' }, h('summary', { text: st.aside.heading }), h('div', { class: 'drawer-body' }, paras(st.aside.body)))
      : null;
    return h('section', { class: 'view' },
      backToStep('mapping'),
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1', text: st.heading || st.navLabel || '' }),
        paras(st.body, 'lede')),
      h('div', { class: 'maplayout' },
        map.node,
        h('div', { class: 'block' },
          isText(st.keyHeading) && h('h2', { text: st.keyHeading }),
          map.setFocus && para(st.keyHint, 'small'),
          key)),
      figureCards(st.figures),
      aside,
      h('div', { class: 'actions' }, nextButton('mapping', st.nextLabel)));
  }

  /* ---------- stage 3: analysis — one chart ---------- */

  function renderChart(heroId) {
    const st = stage('analysis') || {};
    const cells = sortedCells();
    const axis = sharedAxis();
    const anyDonors = cells.some(hasDonors);

    const chart = h('ul', { class: 'chart' });
    chart.append(h('li', { class: 'axis' },
      h('span', { class: 'axis-title', text: axisTitle() }),
      buildTicks(axis, measure().unit), h('span', {})));

    cells.forEach((cell) => {
      const track = h('span', { class: 'track' }, buildTrack(cell, axis, 'small'));
      if (cell.id === heroId) track.style.viewTransitionName = 'hero';
      const readout = fill(st.rowReadout, ctx(cell));
      chart.append(h('li', {},
        h('a', { class: 'row', href: '#' + routeFor(cell), 'data-cell': cell.id, 'aria-label': [cell.label, cell.shortRole, readout].filter(Boolean).join('. ') },
          h('span', { class: 'rowlabel' },
            h('span', { class: 'name' }, swatch(cell), cell.label),
            isText(cell.shortRole) && h('span', { class: 'role', text: cell.shortRole }),
            readout && h('span', { class: 'readout', text: readout })),
          track,
          h('span', { class: 'go', 'aria-hidden': 'true', text: '›' }))));
    });

    const allSmall = cells.length > 0 && cells.every((c) => (c.effect || {}).plainSize === 'small');
    return h('section', { class: 'view' },
      backToStep('analysis'),
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1', text: st.heading || (data.meta || {}).title || '' }),
        paras(st.body, 'lede')),
      legend(),
      chart,
      para([anyDonors && st.dotCaption, st.chartCaption].filter(isText).join(' '), 'caption'),
      allSmall && para(st.allSmallNote, 'finding'),
      hasWriteUp() && h('div', { class: 'actions' }, button('writeup', st.writeUpLabel || (data.writeUp || {}).heading, 'quiet')));
  }

  /* ---------- one cell type ---------- */

  function numbersInWords(cell) {
    const cs = data.cellScreen || {};
    const e = cell.effect || {};
    const c = ctx(cell);
    const a = groupOf(cell, 'normal');
    const b = groupOf(cell, 'dementia');
    return [
      para(measure().plainQuestion, 'kicker'),
      isNum(a.mean) && isNum(b.mean) && para(cs.averageSentence, 'bignum', c, { meanDementia: 'gb', meanNormal: 'ga' }),
      para((cs.verdict || {})[e.direction], 'verdict', c),
      cell.storyRole === 'stable' && para(cs.stableNote, 'caption'),
    ];
  }

  function pText(p, st) {
    if (!isNum(p)) return '';
    const floor = isNum(st.floor) ? st.floor : 0;
    if (p < floor && isText(st.belowFloor)) return st.belowFloor;
    return new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 2 }).format(p);
  }

  function factList(rows) {
    const facts = h('dl', { class: 'block' });
    rows.forEach(([term, value, unitNote, note]) => {
      if (!isText(term) || !value) return;
      facts.append(h('div', {},
        h('dt', {}, h('b', { text: term })),
        h('dd', {}, value, isText(unitNote) && h('span', { class: 'unitnote', text: ` (${unitNote})` }), isText(note) && h('span', { class: 'small', text: ' ' + note }))));
    });
    return facts.children.length ? facts : null;
  }

  function statsDrawer(cell) {
    const st = data.stats;
    if (!st || !isText(st.summary)) return null;
    const meta = data.meta || {};
    const e = cell.effect || {};
    const c = ctx(cell);
    const cols = st.columns || {};
    const rows = GROUPS.map((g) => {
      const v = groupOf(cell, g.key);
      return h('tr', {},
        h('th', { scope: 'row', text: groupName(g.key) }),
        h('td', { class: 'num', text: isNum(v.n) ? String(v.n) : '' }),
        h('td', { class: 'num', text: num(v.mean, dec() + 1) }),
        h('td', { class: 'num', text: num(v.sd, dec() + 1) }));
    });
    const d = st.cohensD || {};
    const p = st.pValue || {};
    const diff = st.difference || {};
    return h('details', { class: 'drawer' },
      h('summary', { text: st.summary }),
      h('div', { class: 'drawer-body' },
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', text: fill(cols.group, c) }),
            h('th', { scope: 'col', class: 'num', text: fill(cols.n, c) || ui('unitMissing') }),
            h('th', { scope: 'col', class: 'num', text: fill(cols.mean, c) || measure().unit || ui('unitMissing') }),
            h('th', { scope: 'col', class: 'num', text: fill(cols.sd, c) || measure().unit || ui('unitMissing') }))),
          h('tbody', {}, rows))),
        factList([
          [diff.term, isNum(e.difference) ? qty(e.difference, e.unit || measure().unit, dec() + 1) : '', '', diff.note],
          [d.term, isNum(e.cohensD) ? num(e.cohensD, 2) + (isText(e.plainSize) ? ` — ${e.plainSize}` : '') : '', e.cohensDUnit && e.cohensDUnit !== 'none' ? e.cohensDUnit : d.unitNote || ui('unitMissing'), d.note],
          [p.term, pText(e.pAdjusted, p), p.unitNote || ui('unitMissing'), p.note],
        ]),
        isText(meta.methodPlain) && h('p', {}, isText(st.methodHeading) && h('b', { text: st.methodHeading + ' ' }), meta.methodPlain),
        para(st.whyPeople, null, c),
        cell.genesChanged && para(st.genesChanged, 'small', c)));
  }

  function caveatsBlock(cell) {
    const items = [...list(measure().caveats), ...list(cell && cell.caveats)];
    if (!items.length) return null;
    const heading = (data.cellScreen || {}).caveatsHeading;
    return h('section', { class: 'caveats' },
      isText(heading) && h('h2', { text: heading }),
      h('ul', {}, items.map((c) => h('li', { text: c }))));
  }

  function geneCards(cell) {
    const gs = data.geneScreen || {};
    return h('div', { class: 'genes' }, genesOf(cell).map((g) => {
      const change = fill(gs.cardChange, ctx(cell, g));
      return h('a', { class: 'gene', href: '#' + routeFor(cell, g) },
        h('span', { class: 'sym', text: g.symbol }),
        isText(g.name) && h('span', { class: 'gname', text: g.name }),
        geneRatio(g) && change && h('span', { class: 'gchange', text: change }));
    }));
  }

  function renderCell(cell) {
    const cs = data.cellScreen || {};
    const an = stage('analysis') || {};
    const { fig, track } = cellFigure(cell, null);
    track.style.viewTransitionName = 'hero';
    const genes = genesOf(cell);
    const ch = data.challenge || {};
    return h('section', { class: 'view' },
      backLink('top', an.backLabel || an.navLabel),
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1' }, swatch(cell), cell.label),
        para(cell.role, 'lede')),
      fig,
      hasDonors(cell) && para(cs.gapPrompt, 'caption'),
      h('div', { class: 'block' }, numbersInWords(cell)),
      statsDrawer(cell),
      caveatsBlock(cell),
      h('div', { class: 'nextup' },
        passageFor(cell) && button('writeup-' + slug(cell.id), cs.writeUpLabel || an.writeUpLabel || (data.writeUp || {}).heading, 'big'),
        genes.length > 0 && isText(cs.genesLabel) && h('details', { class: 'further' },
          h('summary', { text: cs.genesLabel }),
          h('div', { class: 'further-body' }, para(ch.geneIntro, 'small'), geneCards(cell)))));
  }

  /* ---------- one gene: the optional detour ---------- */

  function renderGene(cell, gene) {
    const gs = data.geneScreen || {};
    const ch = data.challenge || null;
    const c = ctx(cell, gene);
    const unit = tokenValue('geneUnit', c);
    const axis = niceAxis(extentOf(gene));
    const ratio = geneRatio(gene);
    const a = groupOf(gene, 'normal');
    const b = groupOf(gene, 'dementia');

    const cellLabel = (idOrName) => {
      const hit = data.cellTypes.find((x) => x.id === idOrName || x.label === idOrName);
      return hit ? hit.label : String(idOrName);
    };
    const elsewhere = list(gene.alsoExpressedIn).filter((x) => x && isNum(x.mean));
    let bars = null;
    if (elsewhere.length) {
      const hereValue = isNum(gene.hereMean) ? gene.hereMean : a.mean;
      const here = isNum(hereValue) ? [{ label: fill(gs.elsewhereHere, c) || cell.label, mean: hereValue, current: true }] : [];
      const all = here.concat(elsewhere.map((x) => ({ label: cellLabel(x.cellType), mean: x.mean })));
      const barAxis = niceAxis(Math.max(...all.map((x) => x.mean)));
      const u = unitScale();
      bars = h('section', { class: 'block' },
        isText(gs.elsewhereHeading) && h('h2', { text: gs.elsewhereHeading }),
        para(gs.elsewhereCaption, 'caption', c),
        h('div', { class: 'bars' }, all.map((x) => {
          const svg = s('svg', { height: 18 * u, 'aria-hidden': 'true', focusable: 'false' });
          svg.append(s('rect', { class: 'bar' + (x.current ? ' current' : ''), x: 0, y: 2 * u, height: 14 * u, rx: 3 * u, width: Math.max(0.5, (x.mean / barAxis.max) * 100) + '%' }));
          return h('div', { class: 'barrow' + (x.current ? ' current' : '') },
            h('span', { text: x.label }), svg, h('span', { class: 'val', text: qty(x.mean, unit, geneDec()) }));
        })),
        para(gs.elsewhereNote, 'small', c));
    }

    const lf = gs.log2FC || {};
    const pv = gs.pValue || {};
    const technical = factList([
      [lf.term, isNum(gene.log2FC) ? num(gene.log2FC, 2) : '', lf.unitNote || ui('unitMissing'), lf.note],
      [pv.term, pText(gene.pAdjusted, Object.assign({}, (data.stats || {}).pValue, pv)), pv.unitNote || ui('unitMissing'), pv.note],
      ...GROUPS.map((g) => {
        const v = groupOf(gene, g.key);
        const line = isNum(v.mean) ? fill(gs.groupLine, ctx(cell, gene, { mean: qty(v.mean, unit, geneDec()), sd: isNum(v.sd) ? qty(v.sd, unit, geneDec()) : '' })) || qty(v.mean, unit, geneDec()) : '';
        return [groupName(g.key), line, '', ''];
      }),
    ]);

    return h('section', { class: 'view' },
      backLink(routeFor(cell), cell.label),
      ch && para(ch.geneIntro, 'detour'),
      h('div', { class: 'prose' },
        para(gs.kicker, 'kicker', c),
        h('h1', { tabindex: '-1', text: gene.symbol }),
        isText(gene.name) && h('p', { class: 'small', text: gene.name }),
        para(gene.plainRole, 'lede')),
      isNum(a.mean) && isNum(b.mean) && h('figure', { class: 'hero' },
        legend(),
        h('div', { class: 'axis' }, buildTicks(axis, '')),
        h('div', { class: 'track' }, buildTrack(gene, axis, 'big')),
        h('figcaption', { class: 'small', text: fill(gs.figCaption, c) || [geneMeasure().label, unit].filter(Boolean).join(' — ') })),
      ratio && para(ratio.same ? gs.verdictSame : gs.verdict, 'verdict', c),
      para(gene.note, 'prose'),
      technical && isText(gs.technicalSummary) && h('details', { class: 'drawer' },
        h('summary', { text: gs.technicalSummary }),
        h('div', { class: 'drawer-body' }, technical)),
      bars,
      caveatsBlock(cell),
      ch && h('div', { class: 'block' },
        para(ch.geneTask, 'prose'),
        h('div', { class: 'actions' }, button('challenge', gs.challengeLabel || ch.navLabel || ch.heading && fill(ch.heading, ctx()), 'quiet'))));
  }

  /* ---------- stage 4: the write-up — a passage with gaps ---------- */

  function renderWriteUp(cell, routeKey) {
    const w = data.writeUp || {};
    const passage = passageFor(cell);
    const own = !!(cell.writeUp && passage === cell.writeUp);
    const key = (own ? 'own:' : 'shared:') + cell.id;
    const parts = list(passage.parts).filter((p) => p && (p.type === 'text' || p.type === 'break' || (p.type === 'blank' && list(p.options).length >= 2)));
    const blanks = parts.filter((p) => p.type === 'blank');
    blanks.forEach((b, i) => { if (!isText(b.id)) b.id = 'gap' + (i + 1); });
    if (!cloze.has(key)) cloze.set(key, { done: new Map(), tried: new Map(), active: null, last: null });
    const st = cloze.get(key);
    const c = ctx(cell);
    const sheet = h('div', { class: 'sheet' });
    const an = stage('analysis') || {};

    const optionText = (b, i) => fill(String(b.options[i]), c);
    const complete = () => blanks.every((b) => st.done.has(b.id));
    const plainText = () => {
      let out = '';
      for (const p of parts) {
        if (p.type === 'text') out += fill(p.text, c);
        else if (p.type === 'break') out += '\n\n';
        else out += st.done.has(p.id) ? optionText(p, p.correct) : '_____';
      }
      return out.trim();
    };

    const paint = (focus) => {
      const total = blanks.length;
      const openBlanks = blanks.filter((b) => !st.done.has(b.id));
      if (!openBlanks.some((b) => b.id === st.active)) st.active = openBlanks.length ? openBlanks[0].id : null;
      const active = blanks.find((b) => b.id === st.active) || null;

      // the passage itself: continuous prose, with a control wherever a gap is
      const text = h('div', { class: 'passage' });
      let line = h('p', {});
      text.append(line);
      for (const p of parts) {
        if (p.type === 'break') { line = h('p', {}); text.append(line); continue; }
        if (p.type === 'text') { line.append(...fillNodes(p.text, c)); continue; }
        const n = blanks.indexOf(p) + 1;
        const longest = Math.min(26, Math.max(...p.options.map((_, i) => optionText(p, i).length)));
        if (st.done.has(p.id)) {
          line.append(h('span', { class: 'gap filled' + (st.done.get(p.id) === 'shown' ? ' shown' : ''), 'data-gap': p.id, text: optionText(p, p.correct) }));
        } else {
          line.append(h('button', {
            type: 'button', class: 'gap' + (p.id === st.active ? ' active' : ''), 'data-gap': p.id,
            style: `min-width:min(${longest * 0.62 + 2}em,100%)`,
            'aria-label': fill(w.gapLabel, ctx(cell, null, { gapNumber: n, total })) || `${n} / ${total}`,
            'aria-current': p.id === st.active ? 'true' : null,
            onclick: () => { st.active = p.id; st.last = null; paint('option'); },
          }, h('span', { class: 'gapnum', 'aria-hidden': 'true', text: String(n) })));
        }
      }

      const status = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
      if (st.last) status.append(h('span', { class: st.last.good ? 'good' : 'retry', text: st.last.text }));

      let chooser = null;
      if (active) {
        const tried = st.tried.get(active.id) || new Set();
        const n = blanks.indexOf(active) + 1;
        const finish = (how) => {
          st.done.set(active.id, how);
          const fb = active.feedback || {};
          const word = optionText(active, active.correct);
          st.last = { good: true, text: [how === 'shown' ? w.shownNote : '', '“' + word + '”', fb.right].filter(isText).join(' ') };
          paint(complete() ? 'done' : 'option');
        };
        const options = active.options.map((_, i) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': 'false', class: 'option' + (tried.has(i) ? ' tried' : ''),
          tabindex: i === 0 ? '0' : '-1',
          onclick: () => {
            if (i === active.correct) { finish('right'); return; }
            tried.add(i);
            st.tried.set(active.id, tried);
            st.last = { good: false, text: (active.feedback || {}).wrong || '' };
            paint('option:' + i);
          },
        }, optionText(active, i), tried.has(i) && h('span', { class: 'triedmark', text: ` — ${ui('tried')}` })));
        const group = h('div', {
          class: 'options', role: 'radiogroup', 'aria-label': fill(w.gapLabel, ctx(cell, null, { gapNumber: n, total })) || String(n),
          onkeydown: (ev) => {
            const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key];
            if (!move) return;
            ev.preventDefault();
            const at = options.indexOf(document.activeElement);
            const to = options[(at + move + options.length) % options.length];
            options.forEach((o) => o.setAttribute('tabindex', o === to ? '0' : '-1'));
            to.focus();
          },
        }, options);
        chooser = h('div', { class: 'chooser' },
          h('p', { class: 'gaplabel' }, h('span', { class: 'gapnum', 'aria-hidden': 'true', text: String(n) }), fill(w.gapLabel, ctx(cell, null, { gapNumber: n, total }))),
          group,
          h('button', { type: 'button', class: 'showme', text: ui('showAnswer'), onclick: () => finish('shown') }));
      }

      let ending = null;
      if (complete()) {
        const copyBtn = isText(w.copyLabel) && h('button', {
          type: 'button', class: 'btn quiet',
          onclick: (ev) => {
            const btn = ev.currentTarget;
            const fallback = () => {
              const range = document.createRange();
              range.selectNodeContents(text);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              btn.textContent = ui('copySelected');
            };
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(plainText()).then(() => { btn.textContent = ui('copied'); }, fallback);
              else fallback();
            } catch (err) { fallback(); }
          },
        }, w.copyLabel);
        ending = h('div', { class: 'ending' },
          isText(w.conclusionHeading) && h('h2', { tabindex: '-1', text: w.conclusionHeading }),
          paras(passage.conclusion, null, c),
          h('div', { class: 'actions' },
            copyBtn,
            data.challenge && button('challenge', fill(w.challengeLabel, ctx()) || (data.challenge || {}).navLabel)));
      }

      sheet.replaceChildren(...[
        total > 0 && h('p', { class: 'progress' },
          h('span', { class: 'pips', 'aria-hidden': 'true' }, blanks.map((b) => h('span', { class: 'pip' + (st.done.has(b.id) ? ' on' : '') }))),
          fill(w.progressLabel, ctx(cell, null, { filled: st.done.size, total })) || `${st.done.size} / ${total}`),
        text, status, chooser, ending].filter(Boolean));

      if (!focus) return;
      let target = null;
      if (focus === 'done') target = sheet.querySelector('.ending h2') || sheet.querySelector('.ending .btn');
      else if (focus.startsWith('option:')) target = sheet.querySelectorAll('.chooser .option')[Number(focus.slice(7))];
      else target = sheet.querySelector('.chooser .option');
      if (target) {
        if (target.getAttribute('role') === 'radio') sheet.querySelectorAll('.chooser .option').forEach((o) => o.setAttribute('tabindex', o === target ? '0' : '-1'));
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      }
    };
    paint(null);

    const { fig } = cellFigure(cell, fill(w.figureHeading, c) || cell.label);
    return h('section', { class: 'view' },
      routeKey === 'writeup' ? backLink('top', an.backLabel || an.navLabel) : backLink(routeFor(cell), cell.label),
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1', text: w.heading || w.navLabel || '' }),
        paras(w.intro, 'lede', c)),
      h('div', { class: 'writeup' }, h('div', { class: 'pinned' }, fig), sheet));
  }

  /* ---------- the challenge: a side branch ---------- */

  function renderChallenge() {
    const ch = data.challenge;
    const cfg = data.config || {};
    const c = ctx();
    const url = /^https:\/\//.test(cfg.entryFormUrl || '') ? cfg.entryFormUrl : null;
    const shortUrl = isText(cfg.entryFormShortUrl) && cfg.entryFormShortUrl !== 'PLACEHOLDER' ? cfg.entryFormShortUrl : null;
    const offline = h('p', { class: 'offline', role: 'status', hidden: true, text: ch.offlineNote || '' });
    const syncOffline = () => { offline.hidden = navigator.onLine !== false || !isText(ch.offlineNote); };
    syncOffline();
    const onNet = () => { if (offline.isConnected) syncOffline(); else { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); } };
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);

    const section = (heading, ...body) => {
      const kids = body.flat(Infinity).filter(Boolean);
      return kids.length ? h('section', { class: 'block' }, isText(heading) && h('h2', { text: heading }), kids) : null;
    };
    const win = ch.winner || {};
    const winner = cfg.winnerAnnounced === true
      ? section(ch.winnerHeading,
        h('div', { class: 'winner' },
          isText(win.name) && h('p', { class: 'wname' }, win.name, isText(win.school) && h('span', { class: 'small', text: ' — ' + win.school })),
          list(win.writeUp).length > 0 && h('blockquote', {}, paras(win.writeUp)),
          para(win.judgeNote, 'small')))
      : para(ch.winnerPendingNote, 'small');

    const entry = h('div', { class: 'entry' },
      url
        ? h('a', { class: 'btn big', href: url, target: '_blank', rel: 'noopener' }, h('span', { text: ch.entryLabel || url }), h('span', { class: 'small', text: ' ' + ui('newTab') }))
        : isText(ch.entryLabel) && h('button', { type: 'button', class: 'btn big', disabled: true, 'aria-describedby': 'entry-pending', text: ch.entryLabel }),
      !url && h('p', { id: 'entry-pending', class: 'small', text: ch.entryPendingNote || '' }),
      offline,
      shortUrl && h('p', { class: 'shorturl' }, isText(ch.shortUrlLabel) && h('span', { class: 'small', text: ch.shortUrlLabel + ' ' }), h('span', { class: 'selectable', text: shortUrl })),
      ch.qr && isText(ch.qr.src) && h('img', { class: 'qr', src: ch.qr.src, alt: ch.qr.alt || '', loading: 'lazy' }));

    return h('section', { class: 'view' },
      hasWriteUp() ? backLink('writeup', (data.writeUp || {}).navLabel) : backLink('top', (stage('analysis') || {}).navLabel),
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1', text: fill(ch.heading, c) || ch.navLabel || '' }),
        paras(ch.intro, 'lede', c)),
      isText(ch.question) && h('section', { class: 'question' },
        isText(ch.questionLabel) && h('p', { class: 'kicker', text: ch.questionLabel }),
        h('p', { class: 'qtext', text: ch.question }),
        para(ch.wordLimitNote, 'small', c)),
      section(ch.criteriaHeading, list(ch.criteria).length > 0 && h('ul', { class: 'ticks-list' }, list(ch.criteria).map((x) => h('li', { text: x })))),
      section(ch.geneHeading, para(ch.geneTask, null, c)),
      section(ch.judgedHeading, paras(ch.howJudged, null, c), isText(cfg.entryDeadline) && para(ch.deadlineLabel, 'deadline', c)),
      h('section', { class: 'enter' },
        section(ch.privacyHeading, paras(ch.privacy, null, c)),
        entry),
      winner);
  }

  /* ---------- routing: plain #names, so links can be shared and Back works ---------- */

  function routeFor(cell, gene) {
    return gene ? `gene-${slug(cell.id)}-${slug(gene.symbol)}` : `cell-${slug(cell.id)}`;
  }

  function buildRoutes() {
    routes = new Map();
    data.cellTypes.forEach((cell) => {
      routes.set(routeFor(cell), { kind: 'cell', cell, gene: null });
      genesOf(cell).forEach((gene) => routes.set(routeFor(cell, gene), { kind: 'gene', cell, gene }));
      if (passageFor(cell)) routes.set('writeup-' + slug(cell.id), { kind: 'writeup', cell, gene: null });
    });
  }

  function resolve(key) {
    const none = { cell: null, gene: null };
    if (routes.has(key)) return routes.get(key);
    if (key === 'data' && stage('data')) return { kind: 'data', ...none };
    if (key === 'mapping' && stage('mapping')) return { kind: 'mapping', ...none };
    if (key === 'top') return { kind: 'analysis', ...none };
    if (key === 'writeup' && hasWriteUp()) { const cell = headlineCell(); if (passageFor(cell)) return { kind: 'writeup', cell, gene: null }; }
    if (key === 'challenge' && data.challenge) return { kind: 'challenge', ...none };
    if (data.intro) return { kind: 'start', ...none };
    return { kind: steps()[0].id, ...none };
  }

  function renderJourney(target) {
    const meta = data.meta || {};
    const all = steps();
    const here = stepOf(target.kind);
    const hereIndex = all.findIndex((x) => x.id === here);
    crumbs.replaceChildren(
      h('a', { class: 'site', href: '#start', text: meta.shortTitle || meta.title || '' }),
      h('ol', { class: 'journey' },
        all.map((st, i) => {
          const isHere = st.id === here;
          const done = !isHere && (visited.has(st.id) || (hereIndex >= 0 && i < hereIndex));
          return h('li', { class: (isHere ? 'here' : '') + (done ? ' done' : '') },
            h('a', { href: '#' + st.route, 'aria-current': isHere ? 'step' : null },
              h('span', { class: 'n', 'aria-hidden': 'true', text: done ? '✓' : String(i + 1) }),
              h('span', { class: 'lbl', text: st.label }),
              done && h('span', { class: 'sr', text: ` (${ui('stepDone')})` })));
        }),
        data.challenge && h('li', { class: 'side' + (here === 'challenge' ? ' here' : '') },
          h('a', { href: '#challenge', 'aria-current': here === 'challenge' ? 'step' : null },
            h('span', { class: 'n', 'aria-hidden': 'true', text: '★' }),
            h('span', { class: 'lbl', text: data.challenge.navLabel || fill(data.challenge.heading, ctx()) })))));
  }

  function titleFor(target) {
    const meta = data.meta || {};
    const site = meta.shortTitle || meta.title || '';
    const k = target.kind;
    const page = k === 'gene' ? `${target.gene.symbol} — ${target.cell.label}`
      : k === 'cell' ? target.cell.label
      : k === 'writeup' ? `${(data.writeUp || {}).heading || ''} — ${target.cell.label}`
      : k === 'challenge' ? fill(data.challenge.heading, ctx())
      : k === 'start' ? (data.intro || {}).heading
      : (stage(k) || {}).heading;
    return [page, site].filter(isText).filter((x, i, arr) => arr.indexOf(x) === i).join(' — ');
  }

  function show() {
    const key = decodeURIComponent(location.hash.replace(/^#/, ''));
    const target = resolve(key);
    const previous = current;

    const paint = () => {
      const k = target.kind;
      const heroId = k === 'analysis' && previous.kind === 'cell' && previous.cell ? previous.cell.id : null;
      const view = k === 'start' ? renderStart()
        : k === 'data' ? renderData()
        : k === 'mapping' ? renderMapping()
        : k === 'cell' ? renderCell(target.cell)
        : k === 'gene' ? renderGene(target.cell, target.gene)
        : k === 'writeup' ? renderWriteUp(target.cell, key)
        : k === 'challenge' ? renderChallenge()
        : renderChart(heroId);
      main.replaceChildren(view);
      visited.add(stepOf(k));
      renderJourney(target);
      document.title = titleFor(target);
      current = { kind: k, cell: target.cell, gene: target.gene };

      if (firstRender) { firstRender = false; return; }
      if (heroId) {
        const row = main.querySelector(`a.row[data-cell="${CSS.escape(heroId)}"]`);
        if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'center' }); return; }
      }
      window.scrollTo(0, 0);
      const heading = main.querySelector('h1');
      if (heading) heading.focus({ preventScroll: true });
    };

    // Going from the chart into a row: name that row so it visibly opens rather than being replaced.
    if (previous.kind === 'analysis' && target.kind === 'cell') {
      const row = main.querySelector(`a.row[data-cell="${CSS.escape(target.cell.id)}"] .track`);
      if (row) row.style.viewTransitionName = 'hero';
    }
    if (!firstRender && document.startViewTransition && !reducedMotion.matches) document.startViewTransition(paint);
    else paint();
  }

  /* ---------- page furniture ---------- */

  function renderNotice() {
    const meta = data.meta || {};
    const text = meta.placeholderNotice || meta.placeholderWarning || 'PLACEHOLDER';
    if (!meta.PLACEHOLDER) { notice.hidden = true; return; }
    notice.replaceChildren(h('p', { text }));
    notice.hidden = false;
  }

  function renderCredits() {
    const meta = data.meta || {};
    const f = data.footer || {};
    const line = (...kids) => { const real = kids.flat().filter(Boolean); return real.length ? h('p', {}, real) : null; };
    const link = (text, url) => (isText(url) && /^https?:\/\//.test(url) ? h('a', { href: url, rel: 'noopener', text }) : text);
    const source = [meta.source, meta.dataset].filter(isText).join(' — ');
    credits.replaceChildren(h('div', {},
      (source || isText(meta.citation)) && line(isText(f.dataLabel) && f.dataLabel + ' ', source, source && isText(meta.citation) && '. ', isText(meta.citation) && link(meta.citation, meta.citationUrl), '.'),
      isText(meta.licence) && line(isText(f.licenceLabel) && f.licenceLabel + ' ', link(meta.licence, meta.licenceUrl), '.'),
      isText(meta.accessed) && line(isText(f.accessedLabel) && f.accessedLabel + ' ', fmtDate(meta.accessed), '.'),
      isText(meta.note) && line(meta.note),
      isText(f.privacy) && line(f.privacy)));
  }

  function fail(message) {
    main.replaceChildren(h('section', { class: 'view' },
      h('h1', { text: UI.loadFailTitle }),
      h('p', { class: 'lede', text: message }),
      h('p', { text: UI.loadFailHelp })));
  }

  async function start() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${DATA_URL}: ${res.status}`);
      data = await res.json();
      if (!data || !Array.isArray(data.cellTypes) || data.cellTypes.length === 0) throw new Error(`${DATA_URL}: cellTypes`);
    } catch (err) {
      data = null;
      fail(err && err.message ? err.message : DATA_URL);
      return;
    }
    crumbs.setAttribute('aria-label', ui('journey'));
    buildRoutes();
    renderNotice();
    renderCredits();
    show();
    window.addEventListener('hashchange', show);
    window.addEventListener('load', () => setTimeout(warmImages, 1500));
    if (document.readyState === 'complete') setTimeout(warmImages, 1500);
    let resizeTimer = null;
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;   // ignore mobile address-bar height changes
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (current.kind === 'analysis') main.replaceChildren(renderChart(null)); }, 200);
    });
  }

  // Fetch every picture the data file names once, so the offline cache holds them even if their screen was never opened.
  function warmImages() {
    if (!/^https?:$/.test(location.protocol) || navigator.onLine === false) return;
    const found = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (isText(node.src) && !/^[a-z]+:/i.test(node.src)) found.add(node.src);
      Object.values(node).forEach(walk);
    };
    walk({ stages: data.stages, challenge: data.challenge });
    found.forEach((src) => { fetch(src).catch(() => {}); });
  }

  // Offline support: the site's own files are cached so the page still opens with no network.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  start();
})();
