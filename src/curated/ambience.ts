import { audio, PIECES, initAudio, setAudioActive, suspendAudio, setMusic, musicName, setRain, rainActive } from '../audio.js';

/** Reuse the museum's sound synthesis without importing its renderer or UI. */
export function createAmbience(select: HTMLSelectElement, volume: HTMLInputElement, note: HTMLElement,
  onWeather: (rain: boolean) => void) {
  let visiting = false;
  for (const piece of PIECES) select.add(new Option(piece.quiet ? 'Silence' : piece.name, piece.name));
  select.add(new Option('Rain on the roof', 'rain'));
  select.value = 'silence';
  function apply() {
    const rain = select.value === 'rain';
    const music = rain ? 'silence' : select.value;
    if (musicName() !== music) setMusic(music);
    if (rainActive() !== rain) setRain(rain);
    onWeather(rain);
    const sounding = visiting && select.value !== 'silence' && Number(volume.value) > 0;
    setAudioActive(sounding);
    if (sounding && !document.hidden) {
      initAudio();
      if (audio.master && audio.ctx) audio.master.gain.setTargetAtTime(Number(volume.value) * 0.9, audio.ctx.currentTime, 0.05);
    } else suspendAudio();
    note.textContent = sounding && !audio.ok ? 'Sound is unavailable in this browser. You can still enjoy the gallery.'
      : rain ? 'Rain replaces music. The room takes on softer, overcast light.'
      : select.value === 'silence' ? 'Your visit is silent. Sound starts only when you choose it.'
      : 'Generated live, with no audio downloads. Sound stops when you leave the visit.';
  }
  select.addEventListener('change', apply);
  volume.addEventListener('input', () => {
    if (audio.master && audio.ctx && Number(volume.value) > 0 && audio.active)
      audio.master.gain.setTargetAtTime(Number(volume.value) * 0.9, audio.ctx.currentTime, 0.05);
    else apply();
  });
  window.addEventListener('pagehide', () => setAudioActive(false));
  window.addEventListener('pageshow', () => { if (visiting) apply(); });
  apply();
  return {
    visit(on: boolean) { visiting = on; apply(); },
    stats: () => ({ context: audio.ctx?.state || 'not-started', music: musicName(), rain: rainActive(), active: audio.active }),
  };
}
