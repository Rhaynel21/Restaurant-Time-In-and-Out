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

// Cache the parsed challenge per host so we can authenticate preemptively on
// subsequent requests instead of paying the 401 round-trip every poll.
const challengeCache = new Map();

async function digestFetch(url, options = {}) {
  const { method = "GET", body, username, password, headers = {}, timeoutMs = 15000 } = options;
  const parsed = new URL(url);
  const uri = parsed.pathname + parsed.search;
  const host = parsed.host;

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

  // Try cached challenge first.
  const cached = challengeCache.get(host);
  if (cached) {
    cached.nc += 1;
    const cnonce = crypto.randomBytes(8).toString("hex");
    const authHeader = buildAuthHeader({
      method,
      uri,
      username,
      password,
      challenge: cached.challenge,
      nc: cached.nc,
      cnonce,
    });
    const res = await doFetch(authHeader);
    if (res.status !== 401) return res;
    challengeCache.delete(host); // stale nonce, fall through to re-challenge
  }

  // Unauthenticated request to obtain the challenge.
  const probe = await doFetch(null);
  if (probe.status !== 401) return probe;

  const wwwAuth = probe.headers.get("www-authenticate");
  if (!wwwAuth) return probe;

  const challenge = parseChallenge(wwwAuth);
  const nc = 1;
  const cnonce = crypto.randomBytes(8).toString("hex");
  challengeCache.set(host, { challenge, nc });

  const authHeader = buildAuthHeader({ method, uri, username, password, challenge, nc, cnonce });
  return doFetch(authHeader);
}

module.exports = { digestFetch };
