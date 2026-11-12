"""Check a data file against the contract Unravel expects.

Usage:  python3 notebook/validate_contract.py data/seaad-mtg.json
Exits 0 when the file is safe to load, 1 otherwise. Warnings do not fail the check.
"""
import json
import re
import sys

TOKENS = {
    "prizeValue", "wordsMin", "wordsMax", "donorTotal", "cellsTotal", "deadline",
    "metricLabel", "cellLabel", "groupingLabel", "unit", "firstGroup", "lastGroup", "medianFirst", "medianLast",
    "nDonors", "trend", "prediction", "donorId", "value", "age", "sex", "n",
    "answered", "total", "score", "benchmarkMean", "count", "target",
}
SECTION_IDS = {"question", "poll", "pivot", "lab", "explore", "further"}
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


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "data/seaad-mtg.json"
    errors, warnings = check(json.load(open(path, encoding="utf-8")))
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("ERROR:", e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    sys.exit(1 if errors else 0)
