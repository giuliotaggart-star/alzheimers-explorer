# Unravel

A free site for UK A-level Biology students. It starts from a question about dementia, takes them through a six-statement poll, a short explanation of how dementia and Alzheimer's disease differ, five guided simulations on donor-level brain-cell data, and their own question to explore, then points to an optional essay prize.

> **Status: built on placeholder data.** Every number in `data/seaad-mtg.json` is made up, and text marked `PLACEHOLDER` is waiting for a subject expert. There is no banner. Instead: (1) the footer carries `footer.buildNote` while `meta.PLACEHOLDER` is true; (2) open any page with `#check` on the end of the address (for example `index.html#check`) and every piece of text still saying `PLACEHOLDER` is outlined, with a count in the corner; (3) the checker keeps warning. **Do not send the link to students until `meta.PLACEHOLDER` is gone from the data file, and run the checker before every push.**

## The journey

The home page is six full-height sections, each with one job and one way on. Their order, names and numbers come from `sections` in the data file; remove one and the rest renumber themselves, and its rail dot and deep link go too.

| # | Address | Job |
|---|---|---|
| 001 | `#question` | The human question about dementia, one line on what to do, one button |
| 002 | `#poll` | The six statements one at a time, no feedback until the end, then the result in the same card |
| 003 | `#pivot` | The dark screen: the poll's hinge statement, dementia vs Alzheimer's disease, three nested rings, then into the lab |
| 004 | `#lab` | A carousel of the five simulations, then the four steps of one (predict, observe, stress-test, takeaway) |
| 005 | `#explore` | Three launchpads and the "Show me how … changes across … in …" sentence; save a snapshot card |
| 006 | `#further` | The prize card, then two quiet doors (UCAS and careers, For teachers) |

The other pages: `#prize` (submit link, four-box claim–evidence–reasoning builder with a running word-count bar, rubric, rules), `#ucas`, `#teachers`.

**Language split.** The name, hero, poll and 003 say *dementia*. From 003 on, *Alzheimer's* is the disease in the data. The only place the lab says *dementia* is the cognitive-status labels. The A-level translator may simplify a term but never swap the disease; the checker enforces it.

Every chart is one dot per donor, with an optional median and interquartile box, a zero-based axis, and a colour that runs from `--ink-2` to `--deep` across the groups. The accent colour (Burning Flame) is used only for the prize card and its bridge, the "you" tick in the poll result, and the thread down the left edge.

## Everything is in one file

Every sentence, number, unit, colour and address is read from `data/seaad-mtg.json`. To finish or change the site you edit that file; you do not touch the code. Leave a field out and its part of the page disappears; leave a whole section out (`prize`, say) and its link disappears.

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

## What is left to fill in

- [ ] Run the real analysis and replace `donors` and `series` (see `notebook/README.md`)
- [ ] `metrics[].unit` for gene activity (still "PLACEHOLDER units")
- [ ] `poll.items[].benchmark`: check each percentage against the results table in Hassan et al. (2026); then tidy `poll.benchmarkSource`
- [ ] `hero.question` and `hero.description`; `pivot.body` (your two sentences); `pivot.handoff`; `poll.resultGap`; `sections[].name`; `further.doors[].line`; `further.prize.bodyAfterWork`
- [ ] `pivot.decoders[1]`: one expert sentence on selective vulnerability
- [ ] Launchpad blurbs
- [ ] `caseStudies[]`: each brief, each takeaway passage, model claim and limitation. These state findings, so they wait for real data
- [ ] `prize`: who can enter, deadline, judging, privacy line; confirm the draft rubric
- [ ] `ucas.founder`: your note
- [ ] `teachers.code[3]`: how a teacher asks for their class results
- [ ] `config`: `essayFormUrl`, `teacherFormUrl`, `teacherPackUrl`, `essayDeadline`, and `pollEndpoint` if you want class results collected
- [ ] `LICENCE`: paste in the full CC BY-NC 4.0 text
- [ ] Remove `meta.PLACEHOLDER` last (it also removes the footer build note)

Sentences already written for you to read through: `poll`, `pivot` (heading, rings, decoder cards 1 and 3), `lab.cheats`, `terms`, `prize` (rules, prompts, rubric), `ucas` (everything but the founder's note), `teachers`.

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

Then open http://localhost:8000. Opening `index.html` straight from the folder will not work. Add `#check` to the address to see what is still unwritten.

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
assets/fonts/                  Instrument Serif and Plus Jakarta Sans (SIL Open Font License); no outside fonts
data/seaad-mtg.json            everything the site says and shows
notebook/                      outline of the analysis, and the data checker
sw.js                          offline support
```

`app.js` is one file with one function per view and per block, each taking the data and returning DOM. That keeps it runnable with no build and makes a later move to React a function-by-function port.

## Credits and licence

Data: Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science; Gabitto et al. (2024), Nature Neuroscience. Used under the Allen Institute Terms of Use for non-commercial purposes.

Site and teaching materials: CC BY-NC 4.0, see `LICENCE`. Fonts: SIL Open Font License 1.1, see `assets/fonts/`.
