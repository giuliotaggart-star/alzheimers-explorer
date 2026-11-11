/* Alzheimer's Explorer — all behaviour.
   Every number and every piece of subject content on screen is read from data/seaad-mtg.json.
   Nothing about the visitor is stored: quiz progress lives in memory and is gone on reload. */
(() => {
  'use strict';

  const DATA_URL = 'data/seaad-mtg.json';
  const MAX_QUESTIONS = 3;
  const MAX_GENES = 5;
  const GROUPS = [
    { key: 'normal', cls: 'a', label: 'People without dementia', short: 'without dementia' },
    { key: 'dementia', cls: 'b', label: 'People with dementia', short: 'with dementia' },
  ];

  const main = document.getElementById('main');
  const crumbs = document.getElementById('crumbs');
  const notice = document.getElementById('notice');
  const credits = document.getElementById('credits');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let data = null;
  let routes = new Map();          // hash -> { cell, gene }
  let current = { level: -1, cell: null, gene: null };
  const progress = new Map();      // cell id -> { answered: Set of question ids, tried: Map(question id -> Set of option ids) }
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
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
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
  const slug = (v) => String(v).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function fmt(v, digits = 1) {
    if (!isNum(v)) return '';
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(v);
  }

  // "7.6% of all cells" rather than "7.6 % of all cells"
  function withUnit(v, unit, digits = 1) {
    if (!unit) return fmt(v, digits);
    return fmt(v, digits) + (/^[%°]/.test(unit) ? '' : ' ') + unit;
  }

  function fmtP(p) {
    if (!isNum(p)) return '';
    if (p < 0.001) return 'less than 0.001';
    return new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 2 }).format(p);
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
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

  function extentOf(item) {
    let max = 0;
    for (const g of GROUPS) {
      const v = groupOf(item, g.key);
      for (const d of donorsOf(v)) max = Math.max(max, d);
      if (isNum(v.mean)) max = Math.max(max, v.mean + (isNum(v.sd) ? v.sd : 0));
    }
    return max;
  }

  function totalDonors() {
    const d = (data.meta && data.meta.donors) || {};
    const n = GROUPS.reduce((sum, g) => sum + (isNum(d[g.key]) ? d[g.key] : 0), 0);
    return n > 0 ? n : null;
  }

  /* ---------- the dumbbell: used at every level so the picture never changes ---------- */

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
      const label = i === axis.ticks.length - 1 && unit && /^[%°]/.test(unit) ? fmt(t, 2) + unit.charAt(0) : fmt(t, 2);
      ticks.append(h('span', { style: `left:${xPct(t, axis)}%`, text: label }));
    });
    return ticks;
  }

  function legend() {
    return h('p', { class: 'legend' },
      GROUPS.map((g) => h('span', {}, h('span', { class: 'swatch ' + g.cls, 'aria-hidden': 'true' }), g.label)));
  }

  /* ---------- level 0: one chart ---------- */

  function sharedAxis() {
    return niceAxis(Math.max(...data.cellTypes.map(extentOf)));
  }

  function sortedCells() {
    return [...data.cellTypes].sort((p, q) => Math.abs(diffOf(q)) - Math.abs(diffOf(p)));
  }

  function rowReadout(cell) {
    const m = data.measure || {};
    const a = groupOf(cell, 'normal');
    const b = groupOf(cell, 'dementia');
    const n = (isNum(a.n) ? a.n : 0) + (isNum(b.n) ? b.n : 0);
    const parts = [];
    if (isNum(a.mean) && isNum(b.mean)) parts.push(`${fmt(a.mean)} without, ${withUnit(b.mean, m.unit)} with`);
    if (n > 0) parts.push(`${n} people`);
    return parts.join(' · ');
  }

  function renderChart(heroId) {
    const m = data.measure || {};
    const meta = data.meta || {};
    const cells = sortedCells();
    const axis = sharedAxis();
    const anyDonors = cells.some(hasDonors);
    const people = totalDonors();

    const list = h('ul', { class: 'chart' });
    list.append(h('li', { class: 'axis' },
      h('span', { class: 'axis-title', text: [m.label, m.unit].filter(Boolean).join(' — ') }),
      buildTicks(axis, m.unit), h('span', {})));

    cells.forEach((cell) => {
      const track = h('span', { class: 'track' }, buildTrack(cell, axis, 'small'));
      if (cell.id === heroId) track.style.viewTransitionName = 'hero';
      const readout = rowReadout(cell);
      list.append(h('li', {},
        h('a', { class: 'row', href: '#' + routeFor(cell), 'data-cell': cell.id, 'aria-label': [cell.label, cell.shortRole, readout].filter(Boolean).join('. ') },
          h('span', { class: 'rowlabel' },
            h('span', { class: 'name', text: cell.label }),
            cell.shortRole && h('span', { class: 'role', text: cell.shortRole }),
            readout && h('span', { class: 'readout', text: readout })),
          track,
          h('span', { class: 'go', 'aria-hidden': 'true', text: '›' }))));
    });

    const where = [people && `${people} people’s brains`, meta.regionPlain ? `from one region: ${meta.regionPlain}` : meta.region && `from one region, the ${meta.region}`]
      .filter(Boolean).join(', ');
    const allSmall = cells.length > 0 && cells.every((c) => (c.effect || {}).plainSize === 'small');

    return h('section', { class: 'view' },
      h('h1', { tabindex: '-1', text: 'Which brain cells change in dementia?' }),
      where && h('p', { class: 'lede', text: where + '.' }),
      legend(),
      list,
      anyDonors && h('p', { class: 'caption', text: 'Each small dot is one person. The big dots are the averages.' }),
      allSmall && h('p', { class: 'finding', text: 'None of these differences is large — which is itself a finding.' }));
  }

  /* ---------- level 1: one cell type ---------- */

  function numbersInWords(cell) {
    const m = data.measure || {};
    const a = groupOf(cell, 'normal');
    const b = groupOf(cell, 'dementia');
    const e = cell.effect || {};
    const out = [];
    if (m.plainQuestion) out.push(h('p', { class: 'kicker', text: m.plainQuestion }));
    if (isNum(a.mean) && isNum(b.mean)) {
      out.push(h('p', { class: 'bignum' },
        'On average, ', h('b', { class: 'gb', text: withUnit(b.mean, m.unit) }), ' in people with dementia, compared with ',
        h('b', { class: 'ga', text: withUnit(a.mean, m.unit) }), ' in people without.'));
    }
    let verdict = '';
    if (e.direction === 'none') verdict = 'The two groups are about the same.';
    else if (e.plainSize) {
      const dir = e.direction === 'up' ? 'higher' : e.direction === 'down' ? 'lower' : '';
      verdict = `That is a ${e.plainSize} difference` + (dir ? `: ${dir} in people with dementia.` : '.');
    }
    if (verdict) {
      const meaning = m.higherMeans && e.direction !== 'none' ? ` Higher means ${m.higherMeans}.` : '';
      out.push(h('p', { class: 'verdict', text: verdict + meaning }));
    }
    if (cell.storyRole === 'stable') {
      out.push(h('p', { class: 'caption', text: 'This one barely changes — and a row that stays flat is a result too.' }));
    }
    return out;
  }

  function statsDrawer(cell) {
    const m = data.measure || {};
    const meta = data.meta || {};
    const e = cell.effect || {};
    const rows = GROUPS.map((g) => {
      const v = groupOf(cell, g.key);
      return h('tr', {},
        h('th', { scope: 'row', text: g.label }),
        h('td', { class: 'num', text: isNum(v.n) ? String(v.n) : '' }),
        h('td', { class: 'num', text: fmt(v.mean, 2) }),
        h('td', { class: 'num', text: fmt(v.sd, 2) }));
    });
    const facts = h('dl', { class: 'block' });
    const fact = (term, value, note) => {
      if (!value) return;
      facts.append(h('div', {}, h('dt', {}, h('b', { text: term })), h('dd', {}, value, note && h('span', { class: 'small', text: ' ' + note }))));
    };
    fact('Difference between the averages', isNum(e.difference) ? withUnit(e.difference, m.unit, 2) : '', '(dementia minus no dementia)');
    fact('Effect size (Cohen’s d)', isNum(e.cohensD) ? fmt(e.cohensD, 2) + (e.plainSize ? ` — ${e.plainSize}` : '') : '',
      'How many “spreads” apart the two averages are. This is the number to trust first.');
    fact('p-value, comparing people not cells', fmtP(e.pAdjusted),
      'Roughly how often a gap at least this big would turn up by chance if there were really no difference. It does not tell you the difference is important.');

    const people = totalDonors();
    const why = isNum(meta.cellsTotal) && people
      ? `Why people, not cells? This study measured ${fmt(meta.cellsTotal, 0)} cells, but they came from ${people} people. Cells from one person are alike, so counting every cell as separate evidence would make almost any difference look certain. The honest sample size is the number of people.`
      : '';

    return h('details', { class: 'drawer' },
      h('summary', { text: 'Show me the actual statistics' }),
      h('div', { class: 'drawer-body' },
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', text: 'Group' }),
            h('th', { scope: 'col', class: 'num', text: 'People' }),
            h('th', { scope: 'col', class: 'num', text: 'Average' }),
            h('th', { scope: 'col', class: 'num', text: 'Spread (standard deviation)' }))),
          h('tbody', {}, rows))),
        m.unit && h('p', { class: 'small', text: `Averages and spreads are in ${m.unit}.` }),
        facts,
        meta.methodPlain && h('p', {}, h('b', { text: 'How it was worked out. ' }), meta.methodPlain),
        why && h('p', { text: why }),
        isNum(cell.genesChanged) && h('p', { class: 'small', text: `Genes whose activity changed in this cell type: ${fmt(cell.genesChanged, 0)}.` })));
  }

  function caveatsBlock() {
    const list = ((data.meta || {}).caveats || []).filter(Boolean);
    if (!list.length) return null;
    return h('section', { class: 'caveats' },
      h('h2', { text: 'What this cannot tell you' }),
      h('ul', {}, list.map((c) => h('li', { text: c }))));
  }

  function stateFor(cell) {
    if (!progress.has(cell.id)) progress.set(cell.id, { answered: new Set(), tried: new Map() });
    return progress.get(cell.id);
  }

  // The interpretation arrives in chunks. A correct answer, or "Show me the answer", reveals the next one.
  function renderThread(cell, host, fresh) {
    const chunks = (cell.interpretation || []).filter((c) => c && c.text);
    const questions = (cell.questions || []).filter((q) => q && q.prompt && Array.isArray(q.options)).slice(0, MAX_QUESTIONS);
    const st = stateFor(cell);
    const chunkById = new Map(chunks.map((c) => [c.id, c]));
    const shown = new Set();
    host.replaceChildren();

    const chunkNode = (c) => {
      shown.add(c.id);
      return h('p', { class: 'chunk' + (fresh === c.id ? ' fresh' : ''), tabindex: '-1', 'data-chunk': c.id, text: c.text });
    };

    let open = null;
    for (const q of questions) {
      if (!st.answered.has(q.id)) { open = q; break; }
      const right = q.options.find((o) => o.id === q.correct);
      const why = (q.feedback || {})[q.correct];
      const unlocked = chunkById.get(q.unlocks);
      host.append(h('div', { class: 'qa' },
        h('p', { class: 'answered' }, q.prompt + ' ', right && h('span', { class: 'picked', text: right.text + '.' }), why && h('span', { class: 'why', text: ' ' + why })),
        unlocked && !shown.has(unlocked.id) && chunkNode(unlocked)));
    }

    if (open) {
      const tried = st.tried.get(open.id) || new Set();
      const feedback = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
      const reveal = () => {
        st.answered.add(open.id);
        renderThread(cell, host, open.unlocks);
        const target = host.querySelector('.chunk.fresh') || host.querySelector('.qcard .option') || host;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      };
      const options = open.options.map((o) => h('button', {
        type: 'button', class: 'option' + (tried.has(o.id) ? ' tried' : ''), text: o.text,
        onclick: (ev) => {
          if (o.id === open.correct) { reveal(); return; }
          tried.add(o.id);
          st.tried.set(open.id, tried);
          ev.currentTarget.classList.add('tried');
          feedback.textContent = (open.feedback || {})[o.id] || 'Have another look at the chart, then try again.';
        },
      }));
      const index = questions.indexOf(open) + 1;
      host.append(h('div', { class: 'qcard' },
        h('p', { class: 'progress', text: `Question ${index} of ${questions.length}` }),
        h('p', { class: 'qprompt', text: open.prompt }),
        h('div', { class: 'options' }, options),
        feedback,
        h('button', { type: 'button', class: 'showme', text: 'Show me the answer', onclick: reveal })));
    } else {
      // every question is done (or there were none): nothing stays hidden
      chunks.filter((c) => !shown.has(c.id)).forEach((c) => host.append(chunkNode(c)));
    }
  }

  function geneChangeWords(gene) {
    const a = groupOf(gene, 'normal').mean;
    const b = groupOf(gene, 'dementia').mean;
    if (!isNum(a) || !isNum(b) || a <= 0) return '';
    const r = b / a;
    if (r >= 0.9 && r <= 1.1) return 'about the same';
    if (r > 1) {
      if (r < 1.35) return 'a little more';
      if (r < 1.75) return 'about one and a half times as much';
      if (r < 2.5) return 'about twice as much';
      return `about ${fmt(Math.round(r), 0)} times as much`;
    }
    if (r > 0.8) return 'a little less';
    if (r > 0.58) return 'about two-thirds as much';
    if (r > 0.4) return 'about half as much';
    if (r > 0.29) return 'about a third as much';
    return 'much less';
  }

  function renderCell(cell) {
    const m = data.measure || {};
    const axis = sharedAxis();   // same axis as level 0, so this reads as a zoom and not a new chart
    const track = h('div', { class: 'track' }, buildTrack(cell, axis, 'big'));
    track.style.viewTransitionName = 'hero';

    const hasThread = (cell.interpretation || []).length > 0;
    const thread = h('div', { class: 'thread' });
    if (hasThread) renderThread(cell, thread, null);

    const genes = (cell.topGenes || []).filter((g) => g && g.symbol).slice(0, MAX_GENES);

    return h('section', { class: 'view' },
      h('div', { class: 'prose' },
        h('h1', { tabindex: '-1', text: cell.label }),
        cell.role && h('p', { class: 'lede', text: cell.role })),
      h('figure', { class: 'hero' },
        legend(),
        h('div', { class: 'axis' }, buildTicks(axis, m.unit)),
        track,
        h('figcaption', { class: 'small', text: [m.label, m.unit].filter(Boolean).join(' — ') + (hasDonors(cell) ? '. Each small dot is one person; the big dots are the averages.' : '.') })),
      hasDonors(cell) && h('p', { class: 'caption', text: 'Ask yourself: is the gap between the two big dots bigger than the scatter of the small ones? If it is, the difference is more likely to be real.' }),
      h('div', { class: 'block' }, numbersInWords(cell)),
      statsDrawer(cell),
      caveatsBlock(),
      hasThread && h('section', { class: 'block' }, h('h2', { text: 'What might this mean?' }), thread),
      genes.length > 0 && h('section', { class: 'block' },
        h('h2', { text: 'Genes that changed most in these cells' }),
        h('div', { class: 'genes' }, genes.map((g) => {
          const words = geneChangeWords(g);
          return h('a', { class: 'gene', href: '#' + routeFor(cell, g) },
            h('span', { class: 'sym', text: g.symbol }),
            g.name && h('span', { class: 'gname', text: g.name }),
            words && h('span', { class: 'gchange', text: words + ' in dementia' }));
        }))));
  }

  /* ---------- level 2: one gene ---------- */

  function renderGene(cell, gene) {
    const axis = niceAxis(extentOf(gene));
    const words = geneChangeWords(gene);
    const a = groupOf(gene, 'normal');
    const b = groupOf(gene, 'dementia');

    const cellLabel = (idOrName) => {
      const hit = data.cellTypes.find((c) => c.id === idOrName || c.label === idOrName);
      return hit ? hit.label : String(idOrName);
    };
    const elsewhere = (gene.alsoExpressedIn || []).filter((x) => x && isNum(x.mean));
    let bars = null;
    if (elsewhere.length) {
      const here = isNum(a.mean) ? [{ label: cell.label + ' (this cell type)', mean: a.mean, current: true }] : [];
      const all = here.concat(elsewhere.map((x) => ({ label: cellLabel(x.cellType), mean: x.mean })));
      const barAxis = niceAxis(Math.max(...all.map((x) => x.mean)));
      const u = unitScale();
      bars = h('section', { class: 'block' },
        h('h2', { text: 'Where else is this gene switched on?' }),
        h('p', { class: 'caption', text: 'The same gene in other cell types. Every cell carries the same DNA, but each type uses a different set of genes.' }),
        h('div', { class: 'bars' }, all.map((x) => {
          const svg = s('svg', { height: 18 * u, 'aria-hidden': 'true', focusable: 'false' });
          svg.append(s('rect', { class: 'bar' + (x.current ? ' current' : ''), x: 0, y: 2 * u, height: 14 * u, rx: 3 * u, width: Math.max(0.5, (x.mean / barAxis.max) * 100) + '%' }));
          return h('div', { class: 'barrow' + (x.current ? ' current' : '') },
            h('span', { text: x.label }), svg, h('span', { class: 'val', text: fmt(x.mean, 2) }));
        })),
        h('p', { class: 'small', text: 'Average activity level of the gene. Bars start at zero.' + (here.length ? ' The bar for this cell type uses people without dementia.' : '') }));
    }

    const technical = [];
    if (isNum(gene.log2FC)) technical.push(['Fold change (log2)', fmt(gene.log2FC, 2), 'One step up means double; one step down means half.']);
    if (isNum(gene.pAdjusted)) technical.push(['p-value, comparing people not cells', fmtP(gene.pAdjusted), 'Never the headline: read the size of the change first.']);
    GROUPS.forEach((g) => {
      const v = groupOf(gene, g.key);
      if (isNum(v.mean)) technical.push([g.label, `average ${fmt(v.mean, 2)}` + (isNum(v.sd) ? `, spread ${fmt(v.sd, 2)}` : ''), '']);
    });

    return h('section', { class: 'view' },
      h('div', { class: 'prose' },
        h('p', { class: 'kicker', text: 'A gene in ' + cell.label.toLowerCase() }),
        h('h1', { tabindex: '-1', text: gene.symbol }),
        gene.name && h('p', { class: 'small', text: gene.name }),
        gene.plainRole && h('p', { class: 'lede', text: gene.plainRole })),
      isNum(a.mean) && isNum(b.mean) && h('figure', { class: 'hero' },
        legend(),
        h('div', { class: 'axis' }, buildTicks(axis, '')),
        h('div', { class: 'track' }, buildTrack(gene, axis, 'big')),
        h('figcaption', { class: 'small', text: 'Average activity level of this gene in ' + cell.label.toLowerCase() + '. The big dots are the averages; the bars show the spread between people.' })),
      words && h('p', { class: 'verdict', text: `In people with dementia these cells make ${words}${words === 'about the same' ? '' : ' of this gene’s message'}.` }),
      gene.note && h('p', { class: 'prose', text: gene.note }),
      technical.length > 0 && h('details', { class: 'drawer' },
        h('summary', { text: 'Show me the technical figures' }),
        h('div', { class: 'drawer-body' }, h('dl', { class: 'block' },
          technical.map(([term, value, note]) => h('div', {}, h('dt', {}, h('b', { text: term })), h('dd', {}, value, note && h('span', { class: 'small', text: ' ' + note }))))))),
      bars,
      caveatsBlock());
  }

  /* ---------- routing: plain #names, so links can be shared and Back works ---------- */

  function routeFor(cell, gene) {
    return gene ? `gene-${slug(cell.id)}-${slug(gene.symbol)}` : `cell-${slug(cell.id)}`;
  }

  function buildRoutes() {
    routes = new Map();
    data.cellTypes.forEach((cell) => {
      routes.set(routeFor(cell), { cell, gene: null });
      (cell.topGenes || []).slice(0, MAX_GENES).forEach((gene) => {
        if (gene && gene.symbol) routes.set(routeFor(cell, gene), { cell, gene });
      });
    });
  }

  function renderCrumbs(target) {
    crumbs.replaceChildren();
    if (!target.cell) {
      crumbs.append(h('span', { class: 'site', text: 'Brain cells and dementia' }));
      return;
    }
    crumbs.append(h('a', { href: '#top', text: '← All cell types' }));
    if (target.gene) {
      crumbs.append(h('a', { class: 'secondary', href: '#' + routeFor(target.cell), text: target.cell.label }));
      crumbs.append(h('span', { class: 'here', 'aria-current': 'page', text: target.gene.symbol }));
    } else {
      crumbs.append(h('span', { class: 'here', 'aria-current': 'page', text: target.cell.label }));
    }
  }

  function show() {
    const key = decodeURIComponent(location.hash.replace(/^#/, ''));
    const target = routes.get(key) || { cell: null, gene: null };
    const level = target.gene ? 2 : target.cell ? 1 : 0;
    const previous = current;

    const paint = () => {
      const heroId = level === 0 && previous.cell ? previous.cell.id : null;
      const view = level === 2 ? renderGene(target.cell, target.gene) : level === 1 ? renderCell(target.cell) : renderChart(heroId);
      main.replaceChildren(view);
      renderCrumbs(target);
      document.title = (level === 2 ? `${target.gene.symbol} in ${target.cell.label}` : level === 1 ? target.cell.label : 'Which brain cells change in dementia?') + ' — Brain cells and dementia';
      current = { level, cell: target.cell, gene: target.gene };

      if (firstRender) { firstRender = false; return; }
      if (level === 0 && previous.cell) {
        const row = main.querySelector(`a.row[data-cell="${CSS.escape(previous.cell.id)}"]`);
        if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'center' }); return; }
      }
      window.scrollTo(0, 0);
      const heading = main.querySelector('h1');
      if (heading) heading.focus({ preventScroll: true });
    };

    // Going from the chart into a row: name that row so it visibly opens rather than being replaced.
    if (previous.level === 0 && level === 1) {
      const row = main.querySelector(`a.row[data-cell="${CSS.escape(target.cell.id)}"] .track`);
      if (row) row.style.viewTransitionName = 'hero';
    }
    if (!firstRender && document.startViewTransition && !reducedMotion.matches) document.startViewTransition(paint);
    else paint();
  }

  /* ---------- page furniture ---------- */

  function renderNotice() {
    const meta = data.meta || {};
    if (!meta.PLACEHOLDER) { notice.hidden = true; return; }
    notice.replaceChildren(h('p', { text: meta.placeholderWarning || 'PLACEHOLDER DATA: nothing on this page is a real finding yet.' }));
    notice.hidden = false;
  }

  function renderCredits() {
    const meta = data.meta || {};
    const line = (...kids) => h('p', {}, kids);
    const link = (text, url) => (url ? h('a', { href: url, rel: 'noopener', text }) : text);
    credits.replaceChildren(h('div', {},
      line('Data: ', [meta.source, meta.dataset].filter(Boolean).join(' — '), meta.citation ? '. ' : '', meta.citation && link(meta.citation, meta.citationUrl), '.'),
      meta.licence && line('Data licence: ', link(meta.licence, meta.licenceUrl), '.'),
      meta.generated && line('Figures as of ', fmtDate(meta.generated), '.'),
      meta.note && line(meta.note),
      line('This page stores nothing about you: no sign-up, no cookies, no tracking.')));
  }

  function fail(message) {
    main.replaceChildren(h('section', { class: 'view' },
      h('h1', { text: 'The data did not load' }),
      h('p', { class: 'lede', text: message }),
      h('p', { text: 'If you opened this page straight from a folder, serve the folder instead: run “python3 -m http.server” in it and open http://localhost:8000.' })));
  }

  async function start() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The data file answered with status ${res.status}.`);
      data = await res.json();
      if (!data || !Array.isArray(data.cellTypes) || data.cellTypes.length === 0) throw new Error('The data file has no cell types in it.');
    } catch (err) {
      fail(err && err.message ? err.message : 'Something went wrong reading the data file.');
      return;
    }
    buildRoutes();
    renderNotice();
    renderCredits();
    show();
    window.addEventListener('hashchange', show);
    let resizeTimer = null;
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;   // ignore mobile address-bar height changes
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (current.level === 0) main.replaceChildren(renderChart(null)); }, 200);
    });
  }

  // Offline support: the site's own files are cached so the page still opens with no network.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  start();
})();
