const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Exercise the actual Workers fetch implementation, not an injected fetch function.
// Outbound traffic is intercepted AFTER runtime Request validation. Authentication
// and prediction responses remain synthetic; no live account or provider is used.
const source = fs.readFileSync(path.join(__dirname, '../server/protox-handler.mjs'), 'utf8');
const script = `import { handleProtox } from './protox-handler.mjs';
export default { fetch(request) {
  return handleProtox(request, new URL(request.url).pathname.split('/').pop());
} };`;
const AUTH = 'https://lfizlfdlrrmtkgzdmncc.supabase.co/auth/v1/user';
const ROOT = 'https://tox.charite.de/protox3/';
const response = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const predict = (mf, action, input) => mf.dispatchFetch(`https://example.test/api/protox/${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer runtime-fixture', Origin: 'https://example.test' }, body: JSON.stringify(input)
});
async function runtime(t, reply) {
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: [
      { type: 'ESModule', path: 'entry.mjs', contents: script },
      { type: 'ESModule', path: 'protox-handler.mjs', contents: source }
    ], compatibilityDate: '2026-11-27', cf: false,
    outboundService: async request => {
      calls.push({ url: request.url, headers: Object.fromEntries(request.headers), body: await request.text() });
      return reply(request.url, calls[calls.length - 1]);
    }
  }));
  t.after(() => mf.dispose());
  return { mf, calls };
}

test('Workers status identifies the deployed adapter revision without requesting upstream services', async t => {
  const { mf, calls } = await runtime(t, () => response('unexpected request', 500));
  const res = await mf.dispatchFetch('https://example.test/api/protox/status');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.adapterVersion, '2026-11-27.2');
  assert.match(body.note, /upstream health.*not implied/);
  assert.equal(calls.length, 0);
});

test('Workers runtime can verify the session and enqueue exact SMILES using native fetch', async t => {
  const { mf, calls } = await runtime(t, url => response(url === AUTH ? { id: 'fixture-user' } : 'runtime-job-1'));
  const res = await predict(mf, 'enqueue', { smiles: 'C[C@@H](O)/C=C\\C.[Na+]' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.jobId, 'runtime-job-1');
  assert.deepEqual(calls.map(call => call.url), [AUTH, ROOT + 'src/api_enqueue.php']);
  assert.equal(calls[0].headers.authorization, 'Bearer runtime-fixture');
  assert.equal(calls[1].headers.authorization, undefined);
  assert.equal(new URLSearchParams(calls[1].body).get('input'), 'C[C@@H](O)/C=C\\C.[Na+]');
});

test('Workers runtime rejects authentication redirects without forwarding the bearer or contacting ProTox', async t => {
  const { mf, calls } = await runtime(t, () => response('', 302, { Location: 'https://untrusted.example/collect' }));
  const res = await predict(mf, 'enqueue', { smiles: 'CCO' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /sign-in.*redirect.*blocked/i);
  assert.deepEqual(calls.map(call => call.url), [AUTH]);
});

test('Workers runtime rejects provider redirects without following or resubmitting', async t => {
  const { mf, calls } = await runtime(t, url => url === AUTH ? response({ id: 'fixture-user' }) : response('', 307, { Location: 'https://untrusted.example/submit' }));
  const res = await predict(mf, 'enqueue', { smiles: 'CCO' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /ProTox.*redirect.*blocked/i);
  assert.deepEqual(calls.map(call => call.url), [AUTH, ROOT + 'src/api_enqueue.php']);
  assert.equal(calls[1].headers.authorization, undefined);
});

test('Workers runtime retrieves original provider files with correct job IDs and separate source types', async t => {
  const { mf, calls } = await runtime(t, url => {
    if (url === AUTH) return response({ id: 'fixture-user' });
    if (url.endsWith('api_retrieve.php')) return response('ready');
    return response('Target\tPrediction\tProbability\n' + (url.endsWith('_tox_class.csv') ? 'LD50\t7000\t88.40' : url.endsWith('_result.csv') ? 'dili\t0\t0.00' : 'Fixture target\t3\t0.60'));
  });
  const res = await predict(mf, 'retrieve', { jobId: 'runtime-job-1' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.state, 'ready');
  assert.deepEqual(body.files.map(file => file.type), ['acute toxicity', 'toxicity model', 'toxicity target']);
  assert.equal(new URLSearchParams(calls[1].body).get('id'), 'runtime-job-1');
  assert.deepEqual(calls.map(call => call.url), [AUTH, ROOT + 'src/api_retrieve.php', ROOT + 'csv/runtime-job-1_tox_class.csv', ROOT + 'csv/runtime-job-1_result.csv', ROOT + 'csv/runtime-job-1_tox_targets.csv']);
  assert(calls.slice(1).every(call => !call.headers.authorization));
  assert(body.files[1].text.includes('dili\t0\t0.00'));
});

test('Workers runtime distinguishes sign-in service outages from expired sessions and never enqueues either', async t => {
  let expired = false;
  const { mf, calls } = await runtime(t, () => response({ error: 'fixture' }, expired ? 401 : 503));
  const outage = await predict(mf, 'enqueue', { smiles: 'CCO' });
  assert.equal(outage.status, 503);
  assert.match((await outage.json()).error, /sign-in service.*unavailable/i);
  expired = true;
  const session = await predict(mf, 'enqueue', { smiles: 'CCO' });
  assert.equal(session.status, 401);
  assert.match((await session.json()).error, /Sign in again/);
  assert.deepEqual(calls.map(call => call.url), [AUTH, AUTH]);
});

test('Workers treats a 404 HTML status response as pending without fetching source files or resubmitting', async t => {
  const { mf, calls } = await runtime(t, url => url === AUTH ? response({ id: 'fixture-user' }) : response('<!DOCTYPE html><html>Not found</html>', 404, { 'Retry-After': '60', 'Content-Type': 'text/html' }));
  const res = await predict(mf, 'retrieve', { jobId: 'runtime-pending' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: 'pending', jobId: 'runtime-pending', retryAfter: 60 });
  assert.deepEqual(calls.map(call => call.url), [AUTH, ROOT + 'src/api_retrieve.php']);
});

test('Workers accepts HTML only as a readiness hint and preserves actual CSV values even with PHP media types', async t => {
  const { mf, calls } = await runtime(t, url => {
    if (url === AUTH) return response({ id: 'fixture-user' });
    if (url.endsWith('api_retrieve.php')) return response('<!DOCTYPE html><html>CONTROL ONLY</html>', 200, { 'Content-Type': 'text/html' });
    return response('Target\tPrediction\tProbability\n' + (url.endsWith('_tox_class.csv') ? 'LD50\t7000\t88.40' : url.endsWith('_result.csv') ? 'dili\t0\t0.00' : 'Fixture target\t3\t0.60'), 200, { 'Content-Type': 'text/html' });
  });
  const res = await predict(mf, 'retrieve', { jobId: 'runtime-ready' });
  const body = await res.json();
  assert.equal(res.status, 200, body.error);
  assert.equal(body.state, 'ready');
  assert.equal(body.files.length, 3);
  assert(body.files[1].text.includes('dili\t0\t0.00'));
  assert.doesNotMatch(JSON.stringify(body), /CONTROL ONLY|<html>/);
  assert.equal(calls.length, 5);
});

test('Workers retains partial output when missing CSV files have HTML 404 bodies', async t => {
  const { mf } = await runtime(t, url => url === AUTH ? response({ id: 'fixture-user' }) : url.endsWith('api_retrieve.php') ? response('ready')
    : url.endsWith('_result.csv') ? response('Target\tPrediction\tProbability\ndili\t0\t0.00') : response('<html>Missing file</html>', 404));
  const body = await (await predict(mf, 'retrieve', { jobId: 'runtime-partial' })).json();
  assert.equal(body.state, 'ready');
  assert.equal(body.files.length, 1);
  assert.deepEqual(body.missing, ['acute toxicity', 'toxicity target']);
});

test('Workers submission HTML errors identify HTTP status and never become job IDs or duplicate submissions', async t => {
  let status = 404;
  const { mf, calls } = await runtime(t, url => url === AUTH ? response({ id: 'fixture-user' }) : response('<html>Private upstream text</html>', status, { 'Content-Type': 'text/html' }));
  for (status of [404, 200]) {
    const res = await predict(mf, 'enqueue', { smiles: 'CCO' });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert(body.error.includes(`ProTox submission (HTTP ${status})`));
    assert.deepEqual(body.diagnostics, { adapterVersion: '2026-11-27.2', stage: 'enqueue', upstreamStatus: status });
    assert.equal(body.jobId, undefined);
    assert.doesNotMatch(JSON.stringify(body), /Private upstream text|runtime-fixture|<html>/);
  }
  assert.deepEqual(calls.map(call => call.url), [AUTH, ROOT + 'src/api_enqueue.php', AUTH, ROOT + 'src/api_enqueue.php']);
});
