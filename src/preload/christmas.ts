// the Christmas theme: its scene behind the Sharkord page (the theme's css draws the glass panels
// in front of it). Light or dark follows the page's own; the palette comes with the look. The
// baubles hang over the chat and swing when the pointer brushes past them.

import { createXmasScene, type TXmasScene } from '../renderer/theme/christmas/scene';

export const startPageXmas = (focused: () => boolean, palette: () => string): TXmasScene | null => {
  if (!document.body) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'jb-xmas';
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;';
  document.body.prepend(canvas);
  const scene = createXmasScene(canvas, {
    palette,
    dark: () => !document.documentElement.classList.contains('light'),
    focused,
    // over the chat's right half, which its words rarely reach (the server list is at the left,
    // the members at the right)
    hang: [0.56, 0.61, 0.66, 0.705, 0.745]
  });
  const move = (e: PointerEvent) => scene.pointer(e.clientX, e.clientY);
  window.addEventListener('pointermove', move, { passive: true, capture: true });
  // for tuning (the preload's world): __xmasCost()
  Object.assign(globalThis, { __xmasCost: () => scene.cost() });
  return {
    ...scene,
    stop: () => {
      scene.stop();
      window.removeEventListener('pointermove', move, { capture: true });
      canvas.remove();
    }
  };
};
