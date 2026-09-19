/** Privileged signing never trusts a mutable metadata row alone. */
export function isOwnedAsset(owner: string, upload: { path?: unknown; bucket?: unknown }) {
  if (!['loans', 'private_loans'].includes(String(upload.bucket))) return false;
  if (typeof upload.path !== 'string' || !upload.path.startsWith(owner + '/')) return false;
  const segments = upload.path.slice(owner.length + 1).split('/');
  return segments.every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part));
}
