# Regenerating the data

`build_data.ipynb` will produce `data/seaad-mtg.json`. It is currently an outline: no analysis has been run, and the JSON in `data/` is placeholder content.

## Rules the analysis must follow

- **One region:** SEA-AD middle temporal gyrus (MTG).
- **Official data only:** `aws s3 ls --no-sign-request s3://sea-ad-single-cell-profiling/`. The download buttons on the CELLxGENE collection page give reduced metadata and must not be used.
- **Count people, not cells:** aggregate to one value per donor first (pseudobulk), then compare donors. A test run on individual cells overstates certainty enormously.
- **Effect size first:** report the difference and Cohen's d; the adjusted p-value is secondary.

## Before publishing

```
python3 notebook/validate_contract.py data/seaad-mtg.json
```

Errors must be fixed. Warnings about PLACEHOLDER mean the file is not ready for a classroom.

## Citation

Gabitto et al. (2024), Nature Neuroscience. Seattle Alzheimer's Disease Brain Cell Atlas (SEA-AD), Allen Institute for Brain Science. Follow the Allen Institute Citation Policy when displaying this data publicly.
