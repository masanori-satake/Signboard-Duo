'use strict';

/* Network layer for feed polling: direct or via the user's proxy,
   with an absolute deadline and symptom classification for failures.
   Pure Node (no vscode) so it stays unit-testable, like model.js and
   feedparse.js. Read-only GETs of user-configured URLs only. */

const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');

const FETCH_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 1024 * 1024;

/* ---------------- proxy configuration ---------------- */

/* "http://user:pass@proxy.local:8080" (scheme optional) into
   { host, port, auth } — auth is a ready Proxy-Authorization value.
   Unparseable input yields null, never a throw: a broken proxy
   setting must not take the whole board down. */
function parseProxyUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let u;
  try { u = new URL(/:\/\//.test(raw) ? raw : 'http://' + raw); } catch (e) { return null; }
  if (!u.hostname) return null;
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  let auth = null;
  if (u.username) {
    let user = u.username, pass = u.password || '';
    try { user = decodeURIComponent(user); pass = decodeURIComponent(pass); } catch (e) { /* keep raw */ }
    auth = 'Basic ' + Buffer.from(user + ':' + pass, 'utf8').toString('base64');
  }
  return { host: u.hostname, port, auth };
}

/* VS Code / curl style NO_PROXY matching: "*" matches everything, a
   leading dot is ignored, a bare domain matches itself and its
   subdomains, and an optional :port restricts the entry to it. */
function noProxyMatch(hostname, port, list) {
  if (!Array.isArray(list)) return false;
  const host = String(hostname || '').toLowerCase();
  for (const rawEntry of list) {
    let entry = String(rawEntry || '').trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    let entryPort = null;
    const m = entry.match(/^(.*):(\d+)$/);
    if (m && !entry.includes(']')) { entry = m[1]; entryPort = Number(m[2]); }
    if (entry.startsWith('.')) entry = entry.slice(1);
    if (entryPort != null && Number(port) !== entryPort) continue;
    if (host === entry || host.endsWith('.' + entry)) return true;
  }
  return false;
}

/* cfg: { proxy, noProxy, authorization, strictSSL } as assembled by
   the host from VS Code's http.* settings and the environment.
   Returns the proxy to use for this URL, or null for a direct fetch. */
function proxyForUrl(urlStr, cfg) {
  if (!cfg || !cfg.proxy) return null;
  let u;
  try { u = new URL(urlStr); } catch (e) { return null; }
  const px = parseProxyUrl(cfg.proxy);
  if (!px) return null;
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (noProxyMatch(u.hostname, port, cfg.noProxy)) return null;
  if (cfg.authorization) px.auth = cfg.authorization;
  return px;
}

/* ---------------- failure symptoms ---------------- */

/* Map a fetch failure to the symptom key the board and the README
   troubleshooting anchors share. Proxy-leg failures arrive with
   their symptom already attached (err.symptom). */
function classifyError(err, viaProxy) {
  if (err && err.symptom) return err.symptom;
  const code = err && err.code ? String(err.code) : '';
  const msg = err && err.message ? String(err.message) : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return viaProxy ? 'proxy' : 'dns';
  if (/CERT|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED/.test(code) || /certificate/i.test(msg)) return 'tls';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /fetch (timeout|deadline)/.test(msg)) return 'timeout';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ECONNABORTED' ||
      code === 'EPIPE' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return viaProxy ? 'proxy' : 'connect';
  }
  return viaProxy ? 'proxy' : 'connect';
}

function taggedError(symptom, message, cause) {
  const err = new Error(message);
  err.symptom = symptom;
  if (cause && cause.code) err.code = cause.code;
  return err;
}

/* ---------------- fetching ---------------- */

function fetchOnce(urlStr, headers, credNames, redirectsLeft, deadline, proxyCfg) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { reject(e); return; }
    const remain = deadline - Date.now();
    if (remain <= 0) { reject(new Error('fetch deadline exceeded')); return; }
    const px = proxyForUrl(urlStr, proxyCfg);
    const timeoutMs = Math.min(FETCH_TIMEOUT_MS, remain);

    const handleResponse = (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url);
        /* Credentials belong to the feed's own origin: a redirect to
           another host must not carry them along. */
        let nextHeaders = headers;
        if (next.origin !== url.origin) {
          nextHeaders = {};
          for (const [k, v] of Object.entries(headers)) {
            if (/^(authorization|cookie)$/i.test(k)) continue;
            if ((credNames || []).includes(k)) continue;
            nextHeaders[k] = v;
          }
        }
        resolve(fetchOnce(next.toString(), nextHeaders, credNames, redirectsLeft - 1, deadline, proxyCfg));
        return;
      }
      if (status === 304) { res.resume(); resolve({ status, body: null, headers: res.headers }); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= MAX_BODY_BYTES) chunks.push(c);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    };

    const armGuards = (req) => {
      req.on('timeout', () => req.destroy(new Error('fetch timeout')));
      /* The socket timeout only catches silence; a server that trickles
         bytes could otherwise hold the fetch (and the serial poll behind
         it) open forever, so an absolute deadline ends the request. */
      const killer = setTimeout(() => req.destroy(new Error('fetch deadline exceeded')), deadline - Date.now());
      req.on('close', () => clearTimeout(killer));
      req.on('error', reject);
    };

    try {
      if (!px) {
        const lib = url.protocol === 'http:' ? http : https;
        const req = lib.get(url, { headers, timeout: timeoutMs }, handleResponse);
        armGuards(req);
        return;
      }
      if (url.protocol === 'http:') {
        /* Plain HTTP through a proxy: the request line carries the
           absolute URL and the proxy forwards it. */
        const req = http.request({
          host: px.host, port: px.port, method: 'GET', path: urlStr,
          headers: px.auth ? { ...headers, 'Proxy-Authorization': px.auth } : headers,
          timeout: timeoutMs,
        }, handleResponse);
        armGuards(req);
        req.end();
        return;
      }
      /* HTTPS through a proxy: CONNECT a tunnel, then TLS over it. */
      const targetHost = url.hostname;
      const targetPort = url.port ? Number(url.port) : 443;
      const connectReq = http.request({
        host: px.host, port: px.port, method: 'CONNECT',
        path: targetHost + ':' + targetPort,
        headers: px.auth ? { Host: targetHost + ':' + targetPort, 'Proxy-Authorization': px.auth } : { Host: targetHost + ':' + targetPort },
        timeout: timeoutMs,
      });
      const killer = setTimeout(() => connectReq.destroy(new Error('fetch deadline exceeded')), deadline - Date.now());
      connectReq.on('close', () => clearTimeout(killer));
      connectReq.on('timeout', () => connectReq.destroy(taggedError('proxy', 'proxy CONNECT timed out')));
      connectReq.on('error', (e) => reject(e && e.symptom ? e : taggedError('proxy', 'proxy CONNECT failed: ' + (e && e.message), e)));
      connectReq.on('connect', (res, socket) => {
        if (res.statusCode === 407) {
          socket.destroy();
          reject(taggedError('proxy-auth', 'proxy requires authentication (407)'));
          return;
        }
        if (res.statusCode !== 200) {
          socket.destroy();
          reject(taggedError('proxy', 'proxy CONNECT refused with ' + res.statusCode));
          return;
        }
        /* SNI takes a DNS name only: passing an IP literal as the
           servername is a hard TypeError on current Node (it was a
           deprecation warning before), so IP targets omit it and
           verification falls back to the IP SAN. A synchronous throw
           anywhere in this handler must reject, never escape. */
        const tlsOptions = {
          socket,
          rejectUnauthorized: !proxyCfg || proxyCfg.strictSSL !== false,
        };
        if (!net.isIP(targetHost)) tlsOptions.servername = targetHost;
        let tlsSock;
        try {
          tlsSock = tls.connect(tlsOptions);
        } catch (e) {
          socket.destroy();
          reject(e);
          return;
        }
        /* The handshake gets the same absolute deadline as every
           other leg: a tunnel that opens but never speaks TLS must
           not hold the fetch (and the serial poll behind it) open. */
        const hsKiller = setTimeout(() => {
          tlsSock.destroy();
          reject(new Error('fetch deadline exceeded'));
        }, Math.max(1, deadline - Date.now()));
        tlsSock.once('secureConnect', () => clearTimeout(hsKiller));
        tlsSock.once('error', (e) => { clearTimeout(hsKiller); reject(e); });
        tlsSock.once('secureConnect', () => {
          /* Hand the secured socket to https.request through an agent
             whose createConnection returns it as-is. Passing it as the
             request's createConnection option instead makes Node wrap
             it in a second TLS handshake with default options. */
          const agent = new https.Agent({ keepAlive: false });
          agent.createConnection = (opts, cb) => cb(null, tlsSock);
          const req = https.request({
            host: targetHost, port: targetPort,
            path: url.pathname + url.search, method: 'GET', headers, agent,
          }, handleResponse);
          armGuards(req);
          req.on('error', () => tlsSock.destroy());
          req.end();
        });
      });
      connectReq.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { fetchOnce, parseProxyUrl, noProxyMatch, proxyForUrl, classifyError };
