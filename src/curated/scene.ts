import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { works, viewpoints, artworkURL } from './exhibition.ts';
import { fitViewport, moveVisitor, cameraPath } from './session.ts';

export type Quality = 'auto' | 'low' | 'high';
type SceneOptions = { signal?: AbortSignal; onInspect: (index: number) => void; onError: (message: string) => void };

/** One static room, one renderer owner, no application or persistence imports. */
export async function createScene(host: HTMLElement, options: SceneOptions) {
  options.signal?.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'The Light Room. Drag to look or use the guided viewpoint buttons.');
  canvas.tabIndex = 0;
  host.append(canvas);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
  } catch (error) { canvas.remove(); throw error; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dce2d5');
  scene.fog = new THREE.Fog('#e6e6d9', 28, 65);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 70);
  camera.rotation.order = 'YXZ';
  const material = (color: string, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
  const plaster = material('#e8e4db');
  const stone = material('#cfcabf');
  const seams = material('#b8b5aa');
  const oak = material('#968065', 0.76);
  const darkOak = material('#493c2b');
  const metal = material('#393d32', 0.5);
  const paper = new THREE.MeshBasicMaterial({ color: '#f2efdf' });
  const sky = new THREE.MeshBasicMaterial({ color: '#f4f4df' });
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const resources = new Set<THREE.Texture>();
  const bitmaps = new Set<ImageBitmap>();
  // Tiny deterministic surface maps are shared across the room. Detail costs
  // texels, not more geometry or additional lights.
  for (const [mat, wood] of [[plaster, false], [stone, false], [oak, true]] as const) {
    const surface = document.createElement('canvas'); surface.width = surface.height = 128;
    const context = surface.getContext('2d')!;
    const pixels = context.createImageData(128, 128);
    let seed = 42;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 4294967296;
      const value = wood ? 224 + 12 * Math.sin(x * 0.45 + Math.sin(y * 0.035) * 1.4) + noise * 12 : 242 + noise * 13;
      const i = (y * 128 + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(wood ? 2 : 6, wood ? 1 : 6);
    resources.add(texture); mat.map = texture;
    if (!wood) { mat.bumpMap = texture; mat.bumpScale = 0.025; }
  }
  const picks: THREE.Object3D[] = [];
  const abort = new AbortController();
  const signal = abort.signal;
  let disposed = false, active = false, raf = 0, dirty = true, lastTime = 0;
  let frames = 0, lastCalls = 0, lastTriangles = 0, cpuMs = 0;
  let quality: Quality = 'auto';
  let weather: 'clear' | 'rain' = 'clear';
  let autoPixels = matchMedia('(pointer:coarse)').matches ? 800_000 : 1_600_000;
  let slowFrames = 0, fastFrames = 0;
  let smoothMotion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const intervals: number[] = [];
  const keys = new Set<string>();
  let pointer: { id: number; x: number; y: number; distance: number } | null = null;
  const startPosition = new THREE.Vector3(), endPosition = new THREE.Vector3();
  const startQuaternion = new THREE.Quaternion(), endQuaternion = new THREE.Quaternion();
  let transitionStart = 0, transitioning = false;
  let path: THREE.Vector3[] = [], pathLengths: number[] = [], pathLength = 0;
  let initialized = false;
  let rejectInitialization: (error: Error) => void;
  const contextFailure = new Promise<never>((_resolve, reject) => { rejectInitialization = reject; });
  const abortInitialization = () => rejectInitialization(new DOMException('Entry canceled', 'AbortError'));
  options.signal?.addEventListener('abort', abortInitialization, { once: true, signal });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); pause();
    if (!initialized) rejectInitialization(new Error('WebGL context lost during initialization'));
    else options.onError('The 3D view was interrupted. You can re-enter, or browse the works.');
  }, { signal });

  function box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) {
    const geometry = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const list = batches.get(mat) || [];
    list.push(geometry); batches.set(mat, list);
  }

  // A room kit with a skylight and a visible, walkable vestibule.
  box(0, -0.14, 0, 16, 0.28, 18, stone);
  for (const x of [-8, 8]) {
    box(x, 2.65, 0, 0.35, 5.3, 18, plaster);
    box(x * 0.97, 0.13, 0, 0.055, 0.26, 18, stone);
    box(x * 0.73, 5.3, 0, 4.4, 0.24, 18, plaster);
  }
  for (const z of [-9, 9]) {
    box(-4.8, 2.65, z, 6.4, 5.3, 0.4, plaster);
    box(4.8, 2.65, z, 6.4, 5.3, 0.4, plaster);
    box(0, 4.55, z, 3.2, 1.5, 0.4, plaster);
    box(-1.65, 1.88, z + (z < 0 ? 0.17 : -0.17), 0.14, 3.76, 0.32, oak);
    box(1.65, 1.88, z + (z < 0 ? 0.17 : -0.17), 0.14, 3.76, 0.32, oak);
    box(0, 3.75, z, 3.4, 0.14, 0.5, oak);
  }
  box(0, 5.48, 0, 7.2, 0.06, 18, sky);
  for (let z = -8; z <= 8; z += 4) box(0, 5.23, z, 7.5, 0.19, 0.13, plaster);
  box(0, -0.1, -11, 3.2, 0.2, 4, stone);
  box(-1.8, 2, -11, 0.3, 4, 4, oak);
  box(1.8, 2, -11, 0.3, 4, 4, oak);
  box(0, 2, -13, 3.9, 4, 0.3, plaster);
  box(0, 4, -11, 3.9, 0.2, 4, plaster);
  for (let x = -1.6; x < 1.7; x += 0.22) box(x, 2, -12.78, 0.07, 4, 0.1, oak);
  for (let x = -6; x <= 6; x += 2) box(x, 0.006, 0, 0.012, 0.008, 18, seams);
  for (let z = -7; z <= 7; z += 2) box(0, 0.006, z, 16, 0.008, 0.012, seams);
  box(0, 0.58, 1, 3.8, 0.18, 1.1, oak);
  box(-1.35, 0.24, 1, 0.2, 0.48, 0.82, darkOak);
  box(1.35, 0.24, 1, 0.2, 0.48, 0.82, darkOak);
  // Repeated fixtures are merged by material; they are not dynamic lights.
  for (const work of works) {
    const pos = new THREE.Vector3(...work.position);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), work.rotation);
    pos.addScaledVector(normal, 0.28);
    box(pos.x, 4.35, pos.z, 0.16, 0.12, 0.16, metal);
  }
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mat !== sky;
    mesh.receiveShadow = mat !== sky;
    scene.add(mesh);
  }
  batches.clear();

  const fill = new THREE.HemisphereLight('#f4f3ec', '#8f8c81', 2.6);
  scene.add(fill);
  const sun = new THREE.DirectionalLight('#fff5e3', 2.4);
  sun.position.set(-3, 10, 5); sun.target.position.set(1, 0, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 15, bottom: -15, near: 1, far: 35 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  // Soft contact under the bench is an authored texture, not a screen-space pass.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(30,30,18,0.32)'); gradient.addColorStop(1, 'rgba(30,30,18,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const contact = new THREE.CanvasTexture(shadowCanvas); resources.add(contact);
  const contactMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 3), new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false }));
  contactMesh.rotation.x = -Math.PI / 2; contactMesh.position.set(0, 0.02, 1); scene.add(contactMesh);

  let textures: PromiseSettledResult<THREE.Texture>[];
  try {
    textures = await Promise.race([Promise.allSettled(works.map(async work => {
      const response = await fetch(artworkURL(work), { signal });
      if (!response.ok) throw new Error(`Artwork unavailable: ${work.id}`);
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
      if (disposed) { bitmap.close(); throw new DOMException('Entry canceled', 'AbortError'); }
      bitmaps.add(bitmap);
      const texture = new THREE.Texture(bitmap); texture.needsUpdate = true;
      resources.add(texture); return texture;
    })), contextFailure]);
  } catch (error) { dispose(); throw error; }
  let missingArt = 0;
  works.forEach((work, index) => {
    const ratio = work.width / work.height;
    const height = ratio > 1 ? 1.8 : 2.45, width = height * ratio;
    const frame = new THREE.Group();
    frame.position.set(...work.position); frame.rotation.y = work.rotation;
    const surround = new THREE.Mesh(new THREE.BoxGeometry(width + 0.29, height + 0.29, 0.11), darkOak);
    surround.castShadow = true; frame.add(surround);
    const mount = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.22, height + 0.22), paper);
    mount.position.z = 0.06; frame.add(mount);
    const loaded = textures[index];
    let imageMaterial: THREE.MeshBasicMaterial;
    if (loaded.status === 'fulfilled') {
      const texture = loaded.value; resources.add(texture);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      imageMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    } else { missingArt++; imageMaterial = new THREE.MeshBasicMaterial({ color: '#c5c5b5' }); }
    const artwork = new THREE.Mesh(new THREE.PlaneGeometry(width, height), imageMaterial);
    artwork.position.z = 0.065; artwork.userData.artwork = index;
    frame.add(artwork); picks.push(artwork);
    // Labels are rasterized once; full accessible metadata lives in the DOM viewer.
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 128;
    const labelCtx = labelCanvas.getContext('2d')!;
    labelCtx.fillStyle = '#eae8dc'; labelCtx.fillRect(0, 0, 512, 128);
    labelCtx.fillStyle = '#34392f'; labelCtx.font = '25px Georgia'; labelCtx.fillText(work.title, 20, 44);
    labelCtx.font = '15px Arial'; labelCtx.fillText(`${String(index + 1).padStart(2, '0')}  /  ${work.medium}`, 20, 83);
    const labelTexture = new THREE.CanvasTexture(labelCanvas); labelTexture.colorSpace = THREE.SRGBColorSpace; resources.add(labelTexture);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), new THREE.MeshBasicMaterial({ map: labelTexture }));
    label.position.set(0, -height / 2 - 0.34, 0.035); frame.add(label);
    scene.add(frame);
  });
  renderer.shadowMap.needsUpdate = true;

  function resize() {
    const pixels = quality === 'low' ? 650_000 : quality === 'high' ? 2_000_000 : autoPixels;
    const size = fitViewport(host.clientWidth || innerWidth, host.clientHeight || innerHeight, Math.min(devicePixelRatio, 1.5), pixels);
    camera.aspect = (host.clientWidth || innerWidth) / (host.clientHeight || innerHeight);
    camera.updateProjectionMatrix(); renderer.setSize(size.width, size.height, false); invalidate();
  }
  function invalidate() {
    dirty = true;
    if (active && !disposed && !document.hidden && !raf) raf = requestAnimationFrame(frame);
  }
  function frame(time: number) {
    raf = 0;
    if (!active || disposed || document.hidden) return;
    const started = performance.now();
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    if (lastTime && (keys.size || transitioning)) {
      const elapsed = time - lastTime;
      intervals.push(elapsed); if (intervals.length > 240) intervals.shift();
      if (quality === 'auto') {
        slowFrames = elapsed > 28 ? slowFrames + 1 : 0;
        fastFrames = elapsed < 18 ? fastFrames + 1 : 0;
        if (slowFrames > 20 && autoPixels > 650_000) { autoPixels = Math.max(650_000, autoPixels * 0.75); slowFrames = 0; resize(); }
        if (fastFrames > 300 && autoPixels < 1_600_000) { autoPixels = Math.min(1_600_000, autoPixels * 1.15); fastFrames = 0; resize(); }
      }
    }
    lastTime = time;
    if (keys.size) {
      transitioning = false;
      const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
      const side = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      const speed = 2.8 * dt / Math.max(1, Math.hypot(forward, side));
      const yaw = camera.rotation.y;
      const [x, z] = moveVisitor([camera.position.x, camera.position.z], [(side * Math.cos(yaw) - forward * Math.sin(yaw)) * speed, (-forward * Math.cos(yaw) - side * Math.sin(yaw)) * speed]);
      camera.position.set(x, 1.7, z); dirty = true;
    }
    if (transitioning) {
      const t = Math.min(1, (time - transitionStart) / 900), ease = t * t * (3 - 2 * t);
      let distance = ease * pathLength, segment = 0;
      while (segment < pathLengths.length - 1 && distance > pathLengths[segment]) distance -= pathLengths[segment++];
      if (path.length > 1) camera.position.lerpVectors(path[segment], path[segment + 1], pathLengths[segment] ? Math.min(1, distance / pathLengths[segment]) : 1);
      camera.quaternion.slerpQuaternions(startQuaternion, endQuaternion, ease);
      transitioning = t < 1; dirty = true;
    }
    if (dirty) {
      renderer.render(scene, camera); frames++;
      lastCalls = renderer.info.render.calls; lastTriangles = renderer.info.render.triangles;
      dirty = false; cpuMs = performance.now() - started;
    }
    if (keys.size || transitioning || dirty) {
      if (!raf) raf = requestAnimationFrame(frame);
    } else lastTime = 0;
  }
  function goTo(index: number, immediate = false) {
    const view = viewpoints[index];
    if (!view) return;
    keys.clear(); startPosition.copy(camera.position); startQuaternion.copy(camera.quaternion);
    endPosition.fromArray(view.position);
    const targetCamera = camera.clone(); targetCamera.position.copy(endPosition); targetCamera.lookAt(new THREE.Vector3().fromArray(view.target));
    endQuaternion.copy(targetCamera.quaternion);
    const points = cameraPath([startPosition.x, startPosition.z], [endPosition.x, endPosition.z]);
    path = points.map((point, i) => new THREE.Vector3(point[0], THREE.MathUtils.lerp(startPosition.y, endPosition.y, i / Math.max(1, points.length - 1)), point[1]));
    pathLengths = path.slice(1).map((point, i) => point.distanceTo(path[i]));
    pathLength = pathLengths.reduce((sum, length) => sum + length, 0);
    if (!smoothMotion || immediate || (pathLength < 0.001 && startQuaternion.angleTo(endQuaternion) < 0.001)) { camera.position.copy(endPosition); camera.quaternion.copy(endQuaternion); transitioning = false; }
    else { transitionStart = performance.now(); transitioning = true; }
    invalidate();
  }
  function pause() { active = false; keys.clear(); pointer = null; transitioning = false; cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
  function resume() { if (disposed) return; active = true; resize(); invalidate(); }
  window.addEventListener('resize', resize, { signal });
  window.addEventListener('blur', () => { keys.clear(); pointer = null; lastTime = 0; }, { signal });
  document.addEventListener('visibilitychange', () => {
    keys.clear(); lastTime = 0;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else invalidate();
  }, { signal });
  window.addEventListener('keydown', e => {
    if (!active || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.matches?.('input,select,textarea,[contenteditable=true]')) return;
    const key = e.key.toLowerCase();
    if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) { keys.add(key); e.preventDefault(); invalidate(); }
  }, { signal });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()), { signal });
  canvas.addEventListener('pointerdown', e => {
    if (!active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    transitioning = false; pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, distance: 0 };
    canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true });
  }, { signal });
  canvas.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId || !active) return;
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    pointer.distance += Math.abs(dx) + Math.abs(dy); pointer.x = e.clientX; pointer.y = e.clientY;
    camera.rotation.y -= dx * 0.003; camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * 0.003, -1.05, 1.05);
    invalidate();
  }, { signal });
  canvas.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const click = pointer.distance < 8; pointer = null;
    if (click && active) {
      const rect = canvas.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(picks)[0];
      if (hit) options.onInspect(hit.object.userData.artwork);
    }
  }, { signal });
  canvas.addEventListener('pointercancel', () => { pointer = null; }, { signal });
  function dispose() {
    if (disposed) return;
    pause(); disposed = true; abort.abort();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>([plaster, stone, seams, oak, darkOak, metal, paper, sky]);
    scene.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); resources.forEach(t => t.dispose());
    bitmaps.forEach(bitmap => bitmap.close()); bitmaps.clear();
    sun.shadow.dispose(); renderer.dispose(); canvas.remove();
  }
  function stats() {
    let geometryBytes = 0, textureBytes = 0;
    const counted = new Set<THREE.BufferGeometry>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || counted.has(object.geometry)) return;
      counted.add(object.geometry);
      for (const attribute of Object.values(object.geometry.attributes) as THREE.BufferAttribute[]) geometryBytes += attribute.array.byteLength;
      geometryBytes += object.geometry.index?.array.byteLength || 0;
    });
    resources.forEach(texture => { const image = texture.image as HTMLImageElement | HTMLCanvasElement; if (image) textureBytes += image.width * image.height * 4 * 4 / 3; });
    const sorted = intervals.slice().sort((a, b) => a - b);
    const gl = renderer.getContext();
    return {
      frames, drawCalls: lastCalls, triangles: lastTriangles, cpuMs: +cpuMs.toFixed(2),
      frameP95Ms: sorted.length ? +sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(2) : null,
      frameSamples: sorted.length, renderWidth: canvas.width, renderHeight: canvas.height,
      geometryBytes, textureBytes: Math.ceil(textureBytes),
      estimatedGpuBytes: Math.ceil(geometryBytes + textureBytes + 1024 * 1024 * 4 + canvas.width * canvas.height * 8 * Math.max(1, gl.getParameter(gl.SAMPLES))),
      textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
      quality, weather, paused: !active, missingArt, renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL || gl.RENDERER),
      position: camera.position.toArray(), onDemand: true,
    };
  }
  goTo(0, true);
  resize();
  initialized = true;
  options.signal?.removeEventListener('abort', abortInitialization);
  return { resume, pause, dispose, goTo, stats,
    setQuality(value: Quality) { quality = value; resize(); },
    setMotion(value: boolean) { smoothMotion = value; },
    setWeather(rain: boolean) {
      weather = rain ? 'rain' : 'clear';
      sun.intensity = rain ? 0.65 : 2.4;
      fill.intensity = rain ? 2.1 : 2.6;
      fill.color.set(rain ? '#dce5ee' : '#f4f3ec');
      sky.color.set(rain ? '#b8c6d0' : '#f4f4df');
      invalidate();
    },
    capture() { renderer.render(scene, camera); return canvas.toDataURL('image/webp', 0.92); },
  };
}
