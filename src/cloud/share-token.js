const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isShareToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

export function generateShareToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashShareToken(token) {
  if (!isShareToken(token)) throw new TypeError('invalid share token');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function shareTokenFromLocation(hash = location.hash) {
  if (!String(hash).startsWith('#')) return null;
  const values = new URLSearchParams(String(hash).replace(/^#/, '')).getAll('share');
  return values.length === 1 && isShareToken(values[0]) ? values[0] : null;
}
