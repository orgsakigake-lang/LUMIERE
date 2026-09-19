export interface Artwork {
  id: string;
  title: string;
  medium: string;
  description: string;
  algo: number;
  seed: number;
  palette: number;
  width: number;
  height: number;
  position: [number, number, number];
  rotation: number;
}

// New curated identities. Legacy seeds and placements are never remapped.
export const works: Artwork[] = [
  { id: 'quiet-current', title: 'Quiet Current', medium: 'Generative ink on paper',
    description: 'A field of fine lines follows an invisible current. Each mark is small; together they become a landscape that seems to breathe. Stay a moment, and let your eye find its own way through.',
    algo: 0, seed: 481516, palette: 3, width: 768, height: 960, position: [-4.1, 2.35, -8.68], rotation: 0 },
  { id: 'a-place-between', title: 'A Place Between', medium: 'Generative colour study',
    description: 'Circles, intervals, and planes hold one another in balance. An arrangement of ordinary shapes becomes a small conversation about the space we leave around things.',
    algo: 4, seed: 271828, palette: 1, width: 768, height: 960, position: [4.1, 2.35, -8.68], rotation: 0 },
  { id: 'slow-earth', title: 'Slow Earth', medium: 'Generative landscape',
    description: 'Layered ridgelines gather into a horizon. The landscape is imagined, but its rhythm is familiar: distance folding into distance, with no particular destination.',
    algo: 5, seed: 20260918, palette: 8, width: 1024, height: 768, position: [-7.68, 2.35, -4.2], rotation: Math.PI / 2 },
  { id: 'the-shape-of-silence', title: 'The Shape of Silence', medium: 'Generative tessellation',
    description: 'A surface breaks into neighbouring fragments, each finding its place among the others. The boundary of one shape becomes the beginning of the next.',
    algo: 3, seed: 314159, palette: 5, width: 768, height: 960, position: [-7.68, 2.35, 3.3], rotation: Math.PI / 2 },
  { id: 'small-infinities', title: 'Small Infinities', medium: 'Generative geometric print',
    description: 'A simple rule is repeated until it becomes something unexpected. Curves meet and separate, suggesting paths that might continue beyond the edge of the paper.',
    algo: 2, seed: 161803, palette: 0, width: 768, height: 960, position: [7.68, 2.35, -4.2], rotation: -Math.PI / 2 },
  { id: 'after-the-rain', title: 'After the Rain', medium: 'Generative density drawing',
    description: 'Thousands of points return to a mathematical attraction. Their accumulated traces form a delicate, almost weightless structure: something between a cloud and a memory.',
    algo: 1, seed: 577215, palette: 3, width: 1024, height: 768, position: [7.68, 2.35, 3.3], rotation: -Math.PI / 2 },
];

export const artworkURL = (work: Artwork, size: 'thumb' | 'room' | 'full' = 'room') =>
  `./art/${work.id}-${size}.webp`;

export const viewpoints = [
  { position: [5.7, 2.3, 7.5], target: [-1.5, 2.1, -6.5], label: 'The main gallery' },
  { position: [-3.5, 1.7, -4.2], target: [-4.1, 2.35, -8.68], label: 'Quiet Current' },
  { position: [3.5, 1.7, -4.2], target: [4.1, 2.35, -8.68], label: 'A Place Between' },
  { position: [-3.8, 1.7, -3.6], target: [-7.68, 2.35, -4.2], label: 'Slow Earth' },
  { position: [-3.8, 1.7, 4], target: [-7.68, 2.35, 3.3], label: 'The Shape of Silence' },
  { position: [3.8, 1.7, -3.6], target: [7.68, 2.35, -4.2], label: 'Small Infinities' },
  { position: [3.8, 1.7, 4], target: [7.68, 2.35, 3.3], label: 'After the Rain' },
] as const;
