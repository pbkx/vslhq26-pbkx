# GrantPilot

A Microsoft 365 Copilot agent that helps nonprofits find, evaluate, compare, and monitor relevant grant opportunities and historical private-funder prospects.

## Team

- **Solo:** Yes
- **Members:**
  - @pbkx

## Category

- **Primary:** Copilot integration
- **Secondary (optional):** AI agent/workflow automation

## What it does

Grant discovery is fragmented across federal opportunity systems, historical award databases, foundation filings, and internal nonprofit knowledge. GrantPilot lets a nonprofit describe its organization and project in Microsoft 365 Copilot, searches a complete local grant-data index, and returns transparent deterministic rankings in an inline MCP App. It clearly separates current Grants.gov opportunities from historical USAspending evidence and IRS 990-PF private-funder prospects, then supports comparison, rescoring, and Azure Communication Services Email watches.

## Architecture

```text
Microsoft 365 Copilot Chat
  → GrantPilot declarative agent
  → Remote MCP plugin
  → GrantPilot Streamable HTTP MCP server
  → search_grants and follow-up MCP tools
  → local Grants.gov + IRS SQLite full-text index
  → optional targeted Grants.gov / USAspending API refresh
  → deterministic scoring
  → inline Grant Opportunity Workbench MCP App
  → Azure Communication Services Email watches
```

The named declarative agent remains the entry point. The web server exists to provide MCP, health, privacy, and terms endpoints; it is not a standalone website product.

`search_grants` returns every matched record in one compact graph-ready payload, so all charts and ranked rows render immediately without widget pagination. The payload includes the numeric scoring, award, deadline, source, and eligibility fields required by the workbench. Selecting a grant silently calls `get_grant_details` through the MCP App host bridge to hydrate the longer evidence text inside the widget without adding a Copilot chat message.

## Tech stack

- **Languages:** TypeScript, TSX, HTML, CSS, SQL
- **Frameworks/libraries:** Node.js 22, Express, React, Vite, Zod, SQLite, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, Saxes, Vitest
- **AI models/services:** Microsoft 365 Copilot, Microsoft 365 declarative agents, Remote MCP, Azure Communication Services Email
- **Hosting:** Local Node.js server on port 3000 exposed through a persistent Microsoft Dev Tunnel

## Getting started

### Prerequisites

- macOS
- Node.js 22 and npm 10+
- Microsoft 365 account that can provision or sideload a declarative agent
- Microsoft 365 Agents Toolkit for VS Code
- Microsoft Dev Tunnels CLI and the configured `camppilot` tunnel
- Optional Azure Communication Services connection string and verified sender address
- No API key is currently required for the Grants.gov `search2` or `fetchOpportunity` endpoints
- Optional API-key placeholders are retained in `.env.example` for future protected endpoints

### Setup

```bash
# Clone the repo
git clone https://github.com/<owner>/<repo>.git
cd <repo>

# Use the supported runtime
nvm use 22

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env

# Build and test
npm run build
npm test

# Build local data indexes after staging the source files
npm run data:ingest:grants
npm run data:ingest:irs
npm run data:status

# Run
npm run dev
```

Keep the existing tunnel running in a second terminal:

```bash
devtunnel host camppilot
```

Verify MCP:

```bash
npm run verify:mcp
```

In Microsoft 365 Agents Toolkit, run **Lifecycle → Provision** before creating
the manual ZIP. Provision writes the environment-specific `TEAMS_APP_ID`, then:

```bash
npm run package:agent
```

The generated package is `dist/grantpilot-agent-mcp.zip`. The packaging script
intentionally refuses to reuse the retired CampPilot ID when `TEAMS_APP_ID` is
unset.

### Microsoft app icon refresh

The development environment intentionally leaves `TEAMS_APP_ID`,
`M365_TITLE_ID`, and `M365_APP_ID` unset once so the next **Lifecycle →
Provision** creates a fresh GrantPilot catalog identity. This avoids Microsoft
365 continuing to show the cached CampPilot mountain icon after the product
rename. The new package uses `grantpilot-color-v2.png` and
`grantpilot-outline-v2.png`; after Provision, select the new **GrantPilot-v2**
app/agent and remove the retired GrantPilot/CampPilot installation. If the
Microsoft 365 client still shows old metadata, sign out and back in before
testing the new agent.

### Configuration

Do not commit `.env`, credentials, raw datasets, generated indexes, or caches. See `.env.example` for the complete shape.

```env
PORT=3000
HOST=0.0.0.0
PUBLIC_ORIGIN=https://rqt1l69t-3000.usw2.devtunnels.ms
PLUGIN_SERVER_URL=https://rqt1l69t-3000.usw2.devtunnels.ms/mcp

GRANTPILOT_DATA_DB=data/index/grantpilot.sqlite
GRANTS_GOV_XML_PATH=data/raw/grants-gov/GrantsDBExtract20260728v2.xml
IRS_INDEX_CSV_PATH=data/raw/irs-teos/2026/index_2026.csv
IRS_XML_ROOT=data/raw/irs-teos/2026
IRS_INGEST_CONCURRENCY=16
IRS_AUTO_REFRESH_ENABLED=true
IRS_REFRESH_ON_STARTUP=true
IRS_REFRESH_INTERVAL_MS=604800000
IRS_INDEX_DOWNLOAD_URL=
IRS_XML_DOWNLOAD_URLS=

GRANTS_GOV_API_KEY=
GRANTS_GOV_API_BASE_URL=https://api.grants.gov
USASPENDING_API_BASE_URL=https://api.usaspending.gov

EMAIL_PROVIDER=azure-communication-services
AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING=
EMAIL_SENDER_ADDRESS=
M365_COPILOT_RETURN_URL=https://m365.cloud.microsoft/chat
ADMIN_WATCH_TOKEN=
WATCH_POLL_INTERVAL_MS=900000
```

Email delivery is production-gated: GrantPilot activates a watch only after
Azure Communication Services confirms that its confirmation email was sent.
If the connection string or verified sender is absent or invalid, delivery
fails closed and the watch remains inactive.

Grant watches use plain-language sensitivity instead of requiring users to
interpret a percentage: **Worth reviewing** (recommended), **Strong matches**,
or **Top matches only**. A user can also choose the watched scope, alert
reasons, deadline reminder window, and delivery cadence while keeping the
single **Create watch** action. Confirmation and alert messages are responsive
HTML emails styled to match the GrantPilot workbench, with native light/dark
mode and an inline CID logo supplied by Azure Communication Services. Every
alert uses event-specific content and includes **Open in Copilot**, the
original evidence/source link, and a signed bearer link to **Manage or cancel
updates**. The management link opens a confirmation page before pausing that
specific watch; standards-compatible email clients also receive
`List-Unsubscribe` headers. `PUBLIC_ORIGIN` must be the reachable HTTPS server
origin so those links return to GrantPilot. When the MCP host exposes the current
conversation URL, GrantPilot preserves it with the watch; otherwise
`M365_COPILOT_RETURN_URL` provides the safe Copilot fallback. The watch checker
suppresses duplicate notifications for the same unchanged event. Each due
check reruns the saved criteria against the current normalized local indexes,
uses the public Grants.gov `search2` API for newly discoverable federal
records, and rescoring the refreshed records while preserving the original
`queryId`. A selected-grant watch bypasses those bounded discovery results and
fetches its exact Grants.gov source ID through `fetchOpportunity`. It can
therefore alert when that record closes, is archived, is removed, or changes;
broad-search watches also report candidates that stop matching the saved
criteria. Watch sensitivity replaces—not compounds—the minimum score from the
original search. Daily and
weekly watches combine all detected changes into one digest; **As detected**
sends individual alerts. Failed deliveries are not marked as notified, so they
remain eligible for delivery after email configuration recovers. Watch creation
first persists a pending record. It becomes active only when Azure confirms the
confirmation send; a provider failure leaves a visible, inactive
`confirmation-failed` record, and retries reuse it instead of creating
duplicates.
While the server is running, a lightweight background poll checks which
watches are due; each watch still honors its own cadence. Timer and admin runs
share an atomic filesystem lease, so processes using the same state volume
cannot send the same event concurrently. `/admin/run-watches` is disabled
unless `ADMIN_WATCH_TOKEN` is configured.

Watch management is owner-scoped. With OAuth, GrantPilot derives ownership
from validated tenant/user claims. In this no-auth hackathon package it falls
back to the MCP session ID: one Copilot session cannot list or delete another
session's watches, and list results mask the stored email address.

## Demo (required)

- **Video file in this repo (preferred):** Not yet recorded
- **Video link (YouTube, Loom, etc.) if not committed to repo:** Not yet published
- **Deployed URL (if any):** `https://rqt1l69t-3000.usw2.devtunnels.ms` while `npm run dev` and `devtunnel host camppilot` are running

Demo prompt:

> Find grants for a Washington nonprofit teaching practical AI skills to low-income adults. We need between $100,000 and $500,000.

Expected behavior:

1. Select GrantPilot in Microsoft 365 Copilot.
2. Copilot calls `search_grants`.
3. GrantPilot searches its indexed Grants.gov and IRS records.
4. The inline Grant Opportunity Workbench renders.
5. Every matched grant appears immediately in all four visualizations and the ranked table.
6. Selecting a grant silently hydrates its full evidence without a new chat message.
7. Current federal opportunities are visibly separated from historical private-funder prospects.
8. Rescoring reuses normalized records without repeating provider searches.
9. Open **Create watch**, choose match sensitivity, alert reasons, cadence, scope, and email destination, then create the watch. Azure Communication Services sends the confirmation and subsequent watch notifications.

## Data ingestion and refresh

Raw data and generated indexes are intentionally excluded from Git because the local corpus is about 13 GB and the reproducible SQLite index is about 1 GB.

Download source data from:

- Grants.gov daily XML: https://www.grants.gov/xml-extract
- IRS Form 990 XML and yearly index CSV: https://www.irs.gov/charities-non-profits/form-990-series-downloads

Stage it as:

```text
data/
  raw/
    grants-gov/
      GrantsDBExtract20260728v2.xml
    irs-teos/2026/
      index_2026.csv
      2026_TEOS_XML_01A/
      2026_TEOS_XML_02A/
      2026_TEOS_XML_03A/
      2026_TEOS_XML_04A/
      2026_TEOS_XML_05A/
      2026_TEOS_XML_06A/
      archives/
  index/
    grantpilot.sqlite
```

For the 2026 IRS release, download both `05A` and `05B`. The IRS index labels records from both halves as `2026_TEOS_XML_05A`, so extract both ZIPs into the same `2026_TEOS_XML_05A/` directory.

The importers use streaming parsers and bounded concurrency:

```bash
npm run data:ingest:grants
npm run data:ingest:irs
npm run data:refresh:irs
npm run data:status
```

Observed local ingestion:

- 82,858 deduplicated Grants.gov opportunities from 82,995 XML records
- 68,094 index-selected IRS 990-PF filings
- 673,424 historical foundation-grant occurrences, deduplicated to 667,313 indexed rows
- zero non-990-PF IRS XML files opened by the importer

Interactive chat requests never scan raw XML. They query the complete SQLite full-text index. Importers fingerprint the source extract and batch directories, then skip unchanged work. Use `--force` only after repairing or replacing a source:

```bash
npm run data:ingest:grants -- --force
npm run data:ingest:irs -- --force
```

For an automated private-funder refresh, set
`IRS_AUTO_REFRESH_ENABLED=true`, supply the current official index CSV URL in
`IRS_INDEX_DOWNLOAD_URL`, and provide comma-separated official XML ZIP URLs in
`IRS_XML_DOWNLOAD_URLS`. The server periodically runs
`npm run data:refresh:irs`: HTTP ETag/Last-Modified headers avoid unchanged
downloads, only changed ZIPs are extracted, and the existing source
fingerprint prevents an unchanged 990-PF corpus from being reprocessed. Keep
automatic refresh disabled when an external scheduler or data pipeline already
stages these files.

The hybrid API strategy preserves freshness without slow broad calls:

- `search_grants` reads the full local index on every request.
- `refreshData: true` bypasses the normalized result cache and attempts targeted live Grants.gov verification for at most three selected federal records.
- USAspending is refreshed only for explicit Assistance Listing numbers, capped at 25 per command, and reused for 24 hours:

```bash
npm run data:refresh:usaspending -- 17.268 93.243
```

Source roles are enforced:

- Grants.gov determines current or forecasted federal opportunity status.
- USAspending supplies historical federal-award context only.
- IRS 990-PF supplies evidence-backed potential private donor/funder candidates worth researching and possibly contacting.

## Known limitations

- Live freshness is bounded by the local extract unless targeted verification is requested.
- USAspending data is historical and can lag agency activity.
- IRS 990-PF records provide evidence-backed potential private donor/funder candidates worth researching and possibly contacting.
- IRS EO BMF identity validation requires its separate CSV extract and is not yet ingested.
- Raw datasets and generated indexes must be recreated after cloning because they cannot reasonably be stored in Git.
- The Microsoft Dev Tunnel URL works only while the local server and tunnel host are running.
- Azure Communication Services Email requires a valid connection string and verified sender supplied through environment variables; GrantPilot never commits or exposes those values.
- Session ownership is the strongest identity available in the no-auth demo. Configure MCP OAuth to manage the same watches across separate Copilot conversations.
- The filesystem watch-run lease coordinates processes that share one state volume. A horizontally scaled deployment with separate filesystems should replace it with a database/distributed lease.
- The demo video has not yet been recorded.
- GrantPilot does not submit applications, guarantee eligibility, or guarantee funding.

## License

MIT — Copyright © 2026 pbkx. See [LICENSE](./LICENSE).
