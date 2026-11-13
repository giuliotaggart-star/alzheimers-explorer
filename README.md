# Unravel

A free site for UK A-level Biology students. It starts from a question about dementia, takes them through a six-statement poll, a short explanation of how dementia and Alzheimer's disease differ, five guided simulations on donor-level brain-cell data, and their own question to explore, then points to an optional essay prize.

> **Status: built on placeholder data.** Every number in `data/seaad-mtg.json` is made up, and text marked `PLACEHOLDER` is waiting for a subject expert. There is no banner. Instead: (1) the footer carries `footer.buildNote` while `meta.PLACEHOLDER` is true; (2) open any page with `#check` on the end of the address (for example `index.html#check`) and every piece of text still saying `PLACEHOLDER` is outlined, with a count in the corner; (3) the checker keeps warning. **Do not send the link to students until `meta.PLACEHOLDER` is gone from the data file, and run the checker before every push.**

## The journey

The home page is one continuous, dark page: a title screen, a 30-second data film, then the v4 journey. Each full-height section has one heading, one visual and one coral button. Their order, names, glow colours and numbers come from `sections` in the data file; remove one and the rest renumber themselves, and its rail dot and deep link go too.

| # | Address | Job |
|---|---|---|
| 001 | `#question` | The title screen: UNRAVEL, one sentence (`hero.tagline`), one button, one glow |
| 002 | `#video` | Where the data comes from: the film, with captions laid over it from `video.captions` |
| 003 | `#poll` | `hero.question` as the heading, then the six statements one at a time, then the score |
| 004 | `#pivot` | The poll's hinge statement, dementia vs Alzheimer's disease, three nested rings |
| 005 | `#lab` | The guided flow: pick a simulation (four tiles and More), then predict, observe, stress-test, takeaway |
| 006 | `#explore` | Working solo: launchpads, the "Show me how … changes across … in …" sentence, cell-type orbs, a snapshot card |
| 007 | `#further` | The prize, then the three side pages as tiles |

The other pages: `#prize`, `#ucas`, `#teachers`.

**Language split.** The name, hero, poll and pivot say *dementia*. From the pivot on, *Alzheimer's* is the disease in the data. The only place the lab says *dementia* is the cognitive-status labels. The checker enforces it.

**Look (Build Spec v5).** Dark only. Eight colour tokens in `assets/app.css` (`--bg`, `--card`, `--cream`, `--muted`, `--coral`, `--peri`, `--rose`, `--line`), plus `--lilac` and `--sand` for the fifth and sixth cell types. Colour arrives as glow that fades into black, never as a flat block or a border. Three faces, all self-hosted: Bagel Fat One (title, section titles, big numbers), Plus Jakarta Sans (body), DM Mono (labels). Seven components: stat card, orb, panel, chip, pill button, tile row, dotted ring.

Every chart is one dot per donor (periwinkle circles for less pathology, coral triangles for more), with the median and interquartile box and a zero-based axis. Directly under each chart are three lines from the data file: what you are looking at, what it shows, why it matters (`explain.look`, `explain.shows`, `explain.matters`). Its effect size (Cohen's d, first group against last) sits beside it in a stat card. Method notes and p-values live only in the closed "For the curious" drawer, which is the only fold on the site.

## Everything is in one file

Every sentence, number, unit, colour and address is read from `data/seaad-mtg.json`. To finish or change the site you edit that file; you do not touch the code. Leave a field out and its part of the page disappears; leave a whole section out (`prize`, say) and its link disappears.

Sentences can quote live values with tokens such as `{{medianFirst}}`. `{{donorTotal}}` and `{{cellsTotal}}` give the bare number, so the sentence names what is counted ("{{donorTotal}} people…"). A mistyped token shows on the page, highlighted. Every number needs a unit: if one is missing the page prints `[unit missing]`.

After every edit:

```
python3 notebook/validate_contract.py data/seaad-mtg.json
```

The checker also runs the v5 writing rules: sentences of 20 words or fewer, at most 45 words of body text on screen per section, gene names out of headings and buttons, science words explained at first use (from `glossary`), no exclamation marks or emoji. It prints failures as `writing:` lines for a person to fix; they never fail the run, because the fix is a rewording.

### The data film

Save the film as `assets/video/data-journey.mp4`, then run `tools/prepare-video.sh`. It makes the poster from the last frame and re-encodes the file if it is over 6 MB. The film has no words in it. The captions are HTML, timed by `video.captions[].from` and `.to` (seconds). If the film's scene changes do not land on the six-second marks, change those numbers. While the file is missing, the section shows its heading, the transcript and the button, and `#check` reports it. The film is never precached by the service worker; only its poster is.

### Browser checks

```
node tests/acceptance.js
```

Runs the 18 v5 acceptance checks except Lighthouse at 390, 820 and 1440 px (needs Playwright with Chromium; ffmpeg for the film checks, which use a generated test clip). It prints a contrast table at the end.

### The data the lab needs

| Key | What it holds |
|---|---|
| `donors[]` | One record per donor: `id`, plus whatever the groupings and confounders use (`adnc`, `braak`, `cognitive`, `age`, `sex`, `apoe4`). No names, no dates of birth |
| `groupings[]` | What donors can be split across: `key` (a donor field), `label`, `plainLabel`, `order` |
| `confounders[]` | What step 3 can stratify by: `key`, `label`, optional `bins` for numbers such as age |
| `cellTypes[]`, `metrics[]` | Labels, A-level labels, colours; each metric has a `unit` and `decimals` |
| `series[]` | The numbers: `{metric, cellType, values}` where `values` lines up one to one with `donors` |
| `caseStudies[]` | The five simulations: which series, which grouping, the prediction question, the takeaway passage, `explain` (three lines) and `curious` (p-value, method notes) |
| `glossary[]` | `{term, plain}` for every science word a Year 12 student would not know |
| `video` | The film: `src`, `poster`, `heading`, `captions`, `transcript`, button `labels` |

## What is left to fill in

- [ ] Run the real analysis and replace `donors` and `series` (see `notebook/README.md`)
- [ ] `metrics[].unit` for gene activity (still "PLACEHOLDER units")
- [ ] `poll.items[].benchmark`: check each percentage against the results table in Hassan et al. (2026); then tidy `poll.benchmarkSource`
- [ ] v5: download the film to `assets/video/data-journey.mp4`, run `tools/prepare-video.sh`, check caption timings
- [ ] v5: `meta.cellsTotal`: the cell count for the MTG from the paper (Allen pages give 1.4 million and 3.4 million)
- [ ] v5: `hero.tagline` (or approve the default); `hero.hint` (time someone doing the journey: "8 MINUTES" is a guess)
- [ ] v5: `explain.look/shows/matters` for each case study and `explore.explain.matters`, from the real results; `curious.pValue` and notes
- [ ] v5: `video.transcript` (four plain sentences); fill `glossary`; fix the `writing:` lines the checker prints
- [ ] v5: look at the title on a phone. If Bagel Fat One feels too childish, switch to Lilita One (the only change is the font file and the first `@font-face` in `assets/app.css`)
- [ ] `hero.question`; `pivot.body` (your two sentences); `pivot.handoff`; `poll.resultGap`; `sections[].name`; `further.doors[].line`; `further.prize.bodyAfterWork`
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
assets/fonts/                  Bagel Fat One, Plus Jakarta Sans, DM Mono (SIL Open Font License); no outside fonts
assets/video/                  the data film and its poster (add them; see above)
data/seaad-mtg.json            everything the site says and shows
notebook/                      outline of the analysis, and the data checker
sw.js                          offline support
tests/acceptance.js            browser checks for Build Spec v5
tools/prepare-video.sh         poster and web encode for the film
```

`app.js` is one file with one function per view and per block, each taking the data and returning DOM. That keeps it runnable with no build and makes a later move to React a function-by-function port.

## Credits and licence

Data: Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science; Gabitto et al. (2024), Nature Neuroscience. Used under the Allen Institute Terms of Use for non-commercial purposes.

Site and teaching materials: CC BY-NC 4.0, see `LICENCE`. Fonts: SIL Open Font License 1.1, see `assets/fonts/`.
