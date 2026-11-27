/* ProTox POST API client. Requests go through the same-origin Pages Function. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProtoxClient = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const MODELS = 'acute_tox dili neuro nephro respi cardio carcino immuno mutagen cyto bbb eco clinical nutri nr_ahr nr_ar nr_ar_lbd nr_aromatase nr_er nr_er_lbd nr_ppar_gamma sr_are sr_hse sr_mmp sr_p53 sr_atad5 mie_thr_alpha mie_thr_beta mie_ttr mie_ryr mie_gabar mie_nmdar mie_ampar mie_kar mie_ache mie_car mie_pxr mie_nadhox mie_vgsc mie_nis CYP1A2 CYP2C19 CYP2C9 CYP2D6 CYP3A4 CYP2E1 tox_targets';
  const secondsOf = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.max(5, Number(value)) : fallback;
  async function delay(ms, signal) {
    // Chunk very long Retry-After waits so browser timer overflow cannot cause early requests.
    if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid provider wait time.');
    do {
      const step = Math.min(ms, 2147483647);
      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Stopped. Existing provider jobs are retained.', 'AbortError'));
        const stop = () => { clearTimeout(timer); reject(new DOMException('Stopped. Existing provider jobs are retained.', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, step);
        signal?.addEventListener('abort', stop, { once: true });
      });
      ms -= step;
    } while (ms > 0);
  }
  function createClient({ fetch: fetchImpl = globalThis.fetch.bind(globalThis), getToken = async () => '', wait = delay, now = Date.now } = {}) {
    let cooldownUntil = 0;
    async function request(action, data, signal) {
      if (cooldownUntil > now()) throw new Error(`ProTox requested a cooldown. Wait at least ${Math.ceil((cooldownUntil - now()) / 1000)} seconds before resuming.`);
      const token = await getToken();
      if (!token) throw new Error('Sign in before using the ProTox API. Manual source imports remain available.');
      const controller = new AbortController();
      const stop = () => controller.abort();
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(() => controller.abort(), 65000);
      try {
        const response = await fetchImpl(`/api/protox/${action}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(data), signal: controller.signal });
        const text = await response.text();
        let result;
        try { result = JSON.parse(text); } catch { throw new Error('ProTox integration is unavailable on this host. Import actual ProTox results instead; no predictions were generated locally.'); }
        if (!response.ok) {
          const error = new Error(result.error || `ProTox request failed (${response.status}).`);
          error.status = response.status;
          error.retryAfter = secondsOf(result.retryAfter, 30);
          // Keep only the adapter's bounded, non-sensitive transport metadata.
          // The UI must not infer provider health from the local HTTP 502 alone.
          const details = result.diagnostics;
          if (details && !Array.isArray(details) && ['enqueue', 'retrieve', 'file'].includes(details.stage)
              && (details.upstreamStatus === null || (Number.isInteger(details.upstreamStatus) && details.upstreamStatus >= 100 && details.upstreamStatus <= 599))) {
            error.diagnostics = { stage: details.stage, upstreamStatus: details.upstreamStatus };
            if (/^\d{4}-\d{2}-\d{2}\.\d{1,6}$/.test(details.adapterVersion || '')) error.diagnostics.adapterVersion = details.adapterVersion;
          }
          if (response.status === 429 || result.retryAfter) cooldownUntil = now() + error.retryAfter * 1000;
          throw error;
        }
        return result;
      } catch (error) {
        if (error.name === 'AbortError' && !signal?.aborted) throw new Error('ProTox request timed out. A submission may already exist; it is not automatically resubmitted.');
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    }
    async function enqueue(smiles, signal) {
      if (!smiles || smiles.length > 4000 || /\s|[<>]/.test(smiles)) throw new Error('Supply one SMILES string (no names, whitespace, or HTML).');
      const result = await request('enqueue', { smiles }, signal);
      if (!JOB_ID.test(result.jobId || '')) throw new Error('ProTox did not return a valid job ID. No result was added.');
      return { id: result.jobId, inputSmiles: smiles, submittedAt: new Date().toISOString(),
        retryAfter: secondsOf(result.retryAfter, 5), status: 'pending' };
    }
    async function retrieve(job, signal) {
      if (!JOB_ID.test(job.id || '') || !job.inputSmiles) throw new Error('The saved ProTox job is invalid.');
      const result = await request('retrieve', { jobId: job.id }, signal);
      if (result.jobId !== job.id || !['pending', 'ready'].includes(result.state)) throw new Error('Unexpected ProTox job response. Nothing was added.');
      return result;
    }
    async function poll(job, { signal, onProgress = () => {}, maxPolls = 20 } = {}) {
      let seconds = Math.max(30, secondsOf(job.retryAfter, 30));
      for (let i = 0; i < maxPolls; i++) {
        onProgress(`ProTox job ${job.id}: waiting ${seconds}s (check ${i + 1}/${maxPolls}).`);
        await wait(seconds * 1000, signal);
        const result = await retrieve(job, signal);
        if (result.state === 'ready') return result;
        seconds = Math.max(30, secondsOf(result.retryAfter, 30));
      }
      return { state: 'pending', jobId: job.id, retryAfter: seconds };
    }
    return { enqueue, retrieve, poll, wait };
  }
  return { createClient, JOB_ID, MODELS, delay };
});
