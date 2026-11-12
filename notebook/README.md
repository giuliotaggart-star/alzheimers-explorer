# Regenerating the data

`build_data.ipynb` will produce `data/seaad-mtg.json`. It is currently an outline: no analysis has been run, and the JSON in `data/` is placeholder content.

## Rules the analysis must follow

- **One region:** SEA-AD middle temporal gyrus (MTG).
- **Official data only:** `aws s3 ls --no-sign-request s3://sea-ad-single-cell-profiling/`. The download buttons on the CELLxGENE collection page give reduced metadata and must not be used.
- **Count people, not cells:** aggregate to one value per donor first (pseudobulk), then compare donors. A test run on individual cells overstates certainty enormously.
- **Effect size first:** report the difference and Cohen's d; the adjusted p-value is secondary.

## What the notebook must write (v3: donor-level)

- **`donors`:** one record per donor with an anonymous `id` and the fields the site splits by: `adnc`, `braak`, `cognitive`, `age`, `sex`, `apoe4`. Use the official SEA-AD donor metadata. No names or dates.
- **`series`:** one entry per metric and cell type, `{metric, cellType, values}`, with one value per donor in the same order as `donors` (use `null` where a donor has no value). Abundance = that cell type's share of the donor's cells. Gene activity = donor-level pseudobulk for that gene in that cell type; record the unit in `metrics[].unit`.
- **`map.points`:** about 3,000 cells sampled from the real map, `{"<cell type id>": [[x, y], …]}`.
- Ids in `cellTypes`, `metrics`, `groupings` and `confounders` must match what `series`, `caseStudies` and `lab.launchpads` refer to. The checker tells you when they do not.

## Before publishing

```
python3 notebook/validate_contract.py data/seaad-mtg.json
```

Errors must be fixed. Warnings about PLACEHOLDER mean the file is not ready for a classroom.

## Citation

Gabitto et al. (2024), Nature Neuroscience. Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science. Follow the Allen Institute Citation Policy when displaying this data publicly.
