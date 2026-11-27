# Drug Design Universe

Static research platform with PubChem batch lookup, ADMET tools and docking-file processing. Serve the repository root; there is no application build step.

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
- No HTML-page scraping, hard-coded name-to-CID table, fabricated molecular formula/weight or placeholder SMILES is used in the **batch lookup**. Unavailable fields stay blank; unavailable records remain unresolved. This change does not alter the separate ADMET prediction workflows.
- Multiple exact matches require manual review of the candidate CIDs; the first match is not silently chosen.

### Recovering unresolved compounds

Network/service failures are shown separately from confirmed **no exact match** results. Use **Retry failed** for just the unresolved entries, or expand a row to correct the name or enter a verified CID/structure. Successful rows and original inputs are preserved. Unresolved rows can be searched and paginated like successful ones.

The spreadsheet contains successful records with the original input, actual lookup query and match provenance. **Unresolved (.csv)** exports failed inputs and reasons separately for checking against the source publication.

A literature name may be absent from PubChem, ambiguous, or misspelled. Formatting and retries cannot create a missing record. Verify the spelling or supply a CID/structure from a trusted source; do not remove α/β, D/L, primes or substituents to obtain a different compound. Browser/network access to PubChem and NCBI is still required.

## Tests

Use Node.js 22+ for the dependency-free resolver and static-script tests:

```sh
npm test
```

Browser regression tests use Playwright:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

An existing Chromium installation can be used via `CHROMIUM_EXECUTABLE_PATH`. The browser tests start a local static server if port 4173 is not already serving the site. All chemical API, authentication and CDN responses are mocked, so these tests need no login or database access. They cover name normalization, exact matching, ambiguity, rate limiting, timeouts, outages, partial property batches, caching, concurrency, retry/correction, preserved inputs, filtering/pagination, and exports. They do **not** assert that a particular literature name is currently indexed in the live PubChem database.
