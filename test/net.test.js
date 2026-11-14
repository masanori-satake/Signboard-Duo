'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

test('fetchOnce reaches an HTTP origin through a proxy (absolute form)', async () => {
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

test('fetchOnce tunnels HTTPS through CONNECT and survives a 407', async (t) => {
  let key, cert;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-net-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', path.join(dir, 'k.pem'),
      '-out', path.join(dir, 'c.pem'), '-days', '1', '-nodes', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    key = fs.readFileSync(path.join(dir, 'k.pem'));
    cert = fs.readFileSync(path.join(dir, 'c.pem'));
  } catch (e) { t.skip('openssl unavailable'); return; }
  const origin = https.createServer({ key, cert }, (req, res) => { res.writeHead(200); res.end('<feed/>'); });
  const proxy = makeProxy();
  const authProxy = makeProxy({ requireAuth: true });
  const [oPort, pPort, aPort] = [await listen(origin), await listen(proxy), await listen(authProxy)];
  try {
    const res = await fetchOnce(`https://127.0.0.1:${oPort}/feed.xml`, {}, [], 0, DEADLINE(),
      { proxy: `http://127.0.0.1:${pPort}`, noProxy: [], strictSSL: false });
    assert.equal(res.status, 200);
    assert.equal(res.body, '<feed/>');
    // strict SSL must reject the self-signed origin even via the tunnel:
    await assert.rejects(
      fetchOnce(`https://127.0.0.1:${oPort}/feed.xml`, {}, [], 0, DEADLINE(),
        { proxy: `http://127.0.0.1:${pPort}`, noProxy: [], strictSSL: true }),
      (e) => classifyError(e, true) === 'tls');
    // 407 from the proxy is its own symptom:
    await assert.rejects(
      fetchOnce(`https://127.0.0.1:${oPort}/feed.xml`, {}, [], 0, DEADLINE(),
        { proxy: `http://127.0.0.1:${aPort}`, noProxy: [], strictSSL: false }),
      (e) => e.symptom === 'proxy-auth');
    // ... and the right credentials pass:
    const ok = await fetchOnce(`https://127.0.0.1:${oPort}/feed.xml`, {}, [], 0, DEADLINE(),
      { proxy: `http://u:p@127.0.0.1:${aPort}`, noProxy: [], strictSSL: false });
    assert.equal(ok.status, 200);
  } finally { origin.closeAllConnections(); proxy.closeAllConnections(); authProxy.closeAllConnections(); origin.close(); proxy.close(); authProxy.close(); }
});
