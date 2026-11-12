# AlzExplore

Practice a university Alzheimer's research project. An interactive site that takes UK A-level Biology students from a warm-up poll, through guided simulations on donor-level brain-cell data, to their own question and an optional essay prize. It is the hands-on core of the free school workshop "Could you spot Alzheimer's?".

> **Status: built on placeholder data.** Every number in `data/seaad-mtg.json` is made up, and text marked `PLACEHOLDER` is waiting for a subject expert. The site shows a banner saying so until `meta.PLACEHOLDER` is removed. Leave it there until the checklist below is done.

## What is on the site

| Tab | Address | What it does |
|---|---|---|
| Home journey | `#home` (also `#poll`, `#lab`) | Hero, the six-statement warm-up poll, then the Data Lab |
| £50 essay prize | `#prize` | Rules, a claim–evidence–reasoning essay builder with word counts, a link out to the entry form, the marking rubric |
| UCAS & careers | `#ucas` | Weak vs strong project sentence, what computational biology is, a founder's note |
| For teachers | `#teachers` | What the lesson needs, AQA and OCR links, the teacher-pack request, how class codes work |

**The Data Lab** has two stages. *Guided simulations*: five case studies, each in four steps (predict, observe, stress-test confounders, takeaway). *Solo Explore*: three launchpads and a "Show me how … changes across … in …" sentence builder, with a downloadable snapshot card. Every chart is one dot per donor with an optional median and interquartile-range overlay, and every chart exports as a PNG. A switch swaps research terms for A-level terms everywhere.

## Everything is in one file

Every sentence, number, unit, colour and address is read from `data/seaad-mtg.json`. To finish or change the site you edit that file; you do not touch the code. Leave a field out and its part of the page disappears; leave a whole section out (`prize`, say) and its tab disappears.

Sentences can quote live values with tokens such as `{{medianFirst}}`. A mistyped token shows on the page, highlighted. Every number needs a unit: if one is missing the page prints `[unit missing]`.

After every edit:

```
python3 notebook/validate_contract.py data/seaad-mtg.json
```

### The data the lab needs

| Key | What it holds |
|---|---|
| `donors[]` | One record per donor: `id`, plus whatever the groupings and confounders use (`adnc`, `braak`, `cognitive`, `age`, `sex`, `apoe4`). No names, no dates of birth |
| `groupings[]` | What donors can be split across: `key` (a donor field), `label`, `plainLabel`, `order` |
| `confounders[]` | What step 3 can stratify by: `key`, `label`, optional `bins` for numbers such as age |
| `cellTypes[]`, `metrics[]` | Labels, A-level labels, colours; each metric has a `unit` and `decimals` |
| `series[]` | The numbers: `{metric, cellType, values}` where `values` lines up one to one with `donors` |
| `caseStudies[]` | The five simulations: which series, which grouping, the prediction question, the takeaway passage |
| `map.points` | About 3,000 cells for the sorting map, as `{"<cell type id>": [[x, y], …]}` |

## What is left to fill in

- [ ] Run the real analysis and replace `donors`, `series`, `map.points` (see `notebook/README.md`)
- [ ] `metrics[].unit` for gene activity (still "PLACEHOLDER units")
- [ ] `poll.items[].benchmark`: check each percentage against the results table in Hassan et al. (2026); then tidy `poll.benchmarkSource`
- [ ] `poll.decoders[1]`: one expert sentence on selective vulnerability
- [ ] `lab.originBody`, map captions, launchpad blurbs
- [ ] `caseStudies[]`: each brief, each takeaway passage, model claim and limitation. These state findings, so they wait for real data
- [ ] `prize`: who can enter, deadline, judging, privacy line; confirm the draft rubric
- [ ] `ucas.founder`: your note
- [ ] `teachers.code[3]`: how a teacher asks for their class results
- [ ] `config`: `essayFormUrl`, `teacherFormUrl`, `teacherPackUrl`, `essayDeadline`, and `pollEndpoint` if you want class results collected
- [ ] `LICENCE`: paste in the full CC BY-NC 4.0 text
- [ ] Remove `meta.PLACEHOLDER` last

Sentences already written for you to read through: `hero`, `poll` (framing, decoder cards 1 and 3), `lab.cheats`, `terms`, `prize` (rules, prompts, rubric), `ucas` (everything but the founder's note), `teachers`.

## Privacy: what this site does and does not do

- **No sign-up, no cookies, no tracking, no outside requests.** Fonts and all code are in this repo.
- **Saved on the student's device only:** their poll result and their essay draft, each with a "clear" button.
- **Poll collection is off by default.** If you set `config.pollEndpoint` to an `https://` address, each submission sends the six answers, the class code, the time and the score to it. No name, no email. The wording under the Submit button changes to say so.
- **Forms that take names or emails are links out**, not embedded: the essay entry and the teacher-pack request. Each says what it asks for before the button. Until its address is set, the button is switched off with a note.
- The essay form will collect names and emails from students, most under 18. That is personal data under UK GDPR and it is the organiser's responsibility: ask for as little as possible, say who sees it and for how long, and check the ICO's guidance on children's data. This note is not legal advice.

## Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from the folder will not work.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository.
2. Repository → Settings → Pages → Source: "Deploy from a branch" → `main`, folder `/ (root)` → Save.
3. The site appears at `https://<your-username>.github.io/<repo-name>/` after a minute or two.

No build step. The service worker is network-first: with a connection, students always get the newest files; offline, they get the last copy.

## Files

```
index.html                     the page shell
assets/app.css                 styles
assets/app.js                  all behaviour; no dependencies; no subject content
assets/fonts/                  Instrument Serif and Plus Jakarta Sans (SIL Open Font License)
data/seaad-mtg.json            everything the site says and shows
notebook/                      outline of the analysis, and the data checker
sw.js                          offline support
```

`app.js` is one file with one function per view and per block, each taking the data and returning DOM. That keeps it runnable with no build and makes a later move to React a function-by-function port.

## Credits and licence

Data: Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science; Gabitto et al. (2024), Nature Neuroscience. Used under the Allen Institute Terms of Use for non-commercial purposes.

Site and teaching materials: CC BY-NC 4.0, see `LICENCE`. Fonts: SIL Open Font License 1.1, see `assets/fonts/`.
