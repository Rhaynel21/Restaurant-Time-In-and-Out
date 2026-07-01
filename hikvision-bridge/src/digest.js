// Minimal HTTP Digest authentication client built on Node's global fetch.
// Hikvision ISAPI endpoints require Digest auth; there is no built-in support
// for it in fetch, so we do the 401 challenge / response dance manually.
const crypto = require("crypto");

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

// Parse a `WWW-Authenticate: Digest ...` header into a key/value map.
function parseChallenge(header) {
  const out = {};
  const body = header.replace(/^Digest\s+/i, "");
  const regex = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    out[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return out;
}

function buildAuthHeader({ method, uri, username, password, challenge, nc, cnonce }) {
  const { realm, nonce, qop, opaque, algorithm } = challenge;
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  let response;
  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
  ];

  if (qop) {
    // qop may be a comma list (e.g. "auth,auth-int"); we only support "auth".
    const ncValue = nc.toString(16).padStart(8, "0");
    response = md5(`${ha1}:${nonce}:${ncValue}:${cnonce}:auth:${ha2}`);
    parts.push(`qop=auth`, `nc=${ncValue}`, `cnonce="${cnonce}"`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  parts.push(`response="${response}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (algorithm) parts.push(`algorithm=${algorithm}`);

  return `Digest ${parts.join(", ")}`;
}

// ── Auth circuit breaker ─────────────────────────────────────────────────────
// This device's "illegal login" lock is hair-trigger: a short burst of auth
// attempts locks the admin account for ~30 min, and the lock survives reboot.
// So we HARD-CAP failed auths: after MAX_401 consecutive 401s we stop making any
// auth'd request for PAUSE_MS, letting the device's own lock time out instead of
// us hammering it (which would reset the lock forever). A single success clears it.
const BREAKER = { consecutive401: 0, pausedUntil: 0 };
const MAX_401 = 2;
const PAUSE_MS = 35 * 60 * 1000; // 35 min — longer than the device's ~30-min lock,
// so after a failed burst we stay quiet long enough for the lock to actually clear
// (attempting during the lock would just reset its timer).

function breakerError() {
  const mins = Math.ceil((BREAKER.pausedUntil - Date.now()) / 60000);
  return new Error(
    `auth paused by circuit breaker (~${mins}m left) after ${MAX_401} failed logins — ` +
      `avoiding a device lockout. Check HIK_PASS / device lock status.`,
  );
}

async function digestFetch(url, options = {}) {
  const { method = "GET", body, username, password, headers = {}, timeoutMs = 15000 } = options;
  const parsed = new URL(url);
  const uri = parsed.pathname + parsed.search;

  if (Date.now() < BREAKER.pausedUntil) throw breakerError();

  const doFetch = (authHeader) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      method,
      body,
      headers: authHeader ? { ...headers, Authorization: authHeader } : headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  };

  // Track only the FINAL authenticated response for the breaker — the initial
  // unauthenticated probe returning 401 is the normal Digest challenge, not a
  // failed login.
  const settle = (res) => {
    if (res.status === 401) {
      BREAKER.consecutive401 += 1;
      if (BREAKER.consecutive401 >= MAX_401) {
        BREAKER.pausedUntil = Date.now() + PAUSE_MS;
        BREAKER.consecutive401 = 0;
      }
    } else {
      BREAKER.consecutive401 = 0; // any success clears the streak
    }
    return res;
  };

  // Always perform the full 401-challenge dance per request: fetch a fresh nonce
  // (nc=1) and never reuse it — this device rejects reused nonces.
  const probe = await doFetch(null);
  if (probe.status !== 401) return probe; // no auth required (unexpected) — pass through

  const wwwAuth = probe.headers.get("www-authenticate");
  if (!wwwAuth) return settle(probe);

  const challenge = parseChallenge(wwwAuth);
  const cnonce = crypto.randomBytes(8).toString("hex");
  const authHeader = buildAuthHeader({ method, uri, username, password, challenge, nc: 1, cnonce });
  return settle(await doFetch(authHeader));
}

module.exports = { digestFetch };
