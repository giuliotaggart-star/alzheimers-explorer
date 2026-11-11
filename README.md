# Alzheimer's Explorer

A single-page site that lets a 17-year-old discover what is different about the brain of someone with dementia, and learn how to judge whether a difference is real. It is the hands-on core of the free school workshop "Could you spot Alzheimer's?".

> **Status: pilot with placeholder data.** Every number and every sentence of subject content currently in `data/seaad-mtg.json` is fake. The page shows a banner saying so until `meta.PLACEHOLDER` is removed from that file.

## How it works

- **Level 0** — one chart: every cell type, people with and without dementia, one small dot per person.
- **Level 1** — one cell type: the same chart enlarged, the numbers in words, the statistics, and an interpretation revealed by answering questions about the chart.
- **Level 2** — one gene: how much it changes, and where else it is switched on.

Everything on screen is read from `data/seaad-mtg.json`. Replacing that file replaces the content; no code changes.

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

## Swap in real data

1. Produce a new `data/seaad-mtg.json` from `notebook/build_data.ipynb`.
2. Check it: `python3 notebook/validate_contract.py data/seaad-mtg.json`
3. Commit. If you change any other file as well, bump `CACHE` in `sw.js` so returning visitors get the new version.

## Promises this page keeps

- **Collects nothing.** No forms, cookies, analytics or storage. Quiz progress lives in memory and is gone on reload.
- **Works offline.** After the first visit the whole site is cached on the device (the site's own files only).
- **Honest charts.** Every axis starts at zero. Effect size is the headline; p-values are donor-level and stay inside the statistics drawer.
- **No invented science.** The page renders the data file's text verbatim, placeholders included.

## Files

```
index.html                  the page shell
assets/app.css              styles, light and dark
assets/app.js               all behaviour; no dependencies
assets/fonts/               Atkinson Hyperlegible Next and Bricolage Grotesque (SIL Open Font License)
data/seaad-mtg.json         the data contract: placeholder now, real later
notebook/build_data.ipynb   outline of the analysis that will produce the data
notebook/validate_contract.py  checks a data file before it is published
sw.js                       offline support
```

## Credits and licence

Data: Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science; Gabitto et al. (2024), Nature Neuroscience. Used under the Allen Institute Terms of Use for non-commercial purposes.

Site and teaching materials: CC BY-NC 4.0, see `LICENCE`. Fonts: SIL Open Font License 1.1, see `assets/fonts/`.
