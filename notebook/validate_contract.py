"""Check a data file against the contract the page expects.

Usage:  python3 notebook/validate_contract.py data/seaad-mtg.json
Exits 0 when the file is safe to load, 1 otherwise. Warnings do not fail the check.
"""
import json
import re
import sys

META = ["title", "dataset", "region", "donorTotal", "citation", "licence", "accessed"]
CELL = ["id", "label", "values", "effect"]
TOKENS = {
    "cellLabel", "cellLabelLower", "measureLabel", "unit", "higherMeans", "difference", "differenceWithUnit",
    "direction", "cohensD", "effectSize", "meanNormal", "meanDementia", "nNormal", "nDementia", "nTotal", "nUnit",
    "genesChanged", "region", "regionPlain", "donorTotal", "cellsTotal", "groupNormal", "groupDementia",
    "groupNormalShort", "groupDementiaShort", "geneSymbol", "geneChange", "geneMeasureLabel", "geneUnit",
    "wordLimit", "deadline",
    # filled in by the page itself, in the one place each is used
    "filled", "total", "gapNumber", "ratio", "mean", "sd",
}
GENE_TOKENS = {"geneSymbol", "geneChange", "geneMeasureLabel", "geneUnit"}
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
    parts = passage.get("parts")
    if not isinstance(parts, list) or not parts:
        errors.append(f"{where}: no parts")
        return
    seen = set()
    for i, part in enumerate(parts):
        kind = part.get("type") if isinstance(part, dict) else None
        at = f"{where}.parts[{i}]"
        if kind == "text":
            if not is_text(part.get("text")):
                errors.append(f"{at}: a text part needs text")
        elif kind == "break":
            pass
        elif kind == "blank":
            options = part.get("options")
            if not isinstance(options, list) or not 2 <= len(options) <= 4:
                errors.append(f"{at}: a blank needs 2 to 4 options")
                continue
            correct = part.get("correct")
            if not isinstance(correct, int) or isinstance(correct, bool) or not 0 <= correct < len(options):
                errors.append(f"{at}: correct must be the position of the right option, counting from 0")
            if part.get("id") in seen:
                errors.append(f"{at}: blank id {part.get('id')} is used twice")
            seen.add(part.get("id"))
            fb = part.get("feedback") or {}
            if not is_text(fb.get("right")) or not is_text(fb.get("wrong")):
                warnings.append(f"{at}: feedback should have both right and wrong")
        else:
            errors.append(f"{at}: type must be text, blank or break")
    if not seen:
        warnings.append(f"{where}: the passage has no blanks")
    for path, text in strings(passage, where):
        for name in TOKEN.findall(text):
            if name in GENE_TOKENS:
                errors.append(f"{path}: the write-up must not depend on genes ({{{{{name}}}}})")


def check(doc):
    errors, warnings = [], []
    meta = doc.get("meta") or {}
    for key in META:
        if key not in meta:
            errors.append(f"meta.{key} is missing")
    if meta.get("PLACEHOLDER"):
        warnings.append("meta.PLACEHOLDER is true: this file must not go in front of students")
    for key in ("donorTotal", "cellsTotal"):
        v = meta.get(key)
        if v is not None and not (isinstance(v, dict) and "value" in v and is_text(v.get("unit"))):
            errors.append(f"meta.{key} must be {{value, unit}}")

    groups = doc.get("groups") or {}
    for g in ("normal", "dementia"):
        if not is_text((groups.get(g) or {}).get("label")):
            errors.append(f"groups.{g}.label is missing")

    measure = doc.get("measure")
    if not isinstance(measure, dict):
        errors.append("no measure object")
        measure = {}
    if not is_text(measure.get("unit")):
        errors.append("measure.unit is missing: every number needs a unit")
    if not is_text(measure.get("label")):
        errors.append("measure.label is missing")

    stages = doc.get("stages") or {}
    for sid in ("data", "mapping", "analysis"):
        if sid not in stages:
            warnings.append(f"stages.{sid} is missing: that screen is skipped")
    for sid, st in stages.items():
        for i, f in enumerate(st.get("figures") or []):
            if "value" not in f:
                errors.append(f"stages.{sid}.figures[{i}]: no value")
            if not is_text(f.get("unit")):
                errors.append(f"stages.{sid}.figures[{i}]: no unit")
        img = st.get("image")
        if img is not None and (not is_text(img.get("src")) or not is_text(img.get("alt"))):
            errors.append(f"stages.{sid}.image needs src and alt")

    cells = doc.get("cellTypes") or []
    if not cells:
        errors.append("cellTypes is empty")
    if not 4 <= len(cells) <= 12:
        warnings.append(f"{len(cells)} cell types; the page is designed for 4 to 12")
    seen, any_genes = set(), False
    for c in cells:
        cid = c.get("id", "?")
        if cid in seen:
            errors.append(f"duplicate cell type id {cid}")
        seen.add(cid)
        missing = [k for k in CELL if k not in c]
        if missing:
            errors.append(f"{cid} is missing {missing}")
            continue
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", c.get("colour") or ""):
            warnings.append(f"{cid}: no colour like #1a2b3c, the page picks one")
        for group in ("normal", "dementia"):
            v = c["values"].get(group) or {}
            if not is_num(v.get("mean")):
                errors.append(f"{cid}/{group}: no mean")
            if "n" in v and not is_text(v.get("nUnit")):
                errors.append(f"{cid}/{group}: n has no nUnit")
            donors = v.get("donorValues")
            if donors is None:
                warnings.append(f"{cid}/{group}: no donorValues, the page falls back to whiskers")
            elif "n" in v and len(donors) != v["n"]:
                errors.append(f"{cid}/{group}: {len(donors)} donorValues but n = {v['n']}")
        e = c["effect"]
        if e.get("pAdjusted") == 0:
            errors.append(f"{cid}: pAdjusted is exactly 0; store the real small number")
        if e.get("direction") not in ("up", "down", "none"):
            errors.append(f"{cid}: effect.direction must be up, down or none")
        gc = c.get("genesChanged")
        if gc is not None and not (isinstance(gc, dict) and is_num(gc.get("value")) and is_text(gc.get("unit"))):
            errors.append(f"{cid}: genesChanged must be {{value, unit}}")
        if c.get("writeUp"):
            check_passage(f"{cid}.writeUp", c["writeUp"], errors, warnings)
        for g in c.get("topGenes") or []:
            any_genes = True
            if not is_text(g.get("symbol")):
                errors.append(f"{cid}: a gene has no symbol")
    if any_genes and not is_text((doc.get("geneMeasure") or {}).get("unit")):
        errors.append("geneMeasure.unit is missing: gene values need a unit")

    points = (doc.get("map") or {}).get("points")
    if points is None:
        warnings.append("map.points is missing: the mapping screen falls back to its image")
    else:
        total = 0
        for cid, pts in points.items():
            if cid not in seen:
                warnings.append(f"map.points.{cid}: not a cell type id, drawn in grey")
            if not all(isinstance(p, list) and len(p) >= 2 and is_num(p[0]) and is_num(p[1]) for p in pts):
                errors.append(f"map.points.{cid}: every point must be [x, y]")
            total += len(pts)
        if total > 6000:
            warnings.append(f"map.points has {total} points; about 3,000 keeps phones smooth")

    write_up = doc.get("writeUp") or {}
    if write_up.get("shared"):
        check_passage("writeUp.shared", write_up["shared"], errors, warnings)
    elif not any(c.get("writeUp") for c in cells):
        warnings.append("no write-up passage anywhere: the write-up screen is skipped")
    head = write_up.get("headlineCell")
    if head is not None and head not in seen:
        errors.append(f"writeUp.headlineCell {head} is not a cell type id")

    config = doc.get("config") or {}
    if "winnerAnnounced" in config and not isinstance(config["winnerAnnounced"], bool):
        errors.append("config.winnerAnnounced must be true or false")
    url = config.get("entryFormUrl")
    if doc.get("challenge") and not (is_text(url) and url.startswith("https://")):
        warnings.append("config.entryFormUrl is not an https address yet: the entry button stays switched off")
    challenge = doc.get("challenge") or {}
    if challenge and not is_num(challenge.get("wordLimit")):
        warnings.append("challenge.wordLimit is missing")

    placeholders = 0
    for path, text in strings(doc):
        if "PLACEHOLDER" in text and path not in ("meta.placeholderNotice",):
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
