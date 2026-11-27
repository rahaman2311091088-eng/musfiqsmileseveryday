// Fixed-upstream adapter for ProTox 3.0's documented POST API; never a generic proxy.
// Protocol reference: provider FAQ §2.3 and the public sample script linked in README.
const ORIGIN = 'https://tox.charite.de';
const ROOT = `${ORIGIN}/protox3/`;
const AUTH_URL = 'https://lfizlfdlrrmtkgzdmncc.supabase.co/auth/v1/user';
// Public anon key already used by the website. This is NOT a service-role credential.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmaXpsZmRscnJtdGtnemRtbmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNDA3NTYsImV4cCI6MjA5NzgxNjc1Nn0.2oD5KlqRGber12j117F-VmJSHT66z-souEj5Q5CF_Ik';
export const MODELS = 'acute_tox dili neuro nephro respi cardio carcino immuno mutagen cyto bbb eco clinical nutri nr_ahr nr_ar nr_ar_lbd nr_aromatase nr_er nr_er_lbd nr_ppar_gamma sr_are sr_hse sr_mmp sr_p53 sr_atad5 mie_thr_alpha mie_thr_beta mie_ttr mie_ryr mie_gabar mie_nmdar mie_ampar mie_kar mie_ache mie_car mie_pxr mie_nadhox mie_vgsc mie_nis CYP1A2 CYP2C19 CYP2C9 CYP2D6 CYP3A4 CYP2E1 tox_targets';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
} });
const fail = (status, message, retryAfter) => Object.assign(new Error(message), { status, retryAfter });
function retrySeconds(header, fallback = 30) {
  if (!header) return fallback;
  const value = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Number.isFinite(value) ? Math.max(5, value) : fallback;
}
async function readBounded(response, limit) {
  if (Number(response.headers.get('Content-Length')) > limit) throw fail(502, 'Provider response exceeds the supported size.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let length = 0, text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw fail(502, 'Provider response exceeds the supported size.'); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
export function createHandler({ fetch: fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 45000 } = {}) {
  async function upstream(path, data, limit = 512000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ROOT + path, {
        method: data ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { Accept: 'text/plain,text/csv' },
        ...(data ? { body: new URLSearchParams(data).toString() } : {})
      });
      const retryAfter = retrySeconds(response.headers.get('Retry-After'));
      if (response.status === 429) throw fail(429, 'ProTox is rate-limiting requests. Wait before resuming; no submission is automatically retried.', retryAfter);
      if (response.status === 403) throw fail(403, 'ProTox denied access or its shared source-IP daily quota was reached (250 queries/day). Try later or use a provider export.');
      if (!response.ok && response.status !== 404) throw fail(502, `ProTox returned HTTP ${response.status}. No predictions were substituted.`);
      const text = await readBounded(response, limit);
      if (/^\s*<(?:!doctype|html|body)/i.test(text)) throw fail(502, 'ProTox returned a web/error page instead of API output. Use a provider export.');
      return { status: response.status, text, retryAfter };
    } catch (error) {
      if (error.status) throw error;
      throw fail(502, 'Could not reach the ProTox API. A submitted job may still be running; do not automatically resubmit.');
    } finally { clearTimeout(timer); }
  }
  return async function handle(request, action) {
    if (action === 'status' && request.method === 'GET') return json({ available: true, provider: 'ProTox 3.0', dailySourceIpLimit: 250, note: 'Adapter available; upstream health and predictions are not implied.' });
    if (request.method !== 'POST') return json({ error: 'Use POST for prediction requests.' }, 405);
    if (!['enqueue', 'retrieve'].includes(action)) return json({ error: 'Unknown action.' }, 404);
    try {
      const origin = request.headers.get('Origin');
      const requestUrl = new URL(request.url);
      // Preview proxies can terminate HTTPS and rewrite the local upstream Host.
      // Browsers own Sec-Fetch-Site (scripts cannot set it); bearer auth is still mandatory.
      let originUrl;
      try { originUrl = origin ? new URL(origin) : null; } catch { throw fail(403, 'Invalid request origin.'); }
      const sameHostTlsProxy = originUrl && requestUrl.protocol === 'http:' && originUrl.protocol === 'https:' && originUrl.host === requestUrl.host;
      const sameOriginBrowser = request.headers.get('Sec-Fetch-Site') === 'same-origin';
      if (origin && origin !== requestUrl.origin && !sameHostTlsProxy && !sameOriginBrowser) throw fail(403, 'Cross-origin prediction requests are not allowed.');
      if (!request.headers.get('Content-Type')?.includes('application/json')) throw fail(415, 'Use JSON input.');
      const authorization = request.headers.get('Authorization') || '';
      if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization) || authorization.length > 8192) throw fail(401, 'Sign in to use the ProTox integration.');
      const inputText = await readBounded(request, 10000);
      let input;
      try { input = JSON.parse(inputText); } catch { throw fail(400, 'Invalid JSON input.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Expected a JSON object.');
      if (action === 'enqueue' && (typeof input.smiles !== 'string' || !input.smiles || input.smiles.length > 4000 || /\s|[<>]/.test(input.smiles))) throw fail(400, 'Supply one SMILES string, up to 4000 characters, without whitespace or HTML.');
      if (action === 'retrieve' && (typeof input.jobId !== 'string' || !ID.test(input.jobId))) throw fail(400, 'Invalid ProTox job ID.');
      // Validate a real logged-in user; never forward the user's JWT to ProTox.
      const auth = await fetchImpl(AUTH_URL, { headers: { Authorization: authorization, apikey: ANON_KEY }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!auth.ok) throw fail(401, 'Your session expired or could not be verified. Sign in again.');
      const user = JSON.parse(await readBounded(auth, 64000));
      if (!user.id) throw fail(401, 'Your session could not be verified.');
      if (action === 'enqueue') {
        // Intentionally no retry: a lost POST response may have already created a job.
        const response = await upstream('src/api_enqueue.php', { input_type: 'smiles', input: input.smiles, requested_data: JSON.stringify([MODELS]) }, 2000);
        const jobId = response.text.trim();
        if (response.status !== 200 || !ID.test(jobId)) throw fail(502, 'ProTox did not return a recognizable job ID. No local prediction was created.');
        return json({ jobId, retryAfter: Math.max(5, response.retryAfter), requestedModels: MODELS });
      }
      const jobId = input.jobId;
      const response = await upstream('src/api_retrieve.php', { id: jobId }, 16000);
      if (response.status === 404 || !response.text.trim()) return json({ state: 'pending', jobId, retryAfter: Math.max(30, response.retryAfter) });
      const files = [], missing = [];
      // Keep raw provider files separate, including their original headers and units.
      for (const [suffix, type] of [['tox_class', 'acute toxicity'], ['result', 'toxicity model'], ['tox_targets', 'toxicity target']]) {
        const path = `csv/${jobId}_${suffix}.csv`;
        const file = await upstream(path);
        if (file.status === 404 || !file.text.trim()) { missing.push(type); continue; }
        if (!/\bTarget\b/i.test(file.text.split(/\r?\n/, 1)[0]) || !/\bPrediction\b/i.test(file.text.split(/\r?\n/, 1)[0])) throw fail(502, 'ProTox output format changed. Raw exports can be imported for review; nothing was estimated.');
        if (file.text.trim().split(/\r?\n/).length < 2) { missing.push(type); continue; }
        files.push({ type, text: file.text, url: ROOT + path });
      }
      if (!files.length) return json({ state: 'pending', jobId, retryAfter: 30 });
      return json({ state: 'ready', jobId, files, missing, retryAfter: 30 });
    } catch (error) {
      return json({ error: error.status ? error.message : 'ProTox integration failed. No source values were added.', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, error.status || 502);
    }
  };
}
export const handleProtox = createHandler();
