import { works, viewpoints, artworkURL } from './exhibition.ts';
import { createSession } from './session.ts';
import { createAmbience } from './ambience.ts';
import { mountCollection } from './collection.ts';
import type { createScene, Quality } from './scene.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const session = createSession(works.length);
const entrance = element('entrance'), collection = element('collection'), tour = element('tour');
const enterButton = element<HTMLButtonElement>('enter-exhibition');
const viewer = element<HTMLDialogElement>('art-viewer'), settings = element<HTMLDialogElement>('settings');
const status = element('status');
let runtime: Awaited<ReturnType<typeof createScene>> | null = null;
let loading = false, epoch = 0, viewpoint = 0;
let pendingEntry: AbortController | null = null;
let previousFocus: HTMLElement | null = null;
let currentQuality: Quality = 'auto';
const motion = element<HTMLInputElement>('motion');
motion.checked = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const ambience = createAmbience(element<HTMLSelectElement>('soundscape'), element<HTMLInputElement>('sound-volume'), element('sound-note'), rain => runtime?.setWeather(rain));

// All lifecycle events use the same input/render ownership decision.
function syncRuntime() {
  if (session.state.mode === 'touring' && !viewer.open && !settings.open && !document.hidden) runtime?.resume();
  else runtime?.pause();
}

function cancelEntry() {
  pendingEntry?.abort(); pendingEntry = null;
  loading = false; enterButton.disabled = false;
  enterButton.removeAttribute('aria-busy');
}

function open(mode: 'entrance' | 'browse' | 'touring') {
  epoch++;
  cancelEntry();
  status.textContent = '';
  session.open(mode);
  ambience.visit(mode === 'touring');
  document.body.dataset.mode = mode;
  entrance.hidden = mode !== 'entrance'; collection.hidden = mode !== 'browse'; tour.hidden = mode !== 'touring';
  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => {
    const selected = button.dataset.open === mode;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  syncRuntime();
  if (mode !== 'touring') window.scrollTo(0, 0);
  if (mode === 'browse') element('collection-title').focus({ preventScroll: true });
}

function showArtwork() {
  const work = works[session.state.artwork];
  const image = element<HTMLImageElement>('art-image');
  element('image-error').hidden = true;
  image.alt = `${work.title} — ${work.medium}`;
  image.width = work.width; image.height = work.height;
  image.src = artworkURL(work, 'full');
  element('art-title').textContent = work.title;
  element('art-number').textContent = `WORK ${String(session.state.artwork + 1).padStart(2, '0')} / THE COLLECTION`;
  element('art-medium').textContent = work.medium;
  element('art-description').textContent = work.description;
  element('art-position').textContent = `${String(session.state.artwork + 1).padStart(2, '0')} / ${String(works.length).padStart(2, '0')}`;
}
function inspect(index: number) {
  if (session.state.mode !== 'touring' && session.state.mode !== 'inspect') ambience.visit(false);
  epoch++;
  cancelEntry();
  status.textContent = '';
  previousFocus = document.activeElement as HTMLElement;
  session.inspect(index); showArtwork(); viewer.showModal(); syncRuntime();
}
viewer.addEventListener('close', () => {
  if (session.state.mode === 'inspect') session.close();
  syncRuntime();
  if (previousFocus?.isConnected && !previousFocus.closest('[hidden]')) previousFocus.focus({ preventScroll: true });
  else if (session.state.mode === 'entrance') enterButton.focus({ preventScroll: true });
});
element('close-viewer').addEventListener('click', () => viewer.close());
element('art-image').addEventListener('error', () => { element('image-error').hidden = false; });
element('retry-image').addEventListener('click', showArtwork);
element('previous-art').addEventListener('click', () => { session.next(-1); showArtwork(); });
element('next-art').addEventListener('click', () => { session.next(1); showArtwork(); });
viewer.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { session.next(e.key === 'ArrowRight' ? 1 : -1); showArtwork(); e.preventDefault(); }
});

mountCollection(element('preview-works'), element('works-grid'), inspect);

document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.addEventListener('click', () => open(button.dataset.open as 'entrance' | 'browse')));
element('browse-works').addEventListener('click', () => open('browse'));
element('leave-tour').addEventListener('click', () => { open('entrance'); enterButton.focus(); });
element('inspect-work').addEventListener('click', () => inspect(Math.max(0, viewpoint - 1)));

function updateView(direction: number) {
  viewpoint = (viewpoint + direction + viewpoints.length) % viewpoints.length;
  element('view-counter').textContent = `${String(viewpoint + 1).padStart(2, '0')} / ${String(viewpoints.length).padStart(2, '0')}`;
  element('view-name').textContent = viewpoints[viewpoint].label;
  runtime?.goTo(viewpoint);
}
element('previous-view').addEventListener('click', () => updateView(-1));
element('next-view').addEventListener('click', () => updateView(1));

enterButton.addEventListener('click', async () => {
  if (loading) return;
  // Resume an already chosen sound inside the gesture, before awaiting WebGL.
  ambience.visit(true);
  const request = ++epoch;
  const controller = new AbortController(); pendingEntry = controller;
  loading = true; enterButton.disabled = true;
  enterButton.setAttribute('aria-busy', 'true');
  status.textContent = 'Preparing the room…';
  try {
    if (!runtime) {
      const { createScene } = await import('./scene.ts');
      if (request !== epoch) return;
      // Unhide the host for accurate initial sizing; the cover stays above it until ready.
      tour.hidden = false; tour.style.visibility = 'hidden';
      const created = await createScene(element('scene-host'), {
        signal: controller.signal,
        onInspect: inspect,
        onError: message => {
          runtime?.dispose(); runtime = null; previousFocus = null;
          open('entrance');
          if (viewer.open) viewer.close();
          if (settings.open) settings.close();
          status.textContent = message; enterButton.focus({ preventScroll: true });
        },
      });
      if (request !== epoch) { created.dispose(); return; }
      tour.style.visibility = ''; tour.hidden = true;
      runtime = created; runtime.setQuality(currentQuality); runtime.setMotion(motion.checked);
      viewpoint = 0; updateView(0);
    }
    if (request !== epoch) return;
    pendingEntry = null;
    status.textContent = '';
    open('touring');
    element('tour-hint').textContent = runtime.stats().missingArt
      ? 'Some images could not load. Use View artwork to retry them.'
      : 'Drag to look · W A S D to walk · or follow the works below';
    element<HTMLCanvasElement>('scene-host').querySelector('canvas')?.focus({ preventScroll: true });
  } catch {
    if (request === epoch) {
      ambience.visit(false);
      tour.style.visibility = ''; tour.hidden = true;
      status.textContent = 'The 3D room could not open on this device. Browse the works to enjoy the full collection, or try entering again.';
    }
  } finally {
    if (pendingEntry === controller || request === epoch) {
      pendingEntry = null; loading = false; enterButton.disabled = false;
      enterButton.removeAttribute('aria-busy');
    }
  }
});

element('tour-settings').addEventListener('click', () => { settings.showModal(); syncRuntime(); });
element('close-settings').addEventListener('click', () => settings.close());
settings.addEventListener('close', syncRuntime);
element<HTMLSelectElement>('quality').addEventListener('change', e => {
  currentQuality = (e.target as HTMLSelectElement).value as Quality; runtime?.setQuality(currentQuality);
});
motion.addEventListener('change', () => runtime?.setMotion(motion.checked));
element('browse-from-tour').addEventListener('click', () => { open('browse'); settings.close(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !viewer.open && !settings.open && session.state.mode === 'touring') { open('entrance'); enterButton.focus(); }
});
window.addEventListener('pagehide', () => runtime?.pause());
window.addEventListener('pageshow', syncRuntime);
document.addEventListener('visibilitychange', syncRuntime);

// Opt-in diagnostics; the production interface never depends on these hooks.
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { LUMIERE: {
    stats: () => runtime?.stats() || { frames: 0, paused: true },
    goTo: (index: number) => runtime?.goTo(index, true),
    capture: () => runtime?.capture(),
    ambience: () => ambience.stats(),
  } });
}
