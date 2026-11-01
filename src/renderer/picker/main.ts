import type { TCaptureSource, TPickerSound } from '../../shared/types';
import { segment, bootTheme } from '../theme/ui';
import { t, translatePage } from '../i18n';

translatePage();
bootTheme();

const grid = document.getElementById('grid')!;
const shareBtn = document.getElementById('share') as HTMLButtonElement;

let sources: TCaptureSource[] = [];
let kind: 'screen' | 'window' = 'screen';
let selected: string | null = null;
let soundOnly = false;
const soundRow = document.getElementById('sound-row')!;
const soundSelect = document.getElementById('sound') as HTMLSelectElement;

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
  const sound = soundRow.hidden ? undefined : soundSelect.value;
  if (soundOnly) window.shell.pickerChoose({ sourceId: '', sound });
  else if (selected) window.shell.pickerChoose({ sourceId: selected, sound });
};

// the sound that goes with the share: everything but the call, nothing, or one app playing now
const showSound = (sound: TPickerSound | null) => {
  soundRow.hidden = !sound;
  if (!sound) return;
  const opt = (value: string, label: string) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };
  soundSelect.replaceChildren(opt('all', t('everything except the call')), ...sound.apps.map((a) => opt(`app:${a.id}`, t('only {app}', { app: a.name }))), opt('none', t('no sound')));
  soundSelect.value = sound.last;
  if (soundSelect.value !== sound.last) soundSelect.value = 'all';
  if (sound.only) {
    soundOnly = true;
    document.body.classList.add('only');
    document.querySelector('.panel-title')!.textContent = document.title = t('sound for the share');
    shareBtn.textContent = t('next');
    shareBtn.disabled = false;
  }
};

const showKind = segment(document.getElementById('kind')!, [{ value: 'screen', label: t('screens') }, { value: 'window', label: t('windows') }], kind, (v) => {
  kind = v;
  render();
});

shareBtn.onclick = share;
document.getElementById('cancel')!.onclick = () => window.shell.pickerChoose(null);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.shell.pickerChoose(null);
  // enter shares the selection, unless the focus is on cancel
  if (e.key === 'Enter' && document.activeElement?.id !== 'cancel') {
    e.preventDefault();
    share();
  }
});

window.shell.onPickerSources((list, lastName, sound) => {
  showSound(sound);
  sources = list;
  const last = lastName ? list.find((s) => s.name === lastName) : undefined;
  if (last) {
    selected = last.id;
    kind = last.kind;
    shareBtn.disabled = false;
    showKind(kind);
  }
  render();
});
