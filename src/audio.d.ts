export const audio: { ctx: AudioContext | null; master: GainNode | null; active: boolean; ok: boolean; muted: boolean };
export const PIECES: { name: string; quiet?: boolean }[];
export function initAudio(): void;
export function setAudioActive(active: boolean): void;
export function suspendAudio(): void;
export function setMusic(name: string): string;
export function musicName(): string;
export function setRain(on: boolean): boolean;
export function rainActive(): boolean;
