# Local grant-data staging

`data/raw/` and `data/index/` are ignored by Git. They hold a multi-gigabyte public-data corpus and its reproducible SQLite search index.

## Sources staged

- Grants.gov daily XML: `raw/grants-gov/GrantsDBExtract20260728v2.xml`
- IRS 2026 index: `raw/irs-teos/2026/index_2026.csv`
- IRS XML batches: `raw/irs-teos/2026/2026_TEOS_XML_01A/` through `06A/`
- Original IRS ZIPs: `raw/irs-teos/2026/archives/`

The IRS 2026 index labels records from both `05A` and `05B` as `2026_TEOS_XML_05A`. Both archives are therefore extracted into the same `2026_TEOS_XML_05A/` directory.

## Rebuild

```bash
npm run data:ingest:grants
npm run data:ingest:irs
npm run data:status
```

The streaming importers fingerprint sources and skip unchanged work. Chat requests query `index/grantpilot.sqlite`; they never scan these raw files.

Download replacements from:

- https://www.grants.gov/xml-extract
- https://www.irs.gov/charities-non-profits/form-990-series-downloads
