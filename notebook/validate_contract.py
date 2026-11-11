"""Check a data file against the contract the page expects.

Usage:  python3 notebook/validate_contract.py data/seaad-mtg.json
Exits 0 when the file is safe to publish, 1 otherwise.
"""
import json
import sys

META = {"dataset", "region", "source", "citation", "licence", "licenceUrl",
        "cellsTotal", "donors", "method", "methodPlain", "generated", "caveats"}
CELL = {"id", "label", "role", "values", "effect"}


def check(doc):
    errors, warnings = [], []
    meta = doc.get("meta", {})
    if META - meta.keys():
        errors.append(f"meta is missing {sorted(META - meta.keys())}")
    if meta.get("PLACEHOLDER"):
        warnings.append("meta.PLACEHOLDER is true: this file must not go in front of students")
    if "measure" not in doc:
        errors.append("no measure object")
    cells = doc.get("cellTypes", [])
    if not 4 <= len(cells) <= 12:
        warnings.append(f"{len(cells)} cell types; the page is designed for 4 to 12")
    seen = set()
    for c in cells:
        cid = c.get("id", "?")
        if cid in seen:
            errors.append(f"duplicate cell type id {cid}")
        seen.add(cid)
        if CELL - c.keys():
            errors.append(f"{cid} is missing {sorted(CELL - c.keys())}")
            continue
        for group in ("normal", "dementia"):
            v = c["values"].get(group, {})
            if "mean" not in v:
                errors.append(f"{cid}/{group}: no mean")
            donors = v.get("donorValues")
            if donors is None:
                warnings.append(f"{cid}/{group}: no donorValues, the page falls back to whiskers")
            elif "n" in v and len(donors) != v["n"]:
                errors.append(f"{cid}/{group}: {len(donors)} donorValues but n = {v['n']}")
        p = c["effect"].get("pAdjusted")
        if p == 0:
            errors.append(f"{cid}: pAdjusted is exactly 0; store the real small number")
        chunk_ids = {i.get("id") for i in c.get("interpretation", [])}
        questions = c.get("questions", [])
        if len(questions) > 3:
            warnings.append(f"{cid}: {len(questions)} questions; only the first 3 are asked")
        for q in questions:
            option_ids = {o.get("id") for o in q.get("options", [])}
            if q.get("correct") not in option_ids:
                errors.append(f"{cid}/{q.get('id')}: correct answer is not one of the options")
            if q.get("unlocks") not in chunk_ids:
                errors.append(f"{cid}/{q.get('id')}: unlocks a chunk that does not exist")
            if set(q.get("feedback", {})) != option_ids:
                warnings.append(f"{cid}/{q.get('id')}: feedback does not cover every option")
        text = json.dumps(c)
        if "PLACEHOLDER" in text:
            warnings.append(f"{cid}: still contains PLACEHOLDER text")
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
