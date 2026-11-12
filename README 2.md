# Alzheimer's Explorer

A small site that walks a 17-year-old through a whole research project on brain-cell data: where the data comes from, how cells are sorted into types, how to compare people with and without dementia, and how to write up the result. It is the hands-on core of the free school workshop "Could you spot Alzheimer's?".

> **Status: pilot with placeholder data.** Every number and every sentence of subject content in `data/seaad-mtg.json` is fake. The site shows a banner saying so until `meta.PLACEHOLDER` is removed from that file. Leave it in place until the checklist below is finished.

## The journey

| Screen | Address | What it does |
|---|---|---|
| Opening | `#start` (and the bare address) | The question, the four steps, one Start button |
| 1. Data | `#data` | Where the data comes from: short text, figure cards, one picture |
| 2. Mapping | `#mapping` | A map of cells the site draws itself. Dots start as a grey jumble and sort into coloured types |
| 3. Analysis | `#top` | One chart: every cell type, both groups, one dot per person |
| Cell type | `#cell-<id>` | The same chart enlarged, the numbers in words, the statistics, the limits |
| Genes (optional) | `#gene-<id>-<symbol>` | The extension task. Not part of the main path |
| 4. Write-up | `#writeup`, `#writeup-<id>` | A short passage with gaps. Choose the right words to finish it |
| Challenge | `#challenge` | The 200-word question, a link out to the entry form, and later the winner |

A bar across the top shows the four steps. Every step can be opened at any time; nothing is locked.

## Everything is in one file

Every heading, sentence, number, unit, colour and address on the site is read from `data/seaad-mtg.json`. To finish the site you edit that file and replace three pictures. You never need to touch the code.

- **Leave a field out and its part of the page disappears.** Leave a whole screen out (`stages.mapping`, say) and the journey skips it.
- **Sentences can quote live values** with tokens such as `{{differenceWithUnit}}`, so the text can never disagree with the chart. A mistyped token shows on the page, highlighted, exactly as you typed it.
- **Every number needs a unit.** If one is missing the page prints `[unit missing]` beside the number rather than hiding the gap.

Tokens you can use in any sentence: `cellLabel`, `cellLabelLower`, `measureLabel`, `unit`, `higherMeans`, `difference`, `differenceWithUnit`, `direction`, `cohensD`, `effectSize`, `meanNormal`, `meanDementia`, `nNormal`, `nDementia`, `nTotal`, `nUnit`, `genesChanged`, `region`, `regionPlain`, `donorTotal`, `cellsTotal`, `groupNormal`, `groupDementia`, `groupNormalShort`, `groupDementiaShort`, `wordLimit`, `deadline`. On the gene screen only: `geneSymbol`, `geneChange`, `geneMeasureLabel`, `geneUnit`. The write-up must not use the gene tokens; the checker stops you.

After every edit, run the checker:

```
python3 notebook/validate_contract.py data/seaad-mtg.json
```

## What is left to fill in

- [ ] `meta` — the real dataset name, region, citation, licence and date
- [ ] `meta.donorTotal`, `meta.cellsTotal`, `stages.*.figures` — totals from the notebook
- [ ] `intro` — the opening screen's wording (written, needs your read-through)
- [ ] `stages.data`, `stages.mapping` — the text for screens 1 and 2 (subject expert)
- [ ] `map.points` — about 3,000 cells sampled from the real map, as `{"<cell type id>": [[x, y], …]}`
- [ ] `measure` — the measure, its unit, rounding and caveats
- [ ] `cellTypes[]` — labels, roles, colours, values, effects, caveats
- [ ] `cellScreen`, `stats`, `geneScreen`, `geneMeasure`, `footer` — the teaching sentences that used to be in the code (written, need your read-through); `geneMeasure.unit` is still a placeholder
- [ ] `writeUp.shared.parts` — the passage and its gaps (subject expert)
- [ ] `cellTypes[].writeUp` — optional: a passage of its own for any cell type
- [ ] `cellTypes[].topGenes` — genes from the notebook, with a subject expert's notes
- [ ] `challenge` — the question, criteria, judging and privacy wording
- [ ] `config` — the form address, short link and deadline, once the Google form exists
- [ ] `config.winnerAnnounced` and `challenge.winner` — after judging: set the flag to `true` and paste the winner in
- [ ] `assets/images/` — a tissue picture, a real QR code, and a still of the map (used only if `map.points` is missing)
- [ ] `LICENCE` — paste in the full CC BY-NC 4.0 text
- [ ] Remove `meta.PLACEHOLDER` last. That takes the banner down.

**Swapping a picture:** save the new file over the old one with the same name, or put the new name in the `src` field in the data file. PNG and JPG work as well as SVG. Nothing else to do: the site fetches every picture named in the data file so it is ready offline.

**The write-up passage** is a list of parts. A part is `{"type": "text", "text": "…"}`, `{"type": "break"}` for a new paragraph, or a gap:

```json
{ "type": "blank", "id": "b1", "options": ["first", "second", "third"], "correct": 1,
  "feedback": { "right": "Shown when they get it.", "wrong": "Shown when they do not." } }
```

`correct` counts from 0, so `1` means the second option. Two to four options per gap; as many gaps as you like.

## Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from the folder will not work, because browsers block the page from reading the data file that way.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository.
2. Repository → Settings → Pages → Source: "Deploy from a branch" → `main`, folder `/ (root)` → Save.
3. The site appears at `https://<your-username>.github.io/<repo-name>/` after a minute or two.

There is no build step. `.nojekyll` tells Pages to serve the files exactly as they are.

## Promises this site keeps

- **Collects nothing.** No forms, cookies, analytics or storage. Progress lives in memory and is gone on reload. The challenge entry form is a link out to Google, and the page says so before the button.
- **Works offline.** After the first visit the whole site is cached on the device (the site's own files only). Only the entry form needs a connection.
- **Honest charts.** Every axis starts at zero. Effect size is the headline; p-values are donor-level and stay inside the statistics drawer.
- **No bare numbers.** Every figure carries its unit, or says it has none.
- **Nothing locked.** Every gap in the write-up has "Show me the answer".
- **No invented science.** The site renders the data file's text exactly as written, placeholders included.

## Files

```
index.html                     the page shell
assets/app.css                 styles, light and dark
assets/app.js                  all behaviour; no dependencies; no subject content
assets/fonts/                  Atkinson Hyperlegible Next and Bricolage Grotesque (SIL Open Font License)
assets/images/                 three placeholder pictures
data/seaad-mtg.json            everything the site says: placeholder now, real later
notebook/build_data.ipynb      outline of the analysis that will produce the data
notebook/validate_contract.py  checks the data file before it is published
sw.js                          offline support
```

## Before entries open

The entry form will collect names from students, most of them under 18. That is personal data under UK GDPR and it is the organiser's responsibility. Ask for as little as possible (first name and school), say who sees the entries and how long they are kept, and consider having teachers send entries in. The ICO's guidance on children's data is the place to check. This note is not legal advice.

## Credits and licence

Data: Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science; Gabitto et al. (2024), Nature Neuroscience. Used under the Allen Institute Terms of Use for non-commercial purposes.

Site and teaching materials: CC BY-NC 4.0, see `LICENCE`. Fonts: SIL Open Font License 1.1, see `assets/fonts/`.
