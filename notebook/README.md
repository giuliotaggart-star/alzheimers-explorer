# Regenerating the data

`build_data.ipynb` will produce `data/seaad-mtg.json`. It is currently an outline: no analysis has been run, and the JSON in `data/` is placeholder content.

## Rules the analysis must follow

- **One region:** SEA-AD middle temporal gyrus (MTG).
- **Official data only:** `aws s3 ls --no-sign-request s3://sea-ad-single-cell-profiling/`. The download buttons on the CELLxGENE collection page give reduced metadata and must not be used.
- **Count people, not cells:** aggregate to one value per donor first (pseudobulk), then compare donors. A test run on individual cells overstates certainty enormously.
- **Effect size first:** report the difference and Cohen's d; the adjusted p-value is secondary.

## What the notebook must also write (new in v2)

- **A unit for everything:** `measure.unit`, `effect.unit`, `nUnit` on each group, `genesChanged` as `{value, unit}`, `geneMeasure.unit`.
- **Map points:** `map.points` as `{"<cell type id>": [[x, y], …]}`: about 3,000 cells sampled at random from the real map, in proportion to how common each type is, using the map's own coordinates (the page rescales them). Ids must match `cellTypes[].id`; any other id is drawn in grey.
- **One colour per cell type:** `cellTypes[].colour`, as `#rrggbb`. Mid-tones read on both the light and the dark page.

## Before publishing

```
python3 notebook/validate_contract.py data/seaad-mtg.json
```

Errors must be fixed. Warnings about PLACEHOLDER mean the file is not ready for a classroom.

## Citation

Gabitto et al. (2024), Nature Neuroscience. Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science. Follow the Allen Institute Citation Policy when displaying this data publicly.
