/* Unravel — all behaviour. No dependencies, no build step.
   Every word of subject content, every number, unit, colour and address is read from data/seaad-mtg.json.
   The only English in this file is page furniture (UI below); the data file's optional "ui" object overrides it.
   Each view is a plain function from (data, state) to DOM, so it ports to a component framework one function at a time.
   What is kept on the device: the poll result and the essay draft, in localStorage, and nothing else.
   What leaves the device: nothing, unless config.pollEndpoint is set, and then only the six poll answers and class code. */
(() => {
  'use strict';

  const DATA_URL = 'data/seaad-mtg.json';
  const UI = {
    site: 'Site', more: 'More', prevCard: 'Previous simulation', nextCard: 'Next simulation', newTab: '(opens in a new tab)', unitMissing: '[unit missing]',
    showAnswer: 'Show me the answer', tried: 'tried', copied: 'Copied', copySelected: 'Selected — copy it with your device',
    you: 'you', step: 'Step', modelAnswer: 'Show a model answer', nextCase: 'Next simulation',
    loadFailTitle: 'The data did not load',
    loadFailHelp: 'If you opened this page straight from a folder, serve the folder instead: run “python3 -m http.server” in it and open http://localhost:8000.',
  };
  const ui = (k) => (data && data.ui && data.ui[k]) || UI[k];

  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const api = {};         // per-section keyboard handlers, filled in as the sections are built
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let data = null;

  const state = {
    tab: '', cur: null, plain: false, overlay: true,
    caseId: null, car: 0, step: 0, view: 0, predictions: {}, strat: {}, didWork: false,
    sandbox: null, snapshotMade: false,
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
  const qv = (o, digits = 0) => (o && (isNum(o.value) || isText(o.value)) ? qty(o.value, o.unit, digits) : '');
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
  function baseVars() {
    const p = data.prize || {};
    const m = data.meta || {};
    return { prizeValue: p.value, wordsMin: p.wordsMin, wordsMax: p.wordsMax, donorTotal: qv(m.donorTotal), cellsTotal: qv(m.cellsTotal), deadline: fmtDate((data.config || {}).essayDeadline) };
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
  const heading = (level, t, vars, cls) => (isText(t) ? h('h' + level, { class: cls || null }, fillNodes(t, vars)) : null);

  /* ---------- data access ---------- */

  const label = (x) => (x ? (state.plain && isText(x.plainLabel) ? x.plainLabel : x.label) || x.id || '' : '');
  const byId = (arr, id) => list(arr).find((x) => x && x.id === id) || null;
  const metricOf = (id) => byId(data.metrics, id);
  const cellOf = (id) => byId(data.cellTypes, id);
  const groupingOf = (id) => byId(data.groupings, id);
  const seriesOf = (metric, cellType) => list(data.series).find((x) => x.metric === metric && x.cellType === cellType && Array.isArray(x.values)) || null;
  const FALLBACK = ['#c8553d', '#0e8a8a', '#b3741a', '#b8479f', '#3f9142', '#4f7cc4'];
  const colourOf = (cell) => (cell && /^#[0-9a-fA-F]{6}$/.test(cell.colour || '') ? cell.colour : FALLBACK[Math.max(0, list(data.cellTypes).indexOf(cell)) % FALLBACK.length]);
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
    return { n: v.length, median: quantile(v, 0.5), q1: quantile(v, 0.25), q3: quantile(v, 0.75) };
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
    return { q, metric, cell, grouping, conf, strata, groups, first, last, trend, dec, unit: metric.unit, max: Math.max(0, ...rows.map((r) => r.value)) };
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

  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  function mix(a, b, t) {
    const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const [A, B] = [p(a), p(b)];
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
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
  function marker(shape, x, y, r, attrs) {
    if (shape === 1) return s('rect', Object.assign({ x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8 }, attrs));
    if (shape === 2) return s('path', Object.assign({ d: `M${x} ${y - r * 1.2}L${x + r * 1.1} ${y + r * 0.8}L${x - r * 1.1} ${y + r * 0.8}Z` }, attrs));
    return s('circle', Object.assign({ cx: x, cy: y, r }, attrs));
  }

  // Draws with literal attributes (no stylesheet), so the same SVG can be exported as a picture.
  function drawChart(Q, width) {
    const lab = data.lab || {};
    const W = Math.max(280, Math.round(width));
    const narrow = W < 520;
    const H = narrow ? 320 : 400;
    const font = narrow ? 11 : 13;
    const m = { l: narrow ? 40 : 52, r: 12, t: 30, b: narrow ? 54 : 58 };
    const ink = css('--ink', '#1B2632');
    const soft = css('--ink-2', '#2C3B4D');
    const grid = css('--muted', '#C9C1B1');
    const lo = css('--ink-2', '#2C3B4D');   // low end of the data scale; the high end is --deep
    const hi = css('--deep', '#A35139');
    const axis = niceAxis(Q.max * 1.05);
    const Y = (v) => m.t + (1 - v / axis.max) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / Math.max(1, Q.groups.length);
    const family = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    const svg = s('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'font-family': family, 'font-size': font,
      'aria-label': [label(Q.metric), label(Q.cell), label(Q.grouping)].filter(Boolean).join(', ') });
    svg.append(s('rect', { width: W, height: H, fill: css('--surface', '#FFFFFF') }));
    svg.append(s('text', { x: 4, y: 14, fill: soft, 'font-weight': 600 }, `${label(Q.metric)} (${Q.unit || ui('unitMissing')})`));
    axis.ticks.forEach((t) => {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? soft : grid, 'stroke-width': t === 0 ? 1.5 : 1 }));
      svg.append(s('text', { x: m.l - 6, y: Y(t) + font * 0.35, 'text-anchor': 'end', fill: soft }, num(t, 2)));
    });
    const r = narrow ? 3.4 : 4.4;
    Q.groups.forEach((g, gi) => {
      const x0 = m.l + gi * band;
      const colour = Q.groups.length > 1 ? mix(lo, hi, gi / (Q.groups.length - 1)) : lo;
      const lanes = g.parts || [Object.assign({ stratum: null }, g)];
      const laneW = (band * 0.84) / lanes.length;
      lanes.forEach((lane, li) => {
        const cx = x0 + band * 0.08 + laneW * (li + 0.5);
        const half = Math.min(laneW * 0.36, 34);
        if (state.overlay && lane.n > 0) {
          svg.append(s('rect', { x: cx - half - 3, width: 2 * half + 6, y: Y(lane.q3), height: Math.max(1, Y(lane.q1) - Y(lane.q3)), fill: ink, 'fill-opacity': 0.07, stroke: ink, 'stroke-opacity': 0.45, 'stroke-width': 1, rx: 3 }));
        }
        lane.rows.forEach((row, i) => {
          const jitter = ((i * 0.61803398875) % 1) * 2 - 1;
          const dot = marker(li % 3, cx + jitter * half, Y(row.value), r, { fill: colour, 'fill-opacity': 0.78, stroke: '#ffffff', 'stroke-width': 0.8 });
          const tip = fill(lab.donorTitle, { donorId: row.donor.id, value: qty(row.value, Q.unit, Q.dec + 1), age: row.donor.age, sex: row.donor.sex });
          if (tip) dot.append(s('title', {}, tip));
          svg.append(dot);
        });
        if (state.overlay && lane.n > 0) svg.append(s('line', { x1: cx - half - 5, x2: cx + half + 5, y1: Y(lane.median), y2: Y(lane.median), stroke: ink, 'stroke-width': 3, 'stroke-linecap': 'round' }));
      });
      svg.append(s('text', { x: x0 + band / 2, y: H - m.b + font + 6, 'text-anchor': 'middle', fill: ink, 'font-weight': 700 }, g.name));
      svg.append(s('text', { x: x0 + band / 2, y: H - m.b + 2 * font + 10, 'text-anchor': 'middle', fill: soft }, fill(lab.nLabel, { n: g.n }) || String(g.n)));
    });
    svg.append(s('text', { x: m.l + (W - m.l - m.r) / 2, y: H - 6, 'text-anchor': 'middle', fill: soft, 'font-weight': 600 }, label(Q.grouping)));
    return svg;
  }

  function strataLegend(Q) {
    if (!Q.conf) return null;
    return h('p', { class: 'legend' }, h('b', { text: Q.conf.label + ': ' }), Q.strata.map((st, i) => {
      const svg = s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' });
      svg.append(marker(i % 3, 8, 8, 5, { fill: css('--ink-2', '#2C3B4D') }));
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
        h('td', { class: 'num', text: x.n ? `${num(x.q1, Q.dec + 1)} to ${num(x.q3, Q.dec + 1)}` : '–' }))));
    });
    return h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', text: [cols.group, label(Q.grouping)].filter(isText).join(': ') }),
        h('th', { scope: 'col', class: 'num', text: cols.n || donorUnit() || ui('unitMissing') }),
        h('th', { scope: 'col', class: 'num', text: `${cols.median || ''} (${unit})`.trim() }),
        h('th', { scope: 'col', class: 'num', text: `${cols.iqr || ''} (${unit})`.trim() }))),
      h('tbody', {}, rows)));
  }

  /* ---------- pictures out: chart PNG and the snapshot card ---------- */

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
    const img = await svgImage(drawChart(Q, 1040));
    const pad = 40;
    const Wc = 1120;
    const Hc = pad + (withStats ? 60 : 0) + 96 + img.height + (withStats ? 50 + (Q.groups.length + 1) * 30 : 0) + 110;
    const canvas = h('canvas', { width: Wc * 2, height: Hc * 2 });
    const g = canvas.getContext('2d');
    g.scale(2, 2);
    g.fillStyle = css('--bg', '#EEE9DF'); g.fillRect(0, 0, Wc, Hc);
    const ink = css('--ink', '#1B2632');
    const soft = css('--ink-2', '#2C3B4D');
    const sans = '"Plus Jakarta Sans", system-ui, Arial, sans-serif';
    let y = pad;
    if (withStats) {
      g.fillStyle = ink; g.font = `700 15px ${sans}`;
      g.fillText([data.meta.title, lab.snapshotTitle].filter(isText).join(' · ').toUpperCase(), pad, y + 12); y += 60;
    }
    g.fillStyle = ink; g.font = `600 24px ${sans}`;
    y = wrapText(g, questionText(Q), pad, y + 20, Wc - 2 * pad, 30) + 6;
    if (Q.q.filter && isText(Q.q.filter.note)) { g.fillStyle = soft; g.font = `400 15px ${sans}`; g.fillText(Q.q.filter.note, pad, y); y += 22; }
    g.drawImage(img, pad, y); y += img.height + 16;
    if (withStats) {
      const cols = lab.tableColumns || {};
      const unit = Q.unit || ui('unitMissing');
      const heads = [label(Q.grouping), cols.n || donorUnit() || '', `${cols.median || ''} (${unit})`, `${cols.iqr || ''} (${unit})`];
      const rows = Q.groups.map((gr) => [gr.name, String(gr.n), gr.n ? num(gr.median, Q.dec + 1) : '–', gr.n ? `${num(gr.q1, Q.dec + 1)} to ${num(gr.q3, Q.dec + 1)}` : '–']);
      // Each column is as wide as its widest cell plus a gap, so columns can never run into each other.
      const widths = heads.map((t, i) => { g.font = `700 14px ${sans}`; let w = g.measureText(t).width; g.font = `400 14px ${sans}`; rows.forEach((r) => { w = Math.max(w, g.measureText(r[i]).width); }); return w; });
      const gapX = Math.max(16, Math.min(40, (Wc - 2 * pad - widths.reduce((a, w) => a + w, 0)) / (heads.length - 1)));
      const xs = widths.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + widths[i - 1] + gapX : pad); return acc; }, []);
      g.font = `700 14px ${sans}`; g.fillStyle = ink;
      heads.forEach((t, i) => g.fillText(t, xs[i], y + 14));
      y += 30; g.font = `400 14px ${sans}`;
      rows.forEach((r) => { r.forEach((t, i) => g.fillText(t, xs[i], y + 14)); y += 30; });
      y += 10;
    }
    g.fillStyle = soft; g.font = `400 13px ${sans}`;
    y = wrapText(g, [lab.dotNote, sourceLine()].filter(isText).join(' '), pad, y + 16, Wc - 2 * pad, 18);
    if (data.meta.PLACEHOLDER) { g.fillStyle = css('--deep', '#A35139'); g.font = `700 13px ${sans}`; wrapText(g, data.meta.placeholderNotice || 'PLACEHOLDER', pad, y + 4, Wc - 2 * pad, 18); }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  const fileStem = (Q) => ['unravel', Q.q.metric, Q.q.cellType, Q.q.grouping].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');

  /* ---------- reusable blocks ---------- */

  const charts = new Set();
  const repaintCharts = () => charts.forEach((c) => { if (c.holder.isConnected) c.paint(); else charts.delete(c); });
  // Swap content with a view transition where the browser has one, and plainly where it does not.
  function swap(fn) {
    if (document.startViewTransition && !reducedMotion.matches) {
      const y = window.scrollY;
      try {
        const t = document.startViewTransition(fn);
        const keep = () => window.scrollTo(window.scrollX, y);
        t.ready.catch(() => {}); t.updateCallbackDone.then(keep, () => {}); t.finished.then(keep, () => {});
        return;
      } catch (e) { /* fall through to a plain swap */ }
    }
    fn();
  }
  // Repaint a panel in place: pin its height and the scroll position so the page never jumps.
  function keepScroll(box, fn) {
    const y = window.scrollY;
    box.style.minHeight = box.offsetHeight + 'px';
    fn();
    window.scrollTo(window.scrollX, y);
    requestAnimationFrame(() => { window.scrollTo(window.scrollX, y); box.style.minHeight = ''; });
  }
  const qlink = (text, onclick, attrs) => h('button', Object.assign({ type: 'button', class: 'qlink', onclick }, attrs || {}), text);
  const arrow = (ch) => h('span', { class: 'arr', 'aria-hidden': 'true', text: ch });
  const focusIn = (box, key) => { if (!key) return; const t = box.querySelector(`[data-k="${key}"]`); if (t) t.focus({ preventScroll: true }); };

  function chartBlock(Q, opts) {
    const lab = data.lab || {};
    const holder = h('div', { class: 'chart' });
    const paint = () => holder.replaceChildren(drawChart(Q, holder.clientWidth || Math.max(280, main.clientWidth - 32)));
    charts.add({ holder, paint });
    requestAnimationFrame(paint);
    if ('ResizeObserver' in window) {
      let lastW = 0;
      new ResizeObserver(() => { const w = holder.clientWidth; if (holder.isConnected && w && Math.abs(w - lastW) > 8) { lastW = w; paint(); } }).observe(holder);
    }
    const tableBox = opts && opts.table === false ? null : h('div', { class: 'tablebox', hidden: true }, statsTable(Q));
    return h('figure', { class: 'plot' },
      h('figcaption', { class: 'plot-title' }, questionText(Q)),
      Q.q.filter && para(Q.q.filter.note, 'small'),
      holder,
      strataLegend(Q),
      para(lab.dotNote, 'small soft'),
      h('div', { class: 'qlinks' },
        isText(lab.overlayLabel) && qlink(lab.overlayLabel, () => {
          state.overlay = !state.overlay;
          document.querySelectorAll('[data-k="overlay"]').forEach((b) => b.setAttribute('aria-pressed', String(state.overlay)));
          repaintCharts();
        }, { 'data-k': 'overlay', 'aria-pressed': String(state.overlay) }),
        tableBox && isText(lab.tableLabel) && qlink(lab.tableLabel, (ev) => { tableBox.hidden = !tableBox.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!tableBox.hidden)); }, { 'aria-expanded': 'false' }),
        isText(lab.exportLabel) && qlink(lab.exportLabel, async () => { try { saveBlob(await composeCard(Q, false), fileStem(Q) + '.png'); } catch (e) { /* the picture could not be made on this device */ } }, { 'data-k': 'export' })),
      tableBox);
  }

  // A passage with gaps: choose the right words. Every gap has "Show me the answer"; nothing is locked.
  function clozeBlock(key, passage, vars) {
    const parts = list(passage.parts).filter((p) => p && (p.type === 'text' || p.type === 'break' || (p.type === 'blank' && list(p.options).length >= 2)));
    const blanks = parts.filter((p) => p.type === 'blank');
    if (!state.cloze.has(key)) state.cloze.set(key, { done: new Map(), tried: new Map(), active: null, last: null });
    const st = state.cloze.get(key);
    const box = h('div', { class: 'cloze' });
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
        if (st.done.has(idOf(p))) line.append(h('span', { class: 'gap filled' + (st.done.get(idOf(p)) === 'shown' ? ' shown' : ''), text: opt(p, p.correct) }));
        else {
          const longest = Math.min(24, Math.max(...p.options.map((_, i) => opt(p, i).length)));
          line.append(h('button', { type: 'button', class: 'gap' + (idOf(p) === st.active ? ' active' : ''), style: `min-width:min(${longest * 0.6 + 2}em,100%)`, 'aria-label': `${n} / ${blanks.length}`, onclick: () => { st.active = idOf(p); st.last = null; paint('option'); } }, h('span', { class: 'gapnum', 'aria-hidden': 'true', text: String(n) })));
        }
      }
      const status = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' }, st.last && h('span', { class: st.last.good ? 'good' : '', text: st.last.text }));
      let chooser = null;
      if (active) {
        const tried = st.tried.get(idOf(active)) || new Set();
        const finish = (how) => { st.done.set(idOf(active), how); st.last = { good: true, text: ['“' + opt(active, active.correct) + '”', (active.feedback || {}).right].filter(isText).join(' ') }; paint(open.length > 1 ? 'option' : 'done'); };
        const options = active.options.map((_, i) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: i === 0 ? '0' : '-1', class: 'option' + (tried.has(i) ? ' tried' : ''),
          onclick: () => { if (i === active.correct) { finish('right'); return; } tried.add(i); st.tried.set(idOf(active), tried); st.last = { good: false, text: (active.feedback || {}).wrong || '' }; paint('option:' + i); } },
          opt(active, i), tried.has(i) && h('span', { class: 'small', text: ` — ${ui('tried')}` })));
        chooser = h('div', { class: 'chooser' },
          h('div', { class: 'options', role: 'radiogroup', 'aria-label': `${idOf(active) + 1} / ${blanks.length}`,
            onkeydown: (ev) => { const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key]; if (!move) return; ev.preventDefault(); const to = options[(options.indexOf(document.activeElement) + move + options.length) % options.length]; options.forEach((o) => o.setAttribute('tabindex', o === to ? '0' : '-1')); to.focus(); } },
            options),
          h('button', { type: 'button', class: 'linkbtn', text: ui('showAnswer'), onclick: () => finish('shown') }));
      }
      box.replaceChildren(...[text, status, chooser].filter(Boolean));
      if (!focus) return;
      const target = focus === 'done' ? status : focus.startsWith('option:') ? box.querySelectorAll('.option')[Number(focus.slice(7))] : box.querySelector('.option');
      if (!target) return;
      if (focus === 'done') target.setAttribute('tabindex', '-1');
      else box.querySelectorAll('.option').forEach((o) => o.setAttribute('tabindex', o === target ? '0' : '-1'));
      target.focus({ preventScroll: true });
    };
    paint(null);
    return box;
  }

  const linkOut = (url, text, cls) => h('a', { class: cls || 'btn', href: url, target: '_blank', rel: 'noopener' }, text, h('span', { class: 'sr', text: ' ' + ui('newTab') }), h('span', { class: 'arr', 'aria-hidden': 'true', text: '↗' }));
  // A link to a form on another site, or a switched-off button with a note while the address is not set.
  function formButton(url, text, pendingNote, id) {
    if (!isText(text)) return null;
    if (isUrl(url)) return linkOut(url, text);
    return [h('button', { type: 'button', class: 'btn', disabled: true, 'aria-describedby': isText(pendingNote) ? id : null, text }), isText(pendingNote) && h('p', { id, class: 'small', text: pendingNote })];
  }
  const scrollToId = (id) => {
    const el = $(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    const hd = el.querySelector('h1, h2');
    if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); }
  };

  /* ---------- the home page: six sections, each with one job and one way on ---------- */

  const KNOWN = ['question', 'poll', 'pivot', 'lab', 'explore', 'further'];
  const pad3 = (n) => String(n).padStart(3, '0');
  let homeSecs = [];
  let hooks = {};          // refresh functions the sections register so they can update each other

  // Sections come from data.sections, in that order. One that is missing from the data, or has nothing to show, is dropped
  // and the rest renumber themselves.
  function homeSections() {
    const hasPoll = !!(data.poll && list(data.poll.items).length);
    const hasLab = !!(data.lab && list(data.series).length && list(data.donors).length);
    const have = { question: !!data.hero, poll: hasPoll, pivot: !!data.pivot, lab: hasLab && list(data.caseStudies).length > 0, explore: hasLab, further: !!data.further };
    const wanted = Array.isArray(data.sections) ? data.sections : KNOWN.map((id) => ({ id }));
    const seen = new Set();
    return wanted.filter((s) => s && KNOWN.includes(s.id) && have[s.id] && !seen.has(s.id) && seen.add(s.id)).map((s) => Object.assign({ name: s.id }, s));
  }
  const badge = (n, name) => h('p', { class: 'badge' }, h('span', { class: 'bn', text: pad3(n) }), h('span', { 'aria-hidden': 'true', text: '·' }), h('span', { class: 'bt', text: name }));
  const sectionEl = (def, cls, kids) => h('section', { class: ['sec', cls, def.dark ? 'dark' : ''].filter(Boolean).join(' '), id: def.id, 'data-id': def.id, 'aria-label': def.name }, h('div', { class: 'wrap' }, kids.flat(Infinity).filter(Boolean)));
  const head = (n, def, title, lead) => [badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(title)), para(lead, 'lead')];
  const nextId = (def) => { const i = homeSecs.findIndex((s) => s.id === def.id); return i >= 0 && homeSecs[i + 1] ? homeSecs[i + 1].id : null; };
  const nextBtn = (def, text, cls) => isText(text) && nextId(def) ? h('button', { type: 'button', class: cls || 'btn', onclick: () => go(nextId(def)) }, text, arrow('↓')) : null;

  /* 001 · the question */
  function secQuestion(def) {
    const hero = data.hero || {};
    return sectionEl(def, 'hero', [
      h('div', { class: 'orb', 'aria-hidden': 'true' }),
      h('h1', { tabindex: '-1' }, fillNodes(hero.question)),
      para(hero.description, 'lead'),
      nextBtn(def, hero.cta),
      h('p', { class: 'hint', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'))]);
  }

  /* 002 · what you think: one statement at a time, no feedback, then the result in the same card */
  function secPoll(def, n) {
    const poll = data.poll;
    const items = list(poll.items);
    const keys = ['true', 'false', 'dk'];
    const names = poll.options || {};
    const endpoint = isUrl((data.config || {}).pollEndpoint) ? data.config.pollEndpoint : null;
    const P = state.poll;
    const box = h('div', { class: 'pollfocal' });
    let timer = 0;
    const csv = (rec) => {
      const hd = ['submitted', 'classCode', ...items.map((i) => i.id), 'score'];
      const row = [rec.at, rec.classCode, ...items.map((i) => rec.answers[i.id] || ''), rec.score];
      return [hd, row].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    };
    const answered = () => items.filter((i) => P.answers[i.id]).length;
    const firstOpen = () => items.findIndex((i) => !P.answers[i.id]);

    const paint = (focus, transition) => {
      const run = () => keepScroll(box, () => { box.replaceChildren(...view().flat(Infinity).filter(Boolean)); focusIn(box, focus); });
      if (transition) swap(run); else run();
    };
    const choose = (k) => {
      const it = items[P.index];
      P.answers[it.id] = k;
      clearTimeout(timer);
      paint('c-' + k);
      timer = setTimeout(() => {
        const open = firstOpen();
        if (P.index < items.length - 1) P.index += 1;
        else if (open >= 0) P.index = open;
        else P.phase = 'code';
        paint(P.phase === 'code' ? 'code' : 'c-true');
      }, 250);
    };
    const dots = () => h('div', { class: 'pdots', role: 'group', 'aria-label': fill(poll.ofLabel, { n: P.index + 1, total: items.length }) },
      items.map((it, i) => h('button', { type: 'button', class: 'pdot' + (P.answers[it.id] ? ' on' : '') + (P.phase === 'ask' && i === P.index ? ' cur' : ''), 'aria-label': fill(poll.ofLabel, { n: i + 1, total: items.length }),
        'aria-current': P.phase === 'ask' && i === P.index ? 'step' : null, onclick: () => { clearTimeout(timer); P.phase = 'ask'; P.index = i; paint('c-true'); } })));

    const askCard = () => {
      const it = items[P.index];
      return h('div', { class: 'card pollcard' },
        h('p', { class: 'small soft', text: fill(poll.ofLabel, { n: P.index + 1, total: items.length }) }),
        h('p', { class: 'stmt', id: 'stmt' }, `“${it.statement}”`),
        h('div', { class: 'choices', role: 'group', 'aria-labelledby': 'stmt' }, keys.map((k, i) => h('button', { type: 'button', class: 'choice', 'aria-pressed': P.answers[it.id] === k ? 'true' : 'false', 'data-k': 'c-' + k, onclick: () => choose(k) },
          h('span', { class: 'ck', 'aria-hidden': 'true', text: String(i + 1) }), names[k] || k))),
        h('div', { class: 'pollnav' }, P.index > 0 && isText(poll.backLabel) ? qlink(poll.backLabel, () => { clearTimeout(timer); P.index -= 1; paint('c-true'); }) : h('span')));
    };
    const codeCard = () => h('form', { class: 'card pollcard', novalidate: true, onsubmit: (ev) => {
      ev.preventDefault();
      const score = items.filter((i) => P.answers[i.id] === i.correct).length;
      P.submitted = { at: new Date().toISOString(), classCode: P.classCode.trim().slice(0, 24), answers: Object.assign({}, P.answers), score };
      P.phase = 'result';
      store.set('poll', P.submitted);
      if (endpoint) { try { fetch(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(P.submitted) }).catch(() => {}); } catch (e) { /* offline: the result is still shown */ } }
      paint('result', true);
      if (hooks.pivot) hooks.pivot();
    } },
      isText(poll.classCodeLabel) && h('div', { class: 'codecard' },
        h('label', { for: 'classcode', text: poll.classCodeLabel }),
        h('input', { id: 'classcode', 'data-k': 'code', type: 'text', maxlength: '24', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: P.classCode, 'aria-describedby': isText(poll.classCodeHint) ? 'classcode-hint' : null, oninput: (ev) => { P.classCode = ev.target.value; } }),
        isText(poll.classCodeHint) && h('p', { id: 'classcode-hint', class: 'small soft', text: poll.classCodeHint })),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn', text: poll.submitLabel || '' })),
      para(endpoint ? poll.privacyShared : poll.privacyLocal, 'small soft'),
      h('div', { class: 'pollnav' }, isText(poll.backLabel) ? qlink(poll.backLabel, () => { P.phase = 'ask'; P.index = items.length - 1; paint('c-true'); }) : h('span')));

    const resultCard = () => {
      const done = P.submitted;
      const mean = items.reduce((a, i) => a + ((i.benchmark || {})[i.correct] || 0), 0) / items.length;
      const wrongForMost = items.filter((i) => isNum((i.benchmark || {})[i.correct]) && i.benchmark[i.correct] < 50).length;
      return h('div', { class: 'card pollcard result' },
        h('h3', { class: 'score', tabindex: '-1', 'data-k': 'result' }, fillNodes(poll.resultHeading, { score: done.score, total: items.length })),
        para(poll.resultCompare, 'soft', { benchmarkMean: qty(mean, '%', 0) }),
        wrongForMost > 0 && para(poll.resultGap, 'gap-line', { count: wrongForMost }),
        h('ol', { class: 'rows' }, items.map((item) => {
          const b = item.benchmark || {};
          const mine = done.answers[item.id];
          const right = mine === item.correct;
          const total = keys.reduce((a, k) => a + (isNum(b[k]) ? b[k] : 0), 0) || 1;
          return h('li', {},
            h('div', { class: 'rowtop' }, h('p', { class: 'statement' }, `“${item.statement}”`), h('span', { class: 'verdict ' + (right ? 'right' : 'wrong'), text: (right ? poll.rightLabel : poll.wrongLabel) || '' })),
            h('div', { class: 'bar', role: 'img', 'aria-label': [poll.benchmarkLabel, keys.map((k) => `${names[k] || k} ${qty(b[k], '%', 1)}`).join(', '), isText(poll.yourAnswer) && `${poll.yourAnswer}: ${names[mine] || mine}`].filter(isText).join('. ') },
              keys.map((k) => (isNum(b[k]) ? h('span', { class: 'seg' + (k === item.correct ? ' correct' : ''), style: `width:${(b[k] / total) * 100}%` }, mine === k && h('span', { class: 'you' })) : null))),
            h('p', { class: 'small barkey' }, isText(poll.benchmarkLabel) && h('b', { text: poll.benchmarkLabel + ': ' }),
              keys.map((k, i) => h('span', { class: k === item.correct ? 'good' : null }, `${names[k] || k} ${qty(b[k], '%', 1)}`, mine === k && h('span', { text: ` (${ui('you')})` }), i < keys.length - 1 ? ' · ' : ''))));
        })),
        (isText(poll.benchmarkSource) || isUrl(poll.benchmarkSourceUrl)) && h('p', { class: 'small soft' }, poll.benchmarkSource || '', ' ', isUrl(poll.benchmarkSourceUrl) && linkOut(poll.benchmarkSourceUrl, poll.benchmarkSourceUrl.replace(/^https:\/\/([^/]+).*$/, '$1'), 'inline')),
        h('div', { class: 'qlinks' },
          isText(poll.exportLabel) && qlink(poll.exportLabel, () => saveBlob(new Blob([csv(done)], { type: 'text/csv' }), 'unravel-poll.csv')),
          isText(poll.retakeLabel) && qlink(poll.retakeLabel, () => { P.submitted = null; P.answers = {}; P.index = 0; P.phase = 'ask'; paint('c-true', true); if (hooks.pivot) hooks.pivot(); }),
          isText(poll.clearLabel) && qlink(poll.clearLabel, () => { store.del('poll'); P.submitted = null; P.answers = {}; P.classCode = ''; P.index = 0; P.phase = 'ask'; paint('c-true', true); if (hooks.pivot) hooks.pivot(); })));
    };
    function view() {
      if (P.phase === 'result' && P.submitted) return [resultCard(), h('div', { class: 'actions' }, nextBtn(def, poll.resultCta))];
      if (P.phase === 'code' && answered() === items.length) return [dots(), codeCard()];
      P.phase = 'ask';
      return [dots(), askCard()];
    }
    paint(null);
    api.poll = {
      key(ev) {
        if (P.phase !== 'ask') return false;
        const k = { 1: 'true', 2: 'false', 3: 'dk' }[ev.key];
        if (k) { choose(k); return true; }
        if (ev.key === 'ArrowLeft' && P.index > 0) { clearTimeout(timer); P.index -= 1; paint('c-true'); return true; }
        return false;
      },
    };
    return sectionEl(def, 'poll', [head(n, def, poll.heading, poll.framing), box]);
  }

  /* 003 · the pivot: the poll's hinge statement, the distinction, and three nested rings */
  function secPivot(def, n) {
    const pv = data.pivot;
    const poll = data.poll || {};
    const names = poll.options || {};
    const item = byId(poll.items, poll.pivotItemId);
    const rings = pv.rings || {};
    const verdict = h('p', { class: 'pverdict' });
    const yours = h('p', { class: 'small soft' });
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
    // The picture: it is the whole argument in one image. Labels come from the data.
    const svg = s('svg', { viewBox: '0 0 400 400', role: 'img', 'aria-label': [rings.outer, rings.inner, rings.core].filter(isText).join(' › ') });
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const g1 = s('g', { class: 'g1' }); g1.append(s('circle', { class: 'r', cx: 200, cy: 200, r: 190 }), s('text', { x: 200, y: 50 }, rings.outer || ''));
    const g2 = s('g', { class: 'g2' }); g2.append(s('circle', { class: 'r r2', cx: 200, cy: 236, r: 128 }), s('text', { x: 200, y: 140 }, rings.inner || ''));
    const g3 = s('g', { class: 'g3' }); g3.append(s('circle', { class: 'r r3', cx: 200, cy: 300, r: 58 }), s('text', { x: 200, y: 232 }, rings.core || ''));
    for (let i = 0; i < 46; i += 1) { const r = 48 * Math.sqrt(rnd()); const a = rnd() * Math.PI * 2; g3.append(s('circle', { class: 'cell', cx: 200 + r * Math.cos(a), cy: 300 + r * Math.sin(a), r: 2.6 })); }
    svg.append(g1, g2, g3);
    const ringsEl = h('div', { class: 'rings', 'data-beat': reducedMotion.matches ? '3' : '0' }, svg);
    const beat = (i, ...kids) => h('div', { class: 'beat rv', 'data-beat': String(i) }, kids);
    const beats = [
      beat(1, item && h('blockquote', { class: 'pq' }, `“${item.statement}”`), item && verdict, item && yours),
      beat(2, paras(pv.body, 'pbody')),
      beat(3, para(pv.handoff, 'pbody'), h('div', { class: 'actions' }, nextBtn(def, pv.cta)))];
    api.beats = (i) => { const cur = Number(ringsEl.dataset.beat) || 0; if (i > cur) ringsEl.dataset.beat = String(i); };
    const dec = list(pv.decoders);
    return sectionEl(def, 'pivot', [
      badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(pv.heading)),
      h('div', { class: 'pivotgrid' }, h('div', { class: 'beats' }, beats), ringsEl),
      dec.length > 0 && h('div', { class: 'decoders' }, heading(3, pv.decodersHeading), h('ul', { class: 'bento' }, dec.map((d) => h('li', { class: 'card' }, heading(4, d.title), para(d.body, 'small')))))]);
  }

  /* 004 · the lab: a carousel of five simulations, then the four steps of one */
  const currentCase = () => byId(data.caseStudies, state.caseId);
  function secLab(def, n) {
    const lab = data.lab;
    const cases = list(data.caseStudies);
    const box = h('div', { class: 'labfocal' });
    const titleOf = (c) => (state.plain && isText(c.plainTitle) ? c.plainTitle : c.title) || c.id;
    const caseIndex = (c) => Math.max(0, cases.indexOf(c));

    const paint = (focus, transition) => {
      const run = () => keepScroll(box, () => {
        box.replaceChildren(currentCase() ? stepView() : carousel());
        focusIn(box, focus);
        if (!currentCase() && box._place) requestAnimationFrame(() => box._place(false));
      });
      if (transition) swap(run); else run();
    };
    hooks.lab = paint;

    function carousel() {
      const view = h('div', { class: 'carview' });
      const track = h('div', { class: 'track' });
      const ink = css('--ink', '#1B2632');
      const slides = cases.map((c, i) => {
        const v = list(c.views)[0] || {};
        const Q = buildQuestion({ metric: v.metric, cellType: v.cellType, grouping: c.grouping, filter: c.filter || null });
        const colour = colourOf(cellOf(v.cellType));
        const cf = lab.cardFigures || {};
        const figs = Q ? [
          [cf.donors, num(Q.groups.reduce((a, g) => a + g.n, 0), 0), donorUnit() || ui('unitMissing')],
          [cf.groups, num(Q.groups.filter((g) => g.n > 0).length, 0), cf.groupsUnit || ui('unitMissing')],
          [cf.measure, label(Q.metric), Q.unit || ui('unitMissing')]] : [];
        return h('article', { class: 'slide', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} / ${cases.length}`, onclick: () => { if (i !== state.car) goTo(i); } },
          h('div', { class: 'card cslide' },
            h('div', { class: 'tile', style: `background:linear-gradient(150deg, ${colour}, ${mix(colour, ink, 0.6)})`, 'aria-hidden': 'true' }, h('span', { class: 'tn', text: String(i + 1) })),
            h('div', { class: 'cbody' },
              h('p', { class: 'kicker', text: label(cellOf(v.cellType)) }),
              h('h3', {}, h('button', { type: 'button', class: 'cardtitle', 'data-k': 'case-' + c.id, onclick: () => open(c) }, titleOf(c))),
              para(c.brief, 'brief'),
              isText(lab.openLabel) && qlink(lab.openLabel, () => open(c)),
              figs.length > 0 && h('ul', { class: 'figs' }, figs.map(([cap, val, unit]) => h('li', {}, h('span', { class: 'fv', text: val }), h('span', { class: 'fu', text: unit }), isText(cap) && cap.toLowerCase() !== String(unit).toLowerCase() && h('span', { class: 'fl', text: cap })))))));
      });
      track.append(...slides);
      view.append(track);
      const prev = h('button', { type: 'button', class: 'arrow prev', 'aria-label': ui('prevCard'), onclick: () => goTo(state.car - 1), text: '←' });
      const next = h('button', { type: 'button', class: 'arrow next', 'aria-label': ui('nextCard'), onclick: () => goTo(state.car + 1), text: '→' });
      const dots = h('div', { class: 'cdots' }, cases.map((c, i) => h('button', { type: 'button', class: 'cdot', 'aria-label': `${i + 1}: ${titleOf(c)}`, onclick: () => goTo(i) })));
      const wrap = h('div', { class: 'carwrap', role: 'region', 'aria-roledescription': 'carousel', 'aria-label': lab.heading || '' }, view, prev, next, dots);
      function place(animate) {
        const vw = view.clientWidth;
        if (!vw) return;
        state.car = Math.min(Math.max(0, state.car), cases.length - 1);
        const sw = vw * (vw < 640 ? 0.86 : 0.78);
        track.classList.toggle('anim', !!animate && !reducedMotion.matches);
        track.style.transform = `translateX(${(vw - sw) / 2 - state.car * sw}px)`;
        slides.forEach((el, i) => { el.classList.toggle('cur', i === state.car); const inner = el.firstChild; if ('inert' in inner) inner.inert = i !== state.car; });
        [...dots.children].forEach((d, i) => { if (i === state.car) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
        prev.disabled = state.car === 0;
        next.disabled = state.car === cases.length - 1;
      }
      function goTo(i, focusCard) {
        if (i < 0 || i > cases.length - 1) return;
        state.car = i;
        place(true);
        if (focusCard) { const t = slides[i].querySelector('.cardtitle'); if (t) t.focus({ preventScroll: true }); }
      }
      // swipe, and the arrow keys while focus is inside or the lab is the section on screen
      let x0 = null;
      view.addEventListener('pointerdown', (ev) => { x0 = ev.clientX; });
      view.addEventListener('pointerup', (ev) => { if (x0 !== null && Math.abs(ev.clientX - x0) > 50) goTo(state.car + (ev.clientX < x0 ? 1 : -1)); x0 = null; });
      view.addEventListener('pointercancel', () => { x0 = null; });
      if ('ResizeObserver' in window) new ResizeObserver(() => { if (view.isConnected) place(false); }).observe(view);
      box._place = place;
      api.lab = { key(ev) { if (!view.isConnected) return false; const d = { ArrowLeft: -1, ArrowRight: 1 }[ev.key]; if (!d) return false; goTo(state.car + d, true); return true; } };
      return wrap;
    }
    function open(c) { state.caseId = c.id; state.car = caseIndex(c); state.step = 0; state.view = 0; api.lab = null; paint('next', true); }

    function stepView() {
      const cs = currentCase();
      const labels = list(lab.stepLabels);
      const repaint = (key) => paint(key, false);
      const views = list(cs.views);
      state.view = Math.min(state.view, Math.max(0, views.length - 1));
      const view = views[state.view] || {};
      const base = { metric: view.metric, cellType: view.cellType, grouping: cs.grouping, filter: cs.filter || null };
      const first = buildQuestion({ metric: (views[0] || {}).metric, cellType: (views[0] || {}).cellType, grouping: cs.grouping, filter: cs.filter || null });
      const predicted = state.predictions[cs.id];
      const predictOptions = list((cs.predict || {}).options);
      const predLabel = (id) => (predictOptions.find((o) => o.id === id) || {}).label || '';
      const viewTabs = views.length > 1 ? h('div', { class: 'chips' }, views.map((v, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': i === state.view ? 'true' : 'false', 'data-k': 'view-' + i, onclick: () => { state.view = i; repaint('view-' + i); } }, [label(metricOf(v.metric)), label(cellOf(v.cellType))].filter(Boolean).join(' · ')))) : null;
      const nextPill = (text, onclick) => isText(text) && h('button', { type: 'button', class: 'btn', 'data-k': 'next', onclick }, text, arrow('→'));
      const back = state.step > 0 && isText(lab.backLabel) ? qlink(lab.backLabel, () => { state.step -= 1; repaint('next'); }) : h('span');
      const nav = () => h('div', { class: 'stepnav' }, back, h('div', { class: 'right' }, state.step < 3 && nextPill(lab.nextLabel, () => { state.step += 1; repaint('next'); })));

      let body;
      if (state.step === 0) {
        body = [para(cs.brief), cs.filter && para(cs.filter.note, 'small soft'),
          predictOptions.length > 0 && h('fieldset', { class: 'predict' }, h('legend', { text: (cs.predict || {}).question || '' }),
            h('div', { class: 'options' }, predictOptions.map((o) => h('button', { type: 'button', class: 'option', 'aria-pressed': predicted === o.id ? 'true' : 'false', 'data-k': 'pred-' + o.id, onclick: () => { state.predictions[cs.id] = o.id; repaint('next'); } }, o.label)))),
          predicted && para(lab.predictSaved, 'good', { prediction: predLabel(predicted) }),
          h('div', { class: 'stepnav' }, h('span'), h('div', { class: 'right' }, predicted ? nextPill(lab.nextLabel, () => { state.step = 1; repaint('next'); }) : qlink(lab.predictSkip || lab.nextLabel || '→', () => { state.step = 1; repaint('next'); }, { 'data-k': 'next' })))];
      } else if (state.step === 1) {
        const Q = buildQuestion(base);
        const vars = Object.assign(questionVars(first), { prediction: predLabel(predicted) });
        body = [viewTabs, Q && chartBlock(Q),
          first && para(!predicted ? lab.observeNoPrediction : predicted === first.trend ? lab.observeMatch : lab.observeMiss, 'callout', vars),
          Q && para(lab.observeStats, 'soft', questionVars(Q)), nav()];
      } else if (state.step === 2) {
        const chosen = state.strat[cs.id] || null;
        const Q = buildQuestion(Object.assign({}, base, { confounder: chosen }));
        const confs = list(cs.confounders).map((id) => byId(data.confounders, id)).filter(Boolean);
        const conf = chosen ? byId(data.confounders, chosen) : null;
        const counts = Q && conf ? h('div', { class: 'stack' }, heading(4, lab.stressCountsHeading),
          h('div', { class: 'tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: `${conf.label} (${donorUnit() || ui('unitMissing')})` }), Q.groups.map((g) => h('th', { scope: 'col', class: 'num', text: g.name })))),
            h('tbody', {}, Q.strata.map((st, si) => h('tr', {}, h('th', { scope: 'row', text: st }), Q.groups.map((g) => h('td', { class: 'num', text: String(g.parts[si].n) }))))))),
          para(lab.stressCountsNote, 'small soft')) : null;
        body = [para(lab.stressIntro),
          confs.length > 0 && h('div', { class: 'chips', role: 'group', 'aria-label': labels[2] || null }, [null, ...confs].map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': (c ? c.id : null) === chosen ? 'true' : 'false', 'data-k': 'strat-' + (c ? c.id : 'none'), onclick: () => { state.strat[cs.id] = c ? c.id : null; repaint('strat-' + (c ? c.id : 'none')); } }, c ? c.label : lab.stressNone || '–'))),
          viewTabs, Q && chartBlock(Q), counts, nav()];
      } else {
        state.didWork = true;
        if (hooks.further) hooks.further();
        const tk = cs.takeaway || {};
        const nextCs = cases[(cases.indexOf(cs) + 1) % cases.length];
        body = [first && list(tk.parts).length > 0 && clozeBlock('case:' + cs.id, tk, questionVars(first)),
          (isText(tk.claim) || isText(tk.limitation)) && h('details', { class: 'drawer slim' }, h('summary', { text: ui('modelAnswer') }),
            h('dl', { class: 'model' }, isText(tk.claim) && h('div', {}, h('dt', { text: lab.takeawayClaimLabel || '' }), h('dd', { text: tk.claim })), isText(tk.limitation) && h('div', {}, h('dt', { text: lab.takeawayLimitLabel || '' }), h('dd', { text: tk.limitation })))),
          h('div', { class: 'stepnav' }, back, h('div', { class: 'right' },
            nextCs && nextCs !== cs && qlink(ui('nextCase'), () => { state.caseId = nextCs.id; state.car = caseIndex(nextCs); state.step = 0; state.view = 0; repaint('next'); }),
            hooks.explore && isText(lab.toExplore) && h('button', { type: 'button', class: 'btn', 'data-k': 'next', onclick: () => go('explore') }, lab.toExplore, arrow('↓'))))];
      }
      return h('div', { class: 'card stepcard' },
        h('div', { class: 'steptop' }, isText(lab.allLabel) ? qlink(lab.allLabel, () => { state.caseId = null; state.car = caseIndex(cs); api.lab = null; paint('case-' + cs.id, true); }, { 'data-k': 'all' }) : h('span'), h('span', { class: 'simname', text: titleOf(cs) })),
        h('div', { class: 'prog', role: 'group', 'aria-label': labels.join(', ') }, [0, 1, 2, 3].map((i) => h('button', { type: 'button', class: 'seg-b' + (i <= state.step ? ' on' : ''), 'aria-label': `${ui('step')} ${i + 1}: ${labels[i] || ''}`, 'aria-current': i === state.step ? 'step' : null, 'data-k': 'step-' + i, onclick: () => { state.step = i; repaint('step-' + i); } }))),
        h('div', { class: 'stephead' }, h('p', { class: 'kicker', text: fill(lab.stepOfLabel, { n: state.step + 1, total: 4 }) }), h('h3', { class: 'stepname', text: labels[state.step] || '' })),
        h('div', { class: 'stack stepbody' }, body));
    }
    paint(null);
    return sectionEl(def, 'lab', [head(n, def, lab.heading, lab.intro), box]);
  }

  /* 005 · solo explore */
  function secExplore(def, n) {
    const lab = data.lab;
    const ex = data.explore || {};
    const box = h('div', { class: 'explorefocal' });
    const paint = (focus) => keepScroll(box, () => { box.replaceChildren(...view().flat(Infinity).filter(Boolean)); focusIn(box, focus); });
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
      return [
        pads.length > 0 && h('ul', { class: 'pads' }, pads.map((p) => h('li', {}, h('button', { type: 'button', class: 'card pad', 'aria-pressed': p.metric === sb.metric && p.cellType === sb.cellType && p.grouping === sb.grouping ? 'true' : 'false', 'data-k': 'pad-' + p.id,
          onclick: () => { state.sandbox = { metric: p.metric, cellType: p.cellType, grouping: p.grouping }; state.snapshotMade = false; paint('pad-' + p.id); } },
          h('span', { class: 'padtitle', text: p.title || '' }), isText(p.blurb) && h('span', { class: 'small soft', text: p.blurb }),
          h('span', { class: 'padq', text: [label(metricOf(p.metric)), label(groupingOf(p.grouping)), label(cellOf(p.cellType))].filter(Boolean).join(' · ') }))))),
        h('p', { class: 'builder' }, b.lead || '', ' ',
          select('metric', metricsWithData, sb.metric, (v) => { sb.metric = v; }, b.lead), ' ', b.mid1 || '', ' ',
          select('grouping', list(data.groupings), sb.grouping, (v) => { sb.grouping = v; }, b.mid1), ' ', b.mid2 || '', ' ',
          select('cellType', cellsFor(sb.metric), sb.cellType, (v) => { sb.cellType = v; }, b.mid2), b.end || ''),
        Q && chartBlock(Q, { table: false }),
        Q && h('details', { class: 'drawer' }, h('summary', { text: lab.statsHeading || '' }), statsTable(Q)),
        Q && isText(lab.snapshotLabel) && h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', 'data-k': 'snapshot', onclick: async () => { try { saveBlob(await composeCard(Q, true), fileStem(Q) + '-snapshot.png'); } catch (e) { /* the picture could not be made on this device */ } state.snapshotMade = true; state.didWork = true; if (hooks.further) hooks.further(); paint('snapshot'); } }, lab.snapshotLabel)),
        state.snapshotMade && h('div', { class: 'bridge', role: 'status' }, para(lab.snapshotDone, 'small'),
          data.prize && isText(lab.snapshotBridge) && h('a', { href: '#prize' }, fillNodes(lab.snapshotBridge), arrow('→')))];
    }
    paint(null);
    return sectionEl(def, 'explore', [head(n, def, ex.heading || lab.heading, ex.intro), box]);
  }

  /* 006 · take it further: the prize, then two quiet doors */
  function secFurther(def, n) {
    const f = data.further;
    const prize = f.prize || {};
    const body = h('p', {});
    const refresh = () => body.replaceChildren(...fillNodes(state.didWork && isText(prize.bodyAfterWork) ? prize.bodyAfterWork : prize.body));
    hooks.further = refresh;
    refresh();
    const doors = list(f.doors).filter((d) => d && data[d.page] && TABS.includes(d.page));
    return sectionEl(def, 'further', [
      badge(n, def.name), h('h2', { class: 'sech' }, fillNodes(f.heading)),
      data.prize && h('div', { class: 'prizewash' }, h('aside', { class: 'prizecard' },
        isText(prize.badge) && h('p', { class: 'badge', text: fill(prize.badge) }),
        heading(3, prize.heading), body,
        isText(prize.cta) && h('a', { class: 'btn', href: '#prize' }, prize.cta, arrow('→')))),
      doors.length > 0 && h('div', { class: 'doors' }, doors.map((d) => h('a', { class: 'card door', href: '#' + d.page }, h('b', { text: (data.nav || {})[d.page] || d.page }), isText(d.line) && h('span', { text: d.line }))))]);
  }

  function renderHome() {
    hooks = {};
    homeSecs = homeSections();
    const build = { question: secQuestion, poll: secPoll, pivot: secPivot, lab: secLab, explore: secExplore, further: secFurther };
    const view = h('div', { class: 'view home' }, homeSecs.map((d, i) => build[d.id](d, i + 1)));
    return view;
  }

  /* ---------- the essay prize, UCAS and teachers pages: numbered sections in one narrow column ---------- */

  const countWords = (t) => (String(t).trim().match(/\S+/g) || []).length;
  function pageSections(navKey) {
    let k = 0;
    const name = (data.nav || {})[navKey] || navKey;
    return { add: (cls, ...kids) => { k += 1; return h('section', { class: 'psec rv' + (cls ? ' ' + cls : '') }, badge(k, name), kids.flat(Infinity).filter(Boolean)); } };
  }
  const pageHead = (title, intro) => h('header', { class: 'psec' }, h('h1', { tabindex: '-1' }, fillNodes(title)), para(intro, 'lead'));

  function renderPrize() {
    const p = data.prize;
    const cfg = data.config || {};
    const draft = store.get('essay') || {};
    const sections = list(p.sections);
    const { add } = pageSections('prize');
    const areas = [];
    let timer = 0;
    const totalText = h('span', { class: 'tt' });
    const fillBar = h('span', { class: 'fill' });
    const scale = (p.wordsMax || 500) * 1.2;
    const bar = h('div', { class: 'totalbar', role: 'status' }, h('div', {}, totalText, h('div', { class: 'track2' }, h('span', { class: 'range', style: `left:${(p.wordsMin / scale) * 100}%;width:${((p.wordsMax - p.wordsMin) / scale) * 100}%` }), fillBar)));
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
    const submitSec = isText(p.submitLabel) && add('', heading(2, p.submitHeading), h('div', { class: 'card' }, h('div', { class: 'actions' }, formButton(cfg.essayFormUrl, p.submitLabel, p.submitPending, 'essay-pending')), paras(p.submitPrivacy, 'small soft')));
    const introSec = sections.length > 0 && add('', heading(2, p.builderHeading), para(p.builderIntro), para(p.originalityNote, 'small soft'));
    const boxes = sections.map((sec, i) => {
      const area = h('textarea', { id: 'essay-' + sec.id, rows: String(Math.max(4, Math.round((sec.target || 100) / 22))), 'aria-describedby': `essay-${sec.id}-hint essay-${sec.id}-count`, oninput: () => { refresh(); save(); } });
      area.value = draft[sec.id] || '';
      const counter = h('p', { class: 'count', id: `essay-${sec.id}-count` });
      areas.push({ sec, area, counter });
      const card = h('div', { class: 'card field' },
        h('label', { for: 'essay-' + sec.id, text: sec.label || sec.id }),
        h('p', { class: 'small soft', id: `essay-${sec.id}-hint`, text: sec.prompt || '' }), area, counter);
      const last = i === sections.length - 1 && list(p.checklist).length;
      return add('', last ? h('div', { class: 'withaside' }, card, h('aside', { class: 'card' }, heading(4, p.checklistHeading), h('ul', { class: 'ticks' }, list(p.checklist).map((c) => h('li', { text: c }))))) : card);
    });
    const text = () => areas.map(({ sec, area }) => `${sec.label || sec.id}\n${area.value.trim()}`).join('\n\n');
    const copy = isText(p.copyLabel) && qlink(p.copyLabel, (ev) => {
      const btn = ev.currentTarget;
      const fallback = () => { const a = areas.find((x) => x.area.value) || areas[0]; if (a) { a.area.focus(); a.area.select(); } btn.textContent = ui('copySelected'); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text()).then(() => { btn.textContent = ui('copied'); }, fallback); else fallback(); } catch (e) { fallback(); }
    });
    const clear = isText(p.clearLabel) && qlink(p.clearLabel, () => { areas.forEach(({ area }) => { area.value = ''; }); store.del('essay'); refresh(); });
    refresh();
    const levels = list(p.rubricLevels);
    const builderWrap = h('div', { class: 'builderwrap', style: 'display:contents' }, boxes, h('div', { class: 'qlinks' }, copy, clear));
    const view = h('div', { class: 'pagecol' },
      pageHead(p.heading, p.intro),
      submitSec,
      introSec,
      builderWrap,
      list(p.rubric).length > 0 && levels.length > 0 && add('', heading(2, p.rubricHeading), para(p.rubricNote, 'small soft'),
        h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('table', { class: 'rubric' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: p.rubricCriterionLabel || '' }), levels.map((l) => h('th', { scope: 'col', text: l })))),
          h('tbody', {}, list(p.rubric).map((r) => h('tr', {}, h('th', { scope: 'row', text: r.criterion || '' }), levels.map((_, i) => h('td', { text: list(r.levels)[i] || '–' })))))))) ),
      list(p.rules).length > 0 && add('', heading(2, p.rulesHeading), h('div', { class: 'card rulescard' }, h('ul', { class: 'ticks' }, list(p.rules).map((r) => h('li', {}, fillNodes(r)))), hasDeadline && para(p.deadlineLabel, 'small'))),
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
    const { add } = pageSections('ucas');
    return h('div', { class: 'pagecol' },
      pageHead(u.heading || (data.nav || {}).ucas, u.intro),
      (isText(u.weak) || isText(u.strong)) && add('', heading(2, u.statementHeading), para(u.statementIntro),
        h('div', { class: 'versus' },
          isText(u.weak) && h('figure', { class: 'weak' }, isText(u.weakLabel) && h('figcaption', { text: u.weakLabel }), h('blockquote', { text: u.weak })),
          isText(u.strong) && h('figure', { class: 'strong' }, isText(u.strongLabel) && h('figcaption', { text: u.strongLabel }), h('blockquote', { text: u.strong }))),
        para(u.statementWarning, 'callout'),
        list(u.statementWhy).length > 0 && h('div', { class: 'left' }, heading(3, u.statementWhyHeading), h('ul', { class: 'ticks' }, list(u.statementWhy).map((x) => h('li', { text: x }))))),
      list(u.comp).length > 0 && add('', heading(2, u.compHeading), h('div', { class: 'left' }, paras(u.comp)),
        u.compLink && isUrl(u.compLink.url) && h('p', {}, linkOut(u.compLink.url, u.compLink.label || u.compLink.url, 'inline'))),
      list(u.founder).length > 0 && add('', heading(2, u.founderHeading),
        h('blockquote', { class: 'founder' }, paras(u.founder), isText(u.founderSign) && h('footer', { class: 'small', text: u.founderSign }))));
  }

  function renderTeachers() {
    const t = data.teachers;
    const cfg = data.config || {};
    const { add } = pageSections('teachers');
    return h('div', { class: 'pagecol' },
      pageHead(t.heading || (data.nav || {}).teachers, t.intro),
      list(t.value).length > 0 && add('', heading(2, t.valueHeading), h('ul', { class: 'ticks' }, list(t.value).map((x) => h('li', { text: x })))),
      list(t.curriculum).length > 0 && add('', heading(2, t.curriculumHeading),
        h('ul', { class: 'bento two' }, list(t.curriculum).map((c) => h('li', { class: 'card' },
          h('h3', {}, isUrl(c.url) ? linkOut(c.url, c.spec || c.url, 'inline') : c.spec || ''), h('ul', { class: 'ticks' }, list(c.topics).map((x) => h('li', { text: x }))))))),
      isText(t.sensitivity) && add('', heading(2, t.sensitivityHeading), para(t.sensitivity)),
      isText(t.packLabel) && add('', heading(2, t.packHeading), para(t.packBody),
        h('div', { class: 'actions' }, formButton(cfg.teacherFormUrl, t.packLabel, t.packPending, 'pack-pending'),
          isUrl(cfg.teacherPackUrl) && isText(t.packDownloadLabel) && linkOut(cfg.teacherPackUrl, t.packDownloadLabel, 'qlink'))),
      list(t.code).length > 0 && add('', heading(2, t.codeHeading), h('ol', { class: 'steps left' }, list(t.code).map((x) => h('li', { text: x })))));
  }

  /* ---------- shell: top bar, rail and thread, footer, review mode, routing ---------- */

  const TABS = ['prize', 'ucas', 'teachers'];
  const availableTabs = () => TABS.filter((id) => data[id]);
  const parseHash = () => {
    const raw = location.hash;
    return { check: /#check$/.test(raw), key: decodeURIComponent(raw.replace(/#check$/, '').replace(/^#/, '')) };
  };
  const hashFor = (id) => '#' + id + (checkMode ? '#check' : '');
  // Move to a section: the address changes (so the back button works) and the page scrolls there.
  function go(id) {
    if (parseHash().key === id) scrollToId(id); else location.hash = hashFor(id);
  }
  function toStart(ev) {
    ev.preventDefault();
    const first = homeSecs[0] ? homeSecs[0].id : '';
    if (state.tab === 'home') { window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' }); if (first && parseHash().key !== first) history.replaceState(null, '', hashFor(first)); return; }
    location.hash = hashFor(first || 'question');
  }

  let switchEl = null;
  function renderNav() {
    const nav = $('tabs');
    const bar = $('topbar');
    nav.setAttribute('aria-label', ui('site'));
    const lab = data.lab || {};
    switchEl = isText(lab.translatorLabel) ? h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': state.plain ? 'true' : 'false', 'data-k': 'translator', onclick: () => {
      state.plain = !state.plain;
      switchEl.setAttribute('aria-checked', String(state.plain));
      repaintWork();
    } }, h('span', { class: 'knob', 'aria-hidden': 'true' }), h('span', { text: lab.translatorLabel })) : null;
    const more = h('button', { type: 'button', class: 'more', 'aria-expanded': 'false', 'aria-controls': 'navlinks', text: ui('more'), onclick: (ev) => { const open = !bar.classList.contains('open'); bar.classList.toggle('open', open); ev.currentTarget.setAttribute('aria-expanded', String(open)); } });
    nav.replaceChildren(
      h('a', { class: 'brand', href: hashFor('question'), onclick: toStart, text: data.meta.title || '' }),
      h('div', { class: 'navright' },
        h('ul', { class: 'navlinks', id: 'navlinks' }, availableTabs().map((id) => h('li', {}, h('a', { href: '#' + id, 'aria-current': state.tab === id ? 'page' : null, onclick: () => { bar.classList.remove('open'); more.setAttribute('aria-expanded', 'false'); }, text: (data.nav || {})[id] || id })))),
        switchEl, more));
  }
  // The translator is global: repaint everything that shows a label, each panel in place.
  function repaintWork() {
    if (hooks.lab) hooks.lab(null, false);
    if (hooks.explore) hooks.explore(null);
    repaintCharts();
  }

  function renderCredits() {
    const m = data.meta;
    const f = data.footer || {};
    const line = (...kids) => { const real = kids.flat().filter(Boolean); return real.length ? h('p', {}, real) : null; };
    const link = (text, url) => (isUrl(url) ? linkOut(url, text, 'inline') : text);
    const source = [m.source, m.dataset].filter(isText).join(' — ');
    $('credits').replaceChildren(h('div', {},
      (source || isText(m.citation)) && line(isText(f.dataLabel) && f.dataLabel + ' ', source && link(source, m.sourceUrl), source && isText(m.citation) && '. ', isText(m.citation) && link(m.citation, m.citationUrl), '.'),
      isText(m.licence) && line(isText(f.licenceLabel) && f.licenceLabel + ' ', link(m.licence, m.licenceUrl), '.'),
      isText(m.accessed) && line(isText(f.accessedLabel) && f.accessedLabel + ' ', fmtDate(m.accessed), '.'),
      isText(f.privacy) && line(f.privacy),
      m.PLACEHOLDER && isText(f.buildNote) && line(f.buildNote)));
  }

  /* Review mode: open any page with #check on the end of the address. Every piece of text that still says PLACEHOLDER is
     outlined and counted in the corner. Nothing links to it and it needs no code change. */
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
    const badge = $('phcount');
    if (badge) badge.textContent = `${found.size} PLACEHOLDER on this page`;
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

  /* The rail and the thread, the section tracker, and the reveal on scroll */
  let homeIO = null;
  let trackFrame = 0;
  // Which home section is on screen: the last one whose top is above 40% of the window.
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
      document.body.classList.toggle('scrolled', window.scrollY > 24);
      if (state.tab !== 'home' || !homeSecs.length) return;
      const { idx, frac } = sectionAtMid();
      const p = homeSecs.length > 1 ? Math.min(1, (idx + frac) / (homeSecs.length - 1)) : 1;
      $('rail').style.setProperty('--p', p);
      $('thread-top').style.setProperty('--p', p);
      const cur = homeSecs[idx];
      if (cur.id !== state.cur) {
        state.cur = cur.id;
        document.querySelectorAll('.rdot').forEach((a) => { if (a.dataset.id === cur.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        document.body.classList.toggle('on-dark', !!cur.dark);
        if (parseHash().key !== cur.id) history.replaceState(null, '', hashFor(cur.id));
      }
    });
  }
  function setupHome() {
    teardownHome();
    document.documentElement.classList.toggle('snap', !reducedMotion.matches);
    $('rail').replaceChildren(h('ol', {}, homeSecs.map((d, i) => h('li', {}, h('a', { class: 'rdot', href: hashFor(d.id), 'data-id': d.id, 'aria-label': `${pad3(i + 1)} ${d.name}`, onclick: (ev) => { ev.preventDefault(); go(d.id); } }, String(i + 1), h('span', { class: 'rname', 'aria-hidden': 'true', text: `${pad3(i + 1)} · ${d.name}` }))))));
    state.cur = null;
    if (reducedMotion.matches || !('IntersectionObserver' in window)) { trackScroll(); return; }
    document.querySelectorAll('.sec > .wrap > *').forEach((el) => el.classList.add('rv'));
    homeIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.dataset.beat && api.beats) api.beats(Number(e.target.dataset.beat));
      homeIO.unobserve(e.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.rv').forEach((el) => homeIO.observe(el));
    trackScroll();
  }
  function teardownHome() {
    if (homeIO) { homeIO.disconnect(); homeIO = null; }
    document.documentElement.classList.remove('snap');
    $('rail').replaceChildren();
    document.body.classList.remove('on-dark');
  }
  function setupPage() {
    teardownHome();
    if ('IntersectionObserver' in window && !reducedMotion.matches) {
      homeIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); homeIO.unobserve(e.target); } }), { threshold: 0.1 });
      document.querySelectorAll('.rv').forEach((el) => homeIO.observe(el));
    }
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || state.tab !== 'home') return;
    const t = ev.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    const here = homeSecs[sectionAtMid().idx];
    const own = here && api[here.id];
    if (own && own.key(ev)) ev.preventDefault();
  });
  window.addEventListener('scroll', trackScroll, { passive: true });
  window.addEventListener('resize', trackScroll);

  let pageCleanup = null;
  function show() {
    const first = state.tab === '';
    const { key } = parseHash();
    syncCheck();
    const sectionIds = homeSecs.length ? homeSecs.map((s) => s.id) : KNOWN;
    const isSection = sectionIds.includes(key);
    const tab = availableTabs().includes(key) ? key : 'home';
    const changed = tab !== state.tab;
    state.tab = tab;
    document.body.dataset.tab = tab;
    if (changed) {
      if (pageCleanup) { pageCleanup(); pageCleanup = null; }
      main.replaceChildren(tab === 'prize' ? renderPrize() : tab === 'ucas' ? renderUcas() : tab === 'teachers' ? renderTeachers() : renderHome());
      if (tab === 'home') setupHome(); else setupPage();
    }
    renderNav();
    document.title = [tab === 'home' ? '' : (data.nav || {})[tab], data.meta.title].filter(isText).join(' — ');
    if (tab === 'home') {
      if (isSection && $(key)) { requestAnimationFrame(() => { if (first) $(key).scrollIntoView({ block: 'start' }); else scrollToId(key); }); return; }
      // A device that already holds a finished poll opens at the pivot instead of making the student do it twice.
      if (first && state.poll.submitted && $('pivot')) { requestAnimationFrame(() => $('pivot').scrollIntoView({ block: 'start' })); return; }
      if (first) return;
      if (!changed) { window.scrollTo(0, 0); return; }
    }
    window.scrollTo(0, 0);
    const h1 = main.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });
    document.body.classList.toggle('scrolled', false);
    trackScroll();
  }

  function fail(message) {
    main.replaceChildren(h('div', { class: 'pagecol' }, h('h1', { text: UI.loadFailTitle }), h('p', { class: 'lead', text: message }), h('p', { text: UI.loadFailHelp })));
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
