import type { TCaptureSource } from '../../shared/types';
import { segment, bootTheme } from '../theme/ui';

bootTheme();

const grid = document.getElementById('grid')!;
const shareBtn = document.getElementById('share') as HTMLButtonElement;

let sources: TCaptureSource[] = [];
let kind: 'screen' | 'window' = 'screen';
let selected: string | null = null;

const render = () => {
  grid.innerHTML = '';

  for (const source of sources.filter((s) => s.kind === kind)) {
    const card = document.createElement('button');
    card.className = `source${selected === source.id ? ' on' : ''}`;
    card.innerHTML = `<img class="thumb" alt="" /><div class="label"><span class="name"></span></div>`;
    (card.querySelector('img.thumb') as HTMLImageElement).src = source.thumbnail;
    card.querySelector('.name')!.textContent = source.name.toLowerCase();

    if (source.appIcon) {
      const icon = document.createElement('img');
      icon.src = source.appIcon;
      card.querySelector('.label')!.prepend(icon);
    }

    card.onclick = () => {
      selected = source.id;
      shareBtn.disabled = false;
      render();
    };
    card.ondblclick = () => share();
    grid.appendChild(card);
  }

  if (!grid.children.length) grid.innerHTML = `<div class="hint">nothing to share here</div>`;
};

const share = () => {
  if (selected) window.shell.pickerChoose({ sourceId: selected });
};

segment(document.getElementById('kind')!, [{ value: 'screen', label: 'screens' }, { value: 'window', label: 'windows' }], kind, (v) => {
  kind = v;
  render();
});

shareBtn.onclick = share;
document.getElementById('cancel')!.onclick = () => window.shell.pickerChoose(null);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.shell.pickerChoose(null);
  if (e.ctrlKey && e.key === 'Enter') share();
});

window.shell.onPickerSources((list, lastName) => {
  sources = list;
  const last = lastName ? list.find((s) => s.name === lastName) : undefined;
  if (last) {
    selected = last.id;
    kind = last.kind;
    shareBtn.disabled = false;
    document.querySelectorAll<HTMLButtonElement>('#kind button').forEach((b) => b.classList.toggle('on', b.textContent === (kind === 'screen' ? 'screens' : 'windows')));
  }
  render();
});
