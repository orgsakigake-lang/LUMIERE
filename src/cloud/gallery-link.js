// Match the existing database constraint, including previously claimed names
// beginning with a dash. A present but invalid link is never an owner visit.
export const SLUG_SHAPE = /^[a-z0-9-]{3,32}$/;
export function galleryLink(search, hash = '') {
  const params = new URLSearchParams(search);
  const names = params.getAll('gallery');
  const slug = (names[0] || '').toLowerCase();
  if (new URLSearchParams(hash.replace(/^#/, '')).has('share')) {
    return { requested: true, slug: null, token: shareTokenFromLocation(hash), private: true };
  }
  return { requested: names.length > 0,
    slug: names.length === 1 && SLUG_SHAPE.test(slug) ? slug : null };
}
import { shareTokenFromLocation } from './share-token.js';
