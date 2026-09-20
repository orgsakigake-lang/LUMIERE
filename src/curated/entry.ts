// Curator-owned layouts still live in the full gallery. Never substitute the
// reference exhibition when a visitor has requested a particular collection.
const authReturn = new URLSearchParams(location.hash.slice(1)).has('access_token');
if (galleryLink(location.search, location.hash).requested || authReturn) {
  const endlessEntry = document.documentElement.dataset.endlessEntry || '../index.html';
  location.replace(new URL(endlessEntry + location.search + location.hash, location.href).href);
} else {
  void import('./app.ts');
}
import { galleryLink } from '../cloud/gallery-link.js';
