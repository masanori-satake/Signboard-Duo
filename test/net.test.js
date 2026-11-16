'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const fs = require('node:fs');
const path = require('node:path');
const { fetchOnce, parseProxyUrl, noProxyMatch, proxyForUrl, classifyError } = require('../src/net');

const DEADLINE = () => Date.now() + 15000;

test('parseProxyUrl handles userinfo, defaults and garbage', () => {
  assert.deepEqual(parseProxyUrl('proxy.local:8080'), { host: 'proxy.local', port: 8080, auth: null });
  assert.equal(parseProxyUrl('http://proxy.local').port, 80);
  assert.equal(parseProxyUrl('https://proxy.local').port, 443);
  const withAuth = parseProxyUrl('http://user:p%40ss@proxy.local:3128');
  assert.equal(withAuth.host, 'proxy.local');
  assert.equal(withAuth.auth, 'Basic ' + Buffer.from('user:p@ss').toString('base64'));
  assert.equal(parseProxyUrl(''), null);
  assert.equal(parseProxyUrl(null), null);
  assert.equal(parseProxyUrl('http://'), null);
});

test('noProxyMatch follows suffix, wildcard and port rules', () => {
  assert.equal(noProxyMatch('example.com', 443, ['example.com']), true);
  assert.equal(noProxyMatch('sub.example.com', 443, ['example.com']), true);
  assert.equal(noProxyMatch('sub.example.com', 443, ['.example.com']), true);
  assert.equal(noProxyMatch('notexample.com', 443, ['example.com']), false);
  assert.equal(noProxyMatch('anything.jp', 80, ['*']), true);
  assert.equal(noProxyMatch('example.com', 8080, ['example.com:8080']), true);
  assert.equal(noProxyMatch('example.com', 443, ['example.com:8080']), false);
  assert.equal(noProxyMatch('EXAMPLE.com', 443, ['Example.COM']), true);
  assert.equal(noProxyMatch('example.com', 443, []), false);
});

test('proxyForUrl bypasses NO_PROXY hosts only', () => {
  const cfg = { proxy: 'proxy.local:8080', noProxy: ['internal.local'] };
  assert.equal(proxyForUrl('https://example.com/feed', cfg).host, 'proxy.local');
  assert.equal(proxyForUrl('https://internal.local/feed', cfg), null);
  assert.equal(proxyForUrl('https://example.com/feed', { proxy: '' }), null);
  assert.equal(proxyForUrl('https://example.com/feed', null), null);
});

test('classifyError maps codes to symptoms', () => {
  const err = (code) => Object.assign(new Error('x'), { code });
  assert.equal(classifyError(err('ENOTFOUND'), false), 'dns');
  assert.equal(classifyError(err('ENOTFOUND'), true), 'proxy');
  assert.equal(classifyError(err('ECONNREFUSED'), false), 'connect');
  assert.equal(classifyError(err('ECONNREFUSED'), true), 'proxy');
  assert.equal(classifyError(err('ETIMEDOUT'), false), 'timeout');
  assert.equal(classifyError(new Error('fetch deadline exceeded'), false), 'timeout');
  assert.equal(classifyError(err('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), true), 'tls');
  assert.equal(classifyError(Object.assign(new Error('x'), { symptom: 'proxy-auth' }), true), 'proxy-auth');
});

/* ---- loopback integration: a tiny origin and a tiny proxy ---- */

function listen(server) {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));
}

function makeProxy({ requireAuth = false } = {}) {
  const proxy = http.createServer((req, res) => {
    // Absolute-form request line for plain HTTP targets.
    if (requireAuth && req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('u:p').toString('base64')) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic' });
      res.end();
      return;
    }
    const target = new URL(req.url);
    const fwd = http.request({ host: target.hostname, port: target.port, path: target.pathname, method: 'GET' }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    fwd.on('error', () => { res.writeHead(502); res.end(); });
    fwd.end();
  });
  proxy.on('connect', (req, clientSocket, head) => {
    if (requireAuth && req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('u:p').toString('base64')) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n');
      clientSocket.destroy();
      return;
    }
    const [host, port] = req.url.split(':');
    const upstream = require('net').connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });
  return proxy;
}

test('the body cap aborts oversize responses, and a larger cap admits them', { timeout: 20000 }, async () => {
  // Regression: the GitHub adapter's 100-run listing legitimately
  // exceeds the 1 MB feed cap; it fetches with a larger cap instead.
  const big = 'x'.repeat(2 * 1024 * 1024);
  const origin = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(big); });
  const oPort = await listen(origin);
  try {
    await assert.rejects(
      fetchOnce(`http://127.0.0.1:${oPort}/runs`, {}, [], 0, DEADLINE(), null),
      /response too large/);
    const res = await fetchOnce(`http://127.0.0.1:${oPort}/runs`, {}, [], 0, DEADLINE(), null, 8 * 1024 * 1024);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, big.length);
  } finally { origin.closeAllConnections(); origin.close(); }
});

test('fetchOnce reaches an HTTP origin through a proxy (absolute form)', { timeout: 20000 }, async () => {
  const origin = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<rss/>'); });
  const proxy = makeProxy();
  const [oPort, pPort] = [await listen(origin), await listen(proxy)];
  try {
    const res = await fetchOnce(`http://127.0.0.1:${oPort}/feed`, {}, [], 0, DEADLINE(), { proxy: `http://127.0.0.1:${pPort}`, noProxy: [] });
    assert.equal(res.status, 200);
    assert.equal(res.body, '<rss/>');
    // A NO_PROXY entry for the origin must bypass the proxy entirely:
    const dead = { proxy: 'http://127.0.0.1:1', noProxy: ['127.0.0.1'] };
    const direct = await fetchOnce(`http://127.0.0.1:${oPort}/feed`, {}, [], 0, DEADLINE(), dead);
    assert.equal(direct.status, 200);
  } finally { origin.closeAllConnections(); proxy.closeAllConnections(); origin.close(); proxy.close(); }
});

/* The TLS origin uses a committed self-signed fixture certificate
   (CN=localhost, SAN 127.0.0.1/localhost, 100-year validity) instead
   of shelling out to the system openssl at test time: the runner's
   openssl build turned out to be an uncontrolled variable. The key
   is a throwaway for loopback tests only. */
function tunnelSetup(t) {
  const material = {
    key: fs.readFileSync(path.join(__dirname, 'fixtures', 'localhost-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'localhost-cert.pem')),
  };
  const origin = https.createServer(material, (req, res) => { res.writeHead(200); res.end('<feed/>'); });
  const proxy = makeProxy();
  const authProxy = makeProxy({ requireAuth: true });
  return Promise.all([listen(origin), listen(proxy), listen(authProxy)]).then(([oPort, pPort, aPort]) => {
    t.after(() => {
      origin.closeAllConnections(); proxy.closeAllConnections(); authProxy.closeAllConnections();
      origin.close(); proxy.close(); authProxy.close();
    });
    return { oPort, pPort, aPort };
  });
}

/* Surface the underlying error in the log next to the failing leg —
   in CI the assertion block is easy to miss when copying logs. */
async function leg(name, fn) {
  try { return await fn(); } catch (e) {
    console.error('[net-test]', name, 'failed:', e && e.code, e && e.message);
    throw e;
  }
}

/* Each leg is its own test with a hard timeout: if an environment
   ever stalls one leg, the log names that leg instead of the job
   sitting silent until the workflow timeout. */
test('CONNECT tunnel carries HTTPS to the origin', { timeout: 20000 }, async (t) => {
  const s = await tunnelSetup(t);
  const res = await leg('tunnel', () => fetchOnce(`https://127.0.0.1:${s.oPort}/feed.xml`, {}, [], 0, DEADLINE(),
    { proxy: `http://127.0.0.1:${s.pPort}`, noProxy: [], strictSSL: false }));
  assert.equal(res.status, 200);
  assert.equal(res.body, '<feed/>');
});

test('strict SSL rejects a self-signed origin through the tunnel', { timeout: 20000 }, async (t) => {
  const s = await tunnelSetup(t);
  await assert.rejects(
    leg('strict', () => fetchOnce(`https://127.0.0.1:${s.oPort}/feed.xml`, {}, [], 0, DEADLINE(),
      { proxy: `http://127.0.0.1:${s.pPort}`, noProxy: [], strictSSL: true })),
    (e) => classifyError(e, true) === 'tls');
});

test('a proxy 407 is its own symptom, and credentials pass', { timeout: 20000 }, async (t) => {
  const s = await tunnelSetup(t);
  await assert.rejects(
    leg('407', () => fetchOnce(`https://127.0.0.1:${s.oPort}/feed.xml`, {}, [], 0, DEADLINE(),
      { proxy: `http://127.0.0.1:${s.aPort}`, noProxy: [], strictSSL: false })),
    (e) => e.symptom === 'proxy-auth');
  const ok = await leg('407-auth', () => fetchOnce(`https://127.0.0.1:${s.oPort}/feed.xml`, {}, [], 0, DEADLINE(),
    { proxy: `http://u:p@127.0.0.1:${s.aPort}`, noProxy: [], strictSSL: false }));
  assert.equal(ok.status, 200);
});
