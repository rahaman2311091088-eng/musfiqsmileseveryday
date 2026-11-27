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
  const legacy = storageGet('ddu_admet_compounds');
  root.classList.add('admet-source-app');
  root.innerHTML = `
    <div class="source-kicker">02 / Investigate · SwissADME + ProTox 3.0</div>
    <h1 class="source-title" tabindex="-1">ADMET <em>evidence.</em></h1>
    <p class="source-muted">Import SwissADME output and retrieve ProTox predictions. No local ADMET calculations, preset results, or invented missing values.</p>
    <nav class="source-step-nav" aria-label="ADMET workflow"><a href="#admetIdentitySection"><span>01</span> Compounds</a><a href="#admetProviderSection"><span>02</span> Providers</a><a href="#admetImportSection"><span>03</span> Import results</a><a href="#admetSourceDataset"><span>04</span> Review &amp; export</a></nav>
    <div class="source-notice"><strong>Predictions, not proof of safety or efficacy.</strong> SwissADME prohibits automated access: run its website yourself, then import its exported results here. ProTox uses its published API where this host supports it. Imported text/files are user-supplied and are not independently authenticated.</div>
    <div id="admetLegacyWarning" class="source-notice" ${!legacy && !loaded.excluded ? 'hidden' : ''}>Older/invalid ADMET records lack reliable source evidence and are excluded from all current profiles, statistics and reports. Their original storage has not been deleted. <button id="admetLegacyExport">Download legacy data for review</button></div>
    <div id="admetStorageWarning" class="source-notice" hidden></div>
    <div id="admetSourceMessage" role="status" aria-live="polite" hidden></div>
    <div class="source-card" id="admetIdentitySection">
      <h3><span class="source-section-number">01</span>Choose the exact compounds</h3>
      <p class="source-muted">Up to 500 records. PubChem supplies identity/SMILES only, never ADMET values. Stereochemistry, charges and salts are retained. Names alone are not used to merge predictions.</p>
      <div class="source-grid">
        <div><label for="admetIdentityType">Identifier type</label><select id="admetIdentityType"><option value="smiles">SMILES — one structure per line</option><option value="cid">PubChem CID — one CID per line</option></select></div>
        <div><label for="admetIdentityLabel">Display label (optional, for a single structure)</label><input id="admetIdentityLabel" placeholder="Your compound label" maxlength="200"></div>
      </div>
      <label for="admetIdentityInput">Structures / identifiers</label><textarea id="admetIdentityInput" spellcheck="false" placeholder="Paste exact SMILES, one per line. Or select PubChem CID above."></textarea>
      <div class="source-actions"><button class="source-primary" id="admetAddIdentity">Add structures — no predictions</button><button id="admetFromPubchem" ${root.dataset.standalone ? 'hidden' : ''}>Use resolved PubChem rows</button></div>
    </div>
    <div class="source-grid" id="admetProviderSection">
      <section class="source-card"><div class="source-kicker">ADME · manual provider run</div><h3>SwissADME</h3>
        <p class="source-muted">Download input batches of at most 200, run each sequentially on SwissADME, then upload its CSV below. Do not run batches simultaneously. Its BOILED-Egg and radar graphics are available on the provider site; this app does not recreate them with approximations.</p>
        <div class="source-actions"><button id="admetSwissInputs">Prepare SwissADME batches</button><a href="https://www.swissadme.ch/" target="_blank" rel="noopener noreferrer">Open SwissADME ↗</a></div>
        <div id="admetSwissDownloads" class="source-actions"></div>
        <p class="source-muted"><a href="https://www.swissadme.ch/termsofuse.php" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="https://www.swissadme.ch/faq.php" target="_blank" rel="noopener noreferrer">Batch guidance</a></p>
      </section>
      <section class="source-card"><div class="source-kicker">TOXICITY · provider API</div><h3>ProTox 3.0</h3>
        <p class="source-muted">Academic/non-commercial use. Up to 250 API queries per shared source IP/day, not 500 simultaneous jobs. One compound is processed at a time, with provider-requested waits. Existing pending jobs can be resumed without resubmitting.</p>
        <div id="admetApiStatus" class="source-muted">Checking API adapter…</div>
        <label class="source-checkbox"><input type="checkbox" id="admetApiConsent">I agree to send these SMILES to ProTox for academic/non-commercial prediction.</label>
        <div class="source-actions"><button id="admetRunProtox" class="source-primary" disabled>Run / resume selected</button><button id="admetRunProtoxBatch" disabled>Run missing profiles (max 250)</button><button id="admetStopProtox" disabled>Stop queue</button></div>
        <p class="source-muted"><a href="https://tox.charite.de/protox3/" target="_blank" rel="noopener noreferrer">Open ProTox ↗</a> · <a href="https://tox.charite.de/protox3/index.php?site=faq" target="_blank" rel="noopener noreferrer">API and confidence definitions</a></p>
      </section>
    </div>
    <section class="source-card" id="admetImportSection">
      <h3><span class="source-section-number">03</span>Import actual provider results</h3>
      <p class="source-muted">CSV/TSV is preferred. For pasted text, include the full result panel and SMILES. Recognized fields are read without recomputation; unrecognized pasted fields remain in the original evidence, not in numeric summaries. Check source identity before importing. Differently written SMILES are kept separate rather than guessed to be equivalent.</p>
      <div class="source-grid">
        <div><label for="admetImportProvider">Provider</label><select id="admetImportProvider"><option value="swissadme">SwissADME</option><option value="protox">ProTox 3.0</option></select></div>
        <div><label for="admetImportTarget">Attach results to</label><select id="admetImportTarget"><option value="">Match exact identity / add new records</option></select></div>
        <div><label for="admetProtoxInputType">ProTox API export “input” column contains</label><select id="admetProtoxInputType"><option value="smiles">SMILES</option><option value="name">Names (requires manual identity confirmation)</option></select></div>
        <div><label for="admetSourceUrl">Provider result URL (optional)</label><input id="admetSourceUrl" type="url" placeholder="HTTPS link on the provider website"></div>
      </div>
      <label for="admetSourceText">Original result text or CSV/TSV</label><textarea id="admetSourceText" spellcheck="false" placeholder="Paste provider output here. No sample predictions are preloaded."></textarea>
      <label for="admetSourceFile">Or upload an original export (.csv, .tsv, .txt; up to 2 MB)</label><input type="file" id="admetSourceFile" accept=".csv,.tsv,.txt,text/plain,text/csv">
      <label class="source-checkbox"><input type="checkbox" id="admetIdentityConfirm">I checked that this is the selected provider’s output for the exact compound(s), including stereochemistry/charge, and that the provider calculation completed successfully.</label>
      <label class="source-checkbox"><input type="checkbox" id="admetReplaceSource">Replace previous results from this provider for matched compounds (missing fields in the new result will stay missing).</label>
      <div class="source-actions"><button id="admetImportResults" class="source-primary">Import source values</button><button id="admetClearSource">Clear import</button></div>
    </section>
    <section class="source-card" id="admetSourceDataset">
      <h3><span class="source-section-number">04</span>Review the dataset &amp; evidence</h3>
      <div id="admetSourceMetrics" class="source-metrics"></div>
      <div class="source-actions"><label for="admetSourceFilter">Filter records</label><input id="admetSourceFilter" style="max-width:290px" placeholder="Label, CID or SMILES"><button id="admetClearProfiles" class="source-delete">Clear current dataset</button></div>
      <div class="source-table-wrap"><table id="admetSourceTable"><thead><tr><th>Compound</th><th>SwissADME</th><th>ProTox 3.0</th><th>Review</th></tr></thead><tbody id="admetSourceRows"></tbody></table></div>
      <div class="source-actions"><button id="admetGenerateDocxBtn" class="source-primary">Word report (.docx)</button><button id="admetExportCsvBtn">CSV with provenance</button><button id="admetExportEvidence">JSON evidence archive</button></div>
      <p class="source-muted">Exports preserve reported precision and confidence meanings. “Not available” never means zero, inactive or safe. Identity metadata may be user-supplied or resolved by PubChem; all ADMET descriptors/predictions are attributed separately.</p>
    </section>
    <section class="source-card" id="admetSelectedRecord"><h3>Selected profile</h3><div id="admetSourceDetails" class="source-muted">Select a record to view individual source values.</div></section>
    <section class="source-card" id="admetHistorySection" hidden><h3>Saved sessions</h3><p class="source-muted">Save source evidence with your signed-in account. Legacy sessions are downloadable for review but are never treated as source-verified profiles.</p><div class="source-actions"><input id="historySessionName" aria-label="Session name" placeholder="Session name (optional)" style="max-width:280px"><button id="historySaveBtn">Save session</button><button id="historyRefreshBtn">Refresh</button></div><div id="historyMsg" role="status"></div><div id="historyList"></div></section>
    <p class="source-muted">Citations: Daina et al., SwissADME (2017), DOI 10.1038/srep42717 · Banerjee et al., ProTox 3.0 (2024), DOI 10.1093/nar/gkae303. Source versions are recorded where supplied; provider outputs may change over time.</p>`;

  function message(text, error = false) {
    $('admetSourceMessage').hidden = !text;
    $('admetSourceMessage').textContent = text;
    $('admetSourceMessage').dataset.error = String(error);
  }
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
  function setBusy(value) {
    busy = value;
    for (const id of ['admetAddIdentity', 'admetFromPubchem', 'admetImportResults', 'admetClearProfiles', 'historySaveBtn']) $(id).disabled = value;
    $('admetStopProtox').disabled = !queueController;
    updateApiButtons();
  }
  function updateApiButtons() {
    const enabled = !busy && apiAvailable && $('admetApiConsent').checked;
    $('admetRunProtox').disabled = !enabled || !profiles.find(p => p.id === selectedId)?.identity.smiles;
    $('admetRunProtoxBatch').disabled = !enabled || !profiles.some(p => p.identity.smiles);
  }
  function render() {
    const selected = profiles.find(p => p.id === selectedId);
    if (!selected) selectedId = profiles[0]?.id || '';
    if (!profiles.some(p => p.id === importTargetId)) importTargetId = '';
    $('admetImportTarget').innerHTML = '<option value="">Match exact identity / add new records</option>' + profiles.map(p => `<option value="${esc(p.id)}">${esc(nameOf(p))}</option>`).join('');
    $('admetImportTarget').value = importTargetId;
    const counts = { swissadme: 0, protox: 0 };
    profiles.forEach(p => Object.keys(counts).forEach(source => { if (Object.values(p.values).some(v => v.source === source)) counts[source]++; }));
    $('admetSourceMetrics').innerHTML = [[profiles.length, 'Compounds (including pending)'], [counts.swissadme, 'With SwissADME values'], [counts.protox, 'With ProTox values'], [profiles.length - counts.protox, 'Without toxicity results']].map(([number, label]) => `<div class="source-metric"><strong>${number}</strong><span>${label}</span></div>`).join('');
    const query = $('admetSourceFilter').value.toLowerCase();
    const filtered = profiles.filter(p => [p.identity.label, p.identity.cid, p.identity.smiles].some(v => v.toLowerCase().includes(query)));
    $('admetSourceRows').innerHTML = filtered.length ? filtered.map(p => `<tr class="${p.id === selectedId ? 'source-selected' : ''}"><td><strong>${esc(nameOf(p))}</strong><div class="source-muted">${p.identity.cid ? `CID ${esc(p.identity.cid)} · ` : ''}${esc(p.identity.smiles)}</div></td><td>${esc(S.status(p, 'swissadme'))}</td><td>${esc(S.status(p, 'protox'))}${p.protoxJob ? `<div class="source-muted">API job: ${esc(p.protoxJob.status)}</div>` : ''}</td><td><button data-review="${esc(p.id)}">View / attach results</button><button data-delete="${esc(p.id)}" class="source-delete" ${busy ? 'disabled' : ''}>Remove</button></td></tr>`).join('') : '<tr><td colspan="4">No source records. Add a structure or import provider output; no example results are generated automatically.</td></tr>';
    $('admetSourceRows').querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.review; importTargetId = selectedId; render(); }));
    $('admetSourceRows').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => { if (!busy && confirm('Remove this compound and its source evidence from the current dataset? Saved sessions are unchanged.')) persist(profiles.filter(p => p.id !== button.dataset.delete)); }));
    for (const id of ['admetGenerateDocxBtn', 'admetExportCsvBtn', 'admetExportEvidence']) $(id).disabled = !profiles.length;
    renderDetails(); updateDashboard(); updateApiButtons();
  }
  function renderDetails() {
    const profile = profiles.find(p => p.id === selectedId);
    if (!profile) { $('admetSourceDetails').textContent = 'Select a record to view individual source values.'; return; }
    const rows = S.entries(profile, true).map(entry => {
      const provenance = profile.imports.find(item => item.id === entry.importId);
      return `<tr><td>${esc(entry.label)}</td><td>${esc(entry.value)}${!entry.missing && entry.unit ? ` ${esc(entry.unit)}` : ''}</td><td>${esc(S.SOURCES[entry.source].name)}</td><td>${entry.probability ? `${esc(entry.probability.value)} · ${esc(entry.probability.meaning)}` : 'Not reported'}</td><td>${provenance ? `<details><summary>${esc(provenance.method === 'api' ? 'API response' : 'User-supplied output')} · ${esc(provenance.importedAt)}</summary><a href="${esc(provenance.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a><pre>${esc(entry.evidence)}</pre><span class="source-muted">Import ${esc(provenance.id)}</span></details>` : 'No source value'}</td></tr>`;
    }).join('');
    $('admetSourceDetails').innerHTML = `<div class="source-identity"><strong>${esc(nameOf(profile))}</strong><br>CID: ${esc(profile.identity.cid || 'Not supplied')}<br>SMILES: ${esc(profile.identity.smiles || 'Not supplied — identity was manually associated')}</div><div class="source-table-wrap"><table><thead><tr><th>Property / model</th><th>Source value</th><th>Provider</th><th>Confidence / metric</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div><details style="margin-top:14px"><summary>Original source records (${profile.imports.length}), including superseded imports</summary>${profile.imports.map(item => `<h4>${esc(S.SOURCES[item.source].name)} · ${esc(item.method)} · ${esc(item.importedAt)}</h4><p class="source-muted">${esc(item.sourceUrl)}<br>${esc(item.jobId ? `API job ${item.jobId}; submitted SMILES ${item.inputSmiles}` : 'User supplied; authenticity not independently verified.')}</p><pre>${esc(item.raw)}</pre>`).join('')}</details>`;
  }
  function updateDashboard() {
    const container = $('dashAdmetContent');
    if (!container) return;
    const withValues = profiles.filter(p => Object.keys(p.values).length);
    if ($('dashAdmetBadge')) $('dashAdmetBadge').textContent = `${withValues.length} with source values · ${profiles.length - withValues.length} pending`;
    container.innerHTML = `<p class="dash-evidence-note">SwissADME and ProTox predictions only. Missing endpoints are unknown, not safe. These results do not establish potency or clinical safety.</p><div class="dash-evidence-records">${profiles.length ? profiles.map(p => {
      const active = Object.values(p.values).filter(value => value.source === 'protox' && value.value === 'Active');
      return `<div class="dash-evidence-record"><strong>${esc(nameOf(p))}</strong><div>SwissADME: ${esc(S.status(p, 'swissadme'))} · ProTox: ${esc(S.status(p, 'protox'))}</div><p>${active.length ? `Predicted active endpoints: ${active.map(e => esc(e.label)).join(', ')}` : 'No active endpoint recorded; this is not evidence of safety.'}</p></div>`;
    }).join('') : '<div class="dash-evidence-empty"><span class="edition-label">No source records yet</span><p>The evidence starts here.</p><span>Import provider output in ADMET Profiling to begin.</span></div>'}</div>`;
  }
  async function addIdentifiers(raw, type = 'cid', label = '') {
    if (busy) return;
    const inputs = [...new Set(String(raw).split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    if (!inputs.length || inputs.length > 500) { message('Enter 1–500 identifiers, one per line.', true); return; }
    setBusy(true);
    try {
      let additions, failures = [];
      if (type === 'cid') {
        if (inputs.some(value => !/^[1-9]\d*$/.test(value))) throw new Error('CID mode accepts numeric CIDs only. Use SMILES mode for structures.');
        const resolved = await window.PubChemLookup.createClient().lookupEntries(inputs, { onProgress: progress => message(`Resolving identity only: ${progress.completed}/${progress.total} (${progress.phase}). No ADMET calculations.`) });
        failures = resolved.filter(row => row.error || !row.smiles);
        additions = resolved.filter(row => !row.error && row.smiles).map(row => S.createProfile({ label: inputs.length === 1 && label ? label : row.name, cid: row.cid, smiles: row.smiles }));
      } else {
        if (inputs.some(value => value.length > 4000 || /\s|[<>]/.test(value))) throw new Error('Each line must contain one SMILES string without spaces or markup. Enter labels separately.');
        additions = inputs.map(smiles => S.createProfile({ smiles, label: inputs.length === 1 ? label : '' }));
      }
      const unique = additions.filter(incoming => !profiles.some(existing => existing.identity.smiles === incoming.identity.smiles && existing.identity.cid === incoming.identity.cid));
      selectedId = unique[0]?.id || selectedId;
      importTargetId = unique[0]?.id || importTargetId;
      persist([...profiles, ...unique]);
      message(`Added ${unique.length} structures. All ADMET values remain unavailable until received from a provider.${failures.length ? '\nCould not resolve: ' + failures.map(row => `${row.inputLabel}: ${row.error || 'SMILES unavailable'}`).join('; ') : ''}`, !!failures.length);
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); }
  }
  $('admetAddIdentity').addEventListener('click', () => addIdentifiers($('admetIdentityInput').value, $('admetIdentityType').value, $('admetIdentityLabel').value.trim()));
  $('admetFromPubchem').addEventListener('click', () => {
    if (busy) return;
    const rows = typeof lastResults === 'undefined' ? [] : lastResults.filter(row => !row.error && row.smiles);
    if (!rows.length) { message('Resolve compounds in PubChem Lookup first. Only structures/identities, not its property values, will be transferred.', true); return; }
    try {
      const additions = rows.filter(row => !profiles.some(p => p.identity.cid === String(row.cid) && p.identity.smiles === row.smiles)).map(row => S.createProfile({ label: row.inputLabel || row.name, cid: row.cid, smiles: row.smiles }));
      selectedId = additions[0]?.id || selectedId; importTargetId = selectedId;
      persist([...profiles, ...additions]); message(`Transferred ${additions.length} identities. ADMET results are still pending.`);
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
      message(`Imported ${incoming.length} ${S.SOURCES[source].name} record(s), preserving ${incoming.reduce((n, p) => n + Object.keys(p.values).length, 0)} reported values. Missing fields were not filled. Review values and original evidence below.`);
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
    message(`Prepared ${batches.length} SwissADME input batches (≤200 structures each). Submit manually and sequentially; wait for each run to finish. ${profiles.filter(p => !p.identity.smiles).length} records without SMILES were excluded. No SwissADME requests were made by this app.`);
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
  async function runProtox(all) {
    if (busy || !apiAvailable || !$('admetApiConsent').checked) return;
    let targets = all ? profiles.filter(p => p.identity.smiles && (!Object.values(p.values).some(v => v.source === 'protox') || ['pending', 'partial'].includes(p.protoxJob?.status))) : profiles.filter(p => p.id === selectedId && p.identity.smiles);
    if (!targets.length) { message('No missing ProTox profiles are queued. Select a structure first.'); return; }
    if (!all && targets[0].protoxJob?.status === 'complete') { message('This compound already has its API response. Review the existing source evidence; it will not be resubmitted automatically.'); return; }
    if (!all && Object.values(targets[0].values).some(v => v.source === 'protox') && !targets[0].protoxJob && !confirm('The API response will replace the selected compound’s imported ProTox values, including any fields the API does not return. Continue?')) return;
    if (targets.length > 250) { if (!confirm(`Only the first 250 of ${targets.length} profiles can be queued. The provider also enforces a daily shared-IP quota. Continue?`)) return; targets = targets.slice(0, 250); }
    queueController = new AbortController(); setBusy(true); render();
    const signal = queueController.signal;
    let completed = 0;
    try {
      for (const target of targets) {
        if (signal.aborted) break;
        let current = profiles.find(p => p.id === target.id);
        if (!current || current.identity.smiles !== target.identity.smiles) throw new Error('The queued compound identity changed. Queue stopped.');
        let job = current.protoxJob;
        if (!job) {
          const usage = JSON.parse(storageGet('ddu_protox_usage') || '{}');
          const count = usage.day === stamp() ? Number(usage.count) || 0 : 0;
          if (count >= 250) throw new Error('This browser has attempted 250 ProTox submissions today. The provider’s shared-IP quota may be reached sooner. Resume on a later day.');
          try { localStorage.setItem('ddu_protox_usage', JSON.stringify({ day: stamp(), count: count + 1 })); } catch { /* Provider remains authoritative for rate limits. */ }
          message(`Submitting exact SMILES for ${nameOf(current)} to ProTox (${completed + 1}/${targets.length}).`);
          job = await api.enqueue(current.identity.smiles, signal);
          persist(profiles.map(p => p.id === current.id ? { ...p, protoxJob: job } : p));
        }
        if (job.inputSmiles !== current.identity.smiles) throw new Error('Saved API job does not match the current SMILES. Nothing was attached.');
        const result = await api.poll(job, { signal, onProgress: text => message(`${nameOf(current)} · ${text}`) });
        if (result.state === 'pending') { message(`ProTox job ${job.id} is still pending. Resume selected later without resubmitting. Remaining compounds have not been submitted.`); return; }
        const incoming = parseApiFiles(result, job);
        current = profiles.find(p => p.id === target.id);
        if (!current || current.identity.smiles !== job.inputSmiles) throw new Error('Compound identity changed while the job ran. Output was not attached.');
        const merged = S.merge(current, incoming, { replace: true });
        const missingTypes = ['acute toxicity', 'toxicity model', 'toxicity target'].filter(type => !result.files.some(file => file.type === type) || result.missing?.includes(type));
        merged.protoxJob = { ...job, status: missingTypes.length ? 'partial' : 'complete' };
        persist(profiles.map(p => p.id === current.id ? merged : p));
        completed++;
        if (missingTypes.length) { message(`Partial ProTox output: ${missingTypes.join(', ')} not returned. Only received values were stored. Resume this job later.`, true); return; }
        if (completed < targets.length) await api.wait(Math.max(5, job.retryAfter) * 1000, signal);
      }
      message(`ProTox queue ${signal.aborted ? 'stopped' : 'finished'}: ${completed} source profile(s) received. SwissADME still requires its own output.`);
    } catch (error) { message(error.name === 'AbortError' ? 'Queue stopped. Existing provider jobs may still run; saved job IDs can be resumed. An interrupted submission is not automatically repeated.' : error.message, true); }
    finally { queueController = null; setBusy(false); render(); }
  }
  $('admetApiConsent').addEventListener('change', updateApiButtons);
  $('admetRunProtox').addEventListener('click', () => runProtox(false));
  $('admetRunProtoxBatch').addEventListener('click', () => runProtox(true));
  $('admetStopProtox').addEventListener('click', () => queueController?.abort());
  fetch('/api/protox/status', { signal: AbortSignal.timeout(10000) }).then(async response => {
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('unavailable');
    const data = await response.json(); apiAvailable = data.available === true && data.provider === 'ProTox 3.0';
    if (!apiAvailable) throw new Error('unavailable');
    $('admetApiStatus').textContent = 'API adapter available. Upstream availability/quota are checked when you run a prediction. Sign-in required.'; updateApiButtons();
  }).catch(() => { $('admetApiStatus').textContent = 'Automatic ProTox retrieval is unavailable on this host. Run ProTox directly and import its actual output below. No fallback predictions will be generated.'; });

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
