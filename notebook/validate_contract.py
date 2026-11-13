"""Check a data file against the contract Unravel expects.

Usage:  python3 notebook/validate_contract.py data/seaad-mtg.json
Exits 0 when the file is safe to load, 1 otherwise. Warnings do not fail the check.

The v5 writing rules are reported under "writing:" for Giulio to fix by hand. They never fail the check, because the
fix is a rewording, and the science is not reworded by the code or by Claude.
"""
import json
import re
import sys

TOKENS = {
    "prizeValue", "wordsMin", "wordsMax", "donorTotal", "cellsTotal", "deadline",
    "metricLabel", "cellLabel", "groupingLabel", "unit", "firstGroup", "lastGroup", "medianFirst", "medianLast",
    "nDonors", "trend", "prediction", "donorId", "value", "age", "sex", "n",
    "answered", "total", "score", "benchmarkMean", "count", "target", "src",
}
SECTION_IDS = {"question", "video", "poll", "pivot", "lab", "explore", "further"}
TINTS = {"coral", "cream", "peri", "rose"}
PAGES = {"prize", "ucas", "teachers"}
TOKEN = re.compile(r"\{\{\s*([A-Za-z0-9]+)\s*\}\}")


def is_text(v):
    return isinstance(v, str) and v.strip() != ""


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def strings(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from strings(v, f"{path}[{i}]")


def check_passage(where, passage, errors, warnings):
    for i, part in enumerate(passage.get("parts") or []):
        kind = part.get("type") if isinstance(part, dict) else None
        at = f"{where}.parts[{i}]"
        if kind == "text":
            if not is_text(part.get("text")):
                errors.append(f"{at}: a text part needs text")
        elif kind == "blank":
            options = part.get("options")
            if not isinstance(options, list) or not 2 <= len(options) <= 4:
                errors.append(f"{at}: a blank needs 2 to 4 options")
                continue
            c = part.get("correct")
            if not isinstance(c, int) or isinstance(c, bool) or not 0 <= c < len(options):
                errors.append(f"{at}: correct must be the position of the right option, counting from 0")
            fb = part.get("feedback") or {}
            if not is_text(fb.get("right")) or not is_text(fb.get("wrong")):
                warnings.append(f"{at}: feedback should have both right and wrong")
        elif kind != "break":
            errors.append(f"{at}: type must be text, blank or break")


def check(doc):
    errors, warnings = [], []
    meta = doc.get("meta") or {}
    for key in ("title", "dataset", "citation", "licence", "accessed"):
        if not is_text(meta.get(key)):
            errors.append(f"meta.{key} is missing")
    if not (isinstance(meta.get("donorTotal"), dict) and is_text(meta["donorTotal"].get("unit"))):
        errors.append("meta.donorTotal must be {value, unit}")
    if meta.get("PLACEHOLDER"):
        warnings.append("meta.PLACEHOLDER is true: this file must not go in front of students")

    donors = doc.get("donors") or []
    n = len(donors)
    if not n:
        errors.append("donors is empty: the Data Lab is hidden")
    donor_ids = [d.get("id") for d in donors]
    if len(set(donor_ids)) != len(donor_ids):
        errors.append("donor ids are not unique")
    for d in donors:
        for bad in ("name", "dob", "dateOfBirth", "postcode"):
            if bad in d:
                errors.append(f"donor {d.get('id')}: remove the field '{bad}'")

    cells = {c.get("id") for c in doc.get("cellTypes") or []}
    metrics = {m.get("id"): m for m in doc.get("metrics") or []}
    for mid, m in metrics.items():
        if not is_text(m.get("unit")):
            errors.append(f"metrics.{mid}: no unit; every number needs one")
        if not is_text(m.get("label")):
            errors.append(f"metrics.{mid}: no label")
    groupings = {g.get("id"): g for g in doc.get("groupings") or []}
    for gid, g in groupings.items():
        key = g.get("key")
        present = {str(d.get(key)) for d in donors if key in d}
        if donors and not present:
            errors.append(f"groupings.{gid}: no donor has the field '{key}'")
        order = [str(x) for x in g.get("order") or []]
        if order and present - set(order):
            errors.append(f"groupings.{gid}: donors have values missing from order: {sorted(present - set(order))}")
    confs = {c.get("id"): c for c in doc.get("confounders") or []}
    for cid, c in confs.items():
        if donors and not any(c.get("key") in d for d in donors):
            errors.append(f"confounders.{cid}: no donor has the field '{c.get('key')}'")

    have = set()
    for i, s in enumerate(doc.get("series") or []):
        pair = (s.get("metric"), s.get("cellType"))
        if pair in have:
            errors.append(f"series[{i}]: {pair} appears twice")
        have.add(pair)
        if s.get("metric") not in metrics:
            errors.append(f"series[{i}]: unknown metric {s.get('metric')}")
        if s.get("cellType") not in cells:
            errors.append(f"series[{i}]: unknown cell type {s.get('cellType')}")
        vals = s.get("values") or []
        if len(vals) != n:
            errors.append(f"series[{i}] {pair}: {len(vals)} values for {n} donors; they must line up one to one")
        if any(v is not None and not is_num(v) for v in vals):
            errors.append(f"series[{i}] {pair}: values must be numbers (or null for a missing donor)")

    def check_question(where, q):
        if (q.get("metric"), q.get("cellType")) not in have:
            errors.append(f"{where}: no series for {q.get('metric')} in {q.get('cellType')}")
        if "grouping" in q and q["grouping"] not in groupings:
            errors.append(f"{where}: unknown grouping {q.get('grouping')}")

    for i, cs in enumerate(doc.get("caseStudies") or []):
        at = f"caseStudies[{i}]"
        if cs.get("grouping") not in groupings:
            errors.append(f"{at}: unknown grouping {cs.get('grouping')}")
        if not cs.get("views"):
            errors.append(f"{at}: needs at least one view")
        for j, v in enumerate(cs.get("views") or []):
            check_question(f"{at}.views[{j}]", v)
        for c in cs.get("confounders") or []:
            if c not in confs:
                errors.append(f"{at}: unknown confounder {c}")
        for o in (cs.get("predict") or {}).get("options") or []:
            if o.get("id") not in ("up", "same", "down"):
                errors.append(f"{at}: predict option ids must be up, same or down")
        if cs.get("takeaway"):
            check_passage(f"{at}.takeaway", cs["takeaway"], errors, warnings)
    for i, pad in enumerate((doc.get("lab") or {}).get("launchpads") or []):
        check_question(f"lab.launchpads[{i}]", pad)

    # home-page sections: ids must be known and unique; removing one removes it from the page
    seen = set()
    for i, sec in enumerate(doc.get("sections") or []):
        sid = sec.get("id") if isinstance(sec, dict) else None
        if sid not in SECTION_IDS:
            errors.append(f"sections[{i}]: unknown id {sid!r}; the code knows {sorted(SECTION_IDS)}")
        elif sid in seen:
            errors.append(f"sections[{i}]: id {sid!r} appears twice")
        seen.add(sid)
        if not is_text((sec or {}).get("name")):
            errors.append(f"sections[{i}]: needs a name")
        if (sec or {}).get("tint") is not None and sec.get("tint") not in TINTS:
            errors.append(f"sections[{i}]: tint must be one of {sorted(TINTS)}")

    # the language split: a plain-English label may simplify a term but never swap Alzheimer's for dementia
    for kind in ("groupings", "cellTypes", "metrics", "confounders"):
        for x in doc.get(kind) or []:
            plain, lab = str(x.get("plainLabel") or ""), str(x.get("label") or "")
            if "dementia" in plain.lower() and "dementia" not in lab.lower():
                errors.append(f"{kind}.{x.get('id')}: plainLabel says 'dementia' but label does not ({plain!r})")
    for i, t in enumerate(doc.get("terms") or []):
        if "dementia" in str(t.get("plain") or "").lower() and "dementia" not in str(t.get("research") or "").lower():
            errors.append(f"terms[{i}]: plain says 'dementia' but the research term does not")
    for i, cs in enumerate(doc.get("caseStudies") or []):
        plain, lab = str(cs.get("plainTitle") or ""), str(cs.get("title") or "")
        if "dementia" in plain.lower() and "dementia" not in lab.lower():
            errors.append(f"caseStudies[{i}]: plainTitle says 'dementia' but title does not")

    ids = [i.get("id") for i in (doc.get("poll") or {}).get("items") or []]
    pivot_id = (doc.get("poll") or {}).get("pivotItemId")
    if pivot_id is not None and pivot_id not in ids:
        errors.append(f"poll.pivotItemId {pivot_id!r} is not one of the poll statement ids {ids}")
    for i, door in enumerate((doc.get("further") or {}).get("doors") or []):
        if door.get("page") not in PAGES or not doc.get(door.get("page")):
            errors.append(f"further.doors[{i}].page {door.get('page')!r} is not a page that exists ({sorted(PAGES)})")

    poll = doc.get("poll") or {}
    for i, item in enumerate(poll.get("items") or []):
        at = f"poll.items[{i}]"
        if item.get("correct") not in ("true", "false", "dk"):
            errors.append(f"{at}: correct must be true, false or dk")
        b = item.get("benchmark") or {}
        if not all(is_num(b.get(k)) for k in ("true", "false", "dk")):
            errors.append(f"{at}: benchmark needs true, false and dk percentages")
        elif abs(sum(b[k] for k in ("true", "false", "dk")) - 100) > 1.5:
            warnings.append(f"{at}: benchmark percentages add up to {sum(b.values()):.1f}, not 100")

    prize = doc.get("prize") or {}
    if prize:
        if not (is_num(prize.get("wordsMin")) and is_num(prize.get("wordsMax")) and prize["wordsMin"] < prize["wordsMax"]):
            errors.append("prize.wordsMin and prize.wordsMax must be numbers, min below max")
        levels = prize.get("rubricLevels") or []
        for r in prize.get("rubric") or []:
            if len(r.get("levels") or []) != len(levels):
                errors.append(f"prize.rubric '{r.get('criterion')}': needs one description per level ({len(levels)})")

    config = doc.get("config") or {}
    for key in ("pollEndpoint", "essayFormUrl", "teacherFormUrl", "teacherPackUrl"):
        v = config.get(key)
        if is_text(v) and v != "PLACEHOLDER" and not v.startswith("https://"):
            errors.append(f"config.{key} must start with https://")
    if is_text(config.get("pollEndpoint")) and config["pollEndpoint"].startswith("https://"):
        warnings.append("config.pollEndpoint is set: poll answers and class codes now leave the device. Check the privacy wording.")

    check_video(doc, errors, warnings)
    check_explain(doc, errors, warnings)
    check_glossary(doc, errors, warnings)

    placeholders = 0
    for path, text in strings(doc):
        if "PLACEHOLDER" in text and path != "meta.placeholderNotice":
            placeholders += 1
        for name in TOKEN.findall(text):
            if name not in TOKENS:
                errors.append(f"{path}: unknown token {{{{{name}}}}}")
    if placeholders:
        warnings.append(f"{placeholders} pieces of text still say PLACEHOLDER")
    return errors, warnings


def check_video(doc, errors, warnings):
    v = doc.get("video")
    if not v:
        return
    for key in ("src", "heading", "transcript"):
        if not is_text(v.get(key)):
            errors.append(f"video.{key} is missing")
    if is_text(v.get("src")) and not v["src"].startswith("assets/video/"):
        errors.append("video.src must be a file in assets/video/ (no outside addresses)")
    for key in ("play", "pause", "soundOn", "soundOff", "again"):
        if not is_text((v.get("labels") or {}).get(key)):
            errors.append(f"video.labels.{key} is missing")
    caps = v.get("captions") or []
    if not caps:
        errors.append("video.captions is empty")
    last_to = None
    for i, cap in enumerate(caps):
        at = f"video.captions[{i}]"
        f, t = cap.get("from"), cap.get("to")
        if not (is_num(f) and is_num(t)):
            errors.append(f"{at}: from and to must be numbers of seconds")
            continue
        if not f < t:
            errors.append(f"{at}: from ({f}) must be less than to ({t})")
        if last_to is not None and f < last_to:
            errors.append(f"{at}: overlaps the caption before it (starts at {f}, the one before ends at {last_to})")
        last_to = t
        if not is_text(cap.get("text")):
            errors.append(f"{at}: needs text")
        for name in TOKEN.findall(cap.get("text") or ""):
            if name not in ("donorTotal", "cellsTotal"):
                errors.append(f"{at}: token {{{{{name}}}}} is not one a caption can use (donorTotal, cellsTotal)")


def check_explain(doc, errors, warnings):
    """Every chart carries three lines: what you are looking at, what it shows, why it matters."""
    targets = [(f"caseStudies[{i}]", cs) for i, cs in enumerate(doc.get("caseStudies") or [])]
    if doc.get("explore") is not None:
        targets.append(("explore", doc["explore"]))
    for where, owner in targets:
        ex = owner.get("explain")
        if not isinstance(ex, dict):
            errors.append(f"{where}.explain is missing: every chart needs look, shows and matters")
            continue
        for key in ("look", "shows", "matters"):
            val = ex.get(key)
            if not is_text(val):
                errors.append(f"{where}.explain.{key} is empty")
            elif "PLACEHOLDER" in val:
                warnings.append(f"{where}.explain.{key} is still PLACEHOLDER (write it from the real results)")
    labels = (doc.get("lab") or {}).get("explainLabels") or {}
    for key in ("look", "shows", "matters"):
        if not is_text(labels.get(key)):
            errors.append(f"lab.explainLabels.{key} is missing")


def check_glossary(doc, errors, warnings):
    gl = doc.get("glossary")
    if gl is None:
        warnings.append("glossary is missing: add {term, plain} for every science word")
        return
    for i, g in enumerate(gl):
        if not (is_text(g.get("term")) and is_text(g.get("plain"))):
            errors.append(f"glossary[{i}]: needs term and plain")


# ---------- writing rules (v5): reported, never fixed by the code ----------

SKIP_ROOTS = ("donors", "series", "config", "meta", "sections", "glossary", "groupings", "confounders", "cellTypes", "metrics", "nav", "ui", "footer")
SKIP_KEYS = {"id", "src", "poster", "colour", "url", "key", "metric", "cellType", "grouping", "page", "type", "correct", "benchmarkSourceUrl", "pivotItemId", "value"}
READING_ORDER = ("hero", "video", "poll", "pivot", "lab", "caseStudies", "explore", "further", "prize", "ucas", "teachers", "footer")
SENTENCE = re.compile(r"(?<=[.?!])\s+(?=[A-Z“\"(])")
HEADING_KEY = re.compile(r"(heading|Heading|title|Title|cta|Cta|Label|label|Labels|hint)$")


def words(text):
    return len(re.findall(r"[A-Za-z0-9£%’'‘\-–]+", TOKEN.sub("N", text)))


def prose(doc):
    """User-facing sentences, in reading order."""
    for root in READING_ORDER:
        if root not in doc:
            continue
        for path, text in strings(doc[root], root):
            leaf = re.sub(r"\[\d+\]$", "", path).rsplit(".", 1)[-1]
            if leaf in SKIP_KEYS or text.startswith("http"):
                continue
            yield path, text


def writing(doc):
    out = []
    flat = list(prose(doc))
    for path, text in flat:
        clean = text.replace("PLACEHOLDER:", "").replace("PLACEHOLDER", "").strip()
        for sentence in SENTENCE.split(clean):
            n = words(sentence)
            if n > 20:
                out.append(f"{path}: a sentence of {n} words (limit 20): “{sentence[:90]}{'…' if len(sentence) > 90 else ''}”")
        if "!" in text:
            out.append(f"{path}: has an exclamation mark")
        if re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", text):
            out.append(f"{path}: has an emoji")

    # gene names stay out of headings and buttons
    genes = [m.get("id") for m in doc.get("metrics") or [] if m.get("id") and m.get("id") != "abundance" and m["id"].isupper()]
    for path, text in flat:
        leaf = re.sub(r"\[\d+\]$", "", path).rsplit(".", 1)[-1]
        if HEADING_KEY.search(leaf) or leaf in ("question",) and path.startswith("hero"):
            for g in genes:
                if re.search(rf"\b{re.escape(g)}\b", text):
                    out.append(f"{path}: gene name {g} in a heading or button")

    # no section shows more than 45 words of body text at once (chart explanations not counted)
    def longest(items):
        return max((words(x) for x in items if is_text(x)), default=0)
    lab, pv, poll, ex, fur = (doc.get(k) or {} for k in ("lab", "pivot", "poll", "explore", "further"))
    cases = doc.get("caseStudies") or []
    budgets = {
        "title screen": words((doc.get("hero") or {}).get("tagline") or ""),
        "the data film (transcript)": words((doc.get("video") or {}).get("transcript") or ""),
        "poll": words(poll.get("framing") or "") + longest(i.get("statement") for i in poll.get("items") or []),
        "pivot": sum(words(x) for x in (pv.get("body") or []) + [pv.get("handoff") or ""]) + sum(words((d or {}).get("body") or "") + words((d or {}).get("title") or "") for d in pv.get("decoders") or []),
        "lab (step 1)": words(lab.get("intro") or "") + longest(c.get("brief") for c in cases) + longest((c.get("predict") or {}).get("question") for c in cases),
        "explore": words(ex.get("intro") or "") + sum(words(p.get("blurb") or "") for p in lab.get("launchpads") or []),
        "take it further": words(((fur.get("prize") or {}).get("body")) or "") + words(((fur.get("prize") or {}).get("heading")) or "") + sum(words(d.get("line") or "") for d in fur.get("doors") or []),
    }
    for name, n in budgets.items():
        if n > 45:
            out.append(f"section '{name}': {n} words of body text on screen at once (limit 45)")

    # a science word is explained the first time it appears: in brackets or after a dash, in the same sentence
    for g in doc.get("glossary") or []:
        term = g.get("term") or ""
        if not is_text(term) or "PLACEHOLDER" in term:
            continue
        pat = re.compile(rf"(?<![A-Za-z]){re.escape(term)}(?![A-Za-z])", 0 if term.isupper() or term[:1].isupper() and len(term) < 5 else re.I)
        for path, text in flat:
            m = pat.search(text)
            if not m:
                continue
            sentence = next((x for x in SENTENCE.split(text) if pat.search(x)), text)
            after = text[m.end():m.end() + 3]
            explained = after.startswith((" (", " —", " –", " - ")) or "(" + term in text or (g.get("plain") or "").lower() in sentence.lower()
            if not explained:
                out.append(f"{path}: first use of “{term}” is not explained in the same sentence (glossary: {g.get('plain')})")
            break
    return out


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "data/seaad-mtg.json"
    doc = json.load(open(path, encoding="utf-8"))
    errors, warnings = check(doc)
    for w in writing(doc):
        print("writing:", w)
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("ERROR:", e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    sys.exit(1 if errors else 0)
