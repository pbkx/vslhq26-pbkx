# GrantPilot

GrantPilot - A Microsoft 365 Copilot agent that turns a nonprofit’s mission and funding needs into an evidence-ranked grant and private-funder workbench.

## Team

- **Solo:** Yes
- **Members:**
  - @pbkx

## Category

- **Primary:** Copilot integration
- **Secondary (optional):** AI agent/workflow automation

## What it does

Small nonprofits often lack a grant writer and fall back to blind searches or cold outreach. GrantPilot lets them describe their mission, location, and funding needs in everyday language, then searches current federal opportunities and historical private-foundation giving evidence. It returns transparent, deterministic rankings in an interactive workbench embedded directly inside Copilot—not a wall of text. Users can inspect evidence, verify official sources, compare candidates with Copilot, and create email watches for meaningful changes.

## Architecture

```text
Microsoft 365 Copilot Chat
  → GrantPilot declarative agent
  → Remote MCP plugin
  → Streamable HTTP MCP server
  → SQLite full-text index + targeted public APIs
  → deterministic six-factor ranking
  → inline React Grant Opportunity Workbench
  → Azure Communication Services Email watches
```

The declarative agent is the product entry point. The MCP server dynamically exposes grant search, evidence, comparison, and watch tools; the inline MCP App renders four coordinated views for match quality, application effort, award fit, scoring factors, and deadlines. GrantPilot clearly distinguishes active federal opportunities from evidence-backed private donor or funder candidates found through IRS Form 990-PF filings.

## Tech stack

- **Languages:** TypeScript, TSX, HTML, CSS, SQL
- **Frameworks/libraries:** Node.js 22, Express, React, Vite, Zod, SQLite FTS, MCP SDK, MCP Apps SDK, Saxes, Vitest
- **AI models/services:** Microsoft 365 Copilot, Microsoft 365 declarative agents, Remote MCP, Azure Communication Services Email
- **Hosting:** Node.js on port 3000 through a persistent Microsoft Dev Tunnel

## Getting started

### Prerequisites

- macOS, Node.js 22, and npm 10+
- Microsoft 365 account with declarative-agent sideloading or provisioning access
- Microsoft 365 Agents Toolkit for VS Code
- Microsoft Dev Tunnels CLI
- Grants.gov and IRS source files for rebuilding the full index
- Azure Communication Services Email connection string and verified sender for live watch emails

### Setup

```bash
# Clone the repo
git clone https://github.com/pbkx/vslhq26-pbkx.git
cd vslhq26-pbkx

# Install and configure
nvm use 22
npm install
cp .env.example .env

# Build and test
npm run build
npm test

# Build the local search index after staging the source data
npm run data:ingest:grants
npm run data:ingest:irs
npm run data:status

# Start GrantPilot
npm run dev
```

Keep the existing tunnel running in a second terminal:

```bash
devtunnel host camppilot
```

Then verify and package the MCP agent:

```bash
npm run verify:mcp
npm run package:agent
```

In Microsoft 365 Agents Toolkit, run **Lifecycle → Provision**, upload `dist/grantpilot-agent-mcp.zip` if needed, open Microsoft 365 Copilot, and select **GrantPilot**.

### Configuration

Copy `.env.example` to `.env`. Never commit `.env`, credentials, raw datasets, generated indexes, or caches.

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | MCP server binding; defaults to `0.0.0.0:3000` |
| `PUBLIC_ORIGIN` | Public HTTPS origin used by Copilot and email actions |
| `PLUGIN_SERVER_URL` | Public `/mcp` endpoint |
| `GRANTPILOT_DATA_DB` | Generated SQLite search index |
| `GRANTS_GOV_XML_PATH` | Local Grants.gov XML extract |
| `IRS_INDEX_CSV_PATH`, `IRS_XML_ROOT` | Local IRS index and Form 990 XML corpus |
| `GRANTS_GOV_API_BASE_URL` | Targeted live federal verification |
| `USASPENDING_API_BASE_URL` | Historical federal-award context |
| `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING` | Azure email service connection |
| `EMAIL_SENDER_ADDRESS` | Verified Azure email sender |
| `ADMIN_WATCH_TOKEN` | Required authorization for manual watch runs |
| `WATCH_POLL_INTERVAL_MS` | Background watch-check interval |

## Demo (required)

- **Video file in this repo (preferred):** [Watch the GrantPilot demo](./demo/demo.mp4)
- **Video link (YouTube, Loom, etc.) if not committed to repo:** N/A
- **Deployed URL (if any):** `https://rqt1l69t-3000.usw2.devtunnels.ms` while the local server and tunnel are running

Demo prompt:

> We are a nonprofit based in Washington State working to reduce hunger and improve access to food. Find and rank 25 possible federal grants or private funders that may support our work. Focus on opportunities with available or historically typical awards between $10,000 and $500,000.

Expected flow:

1. GrantPilot converts the natural-language request into a structured grant search.
2. The inline Grant Opportunity Workbench opens inside Copilot with ranked results.
3. Four coordinated views expose match quality, pursuit effort, award fit, score evidence, and deadline urgency.
4. Selecting a result reveals its rationale, eligibility concern, geographic evidence, confidence, and six-factor score without another chat message.
5. Official-source actions support verification, while selected candidates can be sent to Copilot for a side-by-side decision analysis.
6. A user can create a watch for one candidate or the full search and receive an actionable Azure email when relevant evidence changes.

GrantPilot transforms blind outreach into evidence-guided action—because nonprofits should compete on the strength of their mission, not the size of their software budget.

## Data ingestion and refresh

GrantPilot processes roughly 13 GB of free public data into a reproducible SQLite full-text index with more than 750,000 searchable records:

- 82,858 deduplicated federal opportunities from 82,995 Grants.gov XML records
- 667,313 private-funder prospect rows derived from 673,424 historical grants in 68,094 IRS Form 990-PF filings

Download the source files from:

- [Grants.gov XML extracts](https://www.grants.gov/xml-extract)
- [IRS Form 990 series downloads](https://www.irs.gov/charities-non-profits/form-990-series-downloads)

Place the extracted files under the ignored `data/raw/` directory:

```text
data/
  raw/
    grants-gov/
      GrantsDBExtract*.xml
    irs-teos/2026/
      index_2026.csv
      2026_TEOS_XML_*/
  index/
    grantpilot.sqlite
```

Build or inspect the index with:

```bash
npm run data:ingest:grants
npm run data:ingest:irs
npm run data:status
```

The importers stream large files, use bounded concurrency, fingerprint source batches, and skip unchanged work. Chat requests never rescan raw XML; they query SQLite FTS, then use targeted Grants.gov verification and optional USAspending context when freshness is useful. To rebuild after replacing a source, append `-- --force` to the relevant ingestion command.

For scheduled IRS refreshes, configure `IRS_INDEX_DOWNLOAD_URL` and `IRS_XML_DOWNLOAD_URLS`, then enable `IRS_AUTO_REFRESH_ENABLED`. HTTP validators and source fingerprints prevent unchanged archives from being downloaded or reprocessed.

## Known limitations

- GrantPilot ranks evidence; it does not guarantee eligibility, funding, or application success.
- IRS Form 990-PF results are potential private donor or funder candidates, not confirmed open applications.
- Federal freshness depends on the local extract plus bounded live verification.
- Raw datasets and generated indexes are excluded from Git and must be downloaded and rebuilt.
- Live watch email delivery requires Azure Communication Services Email credentials and a verified sender.
- The development deployment requires both the local server and Microsoft Dev Tunnel to remain running.
- The no-auth hackathon build scopes watches to the MCP session; production deployment should add OAuth and durable multi-tenant storage.
- GrantPilot does not submit grant applications or contact funders on the user’s behalf.

## License

MIT — Copyright © 2026 pbkx. See [LICENSE](./LICENSE).
