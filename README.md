# Drug Design Universe

Research platform with PubChem batch lookup, source-only ADMET records and docking-file processing. The frontend is static. Cloudflare Pages additionally deploys a small, authenticated ProTox API adapter from `functions/`; static-only hosts retain the provider-result import workflow.

```sh
python3 -m http.server 4173 --bind 0.0.0.0
```

## Research Edition interface

The cover, sign-in screen, workbench, compound lookup, ADMET interface and docking view share a new editorial design: warm paper, dark ink, restrained vermilion, a custom DDU monogram and a matching favicon. There are no particle fields, cursor glows, decorative dashboard simulations or seeded global usage counters.

- `assets/site.css` is the shared design system; `assets/admet-source-ui.css` styles the evidence workflow on both entry points. Deploy both, the SVG assets, and the complete `assets/fonts/` directory.
- DM Sans, Newsreader and IBM Plex Mono are self-hosted WOFF2 fonts with `font-display: swap` and system fallbacks. Original SIL Open Font Licenses are included in `assets/fonts/`. There are no Google Fonts requests.
- The cover uses a finite SVG line-drawing animation and one-time intersection reveals. `prefers-reduced-motion` is honored. The **Motion** button saves a browser-local preference (`ddu_motion`); the overview and native FAQ remain readable without JavaScript. The molecular illustration is explicitly illustrative, not a provider prediction.
- Desktop and mobile navigation use real buttons, shared active state, keyboard focus handling, and consistent headers. Account access has a back action and keyboard submission; standalone ADMET can now sign in without redirecting to the cover. Dialogs trap focus and restore their opener. Filtered command-palette actions resolve the selected filtered command, not its old unfiltered index.
- Workbench metrics refer only to actions recorded in this browser. `ddu_stats` retains local counters; `ddu_recent_activity_v1` keeps at most five completion summaries (type, counts/description and time, **not molecular data**). These are not cross-device analytics or global researcher counts. Damaged optional statistics cannot block the workspace.
- The docking sample is marked **illustrative, not predictions or experimental results**. The PubChem resolver, 500-compound limit, ADMET parser/evidence schema, provider restrictions and export formats are unchanged.

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

### SDF ZIP downloads

The SDF ZIP contains two folders: **`3D sdf/`** for available 3D structures and **`2D sdf/`** for 2D fallbacks only. Each compound is requested in 3D first; 2D is requested only if that 3D request fails or returns no structure. A compound with a downloaded 3D file is not also downloaded in 2D. Each structure remains a separate, named `.sdf` file; both folders are included even if one is empty. Compounds with neither structure are reported as unavailable, not replaced with invented coordinates.

## Source-only ADMET: SwissADME + ProTox 3.0

Both `index.html` and `admet.html` use the same `assets/admet-sources.js` parser/schema, `assets/protox-client.js` API client, and `assets/admet-source-ui.js` interface. The old heuristic engines, hard-coded predictions, editable unsourced result fields, fabricated sample datasets, approximated BOILED-Egg/radar plots and pkCSM report attribution have been removed. No local ADMET or toxicity prediction is generated.

**Source fidelity is not biological certainty.** These are computational predictions/descriptors, not experimental findings or proof of safety, potency, efficacy or clinical suitability. A missing endpoint remains **Not available**, never zero, inactive, compliant or safe. A provider’s confidence or reported accuracy is not a guarantee that a particular prediction is correct.

### Automatic-first workflow

Both entry points now show **Compounds → Start profiling → Results**, rather than the previous multi-step forms and provider explanation cards.

1. **Paste compounds:** enter up to **500** lines and select **SMILES** or **Names / PubChem CIDs**. *Use lookup results* transfers resolved PubChem identities into the input; docking identities can still be added from the docking workflow. PubChem supplies identity and exact returned SMILES only—its MW or other numeric properties never enter ADMET results. *Input options* holds the optional single-compound label; *Add without running* keeps the identity-only/manual workflow available.
2. **Start profiling:** sign in, explicitly consent to sending structures for academic/non-commercial prediction, then click **Start profiling**. It resolves names/CIDs, adds or matches exact identities, submits sequentially to ProTox, waits for the original acute/model/target files, and attaches their evidence. No separate Add or Run-selected step is needed. Input is locked during the run; **Stop** or withdrawing consent stops further work, including identity requests. ProTox still enforces provider availability and quotas; a static-only host disables this action instead of inventing fallback predictions.
3. **Review results:** use **View** to open the selected compound’s reported values, units/models, distinct confidence meanings and source links. Unavailable fields and original/superseded evidence remain accessible in nested disclosures, not a long default table of missing values. CSV, Word (even for one compound) and JSON exports retain the full missing-value and provenance records. Browser storage failures explicitly warn that changes are memory-only; export before reloading.
4. **SwissADME, when needed:** expand **Import SwissADME / ProTox results**. *Prepare SwissADME input* creates batches of at most **200** structures. Run them manually on the provider’s website, one at a time, then import original CSV or copied output with identity/success confirmation. SwissADME’s [terms](https://www.swissadme.ch/termsofuse.php) prohibit automated access by data-retrieval tools; this app does not scrape, proxy or automatically submit to it. Its [FAQ](https://www.swissadme.ch/faq.php) specifies sequential batches of at most 200 and a total submission limit of 10,000. Full automation requires provider authorization and a supported integration.

**Run scope and recovery:** pasted input queues only those exact identities, including already-added pending profiles—not unrelated saved compounds. Completed ProTox records are kept, and repeated exact input is deduplicated. The input stays in place after a run, stop or error so retrying cannot silently broaden its scope. Any unresolved/ambiguous identifier blocks all ProTox submissions for that run; successfully resolved identities may be retained as pending while you correct the input. Conflicting identities and a dataset exceeding 500 fail atomically. With an **empty input**, the primary action explicitly becomes **Profile pending (N)** and resumes missing/pending/partial dataset records. A 500-compound dataset does not bypass the 250-job queue cap or daily provider quota.

**Optional controls:** manual imports, matching/replacement settings, selected-profile evidence, saved sessions, queue controls and help/citations use keyboard-accessible native disclosures. *Queue options* retains **Run / resume selected**, **Run missing profiles (max 250)** and dataset clearing. Import confirmation, explicit provider replacement, exact identity checks and archival evidence are unchanged. The main screen retains concise provider-mode, transmission-consent, quota and prediction-interpretation information.

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

- `GET /api/protox/status` reports whether the adapter exists and its `adapterVersion`, **not upstream health or scientific accuracy**. Version `2026-11-27.2` includes stage-aware provider-response handling; `2026-11-27.1` introduced the Workers redirect-mode correction.
- `POST /api/protox/enqueue` and `/retrieve` require a valid login. Upstream URLs are fixed; this is not an arbitrary proxy. Requests/responses have size limits, network timeouts and redirect rejection. Both authentication and provider fetches use **`redirect: 'manual'` and explicitly reject HTTP 3xx**. Cloudflare Workers does not support `redirect: 'error'`; that earlier setting threw before session verification and caused the generic “ProTox integration failed” banner. Redirects are still never followed, and no insecure TLS overrides are used.
- Sign-in verification failures distinguish an expired/rejected session (sign in again) from an unavailable, unreachable, redirected or unreadable authentication service response. These failures stop before sending any ProTox request and do not expose tokens or raw internal exceptions.
- Responses are interpreted **by API stage**, following the reference script. Enqueue must return a bare job ID; HTML or a 404 there is an error. Retrieve 404 means pending even when its body is HTML. A non-empty successful retrieve response is only a readiness hint, not prediction data: the adapter checks a bounded prefix, discards the control body, then fetches the three fixed job CSV URLs. Only the original CSV files can supply evidence. An HTML 404 CSV remains missing; HTML 200 or malformed CSV still fails closed. PHP's `text/html` media type alone is not enough to reject a valid plain-text job ID or CSV.
- The previous generic “web/error page” banner incorrectly rejected HTML before distinguishing these stages. That original screenshot alone did **not** establish whether submission, polling or a file download failed. Provider failures now identify submission/result check/result file and the upstream HTTP status when available, with a small `diagnostics` object (`adapterVersion`, `stage`, `upstreamStatus`; null if no HTTP response). Neither raw provider pages, request SMILES nor credentials are echoed. The browser preserves only validated metadata and reports the failed provider step, rather than continuing to display “adapter available.” Initial status explicitly says provider availability is unverified. These diagnostics are not a claim that the live provider is healthy.
- Jobs are sequential, with at least 30 seconds between retrieval checks and provider `Retry-After` waits respected. Enqueue POSTs are **not automatically retried**, because a lost response may already have submitted the compound. A timeout, rate limit or quota error stops the queue instead of generating substitute values.
- ProTox documents **250 API queries per source IP/day**. A browser attempts at most 250 new submissions per UTC day; the provider is authoritative and a shared server egress IP may hit its quota earlier. This does not mean 250 predictions are guaranteed or that the 500-compound PubChem limit applies to provider submissions. Pending/partial jobs retain their IDs and exact request SMILES so *Run / resume* retrieves the existing job rather than enqueuing it again. Keep the tab open while processing. Stop/reload does not cancel a job already submitted at the provider.
- GitHub Pages and `python -m http.server` do not run Pages Functions. Imports, evidence review and exports still work; automated ProTox retrieval is clearly disabled there.
- API protocol changes, availability and quota depend on the provider. Automated tests use fixtures; **a live end-to-end provider prediction has not been verified from this sandbox**. The UI reports real failures instead of advertising a successful result.

Optional local adapter build check (no deployment):

```sh
WRANGLER_SEND_METRICS=false npx --yes wrangler@4.168.0 pages functions build --outdir .cache/admet-functions --compatibility-date 2026-11-27
```

### Unresolved production submission failure (2026-11-27)

A subsequent production screenshot shows **`ProTox submission (HTTP 404)`**, with no job ID received. The failing request is the fixed POST to `https://tox.charite.de/protox3/src/api_enqueue.php`, not the local Pages route and not a polling response. The runtime/HTML-handling corrections do **not** resolve that upstream submission failure. Compound identities can exist after PubChem lookup while all provider values remain unavailable.

The official FAQ still links the same API sample; no working replacement route has been verified. The `comptox` home and `tox-new` FAQ resolve to the `tox` site, which is not evidence of an alternative working API. A loaded home page, failed GET/script download, synthetic test or successful deployment cannot establish that the POST API works. The 404 alone does not tell us whether the route was removed, routing is misconfigured, or access from this site's server is restricted. No live jobs were submitted during this investigation.

For restoration, ask the [ProTox web-server team](https://tox.charite.de/protox3/index.php?site=contact) to confirm the current public POST submission/retrieval URLs and whether requests from Cloudflare server IPs need additional authorization. Include the method/path, observed 404, date and adapter revision; do **not** include session tokens or private structures. Do not silently switch hosts, use an undocumented web-form scraper, disable TLS checks or substitute another prediction model.

After a provider failure the compact UI offers **Import provider export**, **Open ProTox** and **Contact ProTox**. These are manual fallback actions, not restored automation. Opening import preserves existing pasted/file input and requires normal identity/source confirmation. Manual imports or successful retrieval of an older job do not clear a failed-submission status. Original data, saved job IDs, attempt accounting and the no-automatic-enqueue-retry rule remain unchanged.

### Provider references (reviewed 2026-11-27)

- [SwissADME terms](https://www.swissadme.ch/termsofuse.php), [FAQ](https://www.swissadme.ch/faq.php), [help/export format](https://www.swissadme.ch/help.php). Daina, Michielin & Zoete (2017), DOI **10.1038/srep42717**.
- [ProTox 3.0 FAQ §2.3](https://tox.charite.de/protox3/index.php?site=faq) documents the POST API, daily quota, output fields and probability semantics. Banerjee et al. (2024), DOI **10.1093/nar/gkae303**.
- The official FAQ links [this API sample script](https://comptox.charite.de/protox3/protox3_api.py). The script download could not be retrieved by the research tool in this environment; its public [Scipion mirror](https://github.com/scipion-chem/scipion-chem-protox/blob/fa57ffa497ea22ae652767aa81b25c0bd8649306/protox/scripts/protox3_api.py) supplied the enqueue/retrieve paths and model codes. We do not copy its insecure TLS override or its response-order mapping. Review upstream changes before changing the adapter.

## Tests

Use Node.js **22.12+**. The resolver, parser and deployed adapter remain dependency-free; development dependencies supply browser testing and the actual Workers runtime:

```sh
npm ci
npm test
```

`npm test` includes `tests/protox-runtime.test.cjs`. These regressions run the unmodified adapter in Cloudflare's **workerd** through pinned Miniflare (the same version bundled with Wrangler 4.168.0). Authentication/provider responses are intercepted at the outbound-service boundary, **after native fetch validates request options**, rather than replacing `fetch` inside the handler. This reproduces runtime incompatibilities such as unsupported redirect modes, while making no live provider submissions. Tests also check that redirects cannot leak a bearer or replay a submission, that HTML 404 polling/file bodies remain pending/missing, that readiness HTML never becomes evidence, that submission HTML fails with safe stage/status diagnostics, and that result retrieval preserves job identity and raw source files. Run just these checks with `npm run test:runtime`.

Browser regression tests use Playwright and axe-core for automated accessibility checks:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

An existing Chromium installation can be used via `CHROMIUM_EXECUTABLE_PATH`. The browser tests start a local static server if port 4173 is not already serving the site. All chemical API, authentication and CDN responses are mocked, so these tests need no login or database access. They cover name normalization, exact matching, ambiguity, rate limiting, timeouts, outages, partial property batches, caching, concurrency, retry/correction, preserved inputs, filtering/pagination, and exports. ADMET tests cover both entry points, one-action automatic SMILES and name/CID runs, exact-input queue scoping/deduplication, failed/ambiguous/501-input and dataset-overflow guards, stop during resolution, consent withdrawal, reload/resume at the daily limit, partial API recovery, 250-job cap confirmation, collapsed-control keyboard access, expanded/mobile accessibility, session saving, 500-record batch identity matching, missing/zero handling, model separation, confidence semantics, malformed source output, legacy isolation, Word/CSV/JSON evidence, queued API association, cancellation, quota errors, source-URL restrictions, authentication and adapter size limits. Design regressions additionally cover local fonts/identity, native FAQ behavior without JavaScript, guest/sign-in/back/sign-out flows, instrument entry, filtered commands, dialog focus, motion preferences, standalone access, docking sample export, local activity, and overflow at 320/390/768/1024/1440 px. Axe scans check the cover, account and workspace states against WCAG 2 A/AA and 2.1 AA rules. Scans use settled reduced-motion states to avoid measuring intermediate reveal opacity; normal and reduced motion are separately tested. Automated scans are not a claim of complete accessibility certification.

Test values are deliberately chosen fixtures, **not genuine predictions for the fixture structures**. The checks do not establish biological accuracy, live provider availability or whether a particular literature name is currently indexed in PubChem.
