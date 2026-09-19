import { works, artworkURL } from './exhibition.ts';

/** Artwork presentation owns DOM construction; selection belongs to the app. */
export function mountCollection(previews: HTMLElement, grid: HTMLElement, onInspect: (index: number) => void) {
  for (const [index, work] of works.entries()) {
    const preview = document.createElement('button');
    preview.className = 'preview-work';
    preview.setAttribute('aria-label', `Preview ${work.title}`);
    const thumb = new Image();
    thumb.src = artworkURL(work, 'thumb'); thumb.alt = '';
    thumb.width = work.width; thumb.height = work.height; thumb.loading = 'lazy';
    preview.append(thumb);
    preview.addEventListener('click', () => onInspect(index));
    previews.append(preview);

    const button = document.createElement('button');
    button.className = 'work-card'; button.setAttribute('aria-label', `View ${work.title}`);
    const imageWrap = document.createElement('span'); imageWrap.className = 'work-image';
    const image = new Image();
    image.src = artworkURL(work, 'room'); image.alt = '';
    image.width = work.width; image.height = work.height; image.loading = 'lazy';
    imageWrap.append(image);
    const caption = document.createElement('span'); caption.className = 'work-caption';
    const copy = document.createElement('span'), title = document.createElement('span');
    const medium = document.createElement('span'), number = document.createElement('span');
    title.className = 'work-title'; medium.className = 'work-medium';
    title.textContent = work.title; medium.textContent = work.medium;
    number.textContent = String(index + 1).padStart(2, '0');
    copy.append(title, medium); caption.append(copy, number); button.append(imageWrap, caption);
    button.addEventListener('click', () => onInspect(index)); grid.append(button);
  }
}
