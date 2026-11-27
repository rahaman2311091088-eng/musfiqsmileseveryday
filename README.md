# Drug Design Universe

Research platform with PubChem batch lookup, source-only ADMET records and docking-file processing. The frontend is static. Cloudflare Pages additionally deploys a small, authenticated ProTox API adapter from `functions/`; static-only hosts retain the provider-result import workflow.

```sh
python3 -m http.server 4173 --bind 0.0.0.0
```

## Reliable PubChem batch lookup

The batch lookup in `index.html` uses `assets/pubchem-lookup.js`. **Deploy the `assets/` directory along with the HTML files.** No backend, API key or new production dependency is required.

### Inputs

Enter up to 500 identifiers, one per line, or import them from Excel/CSV. Commas inside chemical names are preserved. Files with more than 500 entries load the first 500 and show a notice to import the remainder in another batch.

This is one batch of up to 500 molecules, not 500 simultaneous API requests. Large name-based batches may take several minutes because request pacing and automatic retries remain enabled. Keep the tab open until processing finishes.

- A compound name, such as `Methyl ferulate`.
- A numeric CID, `CID: 2244`, or `PubChem CID 2244`.
- `SMILES: CCO` (use the explicit prefix; structure case and special characters are preserved).
- An InChI beginning with `InChI=` or an InChIKey.

The original name is tried first, followed by conservative formatting variants: Unicode dashes/primes/quotes, whitespace, Greek letters spelled out, and supported GC-MS name inversions. For example, `3-O-β-D-xylopyranoside` can be searched as `3-O-beta-D-xylopyranoside`. The resolver **does not remove stereochemistry, sugars, ester groups or substituents to force a match**, and does not guess typo corrections or CIDs.

### Requests and data integrity

- PUG REST exact-name/structure lookup uses form POSTs, avoiding special characters in URL paths. An exact, quoted NCBI `CompleteSynonym` search is the fallback for names; broad search results are never auto-selected.
- At most two API requests are in flight, with starts at least 400 ms apart. Each attempt has a 15-second timeout covering the response body as well as the connection.
- Network errors, timeouts, rate limits, server failures and malformed responses are retried up to twice with exponential backoff. `Retry-After` is respected; long waits become an actionable error instead of an early retry. An outage circuit breaker prevents repeating a failing request for every entry.
- Properties are fetched in batches of up to 20 CIDs, using PubChem's `Title` instead of a separate burst of synonym requests. Invalid CID batches are split to isolate the bad identifier; partial responses retry only missing CIDs. An outage does not trigger a per-CID request storm.
- Only successful resolutions and returned properties are cached in memory. Explicit retry/new batches can recover from earlier failures.
- No HTML-page scraping, hard-coded name-to-CID table, fabricated molecular formula/weight or placeholder SMILES is used in the **batch lookup**. Unavailable fields stay blank; unavailable records remain unresolved. ADMET source integrity is described below; its descriptors/predictions are never filled from PubChem properties.
- Multiple exact matches require manual review of the candidate CIDs; the first match is not silently chosen.

### Recovering unresolved compounds

Network/service failures are shown separately from confirmed **no exact match** results. Use **Retry failed** for just the unresolved entries, or expand a row to correct the name or enter a verified CID/structure. Successful rows and original inputs are preserved. Unresolved rows can be searched and paginated like successful ones.

The spreadsheet contains successful records with the original input, actual lookup query and match provenance. **Unresolved (.csv)** exports failed inputs and reasons separately for checking against the source publication.

A literature name may be absent from PubChem, ambiguous, or misspelled. Formatting and retries cannot create a missing record. Verify the spelling or supply a CID/structure from a trusted source; do not remove α/β, D/L, primes or substituents to obtain a different compound. Browser/network access to PubChem and NCBI is still required.

## Source-only ADMET: SwissADME + ProTox 3.0

Both `index.html` and `admet.html` use the same `assets/admet-sources.js` parser/schema, `assets/protox-client.js` API client, and `assets/admet-source-ui.js` interface. The old heuristic engines, hard-coded predictions, editable unsourced result fields, fabricated sample datasets, approximated BOILED-Egg/radar plots and pkCSM report attribution have been removed. No local ADMET or toxicity prediction is generated.

**Source fidelity is not biological certainty.** These are computational predictions/descriptors, not experimental findings or proof of safety, potency, efficacy or clinical suitability. A missing endpoint remains **Not available**, never zero, inactive, compliant or safe. A provider’s confidence or reported accuracy is not a guarantee that a particular prediction is correct.

### Workflow

1. Add up to **500 exact structures/CIDs**, or transfer resolved PubChem/docking identities. PubChem is used only for identity and SMILES; its MW or other properties never enter the ADMET results.
2. **SwissADME:** use *Prepare SwissADME batches* to download input lists of at most **200** structures. Run them manually on the provider’s website, one batch at a time; wait for completion before the next. Import its original CSV, or copied result text. SwissADME’s [terms](https://www.swissadme.ch/termsofuse.php) prohibit automated access by data-retrieval tools, so this app does not scrape, proxy, or automatically submit to it. Its [FAQ](https://www.swissadme.ch/faq.php) specifies sequential batches of at most 200 and a total submission limit of 10,000. Full SwissADME automation would require the provider’s authorization and a supported integration.
3. **ProTox 3.0:** sign in, confirm transmission of your structures for academic/non-commercial prediction, and choose *Run / resume selected* or *Run missing profiles*. On Cloudflare Pages, the same-origin adapter submits exact SMILES to the published API, requests the model list in its reference script, and retrieves original acute/model/target CSV files. On a static-only host or provider outage, use the manual result import; no fallback predictions are invented.
4. **Review and export:** inspect each value, unit/model, confidence meaning, source URL, method, import timestamp and source evidence. Export CSV, Word (even for one compound), or a JSON evidence archive. Word/JSON include original source records, including superseded imports. CSV preserves source precision and neutralizes formula-like text. Browser storage errors are shown explicitly; export before reloading if storage is unavailable/full.

The easiest way to keep the provider structures aligned is to **import SwissADME results first, then run ProTox on those exact reported SMILES**. For batch imports, select *Match exact identity / add new records*: unambiguous exact SMILES/CID matches update existing records, regardless of row order. Names alone never match. If both records contain SMILES/CID, conflicting identifiers block merging even when names agree. Differently canonicalized SMILES may represent the same compound, but this app does not guess equivalence; keep such records separate or independently verify the structures before creating a consistent source dataset. A result without structural identity must be explicitly attached to a selected structure with user confirmation.

### Data integrity and supported output

- Only SwissADME and ProTox are accepted. Pasted text/files are **user-supplied output, not independently authenticated provider responses**. Source selection and successful-run/identity confirmation are required. Incorrect or forged user input cannot be made authentic by a parser.
- SwissADME CSV/TSV supports named headers, quoted cells, BOMs, comma/semicolon/tab separators, and multiple compounds. Supported text labels are parsed conservatively; raw evidence remains available for unrecognized pasted fields. Unknown SwissADME CSV columns are retained as explicitly labelled source text, not interpreted as another model.
- Consensus LogP, XLOGP3, WLOGP, iLOGP, MLOGP and Silicos-IT are separate, as are ESOL/Ali/Silicos-IT LogS. No XLOGP3 → Consensus fallback; no derived drug-likeness or absent violation count. Provider BOILED-Egg/radar graphics must be viewed at the provider, not approximated here.
- ProTox uses its documented `input`, `type`, `Target`, `Prediction`, `Probability` CSV/TSV format. Choose whether an imported `input` column contains names or SMILES. Acute classes **1–6** are supported. ProTox BBB/CYP activity is **not** substituted for SwissADME BBB permeability/CYP inhibition.
- ProTox `Probability` means **average similarity (0–100%)** for acute toxicity, **confidence (0–1)** for toxicity models, or **average pharmacophore fit (0–1)** for toxicity targets. Reported prediction accuracy is a separate field and is never inferred from similarity. The documented 1/0 activity encoding is displayed as Active/Inactive, with the original raw row retained.
- Invalid units/ranges, conflicting values/confidence, inconsistent CSVs, failure messages, wrong job IDs/URLs and compound mismatches fail closed. All requested ProTox models have explicit unavailable fields until their own values arrive. Missing file types are marked partial and can be resumed.
- Replacing a provider’s result requires explicit permission. The replacement removes its stale fields rather than silently filling gaps from an older result; the old evidence remains archived. Cross-provider values are preserved.
- Legacy `ddu_admet_compounds` values are left untouched but excluded from current tables, dashboard statistics and reports. Old cloud sessions can be downloaded for review; sessions without source-schema/evidence validation cannot be silently restored as genuine provider data. New sessions preserve evidence in the existing `admet_sessions` table.

### ProTox deployment, limits and failure behavior

Deploy the HTML, `assets/`, `functions/`, `server/` and `_routes.json` together using **Cloudflare Pages Git integration**. No new API secret or environment variable is required: the adapter validates the existing Supabase user JWT against the same auth service the site already uses. The public anon key is not a service-role credential. The JWT is **never forwarded to ProTox**. Restricting the app’s public/shared guest account or changing Supabase RLS policies is a separate administration task.

- `GET /api/protox/status` reports whether the adapter exists, **not upstream health or scientific accuracy**.
- `POST /api/protox/enqueue` and `/retrieve` require a valid login. Upstream URLs are fixed; this is not an arbitrary proxy. Requests/responses have size limits, network timeouts and redirect rejection. No insecure TLS overrides are used.
- Jobs are sequential, with at least 30 seconds between retrieval checks and provider `Retry-After` waits respected. Enqueue POSTs are **not automatically retried**, because a lost response may already have submitted the compound. A timeout, rate limit or quota error stops the queue instead of generating substitute values.
- ProTox documents **250 API queries per source IP/day**. A browser attempts at most 250 new submissions per UTC day; the provider is authoritative and a shared server egress IP may hit its quota earlier. This does not mean 250 predictions are guaranteed or that the 500-compound PubChem limit applies to provider submissions. Pending/partial jobs retain their IDs and exact request SMILES so *Run / resume* retrieves the existing job rather than enqueuing it again. Keep the tab open while processing. Stop/reload does not cancel a job already submitted at the provider.
- GitHub Pages and `python -m http.server` do not run Pages Functions. Imports, evidence review and exports still work; automated ProTox retrieval is clearly disabled there.
- API protocol changes, availability and quota depend on the provider. Automated tests use fixtures; **a live end-to-end provider prediction has not been verified from this sandbox**. The UI reports real failures instead of advertising a successful result.

Optional local adapter build check (no deployment):

```sh
WRANGLER_SEND_METRICS=false npx --yes wrangler@4.168.0 pages functions build --outdir .cache/admet-functions --compatibility-date 2026-11-27
```

### Provider references (reviewed 2026-11-27)

- [SwissADME terms](https://www.swissadme.ch/termsofuse.php), [FAQ](https://www.swissadme.ch/faq.php), [help/export format](https://www.swissadme.ch/help.php). Daina, Michielin & Zoete (2017), DOI **10.1038/srep42717**.
- [ProTox 3.0 FAQ §2.3](https://tox.charite.de/protox3/index.php?site=faq) documents the POST API, daily quota, output fields and probability semantics. Banerjee et al. (2024), DOI **10.1093/nar/gkae303**.
- The official FAQ links [this API sample script](https://comptox.charite.de/protox3/protox3_api.py). The script download could not be retrieved by the research tool in this environment; its public [Scipion mirror](https://github.com/scipion-chem/scipion-chem-protox/blob/fa57ffa497ea22ae652767aa81b25c0bd8649306/protox/scripts/protox3_api.py) supplied the enqueue/retrieve paths and model codes. We do not copy its insecure TLS override or its response-order mapping. Review upstream changes before changing the adapter.

## Tests

Use Node.js 22+ for the dependency-free resolver, source parser, API adapter/client and static-script tests:

```sh
npm test
```

Browser regression tests use Playwright:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

An existing Chromium installation can be used via `CHROMIUM_EXECUTABLE_PATH`. The browser tests start a local static server if port 4173 is not already serving the site. All chemical API, authentication and CDN responses are mocked, so these tests need no login or database access. They cover name normalization, exact matching, ambiguity, rate limiting, timeouts, outages, partial property batches, caching, concurrency, retry/correction, preserved inputs, filtering/pagination, and exports. ADMET tests cover both entry points, 500-record batch identity matching, missing/zero handling, model separation, confidence semantics, malformed source output, legacy isolation, Word/CSV/JSON evidence, queued API association, cancellation, quota errors, source-URL restrictions, authentication and adapter size limits. Test values are deliberately chosen fixtures, **not genuine predictions for the fixture structures**. The checks do not establish biological accuracy, live provider availability or whether a particular literature name is currently indexed in PubChem.
