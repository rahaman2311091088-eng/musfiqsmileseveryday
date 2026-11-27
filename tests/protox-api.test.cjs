const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../assets/protox-client.js');
const loadServer = () => import('../server/protox-handler.mjs');
const ROOT = 'https://tox.charite.de/protox3/';
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const request = (action, body, headers = {}) => new Request(`https://preview.example/api/protox/${action}`, { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json', Origin: 'https://preview.example', ...headers }, body: JSON.stringify(body) });
async function server(upstream, authOK = true) {
  const calls = [];
  const { createHandler } = await loadServer();
  const handle = createHandler({ fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/auth/v1/user')) return reply(authOK ? { id: 'fixture-user' } : { error: 'expired' }, authOK ? 200 : 401);
    return upstream(url, options);
  } });
  return { handle, calls };
}

test('adapter status is not a claim that upstream predictions are live', async () => {
  const { handle, calls } = await server(() => { throw new Error('should not request upstream'); });
  const res = await handle(new Request('https://preview.example/api/protox/status'), 'status');
  assert.equal(res.status, 200);
  assert.match((await res.json()).note, /upstream health.*not implied/);
  assert.equal(calls.length, 0);
});

test('API submission encodes exact stereochemical SMILES, uses fixed documented endpoint and never forwards login token', async () => {
  const { handle, calls } = await server((url, options) => {
    assert.equal(url, ROOT + 'src/api_enqueue.php');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('input_type'), 'smiles');
    assert.equal(body.get('input'), 'C[C@@H](O)/C=C\\C.[Na+]');
    assert.match(JSON.parse(body.get('requested_data'))[0], /acute_tox dili/);
    assert.match(JSON.parse(body.get('requested_data'))[0], /CYP2E1 tox_targets/);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'manual');
    return reply('fixture-job-0001', 200, { 'Retry-After': '45' });
  });
  const res = await handle(request('enqueue', { smiles: 'C[C@@H](O)/C=C\\C.[Na+]' }), 'enqueue');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).jobId, 'fixture-job-0001');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(calls[0].options.redirect, 'manual');
});

test('invalid input, cross-origin requests, unauthenticated requests, and URL/path injection are blocked before upstream', async () => {
  const { handle, calls } = await server(() => { throw new Error('must not reach upstream'); });
  for (const [action, body, headers, status] of [
    ['enqueue', { smiles: 'CCO CCN' }, {}, 400],
    ['enqueue', { smiles: '<script>' }, {}, 400],
    ['enqueue', { smiles: 'C'.repeat(4001) }, {}, 400],
    ['retrieve', { jobId: '../private' }, {}, 400],
    ['retrieve', { jobId: 'https://other.example' }, {}, 400],
    ['enqueue', { smiles: 'CCO' }, { Origin: 'https://other.example' }, 403],
    ['enqueue', { smiles: 'CCO' }, { Authorization: '' }, 401]
  ]) assert.equal((await handle(request(action, body, headers), action)).status, status);
  const preview = new Request('http://127.0.0.1:4174/api/protox/enqueue', { method: 'POST', headers: { Origin: 'https://4174-preview.e2b.app', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: '{"smiles":"CCO"}' });
  assert.equal((await handle(preview, 'enqueue')).status, 401, 'same-origin browser requests through the TLS preview proxy reach authentication, not an origin rejection');
  assert.equal(calls.length, 0);
});

test('expired Supabase sessions cannot send provider prediction jobs', async () => {
  const { handle, calls } = await server(() => { throw new Error('must not reach ProTox'); }, false);
  const response = await handle(request('enqueue', { smiles: 'CCO' }), 'enqueue');
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
});

test('429 Retry-After, 403 quota, malformed job IDs and service failures never cause automatic duplicate POSTs', async () => {
  for (const [upstream, status, pattern] of [
    [() => reply('slow down', 429, { 'Retry-After': '90' }), 429, /rate-limiting/],
    [() => reply('quota exceeded', 403), 403, /quota/],
    [() => reply('not a valid id'), 502, /job ID/],
    [() => reply('<html>Bad gateway</html>'), 502, /web\/error page/],
    [() => reply('down', 503), 502, /HTTP 503/],
    [() => { throw new Error('network outage'); }, 502, /not automatically resubmit/]
  ]) {
    const { handle, calls } = await server(upstream);
    const res = await handle(request('enqueue', { smiles: 'CCO' }), 'enqueue');
    assert.equal(res.status, status);
    const body = await res.json(); assert.match(body.error, pattern);
    if (status === 429) assert.equal(body.retryAfter, 90);
    assert.equal(calls.length, 2);
  }
});

test('all provider redirect statuses are explicitly rejected without another request', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const { handle, calls } = await server(() => reply('', status, { Location: 'https://untrusted.example/submit' }));
    const res = await handle(request('enqueue', { smiles: 'CCO' }), 'enqueue');
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /redirect.*blocked/);
    assert.equal(calls.length, 2); // One auth check, one submission, no redirect/retry.
    assert(calls.every(call => call.options.redirect === 'manual'));
  }
});

test('session verification failures give actionable errors without contacting ProTox or leaking credentials', async () => {
  const { createHandler } = await loadServer();
  for (const [respond, status, pattern] of [
    [() => { throw new TypeError('private transport detail'); }, 503, /reach the sign-in service/],
    [() => { throw new DOMException('timed out', 'TimeoutError'); }, 503, /reach the sign-in service/],
    [() => reply('', 302, { Location: 'https://untrusted.example/collect' }), 502, /sign-in.*redirect.*blocked/i],
    [() => reply('unavailable', 503), 503, /sign-in service.*unavailable/i],
    [() => reply('too many checks', 429, { 'Retry-After': '90' }), 503, /sign-in service.*unavailable/i],
    [() => reply('<html>unexpected</html>'), 502, /unreadable response/],
    [() => reply('null'), 401, /Sign in again/],
    [() => reply({ id: 123 }), 401, /Sign in again/],
    [() => reply('x'.repeat(64001)), 502, /unreadable response/]
  ]) {
    const calls = [];
    const handle = createHandler({ fetch: async (url, options) => { calls.push({ url, options }); return respond(); } });
    const res = await handle(request('enqueue', { smiles: 'CCO' }), 'enqueue');
    const body = await res.json();
    assert.equal(res.status, status);
    assert.match(body.error, pattern);
    assert.doesNotMatch(body.error, /fixture-token|private transport detail/);
    if (body.retryAfter) assert.equal(body.retryAfter, 90);
    assert.equal(calls.length, 1);
    assert(calls[0].url.endsWith('/auth/v1/user'));
    assert.equal(calls[0].options.redirect, 'manual');
  }
});

test('pending jobs return no predictions and no guessed CSV values', async () => {
  for (const response of [reply('', 200), reply('not ready', 404)]) {
    const { handle, calls } = await server(() => response);
    const res = await handle(request('retrieve', { jobId: 'fixture-job-0001' }), 'retrieve');
    assert.deepEqual(await res.json(), { state: 'pending', jobId: 'fixture-job-0001', retryAfter: 30 });
    assert.equal(calls.length, 2);
  }
});

test('completed jobs return distinct raw acute, model and target files without numeric transformations', async () => {
  const { handle, calls } = await server((url, options) => {
    if (url.endsWith('api_retrieve.php')) { assert.equal(new URLSearchParams(options.body).get('id'), 'fixture-job-0001'); return reply('ready'); }
    const rows = url.endsWith('_tox_class.csv') ? 'LD50\t7000\t88.40' : url.endsWith('_result.csv') ? 'dili\t0\t0.00' : 'Test target\t3\t0.90';
    return reply('Target\tPrediction\tProbability\n' + rows);
  });
  const res = await handle(request('retrieve', { jobId: 'fixture-job-0001' }), 'retrieve');
  const body = await res.json();
  assert.equal(body.state, 'ready');
  assert.deepEqual(body.files.map(f => f.type), ['acute toxicity', 'toxicity model', 'toxicity target']);
  assert(body.files[0].text.endsWith('LD50\t7000\t88.40'));
  assert(body.files[1].text.endsWith('dili\t0\t0.00'));
  assert(body.files.every(f => f.url.startsWith(ROOT + 'csv/fixture-job-0001')));
  assert.deepEqual(body.missing, []);
  assert.equal(calls.length, 5);
});

test('partial files report explicit missing types; malformed output fails closed', async () => {
  const { handle } = await server(url => url.endsWith('api_retrieve.php') ? reply('ready') : url.endsWith('_result.csv') ? reply('Target\tPrediction\tProbability\ndili\t0\t0.8') : reply('', 404));
  const result = await (await handle(request('retrieve', { jobId: 'fixture-job-0001' }), 'retrieve')).json();
  assert.equal(result.files.length, 1);
  assert.deepEqual(result.missing, ['acute toxicity', 'toxicity target']);
  const broken = await server(url => url.endsWith('api_retrieve.php') ? reply('ready') : reply('Unexpected,format\n100,200'));
  assert.equal((await broken.handle(request('retrieve', { jobId: 'fixture-job-0001' }), 'retrieve')).status, 502);
});

test('oversized source responses are refused, not truncated into apparently valid results', async () => {
  const { handle } = await server(() => reply('x'.repeat(2100)));
  const res = await handle(request('enqueue', { smiles: 'CCO' }), 'enqueue');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /size/);
});

test('browser client uses same-origin URLs, preserves the job/input association and waits at least 30s between polls', async () => {
  const requests = [], waits = [];
  let checks = 0;
  const client = createClient({ getToken: async () => 'user-token', wait: async ms => waits.push(ms), fetch: async (url, options) => {
    requests.push({ url, options });
    return reply(url.endsWith('enqueue') ? { jobId: 'job-1', retryAfter: 45 } : ++checks === 1 ? { jobId: 'job-1', state: 'pending', retryAfter: 65 } : { jobId: 'job-1', state: 'ready', files: [] });
  } });
  const job = await client.enqueue('C[C@@H](O)C(=O)O');
  const result = await client.poll(job);
  assert.equal(job.inputSmiles, 'C[C@@H](O)C(=O)O');
  assert.equal(result.state, 'ready');
  assert.deepEqual(waits, [45000, 65000]);
  assert(requests.every(r => r.url.startsWith('/api/protox/')));
  assert.equal(requests[0].options.headers.Authorization, 'Bearer user-token');
  assert.equal(JSON.parse(requests[1].options.body).jobId, 'job-1');
});

test('browser failures and static-only hosts produce no substitute prediction or hidden retries', async () => {
  for (const response of [reply('<html>static site</html>'), reply({ error: 'quota reached' }, 403), reply({ jobId: '../invalid' })]) {
    let calls = 0;
    const client = createClient({ getToken: async () => 'token', fetch: async () => { calls++; return response; } });
    await assert.rejects(client.enqueue('CCO'));
    assert.equal(calls, 1);
  }
  const client = createClient({ getToken: async () => '', fetch: async () => assert.fail('unauthenticated fetch') });
  await assert.rejects(client.enqueue('CCO'), /Sign in/);
});

test('poll limits retain a pending job without submitting it again; wrong job responses are rejected', async () => {
  let calls = 0;
  const job = { id: 'job-1', inputSmiles: 'CCO' };
  const client = createClient({ getToken: async () => 'token', wait: async () => {}, fetch: async url => {
    assert.equal(url, '/api/protox/retrieve'); calls++; return reply({ state: 'pending', jobId: 'job-1' });
  } });
  assert.equal((await client.poll(job, { maxPolls: 2 })).state, 'pending');
  assert.equal(calls, 2);
  const wrong = createClient({ getToken: async () => 'token', fetch: async () => reply({ state: 'ready', jobId: 'different' }) });
  await assert.rejects(wrong.retrieve(job), /Unexpected ProTox job/);
});

test('manual retries cannot bypass a provider Retry-After cooldown', async () => {
  let calls = 0, clock = 100000;
  const client = createClient({ getToken: async () => 'token', now: () => clock, fetch: async () => {
    calls++;
    return calls === 1 ? reply({ error: 'Rate limit', retryAfter: 90 }, 429) : reply({ jobId: 'job-1', retryAfter: 5 });
  } });
  await assert.rejects(client.enqueue('CCO'), /Rate limit/);
  await assert.rejects(client.enqueue('CCO'), /cooldown/);
  assert.equal(calls, 1);
  clock += 90000;
  assert.equal((await client.enqueue('CCO')).id, 'job-1');
  assert.equal(calls, 2);
});

test('header-only provider CSV is explicitly missing, not inactive or a complete file', async () => {
  const { handle } = await server(url => url.endsWith('api_retrieve.php') ? reply('ready') : url.endsWith('_result.csv') ? reply('Target\tPrediction\tProbability\ndili\t0\t0.8') : reply('Target\tPrediction\tProbability\n'));
  const data = await (await handle(request('retrieve', { jobId: 'fixture-job-0001' }), 'retrieve')).json();
  assert.equal(data.files.length, 1);
  assert.deepEqual(data.missing, ['acute toxicity', 'toxicity target']);
});

// Provider transport fixtures only, not observed or scientifically verified results.
test('an HTML 404 on the result-check endpoint is pending and respects Retry-After', async () => {
  const { handle, calls } = await server(() => reply('<!DOCTYPE html><html><body>Not found</body></html>', 404, { 'Content-Type': 'text/html', 'Retry-After': '75' }));
  const res = await handle(request('retrieve', { jobId: 'pending-fixture' }), 'retrieve');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: 'pending', jobId: 'pending-fixture', retryAfter: 75 });
  assert.equal(calls.length, 2); // Auth and status only; no resubmission or premature file reads.
});

test('HTML at submission is never a job ID, and missing endpoints are not mistaken for pending jobs', async () => {
  for (const status of [200, 404]) {
    const { handle, calls } = await server(() => reply('<!DOCTYPE html><html>private echoed input; fixture-token</html>', status, { 'Content-Type': 'text/html' }));
    const res = await handle(request('enqueue', { smiles: 'CCO' }), 'enqueue');
    const body = await res.json();
    assert.equal(res.status, 502);
    assert(body.error.includes(`ProTox submission (HTTP ${status})`));
    assert.match(body.error, status === 404 ? /endpoint was not found/ : /web\/error page instead of a job ID/);
    assert.deepEqual(body.diagnostics, { adapterVersion: '2026-11-27.2', stage: 'enqueue', upstreamStatus: status });
    assert.doesNotMatch(JSON.stringify(body), /private echoed input|fixture-token|<!DOCTYPE/);
    assert.equal(body.jobId, undefined);
    assert.equal(calls.length, 2);
  }
});

test('non-empty HTML readiness bodies are not evidence; only fixed job CSVs supply returned values', async () => {
  const panel = '<!DOCTYPE html><html>CONTROL RESPONSE, NOT A PREDICTION' + 'x'.repeat(65000) + '</html>';
  const { handle, calls } = await server(url => {
    if (url.endsWith('api_retrieve.php')) return reply(panel, 200, { 'Content-Type': 'text/html', 'Content-Length': String(panel.length) });
    return reply('Target\tPrediction\tProbability\n' + (url.endsWith('_tox_class.csv') ? 'LD50\t7000\t88.40' : url.endsWith('_result.csv') ? 'dili\t0\t0.00' : 'Fixture target\t3\t0.60'), 200, { 'Content-Type': 'text/html' });
  });
  const res = await handle(request('retrieve', { jobId: 'ready-fixture' }), 'retrieve');
  const body = await res.json();
  assert.equal(res.status, 200, body.error);
  assert.equal(body.state, 'ready');
  assert.equal(body.files.length, 3);
  assert(body.files.every(file => file.url.startsWith(ROOT + 'csv/ready-fixture_')));
  assert(body.files[1].text.includes('dili\t0\t0.00'));
  assert.doesNotMatch(JSON.stringify(body), /CONTROL RESPONSE|<html>/);
  assert.equal(calls.length, 5);
});

test('HTML 404 result files stay missing, while HTML 200 result files fail closed with stage/status diagnostics', async () => {
  let missingStatus = 404;
  const { handle, calls } = await server(url => url.endsWith('api_retrieve.php') ? reply('<html>ready marker</html>')
    : url.endsWith('_result.csv') ? reply('Target\tPrediction\tProbability\ndili\t0\t0.00')
    : reply('<html>Not found</html>', missingStatus, { 'Content-Type': 'text/html' }));
  let res = await handle(request('retrieve', { jobId: 'partial-fixture' }), 'retrieve');
  let body = await res.json();
  assert.equal(body.state, 'ready');
  assert.equal(body.files.length, 1);
  assert.deepEqual(body.missing, ['acute toxicity', 'toxicity target']);
  assert.equal(calls.length, 5);
  missingStatus = 200;
  res = await handle(request('retrieve', { jobId: 'partial-fixture' }), 'retrieve');
  body = await res.json();
  assert.equal(res.status, 502);
  assert.match(body.error, /ProTox result file \(HTTP 200\).*web\/error page instead of CSV/);
  assert.equal(body.files, undefined);
  assert.deepEqual(body.diagnostics, { adapterVersion: '2026-11-27.2', stage: 'file', upstreamStatus: 200 });
});

test('a readiness hint with no available CSVs stays pending; empty and excessive-whitespace bodies never create values', async () => {
  for (const content of ['<html>ready hint</html>', '', '   \n\t', ' '.repeat(16001)]) {
    const { handle, calls } = await server(url => url.endsWith('api_retrieve.php') ? reply(content) : reply('<html>Not found</html>', 404));
    const res = await handle(request('retrieve', { jobId: 'unready-fixture' }), 'retrieve');
    const body = await res.json();
    assert.equal(body.files, undefined);
    if (content.length > 16000) {
      assert.equal(res.status, 502);
      assert.equal(body.diagnostics.stage, 'retrieve');
      assert.match(body.error, /ProTox result check \(HTTP 200\).*excessive empty content/);
    } else {
      assert.equal(res.status, 200);
      assert.equal(body.state, 'pending');
      assert.equal(body.jobId, 'unready-fixture');
    }
    assert.equal(calls.length, content.startsWith('<html>') ? 5 : 2);
  }
});

test('browser client and adapter progress from HTML pending to original CSVs without another enqueue', async () => {
  let polls = 0;
  const { handle, calls } = await server(url => {
    if (url.endsWith('api_enqueue.php')) return reply('end-to-end-fixture', 200, { 'Content-Type': 'text/html' });
    if (url.endsWith('api_retrieve.php')) return ++polls === 1 ? reply('<html>Not found</html>', 404, { 'Retry-After': '60' }) : reply('<html>ready marker</html>');
    return reply('Target\tPrediction\tProbability\n' + (url.endsWith('_tox_class.csv') ? 'LD50\t7000\t88.40' : url.endsWith('_result.csv') ? 'dili\t0\t0.00' : 'Fixture target\t3\t0.60'));
  });
  const waits = [];
  const client = createClient({ getToken: async () => 'fixture-token', wait: async ms => waits.push(ms), fetch: async (url, options) => {
    const action = url.split('/').pop();
    return handle(new Request('https://preview.example' + url, options), action);
  } });
  const job = await client.enqueue('C[C@@H](O)C(=O)O');
  const result = await client.poll(job, { maxPolls: 3 });
  assert.equal(job.inputSmiles, 'C[C@@H](O)C(=O)O');
  assert.equal(result.state, 'ready');
  assert.equal(result.files.length, 3);
  assert.deepEqual(waits, [30000, 60000]);
  assert.equal(calls.filter(call => call.url.endsWith('api_enqueue.php')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('api_retrieve.php')).length, 2);
});
