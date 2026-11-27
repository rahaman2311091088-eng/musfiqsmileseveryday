/* Shared, source-only ADMET UI for index.html and admet.html. */
(function () {
  'use strict';
  const root = document.getElementById('admetSourceApp');
  if (!root) return;
  const S = window.AdmetSources;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = profile => profile.identity.label || (profile.identity.cid ? `CID ${profile.identity.cid}` : profile.identity.smiles || 'Unlabelled source result');
  const stamp = () => new Date().toISOString().slice(0, 10);
  const storageGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
  let loaded = S.loadStored(storageGet(S.STORAGE_KEY));
  let profiles = loaded.profiles, selectedId = profiles[0]?.id || '', importTargetId = '';
  let busy = false, apiAvailable = false, queueController = null, legacySession = null;
  let lastProviderFailure = null;
  const legacy = storageGet('ddu_admet_compounds');
  root.classList.add('admet-source-app');
  root.innerHTML = `
    <div class="source-kicker">02 / ADMET</div>
    <h1 class="source-title" tabindex="-1">ADMET <em>profiling.</em></h1>
    <p class="admet-mode-note"><span>ProTox · automatic</span><span>SwissADME · manual import</span></p>
    <div id="admetLegacyWarning" class="source-notice" ${!legacy && !loaded.excluded ? 'hidden' : ''}>Older unsourced records were excluded. <button id="admetLegacyExport">Download for review</button></div>
    <div id="admetStorageWarning" class="source-notice" hidden></div>

    <section class="source-card admet-run-card" id="admetIdentitySection" aria-labelledby="admetInputTitle">
      <div class="admet-input-heading"><h2 id="admetInputTitle">Compounds</h2><span id="admetInputCount" class="source-muted">0 / 500</span></div>
      <div class="admet-input-toolbar"><label for="admetIdentityType">Input</label><select id="admetIdentityType"><option value="smiles">SMILES</option><option value="cid">Names / PubChem CIDs</option></select><button id="admetFromPubchem" ${root.dataset.standalone ? 'hidden' : ''}>Use lookup results</button></div>
      <label class="visually-hidden" for="admetIdentityInput">Compounds, one per line</label><textarea id="admetIdentityInput" spellcheck="false" placeholder="Paste SMILES, one per line."></textarea>
      <div class="admet-input-options"><details id="admetInputOptions"><summary>Input options</summary><div class="source-actions"><label for="admetIdentityLabel">Label (one compound)</label><input id="admetIdentityLabel" placeholder="Optional label" maxlength="200"></div></details><button id="admetAddIdentity">Add without running</button></div>
      <label class="source-checkbox"><input type="checkbox" id="admetApiConsent">Send these structures to ProTox for academic/non-commercial prediction.</label>
      <div class="admet-run-actions"><button class="source-primary" id="admetAutoRun" disabled>Start profiling <span aria-hidden="true">↗</span></button><button id="admetStopProtox" disabled hidden>Stop</button><span id="admetApiStatus" class="source-muted">Checking ProTox integration…</span></div>
      <div id="admetQueueProgress" class="admet-queue-progress" hidden><div id="admetQueueLabel" class="source-muted"></div><progress id="admetQueueMeter" max="1" value="0" aria-label="Profiling progress"></progress></div>
    </section>
    <div id="admetSourceMessage" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    <div id="admetProviderRecovery" class="source-actions admet-provider-recovery" role="group" aria-label="Provider connection alternatives" hidden><button id="admetOpenProviderImport">Import provider export</button><a href="https://tox.charite.de/protox3/" target="_blank" rel="noopener noreferrer">Open ProTox ↗</a><a href="https://tox.charite.de/protox3/index.php?site=contact" target="_blank" rel="noopener noreferrer">Contact ProTox ↗</a></div>

    <section class="source-card" id="admetSourceDataset" aria-labelledby="admetResultsTitle">
      <div class="admet-results-heading"><h2 id="admetResultsTitle">Results</h2><div class="source-actions admet-exports"><button id="admetGenerateDocxBtn">Word report</button><button id="admetExportCsvBtn">CSV</button><button id="admetExportEvidence">Evidence JSON</button></div></div>
      <div id="admetSourceMetrics" class="source-metrics"></div>
      <div class="admet-results-toolbar"><label class="visually-hidden" for="admetSourceFilter">Filter records</label><input id="admetSourceFilter" placeholder="Filter by name, CID or SMILES"><details id="admetQueueOptions" class="admet-queue-options"><summary>Queue options</summary><div class="source-actions"><button id="admetRunProtox" disabled>Run / resume selected</button><button id="admetRunProtoxBatch" disabled>Run missing profiles (max 250)</button><button id="admetClearProfiles" class="source-delete">Clear dataset</button></div></details></div>
      <div class="source-table-wrap"><table id="admetSourceTable"><thead><tr><th>Compound</th><th>SwissADME</th><th>ProTox 3.0</th><th>Review</th></tr></thead><tbody id="admetSourceRows"></tbody></table></div>
      <p class="admet-result-note">Predictions are not proof of safety or efficacy. Missing results stay unavailable.</p>
    </section>

    <details class="source-card source-disclosure" id="admetImportSection">
      <summary>Import SwissADME / ProTox results</summary>
      <div class="source-disclosure-body">
        <div id="admetProviderSection" class="admet-swiss-tools"><span class="source-muted">SwissADME: run batches manually (≤200 each), then import its export.</span><div class="source-actions"><button id="admetSwissInputs">Prepare SwissADME input</button><a href="https://www.swissadme.ch/" target="_blank" rel="noopener noreferrer">Open SwissADME ↗</a></div><div id="admetSwissDownloads" class="source-actions"></div></div>
        <div class="source-grid"><div><label for="admetImportProvider">Provider</label><select id="admetImportProvider"><option value="swissadme">SwissADME</option><option value="protox">ProTox 3.0</option></select></div><div><label for="admetSourceFile">Export file · CSV / TSV / TXT · max 2 MB</label><input type="file" id="admetSourceFile" accept=".csv,.tsv,.txt,text/plain,text/csv"></div></div>
        <label for="admetSourceText">Or paste provider output</label><textarea id="admetSourceText" spellcheck="false" placeholder="Original CSV, TSV or result text, including compound identity."></textarea>
        <details id="admetImportOptions" class="admet-import-options"><summary>Matching &amp; replacement options</summary><div class="source-grid"><div><label for="admetImportTarget">Attach to</label><select id="admetImportTarget"><option value="">Match exact identity / add new records</option></select></div><div><label for="admetProtoxInputType">ProTox input column</label><select id="admetProtoxInputType"><option value="smiles">SMILES</option><option value="name">Names — confirm identity manually</option></select></div><div><label for="admetSourceUrl">Result URL (optional)</label><input id="admetSourceUrl" type="url" placeholder="https://…"></div></div><label class="source-checkbox"><input type="checkbox" id="admetReplaceSource">Replace this provider’s previous values; archive the old evidence.</label></details>
        <label class="source-checkbox"><input type="checkbox" id="admetIdentityConfirm">I verified the provider, exact compound identity and successful calculation.</label>
        <div class="source-actions"><button id="admetImportResults" class="source-primary">Import results</button><button id="admetClearSource">Clear input</button></div>
      </div>
    </details>

    <details class="source-card source-disclosure" id="admetSelectedRecord"><summary>Compound details &amp; evidence</summary><div class="source-disclosure-body" id="admetSourceDetails">Select a compound to review its values.</div></details>
    <details class="source-card source-disclosure" id="admetHistorySection" hidden><summary>Saved sessions</summary><div class="source-disclosure-body"><div class="source-actions"><input id="historySessionName" aria-label="Session name" placeholder="Session name (optional)" style="max-width:280px"><button id="historySaveBtn">Save</button><button id="historyRefreshBtn">Refresh</button></div><div id="historyMsg" role="status"></div><div id="historyList"></div></div></details>
    <details class="source-disclosure admet-help" id="admetHelp"><summary>Help &amp; sources</summary><div class="source-disclosure-body">
      <p><strong>Automatic profiling:</strong> resolves names/CIDs through PubChem, submits exact SMILES to ProTox, waits for results and attaches the returned evidence. No local predictions are generated. Only pasted compounds are queued; with an empty input, Profile pending resumes missing profiles in the dataset. Unresolved inputs stop submission for review.</p>
      <p><strong>Limits:</strong> 500 compounds per dataset; ProTox ≤250 API queries per source IP/day, processed sequentially. Provider delays and shared-IP limits apply. Stop does not cancel jobs already received by the provider. Resume retrieves saved job IDs without submitting them again.</p>
      <p><strong>SwissADME:</strong> automated access is prohibited. Prepare input, run each batch sequentially on its website, then import the original results. <a href="https://www.swissadme.ch/termsofuse.php" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="https://www.swissadme.ch/faq.php" target="_blank" rel="noopener noreferrer">Batch guidance</a></p>
      <p><strong>Interpretation:</strong> file/paste imports are user-supplied and not independently authenticated. Missing or inactive endpoints do not establish safety, efficacy or potency. ProTox acute similarity, model confidence and target fit are different metrics. Review original evidence; exact identities, zeros and reported precision are preserved in exports.</p>
      <p><a href="https://tox.charite.de/protox3/" target="_blank" rel="noopener noreferrer">ProTox 3.0 ↗</a> · <a href="https://tox.charite.de/protox3/index.php?site=faq" target="_blank" rel="noopener noreferrer">API &amp; confidence definitions</a></p>
      <p>SwissADME: Daina et al. (2017), DOI 10.1038/srep42717. ProTox 3.0: Banerjee et al. (2024), DOI 10.1093/nar/gkae303.</p>
    </div></details>`;

  function message(text, error = false, providerRecovery = false) {
    $('admetSourceMessage').hidden = !text;
    $('admetSourceMessage').textContent = text;
    $('admetSourceMessage').dataset.error = String(error);
    $('admetProviderRecovery').hidden = !providerRecovery;
  }
  function providerFailed(details) {
    lastProviderFailure = details;
    const stage = { enqueue: 'submission', retrieve: 'result check', file: 'result download' }[details.stage];
    $('admetApiStatus').textContent = `Last ProTox ${stage} failed · ${details.upstreamStatus === null ? 'no HTTP response' : `HTTP ${details.upstreamStatus}`}.`;
    $('admetApiStatus').dataset.error = 'true';
    $('admetApiStatus').title = 'The adapter exists, but this provider request failed. A submission 404 is not a pending job or a successful prediction.';
  }
  function providerRecovered(stage) {
    // Retrieving an older job does not establish that new submissions work.
    if (!lastProviderFailure || (lastProviderFailure.stage === 'enqueue') !== (stage === 'enqueue')) return;
    lastProviderFailure = null;
    $('admetApiStatus').textContent = stage === 'enqueue' ? 'Last ProTox submission accepted.' : 'Last ProTox result received · see source evidence below.';
    $('admetApiStatus').dataset.error = 'false';
    $('admetApiStatus').title = 'This describes the last response, not a guarantee of future provider availability or scientific accuracy.';
  }
  $('admetOpenProviderImport').addEventListener('click', () => {
    if (busy) return;
    // Never reinterpret or clear an in-progress SwissADME/file import.
    if (!$('admetSourceText').value.trim() && !$('admetSourceFile').files.length) {
      $('admetImportProvider').value = 'protox';
      $('admetIdentityConfirm').checked = false;
      $('admetReplaceSource').checked = false;
    }
    $('admetImportSection').open = true;
    $('admetImportProvider').focus();
  });
  function download(data, filename, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function persist(next) {
    if (next.length > 500) throw new Error('The dataset limit is 500 compounds. Export or remove records before adding more.');
    if (!next.every(S.isProfile)) throw new Error('Unsourced or invalid data was blocked from the dataset.');
    profiles = next;
    try {
      localStorage.setItem(S.STORAGE_KEY, JSON.stringify(profiles));
      $('admetStorageWarning').hidden = true;
    } catch {
      $('admetStorageWarning').textContent = 'Browser storage is full or unavailable. Changes are in memory only. Download the JSON evidence archive before reloading.';
      $('admetStorageWarning').hidden = false;
    }
    render();
  }
  function queueProgress(text, completed, total) {
    $('admetQueueProgress').hidden = false;
    $('admetQueueLabel').textContent = text;
    $('admetQueueMeter').max = Math.max(1, total);
    $('admetQueueMeter').value = completed;
  }
  const needsProtox = p => p.identity.smiles && (!Object.values(p.values).some(v => v.source === 'protox') || ['pending', 'partial'].includes(p.protoxJob?.status));
  function setBusy(value) {
    busy = value;
    for (const id of ['admetAddIdentity', 'admetFromPubchem', 'admetImportResults', 'admetClearProfiles', 'historySaveBtn', 'admetIdentityInput', 'admetIdentityType', 'admetIdentityLabel']) $(id).disabled = value;
    $('admetStopProtox').disabled = !queueController;
    $('admetStopProtox').hidden = !queueController;
    updateApiButtons();
  }
  function updateApiButtons() {
    const enabled = !busy && apiAvailable && $('admetApiConsent').checked;
    const inputs = window.PubChemLookup.parseEntries($('admetIdentityInput').value).length;
    const pending = profiles.filter(needsProtox).length;
    $('admetInputCount').textContent = `${inputs} / 500`;
    $('admetInputCount').dataset.error = String(inputs > 500);
    $('admetAutoRun').disabled = !enabled || (!inputs && !pending);
    $('admetAutoRun').textContent = queueController ? 'Profiling…' : inputs || !pending ? 'Start profiling ↗' : `Profile pending (${pending}) ↗`;
    $('admetAutoRun').title = inputs ? 'Profile only the pasted compounds; existing results are kept.' : 'Run or resume missing ProTox profiles in this dataset.';
    $('admetRunProtox').disabled = !enabled || !profiles.find(p => p.id === selectedId)?.identity.smiles;
    $('admetRunProtoxBatch').disabled = !enabled || !pending;
  }
  function render() {
    const selected = profiles.find(p => p.id === selectedId);
    if (!selected) selectedId = profiles[0]?.id || '';
    if (!profiles.some(p => p.id === importTargetId)) importTargetId = '';
    $('admetImportTarget').innerHTML = '<option value="">Match exact identity / add new records</option>' + profiles.map(p => `<option value="${esc(p.id)}">${esc(nameOf(p))}</option>`).join('');
    $('admetImportTarget').value = importTargetId;
    const counts = { swissadme: 0, protox: 0 };
    profiles.forEach(p => Object.keys(counts).forEach(source => { if (Object.values(p.values).some(v => v.source === source)) counts[source]++; }));
    $('admetSourceMetrics').innerHTML = [[profiles.length, 'Compounds'], [counts.protox, 'With ProTox values'], [counts.swissadme, 'With SwissADME values']].map(([number, label]) => `<div class="source-metric"><strong>${number}</strong><span>${label}</span></div>`).join('');
    const query = $('admetSourceFilter').value.toLowerCase();
    const filtered = profiles.filter(p => [p.identity.label, p.identity.cid, p.identity.smiles].some(v => v.toLowerCase().includes(query)));
    const shortStatus = (p, source) => S.status(p, source).replace(' — awaiting provider results', '');
    $('admetSourceRows').innerHTML = filtered.length ? filtered.map(p => `<tr class="${p.id === selectedId ? 'source-selected' : ''}"><td><strong>${esc(nameOf(p))}</strong><div class="source-muted">${p.identity.cid ? `CID ${esc(p.identity.cid)} · ` : ''}${esc(p.identity.smiles)}</div></td><td>${esc(shortStatus(p, 'swissadme'))}</td><td>${esc(shortStatus(p, 'protox'))}${p.protoxJob ? `<div class="source-muted">Job: ${esc(p.protoxJob.status)}</div>` : ''}</td><td><button data-review="${esc(p.id)}" aria-label="View ${esc(nameOf(p))}">View</button><button data-delete="${esc(p.id)}" class="source-delete" aria-label="Remove ${esc(nameOf(p))}" ${busy ? 'disabled' : ''}>Remove</button></td></tr>`).join('') : `<tr><td colspan="4">${profiles.length ? 'No matching compounds.' : 'No compounds yet. Paste your inputs above to start.'}</td></tr>`;
    $('admetSourceRows').querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', () => {
      selectedId = button.dataset.review; importTargetId = selectedId; render();
      $('admetSelectedRecord').open = true;
      $('admetSelectedRecord').querySelector('summary').focus({ preventScroll: true });
      $('admetSelectedRecord').scrollIntoView({ block: 'start', behavior: document.documentElement.classList.contains('motion-paused') || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }));
    $('admetSourceRows').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => { if (!busy && confirm('Remove this compound and its source evidence from the current dataset? Saved sessions are unchanged.')) persist(profiles.filter(p => p.id !== button.dataset.delete)); }));
    for (const id of ['admetGenerateDocxBtn', 'admetExportCsvBtn', 'admetExportEvidence']) $(id).disabled = !profiles.length;
    renderDetails(); updateDashboard(); updateApiButtons();
  }
  function renderDetails() {
    const profile = profiles.find(p => p.id === selectedId);
    if (!profile) { $('admetSourceDetails').textContent = 'Select a compound to review its values.'; return; }
    const entries = S.entries(profile, true);
    const received = entries.filter(entry => !entry.missing), missing = entries.filter(entry => entry.missing);
    const rows = received.map(entry => {
      const provenance = profile.imports.find(item => item.id === entry.importId);
      return `<tr><td>${esc(entry.label)}</td><td>${esc(entry.value)}${entry.unit ? ` ${esc(entry.unit)}` : ''}</td><td>${esc(S.SOURCES[entry.source].name)}</td><td>${entry.probability ? `${esc(entry.probability.value)} · ${esc(entry.probability.meaning)}` : 'Not reported'}</td><td><details><summary>${esc(provenance.method === 'api' ? 'API response' : 'User-supplied output')}</summary><a href="${esc(provenance.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a><pre>${esc(entry.evidence)}</pre><span class="source-muted">${esc(provenance.importedAt)} · Import ${esc(provenance.id)}</span></details></td></tr>`;
    }).join('');
    $('admetSourceDetails').innerHTML = `<div class="source-identity"><strong>${esc(nameOf(profile))}</strong><br>CID: ${esc(profile.identity.cid || 'Not supplied')}<br>SMILES: ${esc(profile.identity.smiles || 'Not supplied — identity was manually associated')}</div>${received.length ? `<div class="source-table-wrap"><table><caption class="visually-hidden">Reported source values</caption><thead><tr><th>Property / model</th><th>Source value</th><th>Provider</th><th>Confidence / metric</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="source-muted">No provider values received yet.</p>'}${missing.length ? `<details id="admetMissingFields" class="admet-evidence-disclosure"><summary>Unavailable fields (${missing.length})</summary><div class="source-table-wrap"><table><thead><tr><th>Property / model</th><th>Provider</th><th>Status</th></tr></thead><tbody>${missing.map(entry => `<tr><td>${esc(entry.label)}</td><td>${esc(S.SOURCES[entry.source].name)}</td><td>Not available</td></tr>`).join('')}</tbody></table></div></details>` : ''}<details class="admet-evidence-disclosure"><summary>Original source records (${profile.imports.length}), including superseded imports</summary>${profile.imports.map(item => `<h3>${esc(S.SOURCES[item.source].name)} · ${esc(item.method)}</h3><p class="source-muted">${esc(item.importedAt)} · ${esc(item.sourceUrl)}<br>${esc(item.jobId ? `API job ${item.jobId}; submitted SMILES ${item.inputSmiles}` : 'User supplied; authenticity not independently verified.')}</p><pre>${esc(item.raw)}</pre>`).join('')}</details>`;
  }
  function updateDashboard() {
    const container = $('dashAdmetContent');
    if (!container) return;
    const withValues = profiles.filter(p => Object.keys(p.values).length);
    if ($('dashAdmetBadge')) $('dashAdmetBadge').textContent = `${withValues.length} with source values · ${profiles.length - withValues.length} pending`;
    container.innerHTML = `<p class="dash-evidence-note">SwissADME and ProTox predictions only. Missing endpoints are unknown, not safe. These results do not establish potency or clinical safety.</p><div class="dash-evidence-records">${profiles.length ? profiles.map(p => {
      const active = Object.values(p.values).filter(value => value.source === 'protox' && value.value === 'Active');
      return `<div class="dash-evidence-record"><strong>${esc(nameOf(p))}</strong><div>SwissADME: ${esc(S.status(p, 'swissadme'))} · ProTox: ${esc(S.status(p, 'protox'))}</div><p>${active.length ? `Predicted active endpoints: ${active.map(e => esc(e.label)).join(', ')}` : 'No active endpoint recorded; this is not evidence of safety.'}</p></div>`;
    }).join('') : '<div class="dash-evidence-empty"><span class="edition-label">No source records yet</span><p>The evidence starts here.</p><span>Start profiling or import provider output in ADMET.</span></div>'}</div>`;
  }
  function assertRunning(signal) {
    if (signal?.aborted) throw new DOMException('Queue stopped.', 'AbortError');
  }
  function mergeIdentities(additions) {
    // Reuse the source schema's atomic exact-identity/conflict checks. Adding a CID
    // for an existing exact SMILES must not create a second prediction job.
    const next = S.mergeBatch(profiles, additions);
    const ids = [...new Set(additions.map(incoming => next.find(p =>
      (incoming.identity.smiles && p.identity.smiles === incoming.identity.smiles) ||
      (incoming.identity.cid && p.identity.cid === incoming.identity.cid)).id))];
    const added = next.length - profiles.length;
    selectedId = ids[0] || selectedId;
    importTargetId = ids.length === 1 ? ids[0] : '';
    persist(next);
    return { ids, added };
  }
  async function prepareIdentifiers(raw, type, label, signal) {
    assertRunning(signal);
    const entries = window.PubChemLookup.parseEntries(raw);
    if (!entries.length || entries.length > 500) throw new Error('Enter 1–500 identifiers, one per line.');
    const inputs = [...new Set(entries)];
    let additions, failures = [];
    if (type === 'cid') {
      // PubChem contributes identity only. The combined signal stops an automatic
      // run, including identity requests, without changing the shared lookup client.
      const options = signal ? { fetch: async (url, init = {}) => {
        assertRunning(signal);
        try { return await fetch(url, { ...init, signal: AbortSignal.any([init.signal, signal].filter(Boolean)) }); }
        catch (error) {
          if (signal.aborted) throw new window.PubChemLookup.LookupError('cancelled', 'Lookup stopped.');
          throw error;
        }
      } } : {};
      const resolved = await window.PubChemLookup.createClient(options).lookupEntries(inputs, { onProgress: progress => {
        assertRunning(signal);
        queueProgress(`Resolving identifiers · ${progress.completed}/${progress.total}`, progress.completed, progress.total);
        message(`Resolving identity: ${progress.completed}/${progress.total}.`);
      } });
      assertRunning(signal);
      failures = resolved.filter(row => row.error || !row.smiles);
      additions = resolved.filter(row => !row.error && row.smiles).map(row => S.createProfile({ label: inputs.length === 1 && label ? label : row.name || row.inputLabel, cid: row.cid, smiles: row.smiles }));
    } else if (type === 'smiles') {
      if (inputs.some(value => value.length > 4000 || /\s|[<>]/.test(value))) throw new Error('Use one exact SMILES per line, without spaces or markup. For compound names or CIDs, change the Input selector.');
      additions = inputs.map(smiles => S.createProfile({ smiles, label: inputs.length === 1 ? label : '' }));
    } else throw new Error('Choose SMILES or Names / PubChem CIDs.');
    assertRunning(signal);
    return { ...mergeIdentities(additions), failures };
  }
  async function addIdentifiers(raw, type = 'cid', label = '') {
    if (busy) return;
    setBusy(true);
    try {
      const result = await prepareIdentifiers(raw, type, label);
      message(`Added ${result.added} structures. Results remain pending.${result.failures.length ? '\nCould not resolve: ' + result.failures.map(row => `${row.inputLabel}: ${row.error || 'SMILES unavailable'}`).join('; ') : ''}`, !!result.failures.length);
      return result;
    } catch (error) { message(error.message, true); }
    finally { $('admetQueueProgress').hidden = true; setBusy(false); }
  }
  $('admetAddIdentity').addEventListener('click', () => addIdentifiers($('admetIdentityInput').value, $('admetIdentityType').value, $('admetIdentityLabel').value.trim()));
  $('admetFromPubchem').addEventListener('click', () => {
    if (busy) return;
    const rows = typeof lastResults === 'undefined' ? [] : lastResults.filter(row => !row.error && row.smiles);
    if (!rows.length) { message('Resolve compounds in PubChem Lookup first.', true); return; }
    try {
      const result = mergeIdentities(rows.map(row => S.createProfile({ label: row.inputLabel || row.name, cid: row.cid, smiles: row.smiles })));
      $('admetIdentityType').value = 'smiles';
      $('admetIdentityInput').value = [...new Set(rows.map(row => row.smiles))].join('\n');
      $('admetIdentityInput').placeholder = 'Paste SMILES, one per line.';
      $('admetIdentityLabel').value = '';
      message(`Transferred ${result.added} identities. Start profiling to retrieve ProTox results.`);
      updateApiButtons();
    } catch (error) { message(error.message, true); }
  });
  $('admetImportTarget').addEventListener('change', event => { importTargetId = event.target.value; if (importTargetId) { selectedId = importTargetId; renderDetails(); updateApiButtons(); } });
  $('admetSourceFilter').addEventListener('input', render);
  $('admetClearProfiles').addEventListener('click', () => { if (!busy && confirm('Clear the current source dataset? Export first if needed. Legacy data and cloud sessions will not be deleted.')) persist([]); });
  $('admetLegacyExport').addEventListener('click', () => download(legacy || 'No legacy data was present. Invalid source records: ' + (storageGet(S.STORAGE_KEY) || '[]'), `ADMET-legacy-UNVERIFIED-${stamp()}.json`, 'application/json'));
  $('admetClearSource').addEventListener('click', () => { $('admetSourceText').value = ''; $('admetSourceFile').value = ''; $('admetSourceUrl').value = ''; $('admetIdentityConfirm').checked = false; $('admetReplaceSource').checked = false; });
  $('admetImportResults').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!$('admetIdentityConfirm').checked) throw new Error('Confirm the provider, successful calculation, and exact compound identity before importing.');
      const file = $('admetSourceFile').files[0];
      const pasted = $('admetSourceText').value.trim();
      if (file && pasted) throw new Error('Choose either a file or pasted output, not both, to avoid importing the wrong result.');
      if (file?.size > 2 * 1024 * 1024) throw new Error('The source file exceeds 2 MB. Split the original export into smaller files.');
      const source = $('admetImportProvider').value;
      const text = file ? await file.text() : pasted;
      const incoming = S.parse(source, text, { method: file ? 'file' : 'paste', filename: file?.name || '', sourceUrl: $('admetSourceUrl').value.trim(), inputType: $('admetProtoxInputType').value, identityConfirmed: true });
      const target = profiles.find(p => p.id === importTargetId);
      let next;
      if (target) {
        if (incoming.length !== 1) throw new Error('Attaching to one compound requires exactly one source result. Select “Match exact identity / add new records” for a batch import.');
        const merged = S.merge(target, incoming[0], { confirmed: true, replace: $('admetReplaceSource').checked });
        next = profiles.map(p => p.id === target.id ? merged : p); selectedId = target.id;
      } else {
        if (incoming.some(p => !p.identity.smiles && !p.identity.cid)) throw new Error('This result lacks a SMILES/CID. Add the exact structure, select it under “Attach results to”, and confirm the association. Names alone cannot identify a compound.');
        next = S.mergeBatch(profiles, incoming, { replace: $('admetReplaceSource').checked });
        selectedId = next.find(p => p.imports.some(item => item.id === incoming[0].imports[0].id))?.id || selectedId;
      }
      persist(next);
      message(`Imported ${incoming.length} ${S.SOURCES[source].name} record(s) · ${incoming.reduce((n, p) => n + Object.keys(p.values).length, 0)} source values. Choose View to review.`);
      $('admetIdentityConfirm').checked = false; $('admetReplaceSource').checked = false;
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); }
  });
  $('admetSwissInputs').addEventListener('click', () => {
    const batches = S.swissBatches(profiles);
    $('admetSwissDownloads').replaceChildren();
    if (!batches.length) { message('Add or resolve a SMILES structure first.', true); return; }
    batches.forEach((text, i) => {
      const button = document.createElement('button'); button.textContent = `Download batch ${i + 1} (${text.split('\n').length})`;
      button.addEventListener('click', () => download(text, `SwissADME-input-${i + 1}-${stamp()}.txt`)); $('admetSwissDownloads').appendChild(button);
    });
    const excluded = profiles.filter(p => !p.identity.smiles).length;
    message(`Prepared ${batches.length} SwissADME batches (≤200 each). Run them manually, one at a time.${excluded ? ` ${excluded} records without SMILES were excluded.` : ''}`);
  });

  function safeCsv(value) {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  $('admetExportCsvBtn').addEventListener('click', () => {
    const rows = S.exportRows(profiles); if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    download([keys.map(safeCsv).join(','), ...rows.map(row => keys.map(key => safeCsv(row[key])).join(','))].join('\r\n'), `ADMET-source-values-${stamp()}.csv`, 'text/csv;charset=utf-8');
  });
  $('admetExportEvidence').addEventListener('click', () => download(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), note: 'Predictions are not experimental facts. User imports are not independently authenticated. Identity metadata is separate from source-only ADMET values.', profiles }, null, 2), `ADMET-source-evidence-${stamp()}.json`, 'application/json'));
  async function report() {
    if (!profiles.length) return;
    const button = $('admetGenerateDocxBtn'); button.disabled = true;
    try {
      const { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer, WidthType, HeadingLevel } = window.docx;
      const para = (text, extra = {}) => new Paragraph({ ...extra, children: [new TextRun({ text: String(text), size: 19 })] });
      const children = [new Paragraph({ text: 'Source-only ADMET report', heading: HeadingLevel.TITLE }), para(`SwissADME + ProTox 3.0 · ${profiles.length} compounds · ${new Date().toISOString()}`), para('Computational predictions are not proof of safety, efficacy, potency or clinical suitability. Missing values mean not available, never zero or inactive. File/paste imports are user-supplied and have not been independently authenticated. No local prediction models or fallback estimates are used.')];
      for (const profile of profiles) {
        children.push(new Paragraph({ text: nameOf(profile), heading: HeadingLevel.HEADING_1 }), para(`Identity metadata — CID: ${profile.identity.cid || 'Not supplied'}; SMILES: ${profile.identity.smiles || 'Not supplied'}`));
        const tableRows = [['Property / model', 'Reported value', 'Provider / metric', 'Source import ID'], ...S.entries(profile, true).map(entry => [entry.label, entry.value + (!entry.missing && entry.unit ? ` ${entry.unit}` : ''), `${S.SOURCES[entry.source].name}${entry.probability ? '; ' + entry.probability.meaning + ': ' + entry.probability.value : ''}`, entry.importId || 'Not available'])];
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows.map((cells, i) => new TableRow({ tableHeader: i === 0, children: cells.map(text => new TableCell({ children: [para(text)] })) })) }));
        children.push(new Paragraph({ text: 'Source evidence (including superseded imports)', heading: HeadingLevel.HEADING_2 }));
        if (!profile.imports.length) children.push(para('No provider result has been supplied.'));
        for (const item of profile.imports) {
          children.push(para(`Import ${item.id}: ${S.SOURCES[item.source].name}; version: ${item.version}; method: ${item.method}; timestamp: ${item.importedAt}`), para(item.sourceUrl));
          if (item.jobId) children.push(para(`API job: ${item.jobId}; request SMILES: ${item.inputSmiles}`));
          for (const line of item.raw.split(/\r?\n/)) children.push(para(line));
        }
      }
      children.push(new Paragraph({ text: 'References and interpretation', heading: HeadingLevel.HEADING_1 }), para('SwissADME: Daina et al. (2017), DOI 10.1038/srep42717; https://www.swissadme.ch/'), para('ProTox 3.0: Banerjee et al. (2024), DOI 10.1093/nar/gkae303; https://tox.charite.de/protox3/'), para('ProTox API Probability: acute toxicity = average similarity (0–100%); toxicity model = confidence (0–1); toxicity target = average pharmacophore fit (0–1). Similarity and reported prediction accuracy are different metrics. SwissADME LogP/LogS models and ProTox BBB/CYP models remain separate; model output is never substituted for another model.'));
      const doc = new Document({ creator: 'Drug Design Universe', title: 'SwissADME and ProTox source-only ADMET report', sections: [{ children }] });
      download(await Packer.toBlob(doc), `ADMET-source-report-${stamp()}.docx`);
      message('Word report generated with provider attribution, missing-value status and original source evidence.');
      if (typeof incrementStat === 'function') incrementStat('reports', 1);
    } catch (error) { message(`Report failed: ${error.message}`, true); }
    finally { button.disabled = !profiles.length; }
  }
  $('admetGenerateDocxBtn').addEventListener('click', report);

  const api = window.ProtoxClient.createClient({ getToken: async () => {
    if (typeof supabaseClient === 'undefined') return '';
    const { data } = await supabaseClient.auth.getSession(); return data?.session?.access_token || '';
  } });
  function parseApiFiles(result, job) {
    if (!Array.isArray(result.files) || !result.files.length) throw new Error('ProTox returned no source files. Nothing was added.');
    const combined = S.createProfile({ smiles: job.inputSmiles });
    for (const file of result.files) {
      const suffix = { 'acute toxicity': 'tox_class', 'toxicity model': 'result', 'toxicity target': 'tox_targets' }[file.type];
      if (!suffix) throw new Error('Unknown ProTox file type.');
      if (file.url !== `https://tox.charite.de/protox3/csv/${job.id}_${suffix}.csv`) throw new Error('Source file URL does not belong to this ProTox job. Nothing was attached.');
      const records = S.parse('protox', file.text, { method: 'api', inputSmiles: job.inputSmiles, inputType: 'smiles', resultType: file.type, jobId: job.id, sourceUrl: file.url });
      if (records.length !== 1) throw new Error('ProTox returned multiple compounds for one job. Nothing was attached.');
      for (const [key, value] of Object.entries(records[0].values)) {
        if (combined.values[key]) throw new Error('Conflicting duplicate endpoint in ProTox output.');
        combined.values[key] = value;
      }
      combined.imports.push(...records[0].imports);
    }
    return combined;
  }
  async function runProtox(all, prepareInput = false) {
    if (busy || !apiAvailable || !$('admetApiConsent').checked) return;
    // Capture input once; never submit edits or a newly selected row mid-run.
    const raw = prepareInput ? $('admetIdentityInput').value.trim() : '';
    const inputType = $('admetIdentityType').value;
    const label = $('admetIdentityLabel').value.trim();
    queueController = new AbortController();
    const signal = queueController.signal;
    setBusy(true); render();
    let completed = 0, total = 0;
    try {
      let inputIds = null;
      if (raw) {
        queueProgress('Preparing compounds…', 0, 1);
        const prepared = await prepareIdentifiers(raw, inputType, label, signal);
        assertRunning(signal);
        if (prepared.failures.length) {
          queueProgress('Check unresolved identifiers before starting.', 0, 1);
          message(`Could not resolve ${prepared.failures.length} input(s). Nothing was submitted to ProTox. Correct the inputs and start again.\n` + prepared.failures.map(row => `${row.inputLabel}: ${row.error || 'SMILES unavailable'}`).join('\n'), true);
          return;
        }
        inputIds = new Set(prepared.ids);
        // Keep the input on success, failure and stop: a later Start must not
        // silently broaden this run to unrelated pending dataset records.
      }
      let targets = all ? profiles.filter(p => (!inputIds || inputIds.has(p.id)) && needsProtox(p)) : profiles.filter(p => p.id === selectedId && p.identity.smiles);
      if (!targets.length) {
        $('admetQueueProgress').hidden = true;
        message('No missing ProTox profiles to run. Existing results were kept.');
        return;
      }
      if (!all && targets[0].protoxJob?.status === 'complete') {
        $('admetQueueProgress').hidden = true;
        message('This compound already has its API response. It will not be resubmitted automatically.'); return;
      }
      if (!all && Object.values(targets[0].values).some(v => v.source === 'protox') && !targets[0].protoxJob && !confirm('Replace this compound’s imported ProTox values with a new API response? Missing fields in the response will stay missing.')) {
        $('admetQueueProgress').hidden = true; message('Profiling cancelled. No new jobs were submitted.'); return;
      }
      if (targets.length > 250) {
        if (!confirm(`Queue the first 250 of ${targets.length} compounds? The others will stay pending. ProTox also enforces a daily shared-IP quota.`)) {
          $('admetQueueProgress').hidden = true; message('Profiling cancelled. No new jobs were submitted.'); return;
        }
        targets = targets.slice(0, 250);
      }
      total = targets.length;
      queueProgress(`ProTox · 0/${total} responses received`, 0, total);
      for (const target of targets) {
        assertRunning(signal);
        let current = profiles.find(p => p.id === target.id);
        if (!current || current.identity.smiles !== target.identity.smiles) throw new Error('The queued compound identity changed. Queue stopped.');
        let job = current.protoxJob;
        if (!job) {
          const usage = JSON.parse(storageGet('ddu_protox_usage') || '{}');
          const count = usage.day === stamp() ? Number(usage.count) || 0 : 0;
          if (count >= 250) throw new Error('Daily limit: this browser has attempted 250 ProTox submissions. Resume new compounds on a later day.');
          try { localStorage.setItem('ddu_protox_usage', JSON.stringify({ day: stamp(), count: count + 1 })); } catch { /* The provider also enforces its shared-IP quota. */ }
          message(`Submitting ${nameOf(current)} · ${completed + 1}/${total}.`);
          job = await api.enqueue(current.identity.smiles, signal);
          providerRecovered('enqueue');
          persist(profiles.map(p => p.id === current.id ? { ...p, protoxJob: job } : p));
        }
        if (job.inputSmiles !== current.identity.smiles) throw new Error('Saved API job does not match the current SMILES. Nothing was attached.');
        const result = await api.poll(job, { signal, onProgress: text => message(`${nameOf(current)} · ${text}`) });
        if (result.state === 'pending') {
          queueProgress(`Paused · ${completed}/${total} responses received`, completed, total);
          message(`Job ${job.id} is still pending. Start profiling to resume it without resubmitting. Remaining compounds have not been sent.`);
          return;
        }
        const incoming = parseApiFiles(result, job);
        current = profiles.find(p => p.id === target.id);
        if (!current || current.identity.smiles !== job.inputSmiles) throw new Error('Compound identity changed while the job ran. Output was not attached.');
        const merged = S.merge(current, incoming, { replace: true });
        const missingTypes = ['acute toxicity', 'toxicity model', 'toxicity target'].filter(type => !result.files.some(file => file.type === type) || result.missing?.includes(type));
        merged.protoxJob = { ...job, status: missingTypes.length ? 'partial' : 'complete' };
        persist(profiles.map(p => p.id === current.id ? merged : p));
        providerRecovered('retrieve');
        completed++;
        queueProgress(`ProTox · ${completed}/${total} responses received`, completed, total);
        if (missingTypes.length) {
          message(`Partial ProTox output: ${missingTypes.join(', ')} not returned. Received values were stored; resume this job later.`, true); return;
        }
        if (completed < total) await api.wait(Math.max(5, job.retryAfter) * 1000, signal);
      }
      message(`ProTox queue finished: ${completed} source profile(s) received. SwissADME: import its output separately.`);
    } catch (error) {
      const state = error.name === 'AbortError' ? 'Stopped' : 'Paused';
      queueProgress(total ? `${state} · ${completed}/${total} responses received` : `${state} before submission.`, completed, Math.max(1, total));
      const stopped = error.name === 'AbortError';
      if (!stopped && error.diagnostics) providerFailed(error.diagnostics);
      message(stopped ? 'Queue stopped. Saved jobs can be resumed; interrupted submissions are not automatically repeated.' : error.message, true, !stopped && Boolean(error.diagnostics));
    } finally { queueController = null; setBusy(false); render(); }
  }
  $('admetApiConsent').addEventListener('change', () => {
    if (!$('admetApiConsent').checked) queueController?.abort();
    updateApiButtons();
  });
  $('admetAutoRun').addEventListener('click', () => runProtox(true, true));
  $('admetRunProtox').addEventListener('click', () => runProtox(false));
  $('admetRunProtoxBatch').addEventListener('click', () => runProtox(true));
  $('admetStopProtox').addEventListener('click', () => queueController?.abort());
  $('admetIdentityInput').addEventListener('input', updateApiButtons);
  $('admetIdentityType').addEventListener('change', () => {
    $('admetIdentityInput').placeholder = $('admetIdentityType').value === 'cid' ? 'Paste names or PubChem CIDs, one per line.' : 'Paste SMILES, one per line.';
    updateApiButtons();
  });
  fetch('/api/protox/status', { signal: AbortSignal.timeout(10000) }).then(async response => {
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('unavailable');
    const data = await response.json(); apiAvailable = data.available === true && data.provider === 'ProTox 3.0';
    if (!apiAvailable) throw new Error('unavailable');
    $('admetApiStatus').textContent = 'ProTox connection configured · provider availability not verified.';
    $('admetApiStatus').title = 'No provider health-check jobs are submitted. ProTox controls availability and its 250 queries/day/source-IP quota.';
    updateApiButtons();
  }).catch(() => {
    apiAvailable = false;
    $('admetApiStatus').textContent = 'Automatic ProTox is unavailable on this host. Import provider results instead.';
    updateApiButtons();
  });

  function historyMessage(text) { $('historyMsg').textContent = text; }
  async function historyLoad() {
    if (typeof currentUser === 'undefined' || !currentUser || typeof supabaseClient === 'undefined') return;
    $('admetHistorySection').hidden = false;
    try {
      const { data, error } = await supabaseClient.from('admet_sessions').select('id, name, compound_count, saved_at').eq('user_id', currentUser.id).order('saved_at', { ascending: false }).limit(20);
      if (error) throw error;
      $('historyList').innerHTML = data?.length ? data.map(row => `<div class="source-actions"><span>${esc(row.name || 'Untitled session')} · ${esc(row.compound_count)} compounds · ${esc(row.saved_at)}</span><button data-load-session="${esc(row.id)}">Load</button><button data-delete-session="${esc(row.id)}">Delete</button></div>`).join('') : '<p class="source-muted">No saved sessions.</p>';
      $('historyList').querySelectorAll('[data-load-session]').forEach(button => button.addEventListener('click', async () => {
        if (busy) return;
        try {
          const { data: result, error: loadError } = await supabaseClient.from('admet_sessions').select('compounds').eq('id', button.dataset.loadSession).eq('user_id', currentUser.id).single();
          if (loadError) throw loadError;
          if (busy) { historyMessage('Stop profiling before loading a different session.'); return; }
          const raw = typeof result.compounds === 'string' ? result.compounds : JSON.stringify(result.compounds);
          const parsed = S.loadStored(raw);
          if (parsed.excluded || !parsed.profiles.length) {
            legacySession = raw;
            historyMessage('This session contains legacy/invalid data without trustworthy source evidence. It was not loaded. ');
            const exportButton = document.createElement('button'); exportButton.textContent = 'Download unverified session'; exportButton.addEventListener('click', () => download(legacySession, `ADMET-session-UNVERIFIED-${stamp()}.json`, 'application/json')); $('historyMsg').appendChild(exportButton); return;
          }
          if (profiles.length && !confirm('Replace the current dataset with this saved session? Export current work first if needed.')) return;
          persist(parsed.profiles); historyMessage(`Loaded ${parsed.profiles.length} source-evidence records.`);
        } catch (error) { historyMessage(`Load failed: ${error.message}`); }
      }));
      $('historyList').querySelectorAll('[data-delete-session]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('Permanently delete this saved cloud session?')) return;
        try {
          const { error } = await supabaseClient.from('admet_sessions').delete().eq('id', button.dataset.deleteSession).eq('user_id', currentUser.id);
          if (error) throw error; await historyLoad();
        } catch (error) { historyMessage(`Delete failed: ${error.message}`); }
      }));
    } catch (error) { historyMessage(`History unavailable: ${error.message}`); }
  }
  $('historyRefreshBtn').addEventListener('click', historyLoad);
  $('historySaveBtn').addEventListener('click', async () => {
    if (busy || !profiles.length || typeof currentUser === 'undefined' || !currentUser) { historyMessage('Sign in and add records before saving.'); return; }
    $('historySaveBtn').disabled = true;
    try {
      const { error } = await supabaseClient.from('admet_sessions').insert({ user_id: currentUser.id, name: $('historySessionName').value.trim() || `Source ADMET ${stamp()}`, compound_count: profiles.length, compounds: JSON.stringify(profiles), saved_at: new Date().toISOString() });
      if (error) throw error; historyMessage('Session and source evidence saved.'); await historyLoad();
    } catch (error) { historyMessage(`Save failed: ${error.message}`); }
    finally { $('historySaveBtn').disabled = busy; }
  });
  window.admetHistoryLoad = historyLoad;
  window.DduAdmetApp = { getProfiles: () => structuredClone(profiles), addIdentifiers, updateDashboard, parseApiFiles };
  window.addEventListener('storage', event => {
    if (event.key === S.STORAGE_KEY && !busy) { const result = S.loadStored(event.newValue); if (!result.excluded) { profiles = result.profiles; render(); } }
  });
  render(); historyLoad();
})();
