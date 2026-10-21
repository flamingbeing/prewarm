// Cloudflare Access: the signed token Access adds to every request it lets through (the scan upload, scan.js, checks it
// again). Copied from anawj-site's worker/ask.js in the repo split (21 Oct 2026).
let certs = null, certsAt = 0;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
export async function verifyAccess(token, env, fetchImpl = fetch, now = Date.now()) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(b64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64u(parts[1]))); } catch (e) { return null; }
  if (head.alg !== 'RS256') return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD) || !(claims.exp * 1000 > now)) return null;
  if (claims.iss && claims.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
  if (!certs || now - certsAt > 3600e3) {
    const r = await fetchImpl(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!r.ok) return null;
    certs = (await r.json()).keys || []; certsAt = now;
  }
  const jwk = certs.find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return ok ? (claims.email || 'signed in') : null;
}
export function resetAccessCache() { certs = null; certsAt = 0; }
