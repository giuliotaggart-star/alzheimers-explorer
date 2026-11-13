/* Unravel — all behaviour (Build Spec v5). No dependencies, no build step.
   Every word on screen, every number, unit, colour and address is read from data/seaad-mtg.json. The only English in this
   file is the two-line message shown when that file cannot be loaded at all, because then there is nothing to read it from.
   Each view is a plain function from (data, state) to DOM, so it ports to a component framework one function at a time.
   What is kept on the device: the poll result and the essay draft, in localStorage, and nothing else.
   What leaves the device: nothing, unless config.pollEndpoint is set, and then only the six poll answers and class code. */
(() => {
  'use strict';

  const DATA_URL = 'data/seaad-mtg.json';
  const LOAD_FAIL = ['The data did not load', 'If you opened this page straight from a folder, serve the folder instead: run “python3 -m http.server” in it and open http://localhost:8000.'];
  const ui = (k) => (data && data.ui && isText(data.ui[k]) ? data.ui[k] : '');

  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const api = {};         // per-section keyboard handlers, filled in as the sections are built
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reducedMotion.matches;
  let data = null;

  const state = {
    tab: '', cur: null,
    caseId: null, step: 0, view: 0, predictions: {}, strat: {}, didWork: false, showAllCases: false,
    sandbox: null, snapshotMade: false, showAllCells: false,
    cloze: new Map(),
    poll: { answers: {}, classCode: '', submitted: null, index: 0, phase: 'ask' },
  };

  /* ---------- helpers ---------- */

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
  function s(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : []);
  const isUrl = (v) => isText(v) && /^https:\/\//.test(v);

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
  function fmtDate(v) {
    if (!isText(v) || !/^\d{4}-\d{2}-\d{2}/.test(v)) return isText(v) ? v : '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Device storage, used only for the poll result and the essay draft. Fails quietly where storage is blocked.
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('unravel.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('unravel.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked: carry on in memory */ } },
    del(k) { try { localStorage.removeItem('unravel.' + k); } catch (e) { /* nothing to clear */ } },
  };

  /* ---------- tokens: sentences in the data quote live values ---------- */

  const TOKEN = /\{\{\s*([A-Za-z0-9]+)\s*\}\}/g;
  // {{donorTotal}} and {{cellsTotal}} are the bare numbers: the sentence around them names what is counted.
  function baseVars() {
    const p = data.prize || {};
    const m = data.meta || {};
    const bare = (o) => (o && isNum(o.value) ? num(o.value, 0) : '');
    return { prizeValue: p.value, wordsMin: p.wordsMin, wordsMax: p.wordsMax, donorTotal: bare(m.donorTotal), cellsTotal: bare(m.cellsTotal), deadline: fmtDate((data.config || {}).essayDeadline) };
  }
  const lookup = (name, vars) => {
    const all = Object.assign(baseVars(), vars || {});
    const v = all[name];
    return v === undefined || v === null || v === '' ? undefined : String(v);
  };
  function fill(template, vars) {
    if (!isText(template)) return '';
    return template.replace(TOKEN, (whole, name) => { const v = lookup(name, vars); return v === undefined ? whole : v; });
  }
  function fillNodes(template, vars) {
    if (!isText(template)) return [];
    const out = [];
    let last = 0;
    template.replace(TOKEN, (whole, name, at) => {
      if (at > last) out.push(template.slice(last, at));
      const v = lookup(name, vars);
      out.push(v === undefined ? h('mark', { class: 'badtoken', text: whole }) : v);
      last = at + whole.length;
      return whole;
    });
    if (last < template.length) out.push(template.slice(last));
    return out;
  }
  const para = (t, cls, vars) => (isText(t) ? h('p', { class: cls || null }, fillNodes(t, vars)) : null);
  const paras = (arr, cls, vars) => list(arr).map((t) => para(t, cls, vars));
  const monoLabel = (t, tag, vars, extra) => (isText(t) ? h(tag || 'span', Object.assign({ class: 'label' }, extra || {}), fillNodes(t, vars)) : null);

  /* ---------- data access ---------- */

  // Everyday words first; the technical term goes underneath, in a mono label.
  const label = (x) => (x ? (isText(x.plainLabel) ? x.plainLabel : x.label) || x.id || '' : '');
  const tech = (x) => (x && isText(x.label) && x.label !== label(x) ? x.label : '');
  const byId = (arr, id) => list(arr).find((x) => x && x.id === id) || null;
  const metricOf = (id) => byId(data.metrics, id);
  const cellOf = (id) => byId(data.cellTypes, id);
  const groupingOf = (id) => byId(data.groupings, id);
  const seriesOf = (metric, cellType) => list(data.series).find((x) => x.metric === metric && x.cellType === cellType && Array.isArray(x.values)) || null;
  const colourOf = (cell) => (cell && /^#[0-9a-fA-F]{6}$/.test(cell.colour || '') ? cell.colour : css('--cream', '#FBE9CF'));
  const donorUnit = () => ((data.meta || {}).donorTotal || {}).unit;

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function summary(values) {
    const v = values.filter(isNum).sort((a, b) => a - b);
    const mean = v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN;
    const sd = v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1)) : NaN;
    return { n: v.length, median: quantile(v, 0.5), q1: quantile(v, 0.25), q3: quantile(v, 0.75), mean, sd };
  }
  // The effect size: Cohen's d between the first and last group with donors, on donor-level values, pooled SD.
  function cohensD(a, b) {
    if (!a || !b || a === b || a.n < 2 || b.n < 2) return NaN;
    const pooled = Math.sqrt(((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / (a.n + b.n - 2));
    return pooled > 0 ? (b.mean - a.mean) / pooled : NaN;
  }
  function stratumOf(donor, conf) {
    if (!conf) return null;
    const raw = donor[conf.key];
    if (Array.isArray(conf.bins)) { const bin = conf.bins.find((b) => !isNum(b.below) || raw < b.below); return bin ? bin.label : null; }
    return raw === undefined || raw === null ? null : String(raw);
  }
  const strataOf = (conf) => {
    if (!conf) return [];
    if (Array.isArray(conf.bins)) return conf.bins.map((b) => b.label);
    return [...new Set(list(data.donors).map((d) => stratumOf(d, conf)).filter((x) => x !== null))].sort();
  };

  // One question = one metric in one cell type, split across one grouping (optionally filtered and stratified).
  function buildQuestion(q) {
    const metric = metricOf(q.metric);
    const cell = cellOf(q.cellType);
    const grouping = groupingOf(q.grouping);
    const ser = seriesOf(q.metric, q.cellType);
    if (!metric || !grouping || !ser) return null;
    const conf = q.confounder ? byId(data.confounders, q.confounder) : null;
    const strata = strataOf(conf);
    const rows = list(data.donors).map((donor, i) => ({ donor, value: ser.values[i] }))
      .filter((r) => isNum(r.value) && (!q.filter || list(q.filter.values).includes(r.donor[q.filter.key])));
    const order = list(grouping.order).length ? grouping.order : [...new Set(rows.map((r) => r.donor[grouping.key]))];
    const groups = order.map((name) => {
      const mine = rows.filter((r) => String(r.donor[grouping.key]) === String(name));
      const parts = conf ? strata.map((st) => { const sub = mine.filter((r) => stratumOf(r.donor, conf) === st); return Object.assign({ stratum: st, rows: sub }, summary(sub.map((r) => r.value))); }) : null;
      return Object.assign({ name: String(name), rows: mine, parts }, summary(mine.map((r) => r.value)));
    });
    const live = groups.filter((g) => g.n > 0);
    const first = live[0] || null;
    const last = live[live.length - 1] || null;
    let trend = 'same';
    if (first && last && first !== last) {
      const spread = live.reduce((a, g) => a + (g.q3 - g.q1), 0) / live.length || 1;
      const diff = last.median - first.median;
      trend = Math.abs(diff) < 0.5 * spread ? 'same' : diff > 0 ? 'up' : 'down';
    }
    const dec = isNum(metric.decimals) ? metric.decimals : 1;
    return { q, metric, cell, grouping, conf, strata, groups, first, last, trend, dec, unit: metric.unit, d: cohensD(first, last), max: Math.max(0, ...rows.map((r) => r.value)) };
  }
  function questionVars(Q) {
    if (!Q) return {};
    return {
      metricLabel: label(Q.metric), cellLabel: label(Q.cell), groupingLabel: label(Q.grouping), unit: Q.unit || ui('unitMissing'),
      firstGroup: Q.first && Q.first.name, lastGroup: Q.last && Q.last.name,
      medianFirst: Q.first && qty(Q.first.median, Q.unit, Q.dec), medianLast: Q.last && qty(Q.last.median, Q.unit, Q.dec),
      nDonors: qty(Q.groups.reduce((a, g) => a + g.n, 0), donorUnit(), 0),
      trend: ((data.lab || {}).trendWords || {})[Q.trend] || Q.trend,
    };
  }

  /* ---------- the chart: one dot per donor, never a bar ---------- */

  // Tokens never change at run time, so each is read from the stylesheet once.
  const tokenCache = new Map();
  const css = (name, fallback) => { if (!tokenCache.has(name)) tokenCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()); return tokenCache.get(name) || fallback; };
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  function mix(a, b, t) {
    const [A, B] = [rgbOf(a), rgbOf(b)];
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  // A zero-based axis with exactly three tick marks above zero.
  function niceAxis(maxValue) {
    const max = maxValue > 0 ? maxValue : 1;
    const rough = max / 3;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((c) => c * 3 >= max - 1e-9);
    return { max: step * 3, ticks: [1, 2, 3].map((k) => Number((k * step).toPrecision(10))) };
  }
  function marker(shape, x, y, r, attrs) {
    if (shape === 2) return s('rect', Object.assign({ x: x - r * 0.85, y: y - r * 0.85, width: r * 1.7, height: r * 1.7 }, attrs));
    if (shape === 1) return s('path', Object.assign({ d: `M${x} ${y - r * 1.2}L${x + r * 1.1} ${y + r * 0.8}L${x - r * 1.1} ${y + r * 0.8}Z` }, attrs));
    return s('circle', Object.assign({ cx: x, cy: y, r }, attrs));
  }

  // Draws with literal attributes, so the same SVG can be exported as a picture in the same dark skin.
  function drawChart(Q, width, forExport) {
    const lab = data.lab || {};
    const W = Math.max(280, Math.round(width));
    const narrow = W < 520;
    const ends = list(Q.grouping.ends);
    const m = { l: narrow ? 44 : 56, r: 14, t: 52, b: ends.length === 2 ? 92 : 70 };
    const H = (narrow ? 300 : 360) + m.b - 70;
    const cream = css('--cream', '#FBE9CF');
    const muted = css('--muted', '#A8A29A');
    const line = css('--line', '#6B6B70');
    const lo = css('--peri', '#8F92E6');
    const hi = css('--coral', '#F28B74');
    const axis = niceAxis(Q.max * 1.05);
    const Y = (v) => m.t + (1 - v / axis.max) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / Math.max(1, Q.groups.length);
    const sans = '"Plus Jakarta Sans", system-ui, Arial, sans-serif';
    const mono = '"DM Mono", ui-monospace, Menlo, monospace';
    const monoText = (attrs, t) => s('text', Object.assign({ 'font-family': mono, 'font-size': 12, 'letter-spacing': 1.2, fill: muted }, attrs), String(t).toUpperCase());
    const svg = s('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'font-family': sans,
      'aria-label': [label(Q.metric), label(Q.cell), label(Q.grouping)].filter(Boolean).join(', ') });
    if (forExport) svg.append(s('rect', { width: W, height: H, fill: css('--card', '#1A1A1D') }));
    // axis title: everyday words, with the technical term beneath in mono
    svg.append(s('text', { x: 0, y: 16, fill: cream, 'font-size': 15, 'font-weight': 600 }, `${label(Q.metric)} (${Q.unit || ui('unitMissing')})`));
    if (tech(Q.metric)) svg.append(monoText({ x: 0, y: 36 }, tech(Q.metric)));
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: line, 'stroke-width': 1.5 }));
    svg.append(monoText({ x: m.l - 8, y: Y(0) + 4, 'text-anchor': 'end' }, '0'));
    axis.ticks.forEach((t) => {
      svg.append(s('line', { x1: m.l - 4, x2: m.l + 6, y1: Y(t), y2: Y(t), stroke: line, 'stroke-width': 1 }));
      svg.append(monoText({ x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, num(t, 2)));
    });
    const r = 5;
    const nG = Q.groups.length;
    let dotIndex = 0;
    Q.groups.forEach((g, gi) => {
      const x0 = m.l + gi * band;
      const t = nG > 1 ? gi / (nG - 1) : 0;
      const colour = nG > 1 ? mix(lo, hi, t) : lo;
      const lanes = g.parts || [Object.assign({ stratum: null }, g)];
      const laneW = (band * 0.84) / lanes.length;
      lanes.forEach((lane, li) => {
        const cx = x0 + band * 0.08 + laneW * (li + 0.5);
        const half = Math.min(laneW * 0.36, 34);
        // lower-pathology groups are circles, higher are triangles; when split by a confounder, the shape shows the split
        const shape = g.parts ? li % 3 : (t < 0.5 ? 0 : 1);
        if (lane.n > 0) svg.append(s('rect', { x: cx - half - 4, width: 2 * half + 8, y: Y(lane.q3), height: Math.max(1, Y(lane.q1) - Y(lane.q3)), fill: cream, 'fill-opacity': 0.08, rx: 4 }));
        lane.rows.forEach((row, i) => {
          const jitter = ((i * 0.61803398875) % 1) * 2 - 1;
          const attrs = { fill: colour, 'fill-opacity': 0.85 };
          if (!forExport) { attrs.class = 'dot'; attrs.style = `--i:${dotIndex}`; }
          const dot = marker(shape, cx + jitter * half, Y(row.value), r, attrs);
          dotIndex += 1;
          const tip = fill(lab.donorTitle, { donorId: row.donor.id, value: qty(row.value, Q.unit, Q.dec + 1), age: row.donor.age, sex: row.donor.sex });
          if (tip) dot.append(s('title', {}, tip));
          svg.append(dot);
        });
        if (lane.n > 0) svg.append(s('line', { x1: cx - half - 6, x2: cx + half + 6, y1: Y(lane.median), y2: Y(lane.median), stroke: cream, 'stroke-width': 3, 'stroke-linecap': 'round' }));
      });
      svg.append(monoText({ x: x0 + band / 2, y: H - m.b + 22, 'text-anchor': 'middle', fill: cream }, g.name));
      // the donor count per group, where there is room for it (it is always in the table under For the curious)
      if (band >= 56) svg.append(monoText({ x: x0 + band / 2, y: H - m.b + 40, 'text-anchor': 'middle' }, fill(lab.nLabel, { n: g.n }) || String(g.n)));
    });
    const by = H - 10;
    if (ends.length === 2) {
      svg.append(s('text', { x: m.l, y: by - 20, fill: cream, 'font-size': 15, 'font-weight': 600 }, '← ' + ends[0]));
      svg.append(s('text', { x: W - m.r, y: by - 20, fill: cream, 'font-size': 15, 'font-weight': 600, 'text-anchor': 'end' }, ends[1] + ' →'));
      svg.append(monoText({ x: m.l + (W - m.l - m.r) / 2, y: by, 'text-anchor': 'middle' }, [label(Q.grouping), tech(Q.grouping)].filter(Boolean).join(' · ')));
    } else {
      svg.append(s('text', { x: m.l + (W - m.l - m.r) / 2, y: by - 18, 'text-anchor': 'middle', fill: cream, 'font-size': 15, 'font-weight': 600 }, label(Q.grouping)));
      if (tech(Q.grouping)) svg.append(monoText({ x: m.l + (W - m.l - m.r) / 2, y: by, 'text-anchor': 'middle' }, tech(Q.grouping)));
    }
    return svg;
  }

  function strataLegend(Q) {
    if (!Q.conf) return null;
    return h('p', { class: 'legend' }, monoLabel(Q.conf.label), Q.strata.map((st, i) => {
      const svg = s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' });
      svg.append(marker(i % 3, 8, 8, 5, { fill: css('--cream', '#FBE9CF') }));
      return h('span', {}, svg, st);
    }));
  }

  function statsTable(Q) {
    const cols = (data.lab || {}).tableColumns || {};
    const unit = Q.unit || ui('unitMissing');
    const rows = [];
    Q.groups.forEach((g) => {
      const lanes = g.parts ? g.parts.map((p) => Object.assign({ title: `${g.name} · ${p.stratum}` }, p)) : [Object.assign({ title: g.name }, g)];
      lanes.forEach((x) => rows.push(h('tr', {},
        h('th', { scope: 'row', text: x.title }),
        h('td', { class: 'num', text: String(x.n) }),
        h('td', { class: 'num', text: x.n ? num(x.median, Q.dec + 1) : '–' }),
        h('td', { class: 'num', text: x.n ? `${num(x.q1, Q.dec + 1)} – ${num(x.q3, Q.dec + 1)}` : '–' }))));
    });
    return h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', text: [cols.group, label(Q.grouping)].filter(isText).join(': ') }),
        h('th', { scope: 'col', class: 'num', text: cols.n || donorUnit() || ui('unitMissing') }),
        h('th', { scope: 'col', class: 'num', text: `${cols.median || ''} (${unit})`.trim() }),
        h('th', { scope: 'col', class: 'num', text: `${cols.iqr || ''} (${unit})`.trim() }))),
      h('tbody', {}, rows)));
  }

  /* ---------- pictures out: chart PNG and the snapshot card, in the same dark skin with the wordmark ---------- */

  function saveBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function svgImage(svg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    });
  }
  function wrapText(g, text, x, y, maxWidth, lineHeight) {
    let line = '';
    let yy = y;
    for (const word of String(text).split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (g.measureText(next).width > maxWidth && line) { g.fillText(line, x, yy); line = word; yy += lineHeight; } else line = next;
    }
    if (line) g.fillText(line, x, yy);
    return yy + lineHeight;
  }
  const questionText = (Q) => fill((data.lab || {}).snapshotQuestion, questionVars(Q)) || [label(Q.metric), label(Q.cell), label(Q.grouping)].filter(Boolean).join(' · ');
  const sourceLine = () => [data.meta.source, data.meta.dataset, data.meta.citation].filter(isText).join(' · ');

  async function composeCard(Q, withStats) {
    const lab = data.lab || {};
    const titleFont = '"Bagel Fat One", "Lilita One", sans-serif';
    try { await Promise.all([document.fonts.load(`40px ${titleFont}`), document.fonts.load('12px "DM Mono"')]); } catch (e) { /* draw with what is there */ }
    const img = await svgImage(drawChart(Q, 1040, true));
    const pad = 40;
    const Wc = 1120;
    const Hc = pad + 70 + (withStats ? 30 : 0) + 96 + img.height + (withStats ? 50 + (Q.groups.length + 1) * 30 : 0) + 110;
    const canvas = h('canvas', { width: Wc * 2, height: Hc * 2 });
    const g = canvas.getContext('2d');
    g.scale(2, 2);
    const bg = css('--bg', '#0E0E10');
    const cream = css('--cream', '#FBE9CF');
    const muted = css('--muted', '#A8A29A');
    const coral = css('--coral', '#F28B74');
    g.fillStyle = bg; g.fillRect(0, 0, Wc, Hc);
    const glow = g.createRadialGradient(Wc / 2, 0, 0, Wc / 2, 0, Wc * 0.7);
    glow.addColorStop(0, coral + '55'); glow.addColorStop(1, bg + '00');
    g.fillStyle = glow; g.fillRect(0, 0, Wc, Hc);
    const sans = '"Plus Jakarta Sans", system-ui, Arial, sans-serif';
    const mono = '"DM Mono", ui-monospace, monospace';
    let y = pad;
    // the wordmark, with its coral A
    g.font = `400 40px ${titleFont}`;
    let x = pad;
    for (const ch of String(data.meta.title || '').toUpperCase()) { g.fillStyle = ch === 'A' ? coral : cream; g.fillText(ch, x, y + 36); x += g.measureText(ch).width; }
    y += 70;
    if (withStats && isText(lab.snapshotTitle)) { g.fillStyle = muted; g.font = `400 13px ${mono}`; g.fillText(lab.snapshotTitle.toUpperCase(), pad, y); y += 30; }
    g.fillStyle = cream; g.font = `600 24px ${sans}`;
    y = wrapText(g, questionText(Q), pad, y + 20, Wc - 2 * pad, 30) + 6;
    if (Q.q.filter && isText(Q.q.filter.note)) { g.fillStyle = muted; g.font = `400 15px ${sans}`; g.fillText(Q.q.filter.note, pad, y); y += 22; }
    g.drawImage(img, pad, y); y += img.height + 16;
    if (withStats) {
      const cols = lab.tableColumns || {};
      const unit = Q.unit || ui('unitMissing');
      const heads = [label(Q.grouping), cols.n || donorUnit() || '', `${cols.median || ''} (${unit})`, `${cols.iqr || ''} (${unit})`];
      const rows = Q.groups.map((gr) => [gr.name, String(gr.n), gr.n ? num(gr.median, Q.dec + 1) : '–', gr.n ? `${num(gr.q1, Q.dec + 1)} – ${num(gr.q3, Q.dec + 1)}` : '–']);
      // Each column is as wide as its widest cell plus a gap, so columns can never run into each other.
      const widths = heads.map((t, i) => { g.font = `700 14px ${sans}`; let w = g.measureText(t).width; g.font = `400 14px ${sans}`; rows.forEach((r) => { w = Math.max(w, g.measureText(r[i]).width); }); return w; });
      const gapX = Math.max(16, Math.min(40, (Wc - 2 * pad - widths.reduce((a, w) => a + w, 0)) / (heads.length - 1)));
      const xs = widths.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + widths[i - 1] + gapX : pad); return acc; }, []);
      g.font = `700 14px ${sans}`; g.fillStyle = muted;
      heads.forEach((t, i) => g.fillText(t, xs[i], y + 14));
      y += 30; g.font = `400 14px ${sans}`; g.fillStyle = cream;
      rows.forEach((r) => { r.forEach((t, i) => g.fillText(t, xs[i], y + 14)); y += 30; });
      y += 10;
    }
    g.fillStyle = muted; g.font = `400 13px ${sans}`;
    y = wrapText(g, [lab.dotNote, sourceLine()].filter(isText).join(' '), pad, y + 16, Wc - 2 * pad, 18);
    if (data.meta.PLACEHOLDER) { g.fillStyle = coral; g.font = `700 13px ${sans}`; wrapText(g, data.meta.placeholderNotice || 'PLACEHOLDER', pad, y + 4, Wc - 2 * pad, 18); }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  const fileStem = (Q) => ['unravel', Q.q.metric, Q.q.cellType, Q.q.grouping].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');

  /* ---------- the seven components ---------- */

  const arrow = (ch) => h('span', { class: 'arr', 'aria-hidden': 'true', text: ch });
  // pill button: the one coral action on each screen
  const pill = (text, onclick, attrs) => (isText(text) ? h('button', Object.assign({ type: 'button', class: 'pill', onclick }, attrs || {}), text) : null);
  const pillLink = (text, href, attrs) => (isText(text) ? h('a', Object.assign({ class: 'pill', href }, attrs || {}), text, arrow('→')) : null);
  // any second action is a periwinkle text link
  const link = (text, onclick, attrs) => (isText(text) ? h('button', Object.assign({ type: 'button', class: 'link', onclick }, attrs || {}), text) : null);
  const chip = (text, attrs, icon) => (isText(text) ? h(attrs && attrs.onclick ? 'button' : 'span', Object.assign({ class: 'chip' }, attrs && attrs.onclick ? { type: 'button' } : {}, attrs || {}), icon || null, text) : null);
  // stat card: a mono label top-left, one big number bottom-left
  function statCard(tint, labelText, value, unit, note, goTo) {
    return h('div', { class: 'glow stat', style: `--tint:${tint}` },
      monoLabel(labelText, 'p'),
      h('div', { class: 'foot' },
        h('div', {}, h('p', { class: 'num' }, value, isText(unit) && h('small', { text: unit })), note ? h('p', { class: 'note' }, note) : null),
        goTo ? h('a', { class: 'go', href: goTo.href, 'aria-label': goTo.label }, h('span', { 'aria-hidden': 'true', text: '→' })) : null));
  }
  const panel = (tint, cls, kids) => h('div', { class: 'panel' + (cls ? ' ' + cls : ''), style: tint ? `--tint:${tint}` : null }, kids);
  function ringSvg(cls, handles) {
    const svg = s('svg', { class: 'ring ' + (cls || ''), viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(s('circle', { cx: 50, cy: 50, r: 49.5 }));
    [0, 1].slice(0, handles || 0).forEach((k) => { const a = k ? 2.4 : -0.6; svg.append(s('rect', { x: 50 + 49.5 * Math.cos(a) - 1.6, y: 50 + 49.5 * Math.sin(a) - 1.6, width: 3.2, height: 3.2 })); });
    return svg;
  }
  // tile row: alternating glow down and glow up
  const tileClass = (i) => 'tile glow' + (i % 2 ? ' glow--up' : '');
  // orbs: a radio group with arrow-key movement. Shows four, and a More chip for the rest.
  function orbGroup(items, current, onpick, groupLabel, showAll, onMore) {
    const shown = showAll || items.length <= 4 || items.findIndex((x) => x.id === current) >= 4 ? items : items.slice(0, 4);
    const orbs = shown.map((it) => h('button', { type: 'button', class: 'orb', role: 'radio', 'aria-checked': it.id === current ? 'true' : 'false', tabindex: it.id === current ? '0' : '-1', 'data-k': 'orb-' + it.id, style: `--c:${colourOf(it)}`, onclick: () => onpick(it.id) }, label(it)));
    if (!orbs.some((o) => o.getAttribute('tabindex') === '0') && orbs[0]) orbs[0].setAttribute('tabindex', '0');
    const group = h('div', { class: 'orbs', role: 'radiogroup', 'aria-label': groupLabel || null, onkeydown: (ev) => {
      const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key];
      if (!move) return;
      ev.preventDefault();
      const i = orbs.indexOf(document.activeElement);
      const to = shown[(i + move + shown.length) % shown.length];
      onpick(to.id);
    } }, orbs);
    return [group, shown.length < items.length && chip(ui('more'), { onclick: onMore, 'aria-expanded': 'false', 'data-k': 'more-orbs' })];
  }

  /* ---------- reusable blocks ---------- */

  const charts = new Set();
  const repaintCharts = () => charts.forEach((c) => { if (c.holder.isConnected) c.paint(); else charts.delete(c); });
  // Repaint a panel in place: pin its height and the scroll position so the page never jumps.
  function keepScroll(box, fn) {
    if (!box.isConnected) { fn(); return; }
    const y = window.scrollY;
    box.style.minHeight = box.offsetHeight + 'px';
    fn();
    window.scrollTo(window.scrollX, y);
    requestAnimationFrame(() => { window.scrollTo(window.scrollX, y); box.style.minHeight = ''; });
  }
  const focusIn = (box, key) => { if (!key) return; const t = box.querySelector(`[data-k="${key}"]`); if (t) t.focus({ preventScroll: true }); };

  // Every chart comes with its explanation attached: three short lines, always on screen.
  function explainBlock(ex, vars) {
    const labels = (data.lab || {}).explainLabels || {};
    return h('dl', { class: 'explain' }, ['look', 'shows', 'matters'].map((k) => h('div', {}, h('dt', { class: 'label', text: labels[k] || k }), h('dd', {}, fillNodes((ex || {})[k], vars)))));
  }
  // The only fold on the site. The only place a p-value appears. Closed by default.
  function curiousBlock(Q, curious) {
    const lab = data.lab || {};
    const c = curious || {};
    return h('details', { class: 'curious' }, h('summary', { text: lab.curiousLabel || '' }),
      h('div', { class: 'inner' },
        para(lab.dotNote, 'soft'),
        isText(c.pValue) && h('p', {}, monoLabel(lab.pValueLabel), ' ', c.pValue),
        paras(c.notes, 'soft'),
        isText(lab.statsHeading) && monoLabel(lab.statsHeading, 'p'),
        statsTable(Q)));
  }
  function effectCard(Q) {
    const lab = data.lab || {};
    const words = lab.effectWords || {};
    const d = Q.d;
    const size = !isNum(d) ? '' : Math.abs(d) < 0.2 ? words.none : Math.abs(d) < 0.5 ? words.small : Math.abs(d) < 0.8 ? words.moderate : words.large;
    const note = [size, fill(lab.effectNote, questionVars(Q))].filter(isText).join('. ');
    return statCard(Q.trend === 'down' ? css('--peri', '#8F92E6') : css('--coral', '#F28B74'), lab.effectLabel, isNum(d) ? num(d, 1) : '–', lab.effectUnit, note);
  }

  function chartBlock(Q, opts) {
    const o = opts || {};
    const lab = data.lab || {};
    const holder = h('div', { class: 'chart' });
    const paint = () => holder.replaceChildren(drawChart(Q, holder.clientWidth || Math.max(280, main.clientWidth - 64)));
    charts.add({ holder, paint });
    requestAnimationFrame(paint);
    if ('ResizeObserver' in window) {
      let lastW = 0;
      new ResizeObserver(() => { const w = holder.clientWidth; if (holder.isConnected && w && Math.abs(w - lastW) > 8) { lastW = w; paint(); } }).observe(holder);
    }
    // dots arrive once, staggered, when the chart scrolls into view
    const dots = () => list(Q.groups).reduce((a, g) => a + g.n, 0);
    const reveal = () => { holder.classList.add('in'); setTimeout(() => holder.classList.add('done'), still() ? 220 : 420 + dots() * 8); };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); reveal(); } }, { threshold: 0.25 });
      requestAnimationFrame(() => io.observe(holder));
    } else reveal();
    const vars = Object.assign(questionVars(Q), o.vars || {});
    return h('div', { class: 'stack' },
      h('div', { class: 'plotgrid' },
        effectCard(Q),
        h('figure', { class: 'plot' },
          h('figcaption', { class: 'callout' }, questionText(Q)),
          Q.q.filter && para(Q.q.filter.note, 'soft'),
          strataLegend(Q),
          holder,
          explainBlock(o.explain, vars),
          h('div', { class: 'links' },
            isText(lab.exportLabel) && link(lab.exportLabel, async () => { try { saveBlob(await composeCard(Q, false), fileStem(Q) + '.png'); } catch (e) { /* the picture could not be made on this device */ } }, { 'data-k': 'export' })))),
      curiousBlock(Q, o.curious));
  }

  // A passage with gaps: choose the right words. Wrong choices are marked and you try again.
  function clozeBlock(key, passage, vars) {
    const parts = list(passage.parts).filter((p) => p && (p.type === 'text' || p.type === 'break' || (p.type === 'blank' && list(p.options).length >= 2)));
    const blanks = parts.filter((p) => p.type === 'blank');
    if (!state.cloze.has(key)) state.cloze.set(key, { done: new Map(), tried: new Map(), active: null, last: null });
    const st = state.cloze.get(key);
    const box = h('div', { class: 'cloze stepbody' });
    const idOf = (b) => blanks.indexOf(b);
    const opt = (b, i) => fill(String(b.options[i]), vars);
    const paint = (focus) => {
      const open = blanks.filter((b) => !st.done.has(idOf(b)));
      if (!open.some((b) => idOf(b) === st.active)) st.active = open.length ? idOf(open[0]) : null;
      const active = blanks.find((b) => idOf(b) === st.active) || null;
      const text = h('div', { class: 'passage' });
      let line = h('p', {});
      text.append(line);
      for (const p of parts) {
        if (p.type === 'break') { line = h('p', {}); text.append(line); continue; }
        if (p.type === 'text') { line.append(...fillNodes(p.text, vars)); continue; }
        const n = idOf(p) + 1;
        if (st.done.has(idOf(p))) line.append(h('span', { class: 'gap filled', text: opt(p, p.correct) }));
        else line.append(h('button', { type: 'button', class: 'gap' + (idOf(p) === st.active ? ' active' : ''), 'aria-label': `${n} / ${blanks.length}`, onclick: () => { st.active = idOf(p); st.last = null; paint('option'); } }, h('span', { class: 'gapnum', 'aria-hidden': 'true', text: String(n) })));
      }
      const status = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' }, st.last && h('span', { class: st.last.good ? 'good' : '', text: st.last.text }));
      let chooser = null;
      if (active) {
        const tried = st.tried.get(idOf(active)) || new Set();
        const finish = () => { st.done.set(idOf(active), 'right'); st.last = { good: true, text: ['“' + opt(active, active.correct) + '”', (active.feedback || {}).right].filter(isText).join(' ') }; paint(open.length > 1 ? 'option' : 'done'); };
        const options = active.options.map((_, i) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: i === 0 ? '0' : '-1', class: 'opt' + (tried.has(i) ? ' tried' : ''),
          onclick: () => { if (i === active.correct) { finish(); return; } tried.add(i); st.tried.set(idOf(active), tried); st.last = { good: false, text: (active.feedback || {}).wrong || '' }; paint('option:' + i); } },
          opt(active, i), tried.has(i) && h('span', { class: 'sr', text: ` — ${ui('tried')}` })));
        chooser = h('div', { class: 'chooser' },
          h('div', { class: 'opts', role: 'radiogroup', 'aria-label': `${idOf(active) + 1} / ${blanks.length}`,
            onkeydown: (ev) => { const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key]; if (!move) return; ev.preventDefault(); const to = options[(options.indexOf(document.activeElement) + move + options.length) % options.length]; options.forEach((o) => o.setAttribute('tabindex', o === to ? '0' : '-1')); to.focus(); } },
            options));
      }
      box.replaceChildren(...[text, status, chooser].filter(Boolean));
      if (!focus) return;
      const target = focus === 'done' ? status : focus.startsWith('option:') ? box.querySelectorAll('.opt')[Number(focus.slice(7))] : box.querySelector('.opt');
      if (!target) return;
      if (focus === 'done') target.setAttribute('tabindex', '-1');
      else box.querySelectorAll('.opt').forEach((o) => o.setAttribute('tabindex', o === target ? '0' : '-1'));
      target.focus({ preventScroll: true });
    };
    paint(null);
    return box;
  }

  const linkOut = (url, text, cls) => h('a', { class: cls || 'link', href: url, target: '_blank', rel: 'noopener' }, text, h('span', { class: 'sr', text: ' ' + ui('newTab') }), h('span', { 'aria-hidden': 'true', text: '↗' }));
  // A link to a form on another site, or a switched-off button with a note while the address is not set.
  function formButton(url, text, pendingNote, id) {
    if (!isText(text)) return null;
    if (isUrl(url)) return linkOut(url, text, 'pill');
    return [h('button', { type: 'button', class: 'pill', disabled: true, 'aria-describedby': isText(pendingNote) ? id : null, text }), isText(pendingNote) && h('p', { id, class: 'soft', text: pendingNote })];
  }

  /* ---------- site-started scrolling: one function, 1100ms, easeInOutCubic. The reader's own scroll is never touched. ---------- */

  let scrollAnim = 0;
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function cancelScroll() { if (scrollAnim) { cancelAnimationFrame(scrollAnim); scrollAnim = 0; document.documentElement.classList.remove('no-snap'); } }
  function scrollToY(target, done) {
    cancelScroll();
    const root = document.scrollingElement || document.documentElement;
    const from = root.scrollTop;
    const to = Math.max(0, Math.min(target, root.scrollHeight - window.innerHeight));
    if (still() || Math.abs(to - from) < 2) { root.scrollTop = to; if (done) done(); return; }
    document.documentElement.classList.add('no-snap');   // snapping would fight the animation; it comes back at the end
    const t0 = performance.now();
    const stepFn = (now) => {
      const t = Math.min(1, (now - t0) / 1100);
      root.scrollTop = from + (to - from) * easeInOutCubic(t);
      if (t < 1) scrollAnim = requestAnimationFrame(stepFn);
      else { scrollAnim = 0; document.documentElement.classList.remove('no-snap'); if (done) done(); }
    };
    scrollAnim = requestAnimationFrame(stepFn);
  }
  // the reader takes over at once: any wheel, touch or key stops a site-started scroll (listeners are passive)
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) => window.addEventListener(ev, (e) => { if (ev !== 'keydown' || ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) cancelScroll(); }, { passive: true }));
  const topOf = (el) => el.getBoundingClientRect().top + window.scrollY;
  function scrollToId(id, instant) {
    const el = $(id);
    if (!el) return;
    const focus = () => { const hd = el.querySelector('h1, h2'); if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); } };
    if (instant) { (document.scrollingElement || document.documentElement).scrollTop = topOf(el); focus(); return; }
    scrollToY(topOf(el), focus);
  }

  /* ---------- the home page: the title, the film, then the journey, as one continuous page ---------- */

  const KNOWN = ['question', 'video', 'poll', 'pivot', 'lab', 'explore', 'further'];
  const pad3 = (n) => String(n).padStart(3, '0');
  let homeSecs = [];
  let hooks = {};          // refresh functions the sections register so they can update each other
  const checkIssues = new Set();

  function homeSections() {
    const hasPoll = !!(data.poll && list(data.poll.items).length);
    const hasLab = !!(data.lab && list(data.series).length && list(data.donors).length);
    const have = { question: !!data.hero, video: !!(data.video && isText(data.video.src)), poll: hasPoll, pivot: !!data.pivot, lab: hasLab && list(data.caseStudies).length > 0, explore: hasLab, further: !!data.further };
    const wanted = Array.isArray(data.sections) ? data.sections : KNOWN.map((id) => ({ id }));
    const seen = new Set();
    return wanted.filter((x) => x && KNOWN.includes(x.id) && have[x.id] && !seen.has(x.id) && seen.add(x.id)).map((x) => Object.assign({ name: x.id }, x));
  }
  const badge = (n, name) => monoLabel(`${pad3(n)} · ${name}`, 'p');
  // A section is one black surface: no border, no background. It declares its glow, and holds a head, a visual and an action.
  function sectionEl(def, cls, headKids, visual, action) {
    return h('section', { class: ['sec', 'rv', cls].filter(Boolean).join(' '), id: def.id, 'data-id': def.id, 'aria-label': def.name,
      'data-tint': def.tint || 'coral', 'data-glow-x': isNum(def.glowX) ? def.glowX : 50, 'data-glow-y': isNum(def.glowY) ? def.glowY : 100 },
    h('div', { class: 'wrap' },
      h('div', { class: 'shead', 'data-rv': '0' }, list(headKids.flat ? headKids.flat(Infinity) : headKids)),
      visual && h('div', { class: 'visual', 'data-rv': '1' }, visual),
      action && h('div', { class: 'actions', 'data-rv': '2' }, action)));
  }
  const nextId = (def) => { const i = homeSecs.findIndex((x) => x.id === def.id); return i >= 0 && homeSecs[i + 1] ? homeSecs[i + 1].id : null; };
  const nextPill = (def, text, attrs) => (isText(text) && nextId(def) ? pill(text, () => go(nextId(def)), attrs) : null);
  const head = (n, def, title, lead) => [badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(title)), para(lead, 'lead')];

  /* 001 · the title screen: the title, one sentence, one button, one glow. Nothing else. */
  const ROTATE = [-4, 3, -2, 4, -3, 2, -4];
  function secTitle(def) {
    const hero = data.hero || {};
    const word = String(data.meta.title || '').toUpperCase();
    const letters = [...word].map((ch, i) => h('span', { class: 'l' + (ch === 'A' ? ' a' : ''), 'aria-hidden': 'true', style: `--i:${i};--r:${ROTATE[i % ROTATE.length]}deg;--dy:${i % 2 ? 0.04 : 0}em`, text: ch }));
    const thread = s('svg', { class: 'thread', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    thread.append(s('path', { d: 'M2 1 C 40 3, 92 8, 80 30 S 28 70, 62 100' }));
    const sec = h('section', { class: 'sec titlescreen', id: def.id, 'data-id': def.id, 'aria-label': def.name, 'data-tint': def.tint || 'coral', 'data-glow-x': isNum(def.glowX) ? def.glowX : 50, 'data-glow-y': isNum(def.glowY) ? def.glowY : 100 },
      h('div', { class: 'hero-glow', 'aria-hidden': 'true' }),
      ringSvg('r1 spin', 2), ringSvg('r2 spin', 1),
      h('div', { class: 'wrap' },
        h('div', { class: 'titlewrap', style: 'position:relative' },
          h('h1', { class: 'title', 'aria-label': data.meta.title || '', tabindex: '-1' }, letters), thread),
        para(hero.tagline, 'tagline'),
        h('div', { class: 'act' }, nextPill(def, hero.cta), monoLabel(hero.hint, 'div'))));
    return sec;
  }

  /* 002 · where the data comes from: a 30-second film with no words in it. The captions are HTML, timed to it. */
  const ICON = {
    play: 'M7 4.5v15l12-7.5z', pause: 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z',
    soundOff: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6', soundOn: 'M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12',
    again: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  };
  const icon = (name) => { const svg = s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }); svg.append(s('path', { d: ICON[name], fill: /play|pause/.test(name) ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': /play|pause/.test(name) ? 0 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); return svg; };
  function secVideo(def, n) {
    const v = data.video;
    const L = v.labels || {};
    const caps = list(v.captions).filter((c) => c && isNum(c.from) && isNum(c.to) && isText(c.text)).sort((a, b) => a.from - b.from);
    const video = h('video', { muted: true, playsinline: true, preload: 'metadata', 'aria-describedby': 'film-captions' });
    video.muted = true;
    const caption = h('p', { class: 'caption', 'aria-hidden': 'true' });
    const bar = h('span');
    const film = h('div', { class: 'film' + (still() ? ' still' : '') });
    const playBtn = h('button', { type: 'button', class: 'round', 'data-k': 'play' });
    const soundBtn = h('button', { type: 'button', class: 'round', 'data-k': 'sound' });
    const transcript = para(v.transcript, 'transcript');
    let userPaused = false;
    let failed = false;
    let shown = -1;
    const setPlayLabel = () => { const playing = !video.paused && !video.ended; playBtn.replaceChildren(icon(playing ? 'pause' : 'play')); playBtn.setAttribute('aria-label', (playing ? L.pause : L.play) || ''); };
    const setSoundLabel = () => { soundBtn.replaceChildren(icon(video.muted ? 'soundOff' : 'soundOn')); soundBtn.setAttribute('aria-label', (video.muted ? L.soundOn : L.soundOff) || ''); soundBtn.setAttribute('aria-pressed', video.muted ? 'false' : 'true'); };
    const showCaption = (t) => {
      let i = caps.findIndex((c) => t >= c.from && t < c.to);
      if (i < 0 && caps.length && (video.ended || t >= caps[caps.length - 1].to)) i = caps.length - 1;   // the last caption stays after the end
      if (i === shown) return;
      shown = i;
      if (i < 0) { caption.classList.remove('on'); return; }
      caption.textContent = fill(caps[i].text);
      caption.classList.remove('on');
      void caption.offsetWidth;
      caption.classList.add('on');
    };
    const tick = () => { const d = video.duration || 30; bar.style.setProperty('--t', Math.min(1, video.currentTime / d)); showCaption(video.currentTime); };
    const fail = () => {
      if (failed) return;
      failed = true;
      film.classList.add('failed');
      video.removeAttribute('src');
      if (transcript) transcript.hidden = false;
      checkIssues.add(fill(ui('checkVideoMissing'), { src: v.src }));
      if (checkMode) markPlaceholders();
    };
    const tryPlay = () => { if (failed || still() || userPaused || video.ended) return; const p = video.play(); if (p && p.catch) p.catch(() => {}); };
    video.addEventListener('timeupdate', tick);
    video.addEventListener('seeked', tick);
    video.addEventListener('play', setPlayLabel);
    video.addEventListener('pause', setPlayLabel);
    video.addEventListener('ended', () => { film.classList.add('ended'); setPlayLabel(); showCaption(video.duration || 0); });
    video.addEventListener('error', fail);
    playBtn.addEventListener('click', () => {
      if (failed) return;
      if (video.paused || video.ended) { userPaused = false; if (video.ended) video.currentTime = 0; film.classList.remove('ended'); const p = video.play(); if (p && p.catch) p.catch(() => {}); } else { userPaused = true; video.pause(); }
    });
    soundBtn.addEventListener('click', () => { video.muted = !video.muted; setSoundLabel(); });
    setPlayLabel(); setSoundLabel();
    if (transcript) transcript.hidden = !still();
    // Is the file there? If not, the section still stands: heading, transcript, button, and a #check failure.
    fetch(v.src, { method: 'HEAD', cache: 'no-store' }).then((res) => {
      if (!res.ok) { fail(); return; }
      if (isText(v.poster)) video.setAttribute('poster', v.poster);
      video.setAttribute('src', v.src);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((es) => es.forEach((e) => { if (e.intersectionRatio >= 0.6) tryPlay(); else if (!video.paused) video.pause(); }), { threshold: [0, 0.6, 1] }).observe(film);
      }
    }, fail);
    api.video = { el: video };
    film.append(
      h('div', { class: 'halo', 'aria-hidden': 'true' }),
      h('div', { class: 'frame' }, video, caption),
      h('div', { class: 'filmbar', 'aria-hidden': 'true' }, bar),
      h('div', { class: 'filmctl' }, playBtn, soundBtn),
      h('div', { class: 'sr', id: 'film-captions' }, isText(v.captionsHeading) && h('p', { text: v.captionsHeading }), h('ol', {}, caps.map((c) => h('li', { text: fill(c.text) })))));
    const again = chip(L.again, { onclick: () => { userPaused = false; film.classList.remove('ended'); video.currentTime = 0; shown = -1; const p = video.play(); if (p && p.catch) p.catch(() => {}); }, 'data-k': 'again' }, icon('again'));
    const sec = sectionEl(def, 'filmsec', [badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(v.heading))], [film, transcript, h('div', { class: 'filmend' }, again, nextPill(def, v.cta))], null);
    return sec;
  }

  /* 003 · what you think: one statement per panel, then the result as a stat card */
  function secPoll(def, n) {
    const poll = data.poll;
    const items = list(poll.items);
    const keys = ['true', 'false', 'dk'];
    const names = poll.options || {};
    const endpoint = isUrl((data.config || {}).pollEndpoint) ? data.config.pollEndpoint : null;
    const P = state.poll;
    const box = h('div', { class: 'pollbox' });
    const csv = (rec) => {
      const hd = ['submitted', 'classCode', ...items.map((i) => i.id), 'score'];
      const row = [rec.at, rec.classCode, ...items.map((i) => rec.answers[i.id] || ''), rec.score];
      return [hd, row].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    };
    const answered = () => items.filter((i) => P.answers[i.id]).length;
    const firstOpen = () => items.findIndex((i) => !P.answers[i.id]);
    const paint = (focus) => keepScroll(box, () => { box.replaceChildren(...view().flat(Infinity).filter(Boolean)); focusIn(box, focus); });
    const choose = (k) => { P.answers[items[P.index].id] = k; paint('c-' + k); };
    const advance = () => {
      const open = firstOpen();
      if (P.index < items.length - 1) P.index += 1;
      else if (open >= 0) P.index = open;
      else P.phase = 'code';
      paint(P.phase === 'code' ? 'code' : 'c-true');
    };
    const dots = () => h('div', { class: 'pdots', role: 'group', 'aria-label': fill(poll.ofLabel, { n: P.index + 1, total: items.length }) },
      items.map((it, i) => h('button', { type: 'button', class: 'pdot' + (P.answers[it.id] ? ' on' : '') + (P.phase === 'ask' && i === P.index ? ' cur' : ''), 'aria-label': fill(poll.ofLabel, { n: i + 1, total: items.length }),
        'aria-current': P.phase === 'ask' && i === P.index ? 'step' : null, onclick: () => { P.phase = 'ask'; P.index = i; paint('c-true'); } })));
    const tint = css('--peri', '#8F92E6');
    const askPanel = () => {
      const it = items[P.index];
      const mine = P.answers[it.id];
      return panel(tint, 'pollpanel', [
        h('div', { class: 'steptop' }, monoLabel(fill(poll.ofLabel, { n: P.index + 1, total: items.length }), 'p'), dots()),
        h('p', { class: 'stmt', id: 'stmt' }, `“${it.statement}”`),
        h('div', { class: 'opts', role: 'group', 'aria-labelledby': 'stmt' }, keys.map((k) => h('button', { type: 'button', class: 'opt', 'aria-pressed': mine === k ? 'true' : 'false', 'data-k': 'c-' + k, onclick: () => choose(k) }, names[k] || k))),
        h('div', { class: 'stepnav' },
          P.index > 0 ? link(poll.backLabel, () => { P.index -= 1; paint('c-true'); }) : h('span'),
          pill(P.index === items.length - 1 && answered() === items.length ? poll.submitLabel : poll.nextLabel, advance, { disabled: !mine, 'data-k': 'next' }))]);
    };
    const codePanel = () => h('form', { class: 'panel pollpanel', style: `--tint:${tint}`, novalidate: true, onsubmit: (ev) => {
      ev.preventDefault();
      const score = items.filter((i) => P.answers[i.id] === i.correct).length;
      P.submitted = { at: new Date().toISOString(), classCode: P.classCode.trim().slice(0, 24), answers: Object.assign({}, P.answers), score };
      P.phase = 'result';
      store.set('poll', P.submitted);
      if (endpoint) { try { fetch(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(P.submitted) }).catch(() => {}); } catch (e) { /* offline: the result is still shown */ } }
      paint('result');
      if (hooks.pivot) hooks.pivot();
    } },
      isText(poll.classCodeLabel) && h('div', { class: 'field' },
        h('label', { for: 'classcode', class: 'label', text: poll.classCodeLabel }),
        h('input', { id: 'classcode', 'data-k': 'code', type: 'text', maxlength: '24', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: P.classCode, 'aria-describedby': isText(poll.classCodeHint) ? 'classcode-hint' : null, oninput: (ev) => { P.classCode = ev.target.value; } }),
        isText(poll.classCodeHint) && h('p', { id: 'classcode-hint', class: 'soft', text: poll.classCodeHint })),
      para(endpoint ? poll.privacyShared : poll.privacyLocal, 'soft'),
      h('div', { class: 'stepnav' }, link(poll.backLabel, () => { P.phase = 'ask'; P.index = items.length - 1; paint('c-true'); }), h('button', { type: 'submit', class: 'pill', text: poll.submitLabel || '' })));

    const resultView = () => {
      const done = P.submitted;
      const mean = items.reduce((a, i) => a + ((i.benchmark || {})[i.correct] || 0), 0) / items.length;
      const wrongForMost = items.filter((i) => isNum((i.benchmark || {})[i.correct]) && i.benchmark[i.correct] < 50).length;
      return [h('div', { class: 'statgrid' },
        h('div', { tabindex: '-1', 'data-k': 'result' }, statCard(css('--coral', '#F28B74'), poll.scoreLabel, String(done.score), fill(poll.scoreOf, { total: items.length }), fill(poll.resultCompare, { benchmarkMean: qty(mean, '%', 0) }))),
        panel(tint, '', [
          wrongForMost > 0 && para(poll.resultGap, '', { count: wrongForMost }),
          h('ol', { class: 'rows' }, items.map((item) => {
            const b = item.benchmark || {};
            const mine = done.answers[item.id];
            const right = mine === item.correct;
            const total = keys.reduce((a, k) => a + (isNum(b[k]) ? b[k] : 0), 0) || 1;
            return h('li', {},
              h('div', { class: 'rowtop' }, h('p', {}, `“${item.statement}”`), chip((right ? poll.rightLabel : poll.wrongLabel) || '', { class: 'chip verdict' })),
              h('div', { class: 'bar', role: 'img', 'aria-label': [poll.benchmarkLabel, keys.map((k) => `${names[k] || k} ${qty(b[k], '%', 1)}`).join(', '), isText(poll.yourAnswer) && `${poll.yourAnswer}: ${names[mine] || mine}`].filter(isText).join('. ') },
                keys.map((k) => (isNum(b[k]) ? h('span', { class: 'seg' + (k === item.correct ? ' correct' : ''), style: `width:${(b[k] / total) * 100}%` }, mine === k && h('span', { class: 'you' })) : null))),
              h('p', { class: 'label' }, keys.map((k, i) => h('span', {}, `${names[k] || k} ${qty(b[k], '%', 0)}`, mine === k && ` (${ui('you')})`, i < keys.length - 1 ? ' · ' : ''))));
          })),
          (isText(poll.benchmarkSource) || isUrl(poll.benchmarkSourceUrl)) && h('p', { class: 'soft' }, poll.benchmarkSource || '', ' ', isUrl(poll.benchmarkSourceUrl) && linkOut(poll.benchmarkSourceUrl, poll.benchmarkSourceUrl.replace(/^https:\/\/([^/]+).*$/, '$1'))),
          h('div', { class: 'links' },
            link(poll.exportLabel, () => saveBlob(new Blob([csv(done)], { type: 'text/csv' }), 'unravel-poll.csv')),
            link(poll.retakeLabel, () => { P.submitted = null; P.answers = {}; P.index = 0; P.phase = 'ask'; paint('c-true'); if (hooks.pivot) hooks.pivot(); }),
            link(poll.clearLabel, () => { store.del('poll'); P.submitted = null; P.answers = {}; P.classCode = ''; P.index = 0; P.phase = 'ask'; paint('c-true'); if (hooks.pivot) hooks.pivot(); }))])),
      h('div', { class: 'actions' }, nextPill(def, poll.resultCta))];
    };
    function view() {
      if (P.phase === 'result' && P.submitted) return resultView();
      if (P.phase === 'code' && answered() === items.length) return [codePanel()];
      P.phase = 'ask';
      return [askPanel()];
    }
    paint(null);
    api.poll = {
      key(ev) {
        if (P.phase !== 'ask') return false;
        const k = { 1: 'true', 2: 'false', 3: 'dk' }[ev.key];
        if (k) { choose(k); return true; }
        return false;
      },
    };
    // v5: the hero question becomes this section's one heading
    return sectionEl(def, 'poll', head(n, def, (data.hero || {}).question, poll.framing), box, null);
  }

  /* 004 · the pivot: the poll's hinge statement, the distinction, and three nested rings */
  function secPivot(def, n) {
    const pv = data.pivot;
    const poll = data.poll || {};
    const names = poll.options || {};
    const item = byId(poll.items, poll.pivotItemId);
    const rings = pv.rings || {};
    const verdict = h('p', { class: 'lead' });
    const yours = h('p', { class: 'soft' });
    const refresh = () => {
      if (!item) return;
      verdict.textContent = [pv.verdictLabel, names[item.correct] || item.correct].filter(isText).join(' ');
      const mine = state.poll.submitted && state.poll.submitted.answers[item.id];
      const b = item.benchmark || {};
      yours.textContent = [mine && isText(poll.yourAnswer) ? `${poll.yourAnswer}: ${names[mine] || mine}.` : '',
        isText(poll.benchmarkLabel) && isNum(b[item.correct]) ? `${poll.benchmarkLabel}: ${names[item.correct] || item.correct} ${qty(b[item.correct], '%', 1)}.` : ''].filter(Boolean).join(' ');
    };
    hooks.pivot = refresh;
    refresh();
    // The picture: three nested dotted rings, and at the core the cells, sorted into six clusters in the six cell colours.
    const svg = s('svg', { viewBox: '0 0 400 400', role: 'img', 'aria-label': [rings.outer, rings.inner, rings.core].filter(isText).join(' › ') });
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const g1 = s('g', { class: 'g1' }); g1.append(s('circle', { class: 'r', cx: 200, cy: 200, r: 190 }), s('text', { x: 200, y: 44 }, (rings.outer || '').toUpperCase()));
    const g2 = s('g', { class: 'g2' }); g2.append(s('circle', { class: 'r', cx: 200, cy: 236, r: 128 }), s('text', { x: 200, y: 140 }, (rings.inner || '').toUpperCase()));
    const g3 = s('g', { class: 'g3' }); g3.append(s('circle', { class: 'r r3', cx: 200, cy: 300, r: 58 }), s('text', { x: 200, y: 230 }, (rings.core || '').toUpperCase()));
    const cells = list(data.cellTypes).slice(0, 6);
    cells.forEach((c, k) => {
      const a = (k / cells.length) * Math.PI * 2 - Math.PI / 2;
      const cx = 200 + 30 * Math.cos(a);
      const cy = 300 + 30 * Math.sin(a);
      for (let i = 0; i < 9; i += 1) { const rr = 11 * Math.sqrt(rnd()); const t = rnd() * Math.PI * 2; g3.append(s('circle', { cx: cx + rr * Math.cos(t), cy: cy + rr * Math.sin(t), r: 2.6, fill: colourOf(c), 'fill-opacity': 0.9 })); }
    });
    svg.append(g1, g2, g3);
    const ringsEl = h('div', { class: 'rings', 'data-beat': still() ? '3' : '0' }, svg);
    hooks.pivotBeats = () => { if (ringsEl.dataset.beat !== '3') { [1, 2, 3].forEach((i) => setTimeout(() => { ringsEl.dataset.beat = String(Math.max(i, Number(ringsEl.dataset.beat))); }, i * 600)); } };
    const dec = list(pv.decoders);
    const tints = [css('--rose', '#E9A3A0'), css('--peri', '#8F92E6'), css('--coral', '#F28B74')];
    const visual = [
      h('div', { class: 'pivotgrid' },
        h('div', { class: 'beats' }, item && h('blockquote', { class: 'pq' }, `“${item.statement}”`), item && verdict, item && yours, paras(pv.body), para(pv.handoff)),
        ringsEl),
      dec.length > 0 && h('div', { class: 'stack', style: 'display:flex;flex-direction:column;gap:16px;margin-top:40px' }, monoLabel(pv.decodersHeading, 'p'),
        h('ul', { class: 'tiles' }, dec.map((d, i) => h('li', { class: tileClass(i), style: `--tint:${tints[i % 3]}` }, h('p', { class: 't', text: d.title || '' }), para(d.body, 's')))))];
    return sectionEl(def, 'pivot', [badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(pv.heading))], visual, nextPill(def, pv.cta));
  }

  /* 005 · the lab: it opens in the guided flow. Pick a simulation from the tiles; the panel runs its four steps. */
  const currentCase = () => byId(data.caseStudies, state.caseId);
  function secLab(def, n) {
    const lab = data.lab;
    const cases = list(data.caseStudies);
    if (!currentCase()) state.caseId = cases[0].id;
    const box = h('div', { class: 'labbox', style: 'display:flex;flex-direction:column;gap:24px' });
    const titleOf = (c) => (isText(c.plainTitle) ? c.plainTitle : c.title) || c.id;
    const paint = (focus) => keepScroll(box, () => { box.replaceChildren(chooser(), stepView()); focusIn(box, focus); });
    hooks.lab = paint;
    const open = (c) => { state.caseId = c.id; state.step = 0; state.view = 0; paint('case-' + c.id); };

    function chooser() {
      const shown = state.showAllCases || cases.length <= 4 || cases.indexOf(currentCase()) >= 4 ? cases : cases.slice(0, 4);
      return h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
        monoLabel(lab.chooseLabel, 'p'),
        h('div', { class: 'tiles four', role: 'group', 'aria-label': lab.chooseLabel || null }, shown.map((c, i) => {
          const v = list(c.views)[0] || {};
          const cell = cellOf(v.cellType);
          return h('button', { type: 'button', class: tileClass(i), style: `--tint:${colourOf(cell)}`, 'aria-pressed': c.id === state.caseId ? 'true' : 'false', 'data-k': 'case-' + c.id, onclick: () => open(c) },
            h('span', { class: 'tn', 'aria-hidden': 'true', text: String(cases.indexOf(c) + 1) }),
            monoLabel(label(cell)), h('span', { class: 't', text: titleOf(c) }));
        })),
        shown.length < cases.length && h('div', {}, chip(lab.moreLabel || ui('more'), { onclick: () => { state.showAllCases = true; paint('case-' + cases[4].id); }, 'aria-expanded': 'false' })));
    }

    function stepView() {
      const cs = currentCase();
      const labels = list(lab.stepLabels);
      const repaint = (key) => paint(key);
      const views = list(cs.views);
      state.view = Math.min(state.view, Math.max(0, views.length - 1));
      const view = views[state.view] || {};
      const base = { metric: view.metric, cellType: view.cellType, grouping: cs.grouping, filter: cs.filter || null };
      const first = buildQuestion({ metric: (views[0] || {}).metric, cellType: (views[0] || {}).cellType, grouping: cs.grouping, filter: cs.filter || null });
      const predicted = state.predictions[cs.id];
      const predictOptions = list((cs.predict || {}).options);
      const predLabel = (id) => (predictOptions.find((o) => o.id === id) || {}).label || '';
      const viewTabs = views.length > 1 ? h('div', { class: 'chips' }, views.map((v, i) => chip([label(metricOf(v.metric)), label(cellOf(v.cellType))].filter(Boolean).join(' · '), { 'aria-pressed': i === state.view ? 'true' : 'false', 'data-k': 'view-' + i, onclick: () => { state.view = i; repaint('view-' + i); } }))) : null;
      const back = state.step > 0 ? link(lab.backLabel, () => { state.step -= 1; repaint('next'); }) : h('span');
      const nextStep = () => { state.step += 1; repaint('next'); };
      const chartOpts = { explain: cs.explain, curious: cs.curious };

      let body;
      let action;
      if (state.step === 0) {
        body = [para(cs.brief), cs.filter && para(cs.filter.note, 'soft'),
          predictOptions.length > 0 && h('fieldset', { class: 'predict' }, h('legend', { text: (cs.predict || {}).question || '' }),
            h('div', { class: 'opts' }, predictOptions.map((o) => h('button', { type: 'button', class: 'opt', 'aria-pressed': predicted === o.id ? 'true' : 'false', 'data-k': 'pred-' + o.id, onclick: () => { state.predictions[cs.id] = o.id; repaint('pred-' + o.id); } }, o.label)))),
          predicted && para(lab.predictSaved, 'callout', { prediction: predLabel(predicted) })];
        action = [predicted ? h('span') : link(lab.predictSkip, nextStep, { 'data-k': 'skip' }), pill(lab.nextLabel, nextStep, { 'data-k': 'next', disabled: !predicted })];
      } else if (state.step === 1) {
        const Q = buildQuestion(base);
        const vars = Object.assign(questionVars(first), { prediction: predLabel(predicted) });
        body = [viewTabs,
          first && para(!predicted ? lab.observeNoPrediction : predicted === first.trend ? lab.observeMatch : lab.observeMiss, 'callout', vars),
          Q && chartBlock(Q, chartOpts)];
        action = [back, pill(lab.nextLabel, nextStep, { 'data-k': 'next' })];
      } else if (state.step === 2) {
        const chosen = state.strat[cs.id] || null;
        const Q = buildQuestion(Object.assign({}, base, { confounder: chosen }));
        const confs = list(cs.confounders).map((id) => byId(data.confounders, id)).filter(Boolean);
        const conf = chosen ? byId(data.confounders, chosen) : null;
        const counts = Q && conf ? h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, monoLabel(lab.stressCountsHeading, 'p'),
          h('div', { class: 'tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: `${conf.label} (${donorUnit() || ui('unitMissing')})` }), Q.groups.map((g) => h('th', { scope: 'col', class: 'num', text: g.name })))),
            h('tbody', {}, Q.strata.map((st, si) => h('tr', {}, h('th', { scope: 'row', text: st }), Q.groups.map((g) => h('td', { class: 'num', text: String(g.parts[si].n) }))))))),
          para(lab.stressCountsNote, 'soft')) : null;
        body = [para(lab.stressIntro),
          confs.length > 0 && h('div', { class: 'chips', role: 'group', 'aria-label': labels[2] || null }, [null, ...confs].map((c) => chip(c ? c.label : lab.stressNone || '–', { 'aria-pressed': (c ? c.id : null) === chosen ? 'true' : 'false', 'data-k': 'strat-' + (c ? c.id : 'none'), onclick: () => { state.strat[cs.id] = c ? c.id : null; repaint('strat-' + (c ? c.id : 'none')); } }))),
          viewTabs, Q && chartBlock(Q, chartOpts), counts];
        action = [back, pill(lab.nextLabel, nextStep, { 'data-k': 'next' })];
      } else {
        state.didWork = true;
        if (hooks.further) hooks.further();
        const tk = cs.takeaway || {};
        const nextCs = cases[(cases.indexOf(cs) + 1) % cases.length];
        body = [first && list(tk.parts).length > 0 && clozeBlock('case:' + cs.id, tk, questionVars(first)),
          (isText(tk.claim) || isText(tk.limitation)) && h('div', { class: 'model' }, monoLabel(lab.modelHeading, 'p'),
            isText(tk.claim) && h('div', {}, h('p', { class: 'label', text: lab.takeawayClaimLabel || '' }), h('p', { text: tk.claim })),
            isText(tk.limitation) && h('div', {}, h('p', { class: 'label', text: lab.takeawayLimitLabel || '' }), h('p', { text: tk.limitation })))];
        action = [h('div', { class: 'links' }, back, nextCs && nextCs !== cs && link(ui('nextCase'), () => { open(nextCs); })),
          hooks.explore ? pill(lab.toExplore, () => go('explore'), { 'data-k': 'next' }) : null];
      }
      return panel(colourOf(cellOf(view.cellType)), 'labpanel', [
        h('div', { class: 'steptop' },
          monoLabel([fill(lab.stepOfLabel, { n: state.step + 1, total: 4 }), labels[state.step]].filter(isText).join(' · '), 'p'),
          h('div', { class: 'prog', role: 'group', 'aria-label': labels.join(', ') }, [0, 1, 2, 3].map((i) => h('button', { type: 'button', class: 'seg-b' + (i <= state.step ? ' on' : ''), 'aria-label': `${ui('step')} ${i + 1}: ${labels[i] || ''}`, 'aria-current': i === state.step ? 'step' : null, 'data-k': 'step-' + i, onclick: () => { state.step = i; repaint('step-' + i); } })))),
        h('p', { class: 'lead', text: titleOf(cs) }),
        h('div', { class: 'stepbody' }, body),
        h('div', { class: 'stepnav' }, action)]);
    }
    paint(null);
    return sectionEl(def, 'lab', head(n, def, lab.heading, lab.intro), box, null);
  }

  /* 006 · working solo: the next step after the guided questions */
  function secExplore(def, n) {
    const lab = data.lab;
    const ex = data.explore || {};
    const box = h('div', { style: 'display:flex;flex-direction:column;gap:28px' });
    const action = h('div', { style: 'display:contents' });
    const paint = (focus) => keepScroll(box, () => { const [b, a] = view(); box.replaceChildren(...b.flat(Infinity).filter(Boolean)); action.replaceChildren(...a.flat(Infinity).filter(Boolean)); focusIn(box, focus) || focusIn(action, focus); });
    hooks.explore = paint;
    function view() {
      if (!state.sandbox) { const first = list(lab.launchpads)[0] || list(data.series)[0] || {}; state.sandbox = { metric: first.metric, cellType: first.cellType, grouping: first.grouping || (list(data.groupings)[0] || {}).id }; }
      const sb = state.sandbox;
      const metricsWithData = list(data.metrics).filter((m) => list(data.series).some((x) => x.metric === m.id));
      const cellsFor = (metricId) => list(data.cellTypes).filter((c) => seriesOf(metricId, c.id));
      if (!metricsWithData.some((m) => m.id === sb.metric)) sb.metric = (metricsWithData[0] || {}).id;
      if (!cellsFor(sb.metric).some((c) => c.id === sb.cellType)) sb.cellType = (cellsFor(sb.metric)[0] || {}).id;
      if (!groupingOf(sb.grouping)) sb.grouping = (list(data.groupings)[0] || {}).id;
      const Q = buildQuestion(sb);
      const b = lab.builder || {};
      const select = (key, options, value, onchange, name) => h('select', { 'data-k': key, 'aria-label': name || key, onchange: (ev) => { onchange(ev.target.value); state.snapshotMade = false; paint(key); } }, options.map((o) => h('option', { value: o.id, selected: o.id === value }, label(o))));
      const pads = list(lab.launchpads);
      const tints = [css('--peri', '#8F92E6'), css('--rose', '#E9A3A0'), css('--coral', '#F28B74')];
      const pick = (id) => { sb.cellType = id; state.snapshotMade = false; paint('orb-' + id); };
      return [[
        pads.length > 0 && h('ul', { class: 'tiles' }, pads.map((p, i) => h('li', { style: 'display:flex' }, h('button', { type: 'button', class: tileClass(i), style: `--tint:${tints[i % 3]};width:100%`, 'aria-pressed': p.metric === sb.metric && p.cellType === sb.cellType && p.grouping === sb.grouping ? 'true' : 'false', 'data-k': 'pad-' + p.id,
          onclick: () => { state.sandbox = { metric: p.metric, cellType: p.cellType, grouping: p.grouping }; state.snapshotMade = false; paint('pad-' + p.id); } },
          monoLabel(label(cellOf(p.cellType))), h('span', { class: 't', text: p.title || '' }), isText(p.blurb) && h('span', { class: 's', text: p.blurb }))))),
        h('p', { class: 'builder' }, b.lead || '', ' ',
          select('metric', metricsWithData, sb.metric, (v) => { sb.metric = v; }, b.lead), ' ', b.mid1 || '', ' ',
          select('grouping', list(data.groupings), sb.grouping, (v) => { sb.grouping = v; }, b.mid1), ' ', b.mid2 || '', ' ',
          h('span', { text: label(cellOf(sb.cellType)) }), b.end || ''),
        h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, monoLabel(ex.cellLabel, 'p', null, { id: 'orbs-label' }),
          orbGroup(cellsFor(sb.metric), sb.cellType, pick, ex.cellLabel, state.showAllCells, () => { state.showAllCells = true; paint('orb-' + sb.cellType); })),
        Q && panel(colourOf(cellOf(sb.cellType)), '', [chartBlock(Q, { explain: ex.explain, curious: null })]),
        state.snapshotMade && h('div', { class: 'bridge', role: 'status' }, para(lab.snapshotDone, 'soft'),
          data.prize && isText(lab.snapshotBridge) && h('a', { class: 'link', href: '#prize' }, fillNodes(lab.snapshotBridge), arrow('→')))],
      [Q && pill(lab.snapshotLabel, async () => { try { saveBlob(await composeCard(Q, true), fileStem(Q) + '-snapshot.png'); } catch (e) { /* the picture could not be made on this device */ } state.snapshotMade = true; state.didWork = true; if (hooks.further) hooks.further(); paint('snapshot'); }, { 'data-k': 'snapshot' })]];
    }
    paint(null);
    return sectionEl(def, 'explore', head(n, def, ex.heading || lab.heading, ex.intro), box, action);
  }

  /* 007 · take it further: the prize, then the three side pages as a tile row */
  function secFurther(def, n) {
    const f = data.further;
    const prize = f.prize || {};
    const body = h('p', {});
    const refresh = () => body.replaceChildren(...fillNodes(state.didWork && isText(prize.bodyAfterWork) ? prize.bodyAfterWork : prize.body));
    hooks.further = refresh;
    refresh();
    const lines = Object.fromEntries(list(f.doors).map((d) => [d.page, d.line]));
    if (data.prize && !lines.prize) lines.prize = data.prize.intro;
    const pages = TABS.filter((p) => data[p]);
    const tints = [css('--coral', '#F28B74'), css('--peri', '#8F92E6'), css('--rose', '#E9A3A0')];
    const visual = [
      data.prize && panel(css('--coral', '#F28B74'), 'prizepanel', [isText(prize.badge) && h('div', {}, chip(fill(prize.badge))), h('p', { class: 'lead' }, fillNodes(prize.heading)), body]),
      pages.length > 0 && h('div', { style: 'display:flex;flex-direction:column;gap:14px;margin-top:40px' }, monoLabel(f.tilesLabel, 'p'),
        h('ul', { class: 'tiles' }, pages.map((p, i) => h('li', { style: 'display:flex' }, h('a', { class: tileClass(i), style: `--tint:${tints[i % 3]};width:100%`, href: '#' + p },
          monoLabel((data.nav || {})[p] || p), isText(lines[p]) && h('span', { class: 's' }, fillNodes(lines[p])))))))];
    return sectionEl(def, 'further', [badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(f.heading))], visual, data.prize ? pillLink(prize.cta, '#prize') : null);
  }

  function renderHome() {
    hooks = {};
    homeSecs = homeSections();
    const build = { question: secTitle, video: secVideo, poll: secPoll, pivot: secPivot, lab: secLab, explore: secExplore, further: secFurther };
    return h('div', { class: 'view home' }, homeSecs.map((d, i) => build[d.id](d, i + 1)));
  }

  /* ---------- the essay prize, UCAS and teachers pages ---------- */

  const countWords = (t) => (String(t).trim().match(/\S+/g) || []).length;
  const psec = (...kids) => h('section', { class: 'psec' }, kids.flat(Infinity).filter(Boolean));
  const h2 = (t) => (isText(t) ? h('h2', {}, fillNodes(t)) : null);
  const pageHead = (title, intro) => h('header', { class: 'psec' }, h('h1', { tabindex: '-1' }, fillNodes(title)), para(intro, 'lead'));
  const pTint = (i) => [css('--coral', '#F28B74'), css('--peri', '#8F92E6'), css('--rose', '#E9A3A0'), css('--cream', '#FBE9CF')][i % 4];

  function renderPrize() {
    const p = data.prize;
    const cfg = data.config || {};
    const draft = store.get('essay') || {};
    const sections = list(p.sections);
    const areas = [];
    let timer = 0;
    const totalText = h('span', { class: 'tt' });
    const fillBar = h('span', { class: 'fill' });
    const scale = (p.wordsMax || 500) * 1.2;
    const bar = h('div', { class: 'totalbar', role: 'status' }, totalText, h('div', { class: 'track2' }, h('span', { class: 'range', style: `left:${(p.wordsMin / scale) * 100}%;width:${((p.wordsMax - p.wordsMin) / scale) * 100}%` }), fillBar));
    const refresh = () => {
      let sum = 0;
      areas.forEach(({ sec, area, counter }) => {
        const c = countWords(area.value); sum += c;
        counter.textContent = fill(p.wordCount, { count: c, target: sec.target });
        counter.classList.toggle('near', c >= 0.85 * (sec.target || 0) && c <= 1.15 * (sec.target || 0));
      });
      totalText.textContent = fill(p.totalCount, { count: sum });
      fillBar.style.width = Math.min(100, (sum / scale) * 100) + '%';
    };
    const save = () => { clearTimeout(timer); timer = setTimeout(() => { const out = {}; areas.forEach(({ sec, area }) => { out[sec.id] = area.value; }); store.set('essay', out); }, 400); };
    const hasDeadline = isText(cfg.essayDeadline) && cfg.essayDeadline !== 'PLACEHOLDER';
    const boxes = sections.map((sec, i) => {
      const area = h('textarea', { id: 'essay-' + sec.id, rows: String(Math.max(4, Math.round((sec.target || 100) / 22))), 'aria-describedby': `essay-${sec.id}-hint essay-${sec.id}-count`, oninput: () => { refresh(); save(); } });
      area.value = draft[sec.id] || '';
      const counter = h('p', { class: 'count', id: `essay-${sec.id}-count` });
      areas.push({ sec, area, counter });
      return panel(pTint(i), 'field', [h('label', { for: 'essay-' + sec.id, class: 'label', text: sec.label || sec.id }), h('p', { class: 'soft', id: `essay-${sec.id}-hint`, text: sec.prompt || '' }), area, counter]);
    });
    const text = () => areas.map(({ sec, area }) => `${sec.label || sec.id}\n${area.value.trim()}`).join('\n\n');
    const copy = link(p.copyLabel, (ev) => {
      const btn = ev.currentTarget;
      const fallback = () => { const a = areas.find((x) => x.area.value) || areas[0]; if (a) { a.area.focus(); a.area.select(); } btn.textContent = ui('copySelected'); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text()).then(() => { btn.textContent = ui('copied'); }, fallback); else fallback(); } catch (e) { fallback(); }
    });
    const clear = link(p.clearLabel, () => { areas.forEach(({ area }) => { area.value = ''; }); store.del('essay'); refresh(); });
    refresh();
    const levels = list(p.rubricLevels);
    const view = h('div', { class: 'page' },
      pageHead(p.heading, p.intro),
      isText(p.submitLabel) && psec(h2(p.submitHeading), h('div', { class: 'actions' }, formButton(cfg.essayFormUrl, p.submitLabel, p.submitPending, 'essay-pending')), paras(p.submitPrivacy, 'soft')),
      sections.length > 0 && psec(h2(p.builderHeading), para(p.builderIntro), para(p.originalityNote, 'soft'), boxes,
        list(p.checklist).length > 0 && panel(pTint(3), '', [monoLabel(p.checklistHeading, 'p'), h('ul', { class: 'ticks' }, list(p.checklist).map((c) => h('li', { text: c })))]),
        h('div', { class: 'links' }, copy, clear)),
      list(p.rubric).length > 0 && levels.length > 0 && psec(h2(p.rubricHeading), para(p.rubricNote, 'soft'),
        panel(pTint(1), '', [h('div', { class: 'tablewrap' }, h('table', { class: 'rubric' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: p.rubricCriterionLabel || '' }), levels.map((l) => h('th', { scope: 'col', text: l })))),
          h('tbody', {}, list(p.rubric).map((r) => h('tr', {}, h('th', { scope: 'row', text: r.criterion || '' }), levels.map((_, i) => h('td', { text: list(r.levels)[i] || '–' })))))))])),
      list(p.rules).length > 0 && psec(h2(p.rulesHeading), h('ul', { class: 'ticks' }, list(p.rules).map((r) => h('li', {}, fillNodes(r)))), hasDeadline && para(p.deadlineLabel)),
      bar);
    // the running total is on screen only while the four boxes are
    if (boxes.length) {
      const place = () => {
        const r = boxes.map((b) => b.getBoundingClientRect());
        bar.classList.toggle('show', Math.min(...r.map((x) => x.top)) < window.innerHeight * 0.9 && Math.max(...r.map((x) => x.bottom)) > 0);
      };
      window.addEventListener('scroll', place, { passive: true });
      window.addEventListener('resize', place);
      pageCleanup = () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
      requestAnimationFrame(place);
    }
    return view;
  }

  function renderUcas() {
    const u = data.ucas;
    return h('div', { class: 'page' },
      pageHead(u.heading || (data.nav || {}).ucas, u.intro),
      (isText(u.weak) || isText(u.strong)) && psec(h2(u.statementHeading), para(u.statementIntro),
        h('div', { class: 'versus' },
          isText(u.weak) && panel(pTint(2), '', [monoLabel(u.weakLabel, 'p'), h('blockquote', { text: u.weak })]),
          isText(u.strong) && panel(pTint(1), '', [monoLabel(u.strongLabel, 'p'), h('blockquote', { text: u.strong })])),
        para(u.statementWarning, 'callout'),
        list(u.statementWhy).length > 0 && [monoLabel(u.statementWhyHeading, 'p'), h('ul', { class: 'ticks' }, list(u.statementWhy).map((x) => h('li', { text: x })))]),
      list(u.comp).length > 0 && psec(h2(u.compHeading), paras(u.comp),
        u.compLink && isUrl(u.compLink.url) && h('p', {}, linkOut(u.compLink.url, u.compLink.label || u.compLink.url))),
      list(u.founder).length > 0 && psec(h2(u.founderHeading),
        h('blockquote', { class: 'founder' }, paras(u.founder), isText(u.founderSign) && monoLabel(u.founderSign, 'footer'))));
  }

  function renderTeachers() {
    const t = data.teachers;
    const cfg = data.config || {};
    return h('div', { class: 'page' },
      pageHead(t.heading || (data.nav || {}).teachers, t.intro),
      list(t.value).length > 0 && psec(h2(t.valueHeading), h('ul', { class: 'ticks' }, list(t.value).map((x) => h('li', { text: x })))),
      list(t.curriculum).length > 0 && psec(h2(t.curriculumHeading),
        h('ul', { class: 'tiles', style: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))' }, list(t.curriculum).map((c, i) => h('li', { class: 'panel', style: `--tint:${pTint(i)}` },
          isUrl(c.url) ? h('p', {}, linkOut(c.url, c.spec || c.url)) : monoLabel(c.spec, 'p'), h('ul', { class: 'ticks' }, list(c.topics).map((x) => h('li', { text: x }))))))),
      isText(t.sensitivity) && psec(h2(t.sensitivityHeading), para(t.sensitivity)),
      isText(t.packLabel) && psec(h2(t.packHeading), para(t.packBody),
        h('div', { class: 'actions' }, formButton(cfg.teacherFormUrl, t.packLabel, t.packPending, 'pack-pending'),
          isUrl(cfg.teacherPackUrl) && isText(t.packDownloadLabel) && linkOut(cfg.teacherPackUrl, t.packDownloadLabel))),
      list(t.code).length > 0 && psec(h2(t.codeHeading), h('ol', { class: 'steps' }, list(t.code).map((x) => h('li', { text: x })))));
  }

  /* ---------- shell: top bar, rail, glow, footer, review mode, routing ---------- */

  const TABS = ['prize', 'ucas', 'teachers'];
  const availableTabs = () => TABS.filter((id) => data[id]);
  const parseHash = () => {
    const raw = location.hash;
    return { check: /#check$/.test(raw), key: decodeURIComponent(raw.replace(/#check$/, '').replace(/^#/, '')) };
  };
  const hashFor = (id) => '#' + id + (checkMode ? '#check' : '');
  // Move to a home section: a smooth, site-started scroll, and the address follows without adding a history entry.
  function go(id) {
    if (state.tab !== 'home') { location.hash = hashFor(id); return; }
    if (parseHash().key !== id) history.replaceState(null, '', hashFor(id));
    scrollToId(id);
  }

  function renderNav() {
    const nav = $('tabs');
    const bar = $('topbar');
    nav.setAttribute('aria-label', ui('site'));
    const first = homeSecs[0] ? homeSecs[0].id : 'question';
    const menu = h('button', { type: 'button', class: 'chip menu', 'aria-expanded': 'false', 'aria-controls': 'navlinks', text: ui('menu'), onclick: (ev) => { const open = !bar.classList.contains('open'); bar.classList.toggle('open', open); ev.currentTarget.setAttribute('aria-expanded', String(open)); ev.currentTarget.textContent = open ? ui('close') : ui('menu'); } });
    nav.replaceChildren(
      h('a', { class: 'brand', href: hashFor(first), onclick: (ev) => { if (state.tab === 'home') { ev.preventDefault(); go(first); } }, text: data.meta.title || '' }),
      h('div', { class: 'navright' },
        h('ul', { class: 'navlinks', id: 'navlinks' }, availableTabs().map((id) => h('li', {}, h('a', { href: '#' + id, 'aria-current': state.tab === id ? 'page' : null, onclick: () => { bar.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }, text: (data.nav || {})[id] || id })))),
        menu));
  }

  function renderCredits() {
    const m = data.meta;
    const f = data.footer || {};
    const line = (...kids) => { const real = kids.flat().filter(Boolean); return real.length ? h('p', {}, real) : null; };
    const lk = (text, url) => (isUrl(url) ? linkOut(url, text) : text);
    const source = [m.source, m.dataset].filter(isText).join(' — ');
    $('credits').replaceChildren(h('div', {},
      (source || isText(m.citation)) && line(isText(f.dataLabel) && f.dataLabel + ' ', source && lk(source, m.sourceUrl), source && isText(m.citation) && '. ', isText(m.citation) && lk(m.citation, m.citationUrl), '.'),
      isText(m.licence) && line(isText(f.licenceLabel) && f.licenceLabel + ' ', lk(m.licence, m.licenceUrl), '.'),
      isText(m.accessed) && line(isText(f.accessedLabel) && f.accessedLabel + ' ', fmtDate(m.accessed), '.'),
      isText(f.privacy) && line(f.privacy),
      m.PLACEHOLDER && isText(f.buildNote) && line(f.buildNote)));
  }

  /* Review mode: open any page with #check on the end of the address. Every piece of text that still says PLACEHOLDER is
     outlined and counted in the corner, with any other failure (a missing video file). Nothing links to it. */
  let checkMode = false;
  let checkObserver = null;
  function markPlaceholders() {
    document.querySelectorAll('.ph').forEach((n) => n.classList.remove('ph'));
    const found = new Set();
    for (const root of [main, $('credits')]) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) if (t.nodeValue.includes('PLACEHOLDER') && t.parentElement) found.add(t.parentElement);
    }
    found.forEach((el) => el.classList.add('ph'));
    const box = $('phcount');
    if (box) box.replaceChildren(h('span', { text: fill(ui('checkCount'), { count: found.size }) }), ...[...checkIssues].map((x) => h('span', { class: 'issue', text: x })));
  }
  function syncCheck() {
    const want = parseHash().check;
    if (want === checkMode && (!want || checkObserver)) return;
    checkMode = want;
    const old = $('phcount');
    if (checkObserver) { checkObserver.disconnect(); checkObserver = null; }
    document.querySelectorAll('.ph').forEach((n) => n.classList.remove('ph'));
    if (old) old.remove();
    if (!checkMode) return;
    document.body.append(h('div', { id: 'phcount', role: 'status' }));
    let queued = false;
    checkObserver = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; markPlaceholders(); }); });
    [main, $('credits')].forEach((r) => checkObserver.observe(r, { childList: true, subtree: true, characterData: true }));
    markPlaceholders();
  }

  /* The ambient glow: one fixed layer. Its tint and position ease towards what the current section declares, 6% a frame. */
  const glow = { cur: null, target: null, frame: 0, io: null, ratios: new Map() };
  const tintRgb = (name) => rgbOf(css('--' + name, '#F28B74'));
  function glowLoop() {
    glow.frame = 0;
    const c = glow.cur;
    const t = glow.target;
    let moving = false;
    for (let i = 0; i < 5; i += 1) { const d = t[i] - c[i]; if (Math.abs(d) > 0.2) { c[i] += d * 0.06; moving = true; } else c[i] = t[i]; }
    const el = $('ambient');
    el.style.setProperty('--gx', c[0].toFixed(2) + '%'); el.style.setProperty('--gy', c[1].toFixed(2) + '%');
    el.style.setProperty('--tr', Math.round(c[2])); el.style.setProperty('--tg', Math.round(c[3])); el.style.setProperty('--tb', Math.round(c[4]));
    if (moving) glow.frame = requestAnimationFrame(glowLoop);
  }
  function glowTo(sec) {
    const [r, g, b] = tintRgb(sec.dataset.tint || 'coral');
    glow.target = [Number(sec.dataset.glowX) || 50, Number(sec.dataset.glowY) || 0, r, g, b];
    if (!glow.cur || still()) glow.cur = glow.target.slice();
    if (!glow.frame) glow.frame = requestAnimationFrame(glowLoop);
  }

  /* The rail, the section tracker and the reveal */
  let revealIO = null;
  let trackFrame = 0;
  function sectionAtMid() {
    const mid = window.innerHeight * 0.4;
    let idx = 0; let frac = 0;
    homeSecs.forEach((d, i) => { const el = $(d.id); if (!el) return; const r = el.getBoundingClientRect(); if (r.top <= mid) { idx = i; frac = Math.min(1, Math.max(0, (mid - r.top) / (r.height || 1))); } });
    return { idx, frac };
  }
  function trackScroll() {
    if (trackFrame) return;
    trackFrame = requestAnimationFrame(() => {
      trackFrame = 0;
      if (state.tab !== 'home' || !homeSecs.length) { document.body.classList.remove('past-title'); return; }
      const titleEl = $(homeSecs[0].id);
      document.body.classList.toggle('past-title', !!titleEl && titleEl.getBoundingClientRect().bottom < 64);
      const { idx, frac } = sectionAtMid();
      const p = homeSecs.length > 1 ? Math.min(1, (idx + frac) / (homeSecs.length - 1)) : 1;
      $('rail').style.setProperty('--p', p);
      $('progress').style.setProperty('--p', p);
      const cur = homeSecs[idx];
      if (cur.id !== state.cur) {
        state.cur = cur.id;
        document.querySelectorAll('.rdot').forEach((a) => { if (a.dataset.id === cur.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        if (parseHash().key !== cur.id) history.replaceState(null, '', hashFor(cur.id));
      }
    });
  }
  function setupHome() {
    teardownHome();
    $('rail').replaceChildren(h('ol', {}, homeSecs.map((d, i) => h('li', {}, h('a', { class: 'rdot', href: hashFor(d.id), 'data-id': d.id, 'aria-label': `${pad3(i + 1)} ${d.name}`, onclick: (ev) => { ev.preventDefault(); go(d.id); } }, h('span', { class: 'rname label', 'aria-hidden': 'true', text: `${pad3(i + 1)} · ${d.name}` }))))));
    $('rail').setAttribute('aria-label', ui('sections'));
    state.cur = null;
    const secs = [...main.querySelectorAll('.sec')];
    if (secs[0]) glowTo(secs[0]);
    if (!('IntersectionObserver' in window)) { secs.forEach((x) => x.classList.add('in')); trackScroll(); return; }
    // reveal once, as each section arrives
    revealIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.id === 'pivot' && hooks.pivotBeats) hooks.pivotBeats();
      revealIO.unobserve(e.target);
    }), { threshold: 0.15 });
    secs.forEach((x) => revealIO.observe(x));
    // the glow follows whichever section fills most of the screen
    glow.ratios.clear();
    glow.io = new IntersectionObserver((entries) => {
      entries.forEach((e) => glow.ratios.set(e.target, e.intersectionRatio));
      let best = null; let bestR = 0;
      glow.ratios.forEach((r, el) => { const vis = r * el.offsetHeight; if (vis > bestR) { bestR = vis; best = el; } });
      if (best) glowTo(best);
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
    secs.forEach((x) => glow.io.observe(x));
    trackScroll();
  }
  function teardownHome() {
    if (revealIO) { revealIO.disconnect(); revealIO = null; }
    if (glow.io) { glow.io.disconnect(); glow.io = null; }
    $('rail').replaceChildren();
  }
  function setupPage() {
    teardownHome();
    const [r, g, b] = tintRgb(state.tab === 'ucas' ? 'peri' : state.tab === 'teachers' ? 'rose' : 'coral');
    glow.target = [80, 0, r, g, b];
    if (!glow.cur) glow.cur = glow.target.slice();
    if (!glow.frame) glow.frame = requestAnimationFrame(glowLoop);
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || state.tab !== 'home') return;
    const t = ev.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable], [role="radiogroup"]')) return;
    const here = homeSecs[sectionAtMid().idx];
    const own = here && api[here.id];
    if (own && own.key && own.key(ev)) ev.preventDefault();
  });
  window.addEventListener('scroll', trackScroll, { passive: true });
  window.addEventListener('resize', trackScroll);

  let pageCleanup = null;
  function show() {
    const first = state.tab === '';
    const { key } = parseHash();
    syncCheck();
    const sectionIds = homeSecs.length ? homeSecs.map((x) => x.id) : KNOWN;
    const isSection = sectionIds.includes(key);
    const tab = availableTabs().includes(key) ? key : 'home';
    const changed = tab !== state.tab;
    state.tab = tab;
    document.body.dataset.tab = tab;
    if (changed) {
      if (pageCleanup) { pageCleanup(); pageCleanup = null; }
      cancelScroll();
      main.replaceChildren(tab === 'prize' ? renderPrize() : tab === 'ucas' ? renderUcas() : tab === 'teachers' ? renderTeachers() : renderHome());
      if (tab === 'home') setupHome(); else setupPage();
    }
    renderNav();
    document.title = [tab === 'home' ? '' : (data.nav || {})[tab], data.meta.title].filter(isText).join(' — ');
    if (tab === 'home') {
      // #poll, #lab and the rest open at their section; a fresh load jumps, a link inside the site glides
      if (isSection && $(key) && key !== homeSecs[0].id) { requestAnimationFrame(() => scrollToId(key, first || changed)); return; }
      // A device that already holds a finished poll opens at the pivot instead of making the student do it twice.
      if (first && !key && state.poll.submitted && $('pivot')) { requestAnimationFrame(() => scrollToId('pivot', true)); return; }
      if (first) return;
      if (changed) window.scrollTo(0, 0);
      else if (isSection && $(key)) scrollToId(key);
      trackScroll();
      return;
    }
    window.scrollTo(0, 0);
    const h1 = main.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });
    trackScroll();
  }

  function fail(message) {
    main.replaceChildren(h('div', { class: 'page' }, h('h1', { text: LOAD_FAIL[0] }), h('p', { class: 'lead', text: message }), h('p', { text: LOAD_FAIL[1] })));
  }

  async function start() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${DATA_URL}: ${res.status}`);
      data = await res.json();
      if (!data || typeof data !== 'object') throw new Error(DATA_URL);
      data.meta = data.meta || {};
    } catch (err) {
      data = null;
      fail(err && err.message ? err.message : DATA_URL);
      return;
    }
    const saved = store.get('poll');
    if (saved && saved.answers && isNum(saved.score)) { state.poll.submitted = saved; state.poll.classCode = saved.classCode || ''; state.poll.answers = Object.assign({}, saved.answers); state.poll.phase = 'result'; }
    const skip = document.querySelector('.skip');
    if (skip) skip.textContent = ui('skip');
    homeSecs = homeSections();
    renderCredits();
    show();
    window.addEventListener('hashchange', show);
  }

  // Offline support: the site's own files are cached so it still opens with no network.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  start();
})();
