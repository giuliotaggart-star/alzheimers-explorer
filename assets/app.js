/* AlzExplore — all behaviour. No dependencies, no build step.
   Every word of subject content, every number, unit, colour and address is read from data/seaad-mtg.json.
   The only English in this file is page furniture (UI below); the data file's optional "ui" object overrides it.
   Each view is a plain function from (data, state) to DOM, so it ports to a component framework one function at a time.
   What is kept on the device: the poll result and the essay draft, in localStorage, and nothing else.
   What leaves the device: nothing, unless config.pollEndpoint is set, and then only the six poll answers and class code. */
(() => {
  'use strict';

  const DATA_URL = 'data/seaad-mtg.json';
  const UI = {
    tabs: 'Sections', newTab: '(opens in a new tab)', unitMissing: '[unit missing]',
    showAnswer: 'Show me the answer', tried: 'tried', copied: 'Copied', copySelected: 'Selected — copy it with your device',
    you: 'you', step: 'Step', modelAnswer: 'Show a model answer', nextCase: 'Next simulation',
    skipPoll: 'Skip poll', pollSkipped: 'Poll skipped. You can still take it any time.', takePoll: 'Take the poll instead',
    stageOf: 'Stage', stageNames: ['Warm-Up Poll', 'Guided Simulations', 'Solo Explore'], simShort: 'Sim', simLong: 'Simulation',
    soloCta: 'Ready to test your own question?', soloGo: 'Go to Solo Explore',
    toStart: 'back to the start', loadFailTitle: 'The data did not load',
    loadFailHelp: 'If you opened this page straight from a folder, serve the folder instead: run “python3 -m http.server” in it and open http://localhost:8000.',
  };
  const ui = (k) => (data && data.ui && data.ui[k]) || UI[k];

  /* Plain-English wording. It is laid over the data file when the page loads, so data/seaad-mtg.json itself stays untouched.
     Objects merge key by key; lists and strings replace what the data file has. */
  const COPY = {
    nav: { prize: '£50 Essay Prize', ucas: 'UCAS & Careers', teachers: 'For Teachers' },
    hero: {
      title: 'AlzExplore',
      description: 'Dig into real brain-cell data from people with Alzheimer’s. Spot the pattern yourself and think like a scientist.',
      cta: 'Start Warm-Up Poll',
      prize: {
        badge: '{{prizeValue}} Essay Prize',
        heading: 'Found a pattern? Turn it into a {{prizeValue}} essay.',
        body: 'Write {{wordsMin}}–{{wordsMax}} words about what you just discovered. Every entry gets personal feedback. Winners get a {{prizeValue}} voucher.',
        cta: 'See how to enter',
      },
    },
    poll: {
      heading: 'Warm-up poll',
      framing: 'Six quick true-or-false questions about Alzheimer’s. Can you beat the average teenager?',
      classCodeHint: 'Your teacher may give you a code, like BIOL-12. Working alone? Leave it blank.',
      privacyLocal: 'Your answers stay on this device.',
      privacyShared: 'Your six answers and class code go to the workshop organiser. No name. No email.',
      resultCompare: 'The average teenager in the study got {{benchmarkMean}} right.',
      decodersHeading: 'Three ideas to take with you',
      decoders: [
        { title: 'Dementia is the symptoms. Alzheimer’s is one cause.', body: 'Dementia means memory loss and confusion that get in the way of daily life. Alzheimer’s disease is the most common cause of it.' },
        { title: 'Some brain cells are hit harder than others', body: 'The brain has many cell types. A disease can change some a lot and others barely at all. Which ones? That is your big question.' },
        { title: 'Reading genes, one cell at a time', body: 'Every cell has the same DNA, but each cell type switches on different genes. Counting the mRNA in one nucleus shows which genes are on, and what type of cell it is.' },
      ],
      labCta: 'Continue to Guided Simulations',
    },
    lab: {
      heading: 'The Data Lab',
      intro: 'Every dot is one person who donated their brain to research. Try the guided simulations first. Then explore on your own.',
      originHeading: 'Where do these dots come from?',
      originBody: ['Each dot is one cell from a donated brain. We measured {{cellsTotal}} from {{donorTotal}}. Press the button to sort them by cell type.'],
      mapAlt: 'A cloud of dots. Mixed up at first, they sort into groups of coloured dots, one colour for each cell type.',
      captionUnsorted: 'All the cells, mixed together.',
      captionSorted: 'The same cells, grouped by type.',
      modeGuided: 'Guided Simulations',
      modeSandbox: 'Solo Explore',
      overlayLabel: 'Show median & IQR',
      cheatHeading: 'Skills cheat-sheet',
      dotNote: '1 dot = 1 donor. The thick line is the median. The box shows the middle half of donors (the IQR).',
      cheats: [
        { title: 'Correlation is not causation', body: 'Two things moving together does not mean one causes the other.' },
        { title: 'Sample size', body: 'Check the n under each group. Few donors means a shaky pattern.' },
        { title: 'Confounders', body: 'Age, sex or genes could explain a difference too. Split the data and see if the pattern holds.' },
        { title: 'Post-mortem tissue', body: 'Each brain is measured once, after death. You never see one person change over time.' },
        { title: 'mRNA is not protein', body: 'More mRNA often means more protein, but not always.' },
      ],
      stressIntro: 'Groups can differ in more than disease stage. Pick a variable and split every group by it. Does the pattern survive?',
      stressCountsNote: 'If one column is mostly one kind of donor, that variable is tangled up with the groups.',
      observeMatch: 'The median is {{trend}} in the last group than the first. That matches your prediction.',
      observeMiss: 'The median is {{trend}} in the last group than the first. You predicted {{prediction}}. A wrong prediction is useful: it shows what to look at again.',
      observeNoPrediction: 'The median is {{trend}} in the last group than the first.',
      sandboxIntro: 'No task and no marks. Pick a launchpad or build your own question.',
      toSandbox: 'Go to Solo Explore',
      snapshotBridge: 'Found something interesting? Turn it into a {{prizeValue}} essay entry',
    },
    prize: {
      intro: 'Turn any finding from the Data Lab into a short essay.',
      builderIntro: 'Four boxes. One for each part of a scientific argument. Your draft saves on this device only.',
      submitHeading: 'Submit your essay',
      submitPrivacy: ['The entry form is on another website, not this one.', 'It asks for your name, email, school, class code, how confident you feel about a STEM degree, and your essay.', 'PLACEHOLDER: who sees entries, how long they are kept, and what under-16s need to do.'],
    },
    ucas: {
      intro: 'Nobody is born knowing how university applications work. Here is what people rarely say out loud.',
      statementIntro: 'Admissions tutors want to know what you did and what you learned. “I found it interesting” does not tell them.',
      statementWhy: ['It names the data and the method.', 'It says exactly what was analysed.', 'It ends on a skill, not a feeling.'],
      statementWarning: 'Do not copy this sentence. UCAS checks every application for matching text. Write about what you actually did, in your own words.',
      comp: [
        'Biomedical research is not only lab coats and pipettes. A lot of it happens on a computer.',
        'Computational biologists write code to find patterns in huge biological datasets, like the one on this site. The same skills power bioinformatics, health data science and AI in healthcare.',
        'You can get there from biology, biochemistry, biomedical science, maths, computer science or physics. Entry requirements differ, so check each course on UCAS.',
      ],
    },
    teachers: {
      intro: 'A free 50-minute workshop on Alzheimer’s and gene expression for Year 12 and 13, built on real research data.',
      value: ['Runs in the browser on a school Chromebook. No accounts. Nothing to install.', 'Keeps working if the school Wi-Fi drops.', 'One lesson: warm-up poll, guided simulations, then solo exploring.', 'The essay prize is optional follow-up work.'],
      sensitivity: 'Some students care for, or have lost, someone with dementia. Tell the class the topic beforehand and say where support is in school.',
    },
  };
  const merge = (base, over) => {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return over;
    const out = Object.assign({}, base && typeof base === 'object' && !Array.isArray(base) ? base : {});
    for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
    return out;
  };

  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let data = null;

  const state = {
    tab: '', plain: false, overlay: true, stage: 1,
    caseId: null, step: 0, view: 0, predictions: {}, strat: {},
    sandbox: null, snapshotMade: false,
    cloze: new Map(), map: { sorted: false, focus: null },
    poll: { answers: {}, classCode: '', submitted: null, skipped: false },
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
    get(k) { try { return JSON.parse(localStorage.getItem('alzexplore.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('alzexplore.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked: carry on in memory */ } },
    del(k) { try { localStorage.removeItem('alzexplore.' + k); } catch (e) { /* nothing to clear */ } },
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
    const ink = css('--ink', '#0F172A');
    const soft = css('--body', '#334155');
    const grid = css('--rule', '#E5E0F5');
    const teal = css('--teal', '#0D9488');
    const crimson = css('--crimson', '#BE123C');
    const axis = niceAxis(Q.max * 1.05);
    const Y = (v) => m.t + (1 - v / axis.max) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / Math.max(1, Q.groups.length);
    const family = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    const svg = s('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'font-family': family, 'font-size': font,
      'aria-label': [label(Q.metric), label(Q.cell), label(Q.grouping)].filter(Boolean).join(', ') });
    svg.append(s('rect', { width: W, height: H, fill: '#FFFFFF' }));
    svg.append(s('text', { x: 4, y: 14, fill: soft, 'font-weight': 600 }, `${label(Q.metric)} (${Q.unit || ui('unitMissing')})`));
    axis.ticks.forEach((t) => {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? soft : grid, 'stroke-width': t === 0 ? 1.5 : 1 }));
      svg.append(s('text', { x: m.l - 6, y: Y(t) + font * 0.35, 'text-anchor': 'end', fill: soft }, num(t, 2)));
    });
    const r = narrow ? 3.4 : 4.4;
    Q.groups.forEach((g, gi) => {
      const x0 = m.l + gi * band;
      const colour = Q.groups.length > 1 ? mix(teal, crimson, gi / (Q.groups.length - 1)) : teal;
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
      svg.append(marker(i % 3, 8, 8, 5, { fill: css('--body', '#334155') }));
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
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, Wc, Hc);
    const ink = css('--ink', '#0F172A');
    const soft = css('--body', '#334155');
    const sans = '"Plus Jakarta Sans", system-ui, Arial, sans-serif';
    let y = pad;
    if (withStats) {
      g.fillStyle = css('--plum', '#4C1D95'); g.font = `700 15px ${sans}`;
      g.fillText([data.meta.title, lab.snapshotTitle].filter(isText).join(' · ').toUpperCase(), pad, y + 12); y += 60;
    }
    g.fillStyle = ink; g.font = `600 24px ${sans}`;
    y = wrapText(g, questionText(Q), pad, y + 20, Wc - 2 * pad, 30) + 6;
    if (Q.q.filter && isText(Q.q.filter.note)) { g.fillStyle = soft; g.font = `400 15px ${sans}`; g.fillText(Q.q.filter.note, pad, y); y += 22; }
    g.drawImage(img, pad, y); y += img.height + 16;
    if (withStats) {
      const cols = lab.tableColumns || {};
      const unit = Q.unit || ui('unitMissing');
      const xs = [pad, pad + 360, pad + 480, pad + 720];
      g.font = `700 14px ${sans}`; g.fillStyle = ink;
      [label(Q.grouping), cols.n || donorUnit() || '', `${cols.median || ''} (${unit})`, `${cols.iqr || ''} (${unit})`].forEach((t, i) => g.fillText(t, xs[i], y + 14));
      y += 30; g.font = `400 14px ${sans}`;
      Q.groups.forEach((gr) => {
        [gr.name, String(gr.n), gr.n ? num(gr.median, Q.dec + 1) : '–', gr.n ? `${num(gr.q1, Q.dec + 1)} to ${num(gr.q3, Q.dec + 1)}` : '–'].forEach((t, i) => g.fillText(t, xs[i], y + 14));
        y += 30;
      });
      y += 10;
    }
    g.fillStyle = soft; g.font = `400 13px ${sans}`;
    y = wrapText(g, [lab.dotNote, sourceLine()].filter(isText).join(' '), pad, y + 16, Wc - 2 * pad, 18);
    if (data.meta.PLACEHOLDER) { g.fillStyle = css('--crimson', '#BE123C'); g.font = `700 13px ${sans}`; wrapText(g, data.meta.placeholderNotice || 'PLACEHOLDER', pad, y + 4, Wc - 2 * pad, 18); }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  const fileStem = (Q) => ['alzexplore', Q.q.metric, Q.q.cellType, Q.q.grouping].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');

  /* ---------- reusable blocks ---------- */

  function chartBlock(Q) {
    const lab = data.lab || {};
    const holder = h('div', { class: 'chart' });
    const paint = () => holder.replaceChildren(drawChart(Q, holder.clientWidth || main.clientWidth - 32));
    requestAnimationFrame(paint);
    if ('ResizeObserver' in window) {
      let lastW = 0;
      new ResizeObserver(() => { const w = holder.clientWidth; if (holder.isConnected && w && Math.abs(w - lastW) > 8) { lastW = w; paint(); } }).observe(holder);
    }
    return h('figure', { class: 'plot' },
      h('figcaption', { class: 'plot-title' }, questionText(Q)),
      Q.q.filter && para(Q.q.filter.note, 'small'),
      holder,
      strataLegend(Q),
      para(lab.dotNote, 'small'),
      h('div', { class: 'plot-tools' },
        isText(lab.exportLabel) && h('button', { type: 'button', class: 'btn ghost', 'data-k': 'export', onclick: async () => { try { saveBlob(await composeCard(Q, false), fileStem(Q) + '.png'); } catch (e) { /* the picture could not be made on this device */ } } }, lab.exportLabel)),
      isText(lab.tableLabel) && h('details', { class: 'drawer slim' }, h('summary', { text: lab.tableLabel }), statsTable(Q)));
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

  // The map of cells the site draws itself: a grey jumble that sorts into coloured types.
  function mapBlock() {
    const lab = data.lab || {};
    const src = (data.map && data.map.points) || null;
    if (!src || typeof src !== 'object') return null;
    const groups = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [id, pts] of Object.entries(src)) {
      const clean = list(pts).filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
      if (!clean.length) continue;
      clean.forEach((p) => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
      groups.push({ id, cell: cellOf(id), pts: clean });
    }
    if (!groups.length) return null;
    let seed = 20261112;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const M = 0.07;
    groups.forEach((g) => {
      g.sorted = g.pts.map((p) => [M + ((p[0] - minX) / (maxX - minX || 1)) * (1 - 2 * M), 1 - (M + ((p[1] - minY) / (maxY - minY || 1)) * (1 - 2 * M))]);
      g.mixed = g.pts.map(() => { const r = 0.4 * Math.sqrt(rand()); const t = rand() * Math.PI * 2; return [0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t)]; });
      g.delay = g.pts.map(() => rand() * 0.35);
    });
    const canvas = h('canvas', { role: 'img', 'aria-label': lab.mapAlt || '' });
    const caption = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const toggle = h('button', { type: 'button', class: 'btn ghost', 'data-k': 'mapsort' });
    let t = state.map.sorted ? 1 : 0;
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const hgt = canvas.clientHeight;
      if (!w || !hgt) return;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(hgt * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(hgt * ratio); }
      const g2 = canvas.getContext('2d');
      g2.setTransform(ratio, 0, 0, ratio, 0, 0);
      g2.clearRect(0, 0, w, hgt);
      const r = Math.max(1.3, Math.min(w, hgt) / 200);
      const pass = (g, colour, alpha) => {
        if (alpha <= 0.004) return;
        g2.globalAlpha = alpha; g2.fillStyle = colour; g2.beginPath();
        for (let i = 0; i < g.pts.length; i += 1) {
          const k = ease(Math.min(1, Math.max(0, (t - g.delay[i]) / 0.65)));
          const x = (g.mixed[i][0] + (g.sorted[i][0] - g.mixed[i][0]) * k) * w;
          const y = (g.mixed[i][1] + (g.sorted[i][1] - g.mixed[i][1]) * k) * hgt;
          g2.moveTo(x + r, y); g2.arc(x, y, r, 0, Math.PI * 2);
        }
        g2.fill();
      };
      for (const g of groups) {
        const focused = state.map.focus === g.id;
        const dim = state.map.focus && !focused ? 0.2 : 1;
        const tint = !g.cell ? 0 : focused ? 1 : ease(Math.min(1, t * 1.4));
        pass(g, css('--body', '#334155'), 0.5 * (1 - tint) * dim);
        if (g.cell) pass(g, colourOf(g.cell), 0.85 * tint * dim);
      }
      g2.globalAlpha = 1;
    };
    const sync = () => {
      toggle.textContent = (state.map.sorted ? lab.unsortLabel : lab.sortLabel) || '';
      toggle.hidden = !toggle.textContent;
      caption.textContent = (state.map.sorted ? lab.captionSorted : lab.captionUnsorted) || '';
      caption.hidden = !caption.textContent;
    };
    let raf = 0;
    toggle.addEventListener('click', () => {
      state.map.sorted = !state.map.sorted; sync();
      cancelAnimationFrame(raf);
      const target = state.map.sorted ? 1 : 0;
      if (reducedMotion.matches) { t = target; draw(); return; }
      const from = t;
      const began = performance.now();
      const tick = (now) => { if (!canvas.isConnected) return; const k = Math.min(1, (now - began) / 1500); t = from + (target - from) * k; draw(); if (k < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    });
    sync();
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (canvas.isConnected) draw(); }).observe(canvas);
    requestAnimationFrame(draw);
    const chips = [];
    const key = h('ul', { class: 'chips' }, list(data.cellTypes).filter((c) => src[c.id]).map((cell) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': state.map.focus === cell.id ? 'true' : 'false',
        onclick: () => { const on = state.map.focus !== cell.id; state.map.focus = on ? cell.id : null; chips.forEach((x) => x.setAttribute('aria-pressed', x === b && on ? 'true' : 'false')); draw(); } },
        h('span', { class: 'dot', style: `background:${colourOf(cell)}`, 'aria-hidden': 'true' }), label(cell));
      chips.push(b);
      return h('li', {}, b);
    }));
    return h('div', { class: 'mapfig' }, h('div', { class: 'mapframe' }, canvas), h('div', { class: 'plot-tools' }, toggle), caption, key);
  }

  function figureCards(items) {
    const cards = list(items).filter((f) => f && (isNum(f.value) || isText(f.value)));
    if (!cards.length) return null;
    return h('ul', { class: 'figures' }, cards.map((f) => h('li', { class: 'card stat' },
      h('span', { class: 'fvalue', text: isNum(f.value) ? num(f.value, 0) : f.value }),
      h('span', { class: 'funit', text: isText(f.unit) ? f.unit : ui('unitMissing') }),
      isText(f.label) && h('span', { class: 'small', text: f.label }))));
  }

  const linkOut = (url, text, cls) => h('a', { class: cls || 'btn', href: url, target: '_blank', rel: 'noopener' }, text, h('span', { class: 'sr', text: ' ' + ui('newTab') }), h('span', { class: 'arr', 'aria-hidden': 'true', text: '↗' }));
  // A link to a form on another site, or a switched-off button with a note while the address is not set.
  function formButton(url, text, pendingNote, id) {
    if (!isText(text)) return null;
    if (isUrl(url)) return linkOut(url, text);
    return [h('button', { type: 'button', class: 'btn', disabled: true, 'aria-describedby': isText(pendingNote) ? id : null, text }), isText(pendingNote) && h('p', { id, class: 'small', text: pendingNote })];
  }
  function scrollToId(id) {
    const el = $(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    const hd = el.querySelector('h2');
    if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); }
  }
  // Repaint a panel in place: pin its height and the scroll position so the page never jumps.
  function keepScroll(box, fn) {
    const y = window.scrollY;
    box.style.minHeight = box.offsetHeight + 'px';
    fn();
    window.scrollTo(window.scrollX, y);
    requestAnimationFrame(() => { window.scrollTo(window.scrollX, y); box.style.minHeight = ''; });
  }
  const arrow = (ch) => h('span', { class: 'arr', 'aria-hidden': 'true', text: ch });

  /* ---------- view 1: home — hero, poll, data lab ---------- */

  // Stage switcher: three small pills. Clicking one reveals that stage and scrolls to the top of it.
  function stageBar(current) {
    const names = list(ui('stageNames'));
    const has = (n) => n === 1 ? !!data.poll : n === 2 ? list(data.caseStudies).length > 0 && !!data.lab : !!data.lab;
    return h('ol', { class: 'stagebar', 'aria-label': ui('stageOf') }, [1, 2, 3].filter(has).map((n) => h('li', {},
      h('button', { type: 'button', class: 'stagepill', 'aria-current': n === current ? 'step' : null, onclick: () => goStage(n) },
        h('span', { class: 'qn', 'aria-hidden': 'true', text: String(n) }), h('span', { class: 'sr', text: ui('stageOf') + ' ' }), names[n - 1] || ''))));
  }
  const stageHead = (n, title, intro) => h('div', { class: 'stagehead' }, stageBar(n), heading(2, title), para(intro, 'lede'));

  function heroBlock() {
    const hero = data.hero || {};
    const title = hero.title || data.meta.title || '';
    const m = /^(Alz)(.+)$/.exec(title);
    return h('section', { class: 'bandfull herob' }, h('div', { class: 'wrap' }, h('div', { class: 'hero' },
      h('h1', { tabindex: '-1' }, m ? [h('span', { class: 'alz', text: m[1] }), m[2]] : title),
      para(hero.description, 'lede'),
      data.poll && isText(hero.cta) && h('button', { type: 'button', class: 'btn big light', onclick: () => goStage(1) }, hero.cta, arrow('↓')))));
  }

  // The celebratory prize card that closes the learning journey.
  function prizeCallout() {
    const prize = (data.hero || {}).prize;
    if (!prize || !data.prize) return null;
    return h('section', { class: 'bandfull b-white', id: 'journey-end' }, h('div', { class: 'wrap' }, h('aside', { class: 'prizecard' },
      isText(prize.badge) && h('p', { class: 'badge', text: fill(prize.badge) }),
      heading(2, prize.heading),
      para(prize.body),
      isText(prize.cta) && h('div', { class: 'actions' }, h('a', { class: 'btn gold big', href: '#prize' }, prize.cta, arrow('→'))))));
  }

  function pollBlock() {
    const poll = data.poll;
    if (!poll || !list(poll.items).length) return null;
    const items = list(poll.items);
    const keys = ['true', 'false', 'dk'];
    const names = poll.options || {};
    const sec = h('section', { class: 'bandfull b-lav', id: 'poll' });
    const box = h('div', { class: 'wrap' });
    sec.append(box);
    const endpoint = isUrl((data.config || {}).pollEndpoint) ? data.config.pollEndpoint : null;
    const P = state.poll;
    const csv = (rec) => {
      const head = ['submitted', 'classCode', ...items.map((i) => i.id), 'score'];
      const row = [rec.at, rec.classCode, ...items.map((i) => rec.answers[i.id] || ''), rec.score];
      return [head, row].map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    };

    const goLab = () => h('div', { class: 'cta-row' }, data.lab && isText(poll.labCta) && h('button', { type: 'button', class: 'btn big', 'data-k': 'continue', onclick: () => goStage(2) }, poll.labCta, arrow('→')));
    const paint = (focus) => keepScroll(box, () => paintNow(focus));
    const paintNow = (focus) => {
      const done = P.submitted;
      const kids = [stageHead(1, poll.heading, poll.framing)];
      if (!done && P.skipped) {
        kids.push(h('div', { class: 'card stack' }, h('p', { class: 'statement', text: ui('pollSkipped') }), h('div', { class: 'cta-row' },
          data.lab && isText(poll.labCta) && h('button', { type: 'button', class: 'btn big', 'data-k': 'continue', onclick: () => goStage(2) }, poll.labCta, arrow('→')),
          h('button', { type: 'button', class: 'linkbtn', text: ui('takePoll'), onclick: () => { P.skipped = false; paint('form'); } }))));
      } else if (!done) {
        const count = () => items.filter((i) => P.answers[i.id]).length;
        const submit = h('button', { type: 'submit', class: 'btn big', disabled: count() < items.length, text: poll.submitLabel || '' });
        const progress = h('span', { class: 'small', role: 'status', text: fill(poll.progressLabel, { answered: count(), total: items.length }) });
        kids.push(h('form', { class: 'poll', novalidate: true, onsubmit: (ev) => {
          ev.preventDefault();
          if (count() < items.length) return;
          const score = items.filter((i) => P.answers[i.id] === i.correct).length;
          P.submitted = { at: new Date().toISOString(), classCode: P.classCode.trim().slice(0, 24), answers: Object.assign({}, P.answers), score };
          store.set('poll', P.submitted);
          if (endpoint) { try { fetch(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(P.submitted) }).catch(() => {}); } catch (e) { /* offline: the result is still shown */ } }
          paintNow('result');
        } },
          h('ol', { class: 'poll-items' }, items.map((item, n) => h('li', {}, h('fieldset', {},
            h('legend', {}, h('span', { class: 'qn', 'aria-hidden': 'true', text: String(n + 1) }), `“${item.statement}”`),
            h('div', { class: 'tfd' }, keys.map((k) => h('label', { for: `${item.id}-${k}` },
              h('input', { type: 'radio', name: item.id, value: k, id: `${item.id}-${k}`, checked: P.answers[item.id] === k,
                onchange: () => { P.answers[item.id] = k; submit.disabled = count() < items.length; progress.textContent = fill(poll.progressLabel, { answered: count(), total: items.length }); } }),
              h('span', { text: names[k] || k }))))))),
          ),
          isText(poll.classCodeLabel) && h('div', { class: 'classcode' },
            h('label', { for: 'classcode', text: poll.classCodeLabel }),
            h('input', { id: 'classcode', type: 'text', maxlength: '24', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: P.classCode, 'aria-describedby': isText(poll.classCodeHint) ? 'classcode-hint' : null, oninput: (ev) => { P.classCode = ev.target.value; } }),
            isText(poll.classCodeHint) && h('p', { id: 'classcode-hint', class: 'small', text: poll.classCodeHint })),
          h('div', { class: 'actions' }, submit, progress),
          para(endpoint ? poll.privacyShared : poll.privacyLocal, 'small'),
          h('div', { class: 'skiprow' }, h('button', { type: 'button', class: 'skiplink', onclick: () => { P.skipped = true; paint('skipped'); } }, ui('skipPoll') + ' →'))));
      } else {
        const mean = items.reduce((a, i) => a + ((i.benchmark || {})[i.correct] || 0), 0) / items.length;
        kids.push(h('div', { class: 'result' },
          h('h3', { class: 'score', tabindex: '-1' }, fillNodes(poll.resultHeading, { score: done.score, total: items.length })),
          para(poll.resultCompare, null, { benchmarkMean: qty(mean, '%', 0) }),
          goLab(),
          h('ol', { class: 'compare' }, items.map((item) => {
            const b = item.benchmark || {};
            const mine = done.answers[item.id];
            const right = mine === item.correct;
            return h('li', { class: 'card' },
              h('p', { class: 'statement' }, `“${item.statement}”`),
              h('p', {}, h('span', { class: 'verdict ' + (right ? 'right' : 'wrong'), text: (right ? poll.rightLabel : poll.wrongLabel) || '' }), ' ',
                [isText(poll.yourAnswer) && `${poll.yourAnswer}: ${names[mine] || mine}.`, isText(poll.correctAnswer) && `${poll.correctAnswer}: ${names[item.correct] || item.correct}.`].filter(Boolean).join(' ')),
              h('div', { class: 'bar', role: 'img', 'aria-label': [poll.benchmarkLabel, keys.map((k) => `${names[k] || k} ${qty(b[k], '%', 1)}`).join(', ')].filter(isText).join(': ') },
                keys.map((k) => (isNum(b[k]) ? h('span', { class: 'seg ' + k + (k === item.correct ? ' correct' : ''), style: `width:${b[k]}%` }) : null))),
              h('p', { class: 'small barkey' }, isText(poll.benchmarkLabel) && h('b', { text: poll.benchmarkLabel + ': ' }), keys.map((k, i) => h('span', { class: k === item.correct ? 'kcorrect' : null },
                `${names[k] || k} ${qty(b[k], '%', 1)}`, mine === k && h('span', { text: ` (${ui('you')})` }), i < keys.length - 1 ? ' · ' : ''))));
          })),
          (isText(poll.benchmarkSource) || isUrl(poll.benchmarkSourceUrl)) && h('p', { class: 'small' }, poll.benchmarkSource || '', ' ', isUrl(poll.benchmarkSourceUrl) && linkOut(poll.benchmarkSourceUrl, poll.benchmarkSourceUrl.replace(/^https:\/\/([^/]+).*$/, '$1'), 'inline')),
          h('div', { class: 'actions' },
            isText(poll.exportLabel) && h('button', { type: 'button', class: 'btn ghost', text: poll.exportLabel, onclick: () => saveBlob(new Blob([csv(done)], { type: 'text/csv' }), 'alzexplore-poll.csv') }),
            isText(poll.retakeLabel) && h('button', { type: 'button', class: 'btn ghost', text: poll.retakeLabel, onclick: () => { P.submitted = null; P.answers = {}; paint('form'); } }),
            isText(poll.clearLabel) && h('button', { type: 'button', class: 'linkbtn', text: poll.clearLabel, onclick: () => { store.del('poll'); P.submitted = null; P.answers = {}; P.classCode = ''; paint('form'); } }))));
        if (list(poll.decoders).length) {
          kids.push(heading(3, poll.decodersHeading, null, 'subhead'),
            h('ul', { class: 'bento three' }, list(poll.decoders).map((d) => h('li', { class: 'card' }, heading(4, d.title), para(d.body)))));
        }
        kids.push(goLab());
      }
      box.replaceChildren(...kids.flat(Infinity).filter(Boolean));
      if (focus === 'result') { const t = box.querySelector('.score'); if (t) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' }); } }
      if (focus === 'form') { const t = box.querySelector('input'); if (t) t.focus({ preventScroll: true }); }
      if (focus === 'skipped') { const t = box.querySelector('[data-k="continue"]'); if (t) t.focus({ preventScroll: true }); }
    };
    paintNow(null);
    return sec;
  }

  const currentCase = () => byId(data.caseStudies, state.caseId) || list(data.caseStudies)[0] || null;
  function sandboxDefaults() {
    const first = list((data.lab || {}).launchpads)[0] || list(data.series)[0] || {};
    return { metric: first.metric, cellType: first.cellType, grouping: first.grouping || (list(data.groupings)[0] || {}).id };
  }

  // Stages 2 and 3. Built once, on first reveal. Every control repaints only its own panel, in place.
  function labStages() {
    const lab = data.lab;
    if (!lab || !list(data.series).length || !list(data.donors).length) return null;
    const hasGuided = list(data.caseStudies).length > 0;
    const make = (id, cls) => { const sec = h('section', { class: 'bandfull ' + cls, id }); const box = h('div', { class: 'wrap' }); sec.append(box); return { sec, box }; };
    const G = make('guided', 'b-lilac');
    const S = make('solo', 'b-lav');
    let origin = null;      // built once, so the map keeps its state while the rest of the lab repaints

    const controls = (which) => {
      const pill = (key, on, text, onclick) => h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'data-k': key, onclick }, h('span', { class: 'knob', 'aria-hidden': 'true' }), h('span', { text }));
      return h('div', { class: 'labbar' },
        isText(lab.translatorLabel) && pill('translator', state.plain, [lab.translatorLabel, state.plain ? lab.translatorOn : lab.translatorOff].filter(isText).join(': '), () => { state.plain = !state.plain; origin = null; paintAll('translator', which); }),
        isText(lab.overlayLabel) && pill('overlay', state.overlay, lab.overlayLabel, () => { state.overlay = !state.overlay; paintAll('overlay', which); }));
    };
    const cheatsBlock = () => (list(lab.cheats).length && isText(lab.cheatHeading) ? h('details', { class: 'drawer' }, h('summary', { text: lab.cheatHeading }),
      h('ul', { class: 'bento five' }, list(lab.cheats).map((c) => h('li', { class: 'card mini' }, heading(4, c.title), para(c.body, 'small')))),
      list(data.terms).length > 0 && h('ul', { class: 'terms small' }, list(data.terms).map((t) => h('li', {}, h('b', { text: t.research }), ' = ', t.plain)))) : null);
    const focusIn = (box, key) => { if (!key) return; const t = box.querySelector(`[data-k="${key}"]`); if (t) t.focus({ preventScroll: true }); };

    const paintGuided = (focusKey) => keepScroll(G.box, () => {
      if (!origin) {
        const map = mapBlock();
        const text = [paras(lab.originBody), figureCards(lab.originFigures)].flat(Infinity).filter(Boolean);
        origin = (map || text.length) && isText(lab.originHeading) ? h('details', { class: 'drawer origin', open: true }, h('summary', { text: lab.originHeading }),
          h('div', { class: 'origin-grid' }, text.length > 0 && h('div', { class: 'stack' }, text), map)) : false;
      }
      G.box.replaceChildren(...[stageHead(2, lab.modeGuided || lab.heading, lab.intro), origin, controls('guided'), cheatsBlock(), guidedBlock(paintGuided)].flat(Infinity).filter(Boolean));
      focusIn(G.box, focusKey);
    });
    const paintSolo = (focusKey) => keepScroll(S.box, () => {
      S.box.replaceChildren(...[stageHead(3, lab.modeSandbox || lab.heading, lab.sandboxIntro), controls('solo'), sandboxBlock(paintSolo)].flat(Infinity).filter(Boolean));
      focusIn(S.box, focusKey);
    });
    // The translator and chart switches are shared, so both panels are repainted; focus returns to the one that was used.
    function paintAll(focusKey, which) {
      if (hasGuided) paintGuided(which === 'guided' ? focusKey : null);
      if (S.sec.isConnected || which === 'solo') paintSolo(which === 'solo' ? focusKey : null);
    }

    function guidedBlock(repaint) {
      const cs = currentCase();
      const title = (c) => (state.plain && isText(c.plainTitle) ? c.plainTitle : c.title) || c.id;
      const idx = Math.max(0, list(data.caseStudies).indexOf(cs));
      const picker = h('div', { class: 'simpills', role: 'group', 'aria-label': ui('simLong') },
        list(data.caseStudies).map((c, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': c === cs ? 'true' : 'false', 'aria-label': `${ui('simLong')} ${i + 1}: ${title(c)}`, 'data-k': 'case-' + c.id,
          onclick: () => { state.caseId = c.id; state.step = 0; state.view = 0; repaint('case-' + c.id); } }, `${ui('simShort')} ${i + 1}`)));
      const labels = list(lab.stepLabels);
      const stepper = h('ol', { class: 'stepper' }, [0, 1, 2, 3].map((i) => h('li', { class: i === state.step ? 'here' : i < state.step ? 'done' : '' }, h('button', { type: 'button', 'aria-current': i === state.step ? 'step' : null, 'data-k': 'step-' + i, onclick: () => { state.step = i; repaint('step-' + i); } },
        h('span', { class: 'qn', 'aria-hidden': 'true', text: String(i + 1) }), h('span', { class: 'sr', text: `${ui('step')} ${i + 1}: ` }), h('span', { class: 'steplabel', text: labels[i] || '' })))));
      const views = list(cs.views);
      state.view = Math.min(state.view, Math.max(0, views.length - 1));
      const view = views[state.view] || {};
      const base = { metric: view.metric, cellType: view.cellType, grouping: cs.grouping, filter: cs.filter || null };
      const first = buildQuestion({ metric: (views[0] || {}).metric, cellType: (views[0] || {}).cellType, grouping: cs.grouping, filter: cs.filter || null });
      const predicted = state.predictions[cs.id];
      const predictOptions = list((cs.predict || {}).options);
      const predLabel = (id) => (predictOptions.find((o) => o.id === id) || {}).label || '';
      const nav = () => h('div', { class: 'actions' },
        state.step > 0 && isText(lab.backLabel) && h('button', { type: 'button', class: 'btn ghost', text: lab.backLabel, onclick: () => { state.step -= 1; repaint('step-' + state.step); } }),
        state.step < 3 && isText(lab.nextLabel) && h('button', { type: 'button', class: 'btn', 'data-k': 'next', onclick: () => { state.step += 1; repaint('step-' + state.step); } }, lab.nextLabel, arrow('→')));
      const viewTabs = views.length > 1 ? h('div', { class: 'viewtabs' }, views.map((v, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': i === state.view ? 'true' : 'false', 'data-k': 'view-' + i, onclick: () => { state.view = i; repaint('view-' + i); } }, [label(metricOf(v.metric)), label(cellOf(v.cellType))].filter(Boolean).join(' · ')))) : null;

      let body;
      if (state.step === 0) {
        body = [para(cs.brief), cs.filter && para(cs.filter.note, 'small'),
          predictOptions.length > 0 && h('fieldset', { class: 'predict' }, h('legend', { text: (cs.predict || {}).question || '' }),
            h('div', { class: 'options' }, predictOptions.map((o) => h('button', { type: 'button', class: 'option', 'aria-pressed': predicted === o.id ? 'true' : 'false', 'data-k': 'pred-' + o.id, onclick: () => { state.predictions[cs.id] = o.id; repaint('next'); } }, o.label)))),
          predicted && para(lab.predictSaved, 'good', { prediction: predLabel(predicted) }),
          h('div', { class: 'actions' }, h('button', { type: 'button', class: predicted ? 'btn' : 'linkbtn', 'data-k': 'next', onclick: () => { state.step = 1; repaint('step-1'); } },
            predicted ? [lab.nextLabel || '', arrow('→')] : lab.predictSkip || lab.nextLabel || '→'))];
      } else if (state.step === 1) {
        const Q = buildQuestion(base);
        const vars = Object.assign(questionVars(first), { prediction: predLabel(predicted) });
        body = [viewTabs, Q && chartBlock(Q),
          first && para(!predicted ? lab.observeNoPrediction : predicted === first.trend ? lab.observeMatch : lab.observeMiss, 'callout', vars),
          Q && para(lab.observeStats, null, questionVars(Q)), nav()];
      } else if (state.step === 2) {
        const chosen = state.strat[cs.id] || null;
        const Q = buildQuestion(Object.assign({}, base, { confounder: chosen }));
        const confs = list(cs.confounders).map((id) => byId(data.confounders, id)).filter(Boolean);
        const conf = chosen ? byId(data.confounders, chosen) : null;
        const counts = Q && conf ? h('div', { class: 'stack' }, heading(4, lab.stressCountsHeading),
          h('div', { class: 'tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: `${conf.label} (${donorUnit() || ui('unitMissing')})` }), Q.groups.map((g) => h('th', { scope: 'col', class: 'num', text: g.name })))),
            h('tbody', {}, Q.strata.map((st, si) => h('tr', {}, h('th', { scope: 'row', text: st }), Q.groups.map((g) => h('td', { class: 'num', text: String(g.parts[si].n) }))))))),
          para(lab.stressCountsNote, 'small')) : null;
        body = [para(lab.stressIntro),
          confs.length > 0 && h('div', { class: 'viewtabs', role: 'group', 'aria-label': labels[2] || null }, [null, ...confs].map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': (c ? c.id : null) === chosen ? 'true' : 'false', 'data-k': 'strat-' + (c ? c.id : 'none'), onclick: () => { state.strat[cs.id] = c ? c.id : null; repaint('strat-' + (c ? c.id : 'none')); } }, c ? c.label : lab.stressNone || '–'))),
          viewTabs, Q && chartBlock(Q), counts, nav()];
      } else {
        const tk = cs.takeaway || {};
        const all = list(data.caseStudies);
        const next = all[(all.indexOf(cs) + 1) % all.length];
        body = [first && list(tk.parts).length > 0 && clozeBlock('case:' + cs.id, tk, questionVars(first)),
          (isText(tk.claim) || isText(tk.limitation)) && h('details', { class: 'drawer slim' }, h('summary', { text: ui('modelAnswer') }),
            h('dl', { class: 'model' }, isText(tk.claim) && h('div', {}, h('dt', { text: lab.takeawayClaimLabel || '' }), h('dd', { text: tk.claim })), isText(tk.limitation) && h('div', {}, h('dt', { text: lab.takeawayLimitLabel || '' }), h('dd', { text: tk.limitation })))),
          h('div', { class: 'actions' },
            isText(lab.backLabel) && h('button', { type: 'button', class: 'btn ghost', text: lab.backLabel, onclick: () => { state.step = 2; repaint('step-2'); } }),
            next && next !== cs && h('button', { type: 'button', class: 'btn', onclick: () => { state.caseId = next.id; state.step = 0; state.view = 0; repaint('case-' + next.id); } }, ui('nextCase'), arrow('→')))];
      }
      return h('div', { class: 'guided' },
        h('div', { class: 'card sim' }, picker, h('h3', { class: 'simtitle', text: `${ui('simLong')} ${idx + 1}: ${title(cs)}` }), stepper, h('div', { class: 'stack stepbody' }, body)),
        h('div', { class: 'to-solo' }, h('p', { text: ui('soloCta') }), h('button', { type: 'button', class: 'btn big', 'data-k': 'to-solo', onclick: () => goStage(3) }, ui('soloGo'), arrow('→'))));
    }

    function sandboxBlock(repaint) {
      if (!state.sandbox) state.sandbox = sandboxDefaults();
      const sb = state.sandbox;
      const metricsWithData = list(data.metrics).filter((m) => list(data.series).some((x) => x.metric === m.id));
      const cellsFor = (metricId) => list(data.cellTypes).filter((c) => seriesOf(metricId, c.id));
      if (!metricsWithData.some((m) => m.id === sb.metric)) sb.metric = (metricsWithData[0] || {}).id;
      if (!cellsFor(sb.metric).some((c) => c.id === sb.cellType)) sb.cellType = (cellsFor(sb.metric)[0] || {}).id;
      if (!groupingOf(sb.grouping)) sb.grouping = (list(data.groupings)[0] || {}).id;
      const Q = buildQuestion(sb);
      const b = lab.builder || {};
      const select = (key, options, value, onchange) => h('select', { 'data-k': key, 'aria-label': key, onchange: (ev) => { onchange(ev.target.value); state.snapshotMade = false; repaint(key); } }, options.map((o) => h('option', { value: o.id, selected: o.id === value }, label(o))));
      const pads = list(lab.launchpads);
      return h('div', { class: 'sandbox stack' },
        pads.length > 0 && h('ul', { class: 'bento three' }, pads.map((p) => h('li', {}, h('button', { type: 'button', class: 'card pad', 'aria-pressed': p.metric === sb.metric && p.cellType === sb.cellType && p.grouping === sb.grouping ? 'true' : 'false', 'data-k': 'pad-' + p.id,
          onclick: () => { state.sandbox = { metric: p.metric, cellType: p.cellType, grouping: p.grouping }; state.snapshotMade = false; repaint('pad-' + p.id); } },
          h('span', { class: 'padtitle', text: p.title || '' }), isText(p.blurb) && h('span', { class: 'small', text: p.blurb }),
          h('span', { class: 'small padq', text: [label(metricOf(p.metric)), label(groupingOf(p.grouping)), label(cellOf(p.cellType))].filter(Boolean).join(' · ') }))))),
        h('p', { class: 'builder' }, b.lead || '', ' ',
          select('metric', metricsWithData, sb.metric, (v) => { sb.metric = v; }), ' ', b.mid1 || '', ' ',
          select('grouping', list(data.groupings), sb.grouping, (v) => { sb.grouping = v; }), ' ', b.mid2 || '', ' ',
          select('cellType', cellsFor(sb.metric), sb.cellType, (v) => { sb.cellType = v; }), b.end || ''),
        Q && chartBlock(Q),
        Q && h('div', { class: 'stack' }, heading(4, lab.statsHeading), statsTable(Q)),
        Q && isText(lab.snapshotLabel) && h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', 'data-k': 'snapshot', onclick: async () => { try { saveBlob(await composeCard(Q, true), fileStem(Q) + '-snapshot.png'); } catch (e) { /* the picture could not be made on this device */ } state.snapshotMade = true; repaint('snapshot'); } }, lab.snapshotLabel)),
        state.snapshotMade && h('div', { class: 'bridge', role: 'status' }, para(lab.snapshotDone, 'small'),
          data.prize && isText(lab.snapshotBridge) && h('a', { href: '#prize' }, fillNodes(lab.snapshotBridge), arrow('→'))));
    }

    if (hasGuided) paintGuided(null);
    paintSolo(null);
    return { guided: hasGuided ? G.sec : null, solo: S.sec };
  }

  /* The journey: hero, then stage 1 (poll), stage 2 (guided simulations), stage 3 (solo explore), then the prize card.
     Later stages are added to the page only when the student asks for them, so there is no endless scroll. */
  let homeView = null;
  let labs = null;
  let prizeBand = null;
  function mountStages() {
    if (!homeView) return;
    if (!labs && state.stage >= 2) labs = labStages();
    if (!labs) return;
    if (state.stage >= 2 && labs.guided && !labs.guided.isConnected) homeView.append(labs.guided);
    if (state.stage >= 3 && !labs.solo.isConnected) homeView.append(labs.solo);
    if (state.stage >= 2) { if (!prizeBand) prizeBand = prizeCallout(); if (prizeBand) homeView.append(prizeBand); }
  }
  function goStage(n) {
    if (n === 1) { scrollToId('poll'); return; }
    if (n === 2 && !list(data.caseStudies).length) n = 3;
    state.stage = Math.max(state.stage, n);
    mountStages();
    if (!labs) return;
    requestAnimationFrame(() => scrollToId(n === 2 ? 'guided' : 'solo'));
  }
  function renderHome() {
    labs = null; prizeBand = null;
    if (!data.poll) state.stage = Math.max(state.stage, 2);
    homeView = h('div', { class: 'view home' }, heroBlock(), pollBlock());
    mountStages();
    return homeView;
  }

  /* ---------- view 2: the essay prize ---------- */

  const countWords = (t) => (String(t).trim().match(/\S+/g) || []).length;

  function renderPrize() {
    const p = data.prize;
    const cfg = data.config || {};
    const draft = store.get('essay') || {};
    const sections = list(p.sections);
    const total = h('p', { class: 'total', role: 'status' });
    const areas = [];
    let timer = 0;
    const refresh = () => {
      let sum = 0;
      areas.forEach(({ sec, area, counter }) => { const c = countWords(area.value); sum += c; counter.textContent = fill(p.wordCount, { count: c, target: sec.target }); });
      total.textContent = fill(p.totalCount, { count: sum });
      total.classList.toggle('inrange', sum >= p.wordsMin && sum <= p.wordsMax);
    };
    const save = () => { clearTimeout(timer); timer = setTimeout(() => { const out = {}; areas.forEach(({ sec, area }) => { out[sec.id] = area.value; }); store.set('essay', out); }, 400); };
    const builder = sections.map((sec, i) => {
      const area = h('textarea', { id: 'essay-' + sec.id, rows: String(Math.max(4, Math.round((sec.target || 100) / 22))), 'aria-describedby': `essay-${sec.id}-hint essay-${sec.id}-count`, oninput: () => { refresh(); save(); } });
      area.value = draft[sec.id] || '';
      const counter = h('p', { class: 'small count', id: `essay-${sec.id}-count` });
      areas.push({ sec, area, counter });
      const field = h('div', { class: 'field' },
        h('label', { for: 'essay-' + sec.id }, h('span', { class: 'qn', 'aria-hidden': 'true', text: String(i + 1) }), sec.label || sec.id),
        h('p', { class: 'small', id: `essay-${sec.id}-hint`, text: sec.prompt || '' }), area, counter);
      if (i === sections.length - 1 && list(p.checklist).length) {
        return h('div', { class: 'withaside' }, field, h('aside', { class: 'card mini' }, heading(4, p.checklistHeading), h('ul', { class: 'ticks' }, list(p.checklist).map((c) => h('li', { text: c })))));
      }
      return field;
    });
    const text = () => areas.map(({ sec, area }) => `${sec.label || sec.id}\n${area.value.trim()}`).join('\n\n');
    const copy = isText(p.copyLabel) && h('button', { type: 'button', class: 'btn', onclick: (ev) => {
      const btn = ev.currentTarget;
      const fallback = () => { const a = areas.find((x) => x.area.value) || areas[0]; if (a) { a.area.focus(); a.area.select(); } btn.textContent = ui('copySelected'); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text()).then(() => { btn.textContent = ui('copied'); }, fallback); else fallback(); } catch (e) { fallback(); }
    } }, p.copyLabel);
    const clear = isText(p.clearLabel) && h('button', { type: 'button', class: 'linkbtn', text: p.clearLabel, onclick: () => { areas.forEach(({ area }) => { area.value = ''; }); store.del('essay'); refresh(); } });
    refresh();
    const levels = list(p.rubricLevels);
    const hasDeadline = isText(cfg.essayDeadline) && cfg.essayDeadline !== 'PLACEHOLDER';
    return h('div', { class: 'view narrow' },
      h('header', { class: 'pagehead' }, h('h1', { tabindex: '-1' }, fillNodes(p.heading)), para(p.intro, 'lede')),
      isText(p.submitLabel) && h('section', { class: 'prizecard flat stack' }, heading(2, p.submitHeading),
        h('div', { class: 'actions' }, formButton(cfg.essayFormUrl, p.submitLabel, p.submitPending, 'essay-pending')), paras(p.submitPrivacy, 'small')),
      sections.length > 0 && h('section', { class: 'stack' }, heading(2, p.builderHeading), para(p.builderIntro), para(p.originalityNote, 'small'),
        h('div', { class: 'card essay stack' }, builder, total, h('div', { class: 'actions' }, copy, clear))),
      list(p.rubric).length > 0 && levels.length > 0 && h('section', { class: 'stack' }, heading(2, p.rubricHeading), para(p.rubricNote, 'small'),
        h('div', { class: 'tablewrap' }, h('table', { class: 'rubric' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: p.rubricCriterionLabel || '' }), levels.map((l) => h('th', { scope: 'col', text: l })))),
          h('tbody', {}, list(p.rubric).map((r) => h('tr', {}, h('th', { scope: 'row', text: r.criterion || '' }), levels.map((_, i) => h('td', { text: list(r.levels)[i] || '–' })))))))),
      list(p.rules).length > 0 && h('section', { class: 'card stack' }, heading(2, p.rulesHeading), h('ul', { class: 'ticks' }, list(p.rules).map((r) => h('li', {}, fillNodes(r)))),
        hasDeadline && para(p.deadlineLabel, 'small')));
  }

  /* ---------- view 3: UCAS and careers ---------- */

  function renderUcas() {
    const u = data.ucas;
    return h('div', { class: 'view narrow' },
      h('header', { class: 'pagehead' }, h('h1', { tabindex: '-1', text: u.heading || (data.nav || {}).ucas || '' }), para(u.intro, 'lede')),
      (isText(u.weak) || isText(u.strong)) && h('section', { class: 'stack' }, heading(2, u.statementHeading), para(u.statementIntro),
        h('div', { class: 'versus' },
          isText(u.weak) && h('figure', { class: 'card weak' }, isText(u.weakLabel) && h('figcaption', { class: 'badge', text: u.weakLabel }), h('blockquote', { text: u.weak })),
          isText(u.strong) && h('figure', { class: 'card strong' }, isText(u.strongLabel) && h('figcaption', { class: 'badge', text: u.strongLabel }), h('blockquote', { text: u.strong }))),
        list(u.statementWhy).length > 0 && h('div', { class: 'stack' }, heading(3, u.statementWhyHeading), h('ul', { class: 'ticks' }, list(u.statementWhy).map((x) => h('li', { text: x })))),
        para(u.statementWarning, 'callout')),
      list(u.comp).length > 0 && h('section', { class: 'stack' }, heading(2, u.compHeading), paras(u.comp),
        u.compLink && isUrl(u.compLink.url) && h('p', {}, linkOut(u.compLink.url, u.compLink.label || u.compLink.url, 'inline'))),
      list(u.founder).length > 0 && h('section', { class: 'stack' }, heading(2, u.founderHeading),
        h('blockquote', { class: 'founder' }, paras(u.founder), isText(u.founderSign) && h('footer', { text: u.founderSign }))));
  }

  /* ---------- view 4: for teachers ---------- */

  function renderTeachers() {
    const t = data.teachers;
    const cfg = data.config || {};
    return h('div', { class: 'view narrow' },
      h('header', { class: 'pagehead' }, h('h1', { tabindex: '-1', text: t.heading || (data.nav || {}).teachers || '' }), para(t.intro, 'lede')),
      list(t.value).length > 0 && h('section', { class: 'stack' }, heading(2, t.valueHeading), h('ul', { class: 'ticks' }, list(t.value).map((x) => h('li', { text: x })))),
      list(t.curriculum).length > 0 && h('section', { class: 'stack' }, heading(2, t.curriculumHeading),
        h('ul', { class: 'bento two' }, list(t.curriculum).map((c) => h('li', { class: 'card' },
          h('h3', {}, isUrl(c.url) ? linkOut(c.url, c.spec || c.url, 'inline') : c.spec || ''), h('ul', { class: 'ticks' }, list(c.topics).map((x) => h('li', { text: x }))))))),
      isText(t.sensitivity) && h('section', { class: 'stack' }, heading(2, t.sensitivityHeading), para(t.sensitivity)),
      isText(t.packLabel) && h('section', { class: 'card stack' }, heading(2, t.packHeading), para(t.packBody),
        h('div', { class: 'actions' }, formButton(cfg.teacherFormUrl, t.packLabel, t.packPending, 'pack-pending'),
          isUrl(cfg.teacherPackUrl) && isText(t.packDownloadLabel) && linkOut(cfg.teacherPackUrl, t.packDownloadLabel, 'btn ghost'))),
      list(t.code).length > 0 && h('section', { class: 'stack' }, heading(2, t.codeHeading), h('ol', { class: 'steps' }, list(t.code).map((x) => h('li', { text: x })))));
  }

  /* ---------- shell: tabs, notice, footer, routing ---------- */

  const TABS = ['home', 'prize', 'ucas', 'teachers'];
  const availableTabs = () => TABS.filter((id) => id === 'home' || data[id]);
  // The logo always goes back to the start of the journey.
  function toStart(ev) {
    ev.preventDefault();
    if (state.tab === 'home') { window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' }); if (location.hash) history.replaceState(null, '', location.pathname + location.search); return; }
    location.hash = '#home';
  }

  function renderNav() {
    const nav = $('tabs');
    nav.setAttribute('aria-label', ui('tabs'));
    nav.replaceChildren(
      h('a', { class: 'brand', href: '#home', onclick: toStart, text: data.meta.title || '' }),
      h('ul', {}, availableTabs().filter((id) => id !== 'home').map((id) => h('li', {}, h('a', { href: '#' + id, class: id === 'prize' ? 'tab prize' : 'tab', 'aria-current': state.tab === id ? 'page' : null, text: (data.nav || {})[id] || id })))));
  }
  function renderNotice() {
    const n = $('notice');
    if (!data.meta.PLACEHOLDER) { n.hidden = true; return; }
    n.replaceChildren(h('p', { text: data.meta.placeholderNotice || 'PLACEHOLDER' }));
    n.hidden = false;
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
      isText(f.privacy) && line(f.privacy)));
  }

  function show() {
    const key = decodeURIComponent(location.hash.replace(/^#/, ''));
    const section = { poll: 1, lab: 2, guided: 2, solo: 3 }[key] || null;
    const tab = availableTabs().includes(key) ? key : 'home';
    const first = state.tab === '';
    const changed = tab !== state.tab;
    state.tab = tab;
    main.dataset.tab = tab;
    if (changed) main.replaceChildren(tab === 'prize' ? renderPrize() : tab === 'ucas' ? renderUcas() : tab === 'teachers' ? renderTeachers() : renderHome());
    renderNav();
    document.title = [tab === 'home' ? '' : (data.nav || {})[tab], data.meta.title].filter(isText).join(' — ');
    if (section && tab === 'home') { requestAnimationFrame(() => goStage(section)); return; }
    if (first) return;
    if (!changed && tab === 'home') return;
    window.scrollTo(0, 0);
    const h1 = main.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });
  }

  function fail(message) {
    main.replaceChildren(h('div', { class: 'view narrow' }, h('h1', { text: UI.loadFailTitle }), h('p', { class: 'lede', text: message }), h('p', { text: UI.loadFailHelp })));
  }

  async function start() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${DATA_URL}: ${res.status}`);
      data = await res.json();
      if (!data || typeof data !== 'object') throw new Error(DATA_URL);
      data.meta = data.meta || {};
      Object.keys(COPY).forEach((k) => { if (data[k]) data[k] = merge(data[k], COPY[k]); });
    } catch (err) {
      data = null;
      fail(err && err.message ? err.message : DATA_URL);
      return;
    }
    const saved = store.get('poll');
    if (saved && saved.answers && isNum(saved.score)) { state.poll.submitted = saved; state.poll.classCode = saved.classCode || ''; }
    renderNotice();
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
