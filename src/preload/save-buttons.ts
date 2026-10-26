// Save buttons on the server page, so pictures and files can be saved without another browser
// (which doesn't have the server's proxy login): "save" next to Sharkord's "open in new tab"
// under pictures and videos, a save icon on file cards, and one beside "copy link" in the
// full-screen picture. They only hand the address to the app (main checks it is one of this
// server's own files and shows the save dialog). Sharkord re-renders all the time, so the page
// is looked over again shortly after it changes.

const ICON =
  '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>';
const svg = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download">${ICON}</svg>`;

const isServerFile = (href: string) => {
  try {
    const u = new URL(href, location.href);
    return /^https?:$/.test(u.protocol) && u.pathname.startsWith('/public/');
  } catch {
    return false;
  }
};

export const startSaveButtons = (labels: { save: string; saveImage: string; saveFile: string }, save: (url: string) => void) => {
  const button = (onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.jbSave = '';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  const scan = () => {
    // under pictures and videos: sharkord's "open in new tab" link (an <a> with its icon after it)
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a.text-xs[target="_blank"]'))) {
      const row = a.parentElement;
      if (!row || row.querySelector(':scope > [data-jb-save]') || !isServerFile(a.href)) continue;
      const b = button(() => save(a.href));
      b.className = 'jb-save-link text-xs hover:underline text-primary/60';
      b.innerHTML = `${svg(12)}<span></span>`;
      b.querySelector('span')!.textContent = labels.save;
      b.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-left:10px;cursor:pointer;background:none;border:0;padding:0;font-family:inherit;';
      row.append(b);
    }

    // file cards: a small save icon at the end (the card itself still does what it did)
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a.max-w-sm[target="_blank"]'))) {
      if (a.querySelector(':scope > [data-jb-save]') || !isServerFile(a.href)) continue;
      const b = button(() => save(a.href));
      b.title = labels.saveFile;
      b.setAttribute('aria-label', labels.saveFile);
      b.className = 'jb-save-icon text-muted-foreground hover:text-foreground';
      b.innerHTML = svg(16);
      b.style.cssText = 'display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:6px;cursor:pointer;background:none;border:0;padding:0;';
      a.append(b);
    }

    // the full-screen picture: a save button before "copy link" and "close", made like them
    const bar = document.querySelector<HTMLElement>('#imagePortal .absolute.top-2.right-2');
    const img = document.querySelector<HTMLImageElement>('#imagePortal img');
    if (bar && img && !bar.querySelector(':scope > [data-jb-save]')) {
      const like = bar.querySelector('button');
      const b = button(() => save(img.currentSrc || img.src));
      b.className = like?.className ?? '';
      b.title = labels.saveImage;
      b.setAttribute('aria-label', labels.saveImage);
      const icon = like?.querySelector('svg');
      b.innerHTML = svg(16);
      if (icon) b.querySelector('svg')!.setAttribute('class', `${icon.getAttribute('class') ?? ''} lucide-download`.trim());
      if (isServerFile(img.currentSrc || img.src)) bar.prepend(b);
    }
  };

  let timer = 0;
  const soon = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      scan();
    }, 200);
  };
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  scan();
};
