import type { TServerEntry, TServerInput, TUpdateStatus } from '../../shared/types';
import { bootTheme, hint, segment, toast } from '../theme/ui';
import { t, translatePage } from '../i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

translatePage();
const { fx } = bootTheme();

const list = $('server-list');
const editorPanel = $('editor');
const fUrl = $<HTMLInputElement>('f-url');
const fName = $<HTMLInputElement>('f-name');
const fUser = $<HTMLInputElement>('f-user');
const fPass = $<HTMLInputElement>('f-pass');
const testStatus = $('test-status');
const listStatus = $('list-status');
const shareStatus = $('share-status');
const deleteBtn = $<HTMLButtonElement>('delete');
const openBtn = $<HTMLButtonElement>('open-now');
const autoRow = $('auto-connect-row');
const autoBox = $<HTMLInputElement>('auto-connect');
const keepBox = $<HTMLInputElement>('keep-login');
const shareRow = $('share-row');
const authBox = $<HTMLInputElement>('use-auth');
const authFields = $('auth-fields');
const right = $('right');

let editingId: string | undefined;
let servers: TServerEntry[] = [];
let autoConnectId: string | null = null;
let confirmingRemove = false;

// a server that failed to open comes back here with its id and the reason; the row shows it
const query = new URLSearchParams(location.search);
const failures = new Map<string, string>();
if (query.get('server') && query.get('error')) failures.set(query.get('server')!, query.get('error')!);

// ---- servers list ---------------------------------------------------------------------------

const testLabel = (s: TServerEntry) => {
  if (!s.lastTest || s.lastTest.ok) return '';
  return ` | ${s.lastTest.status === 401 ? t('auth problem') : t('unreachable')}`;
};

// a lone server opens at start without being asked
const startsInto = (s: TServerEntry) => s.id === autoConnectId || servers.length === 1;

const renderStartup = () => {
  const auto = servers.find(startsInto);
  $('startup-line').textContent = `${auto ? `| ${t('opens {name} at start', { name: auto.name })} ` : ''}| ${t('{keys} opens this window', { keys: `${window.shell.platform === 'darwin' ? 'cmd' : 'ctrl'}+shift+s` })}`;
};

const renderServers = async () => {
  servers = await window.shell.listServers();
  autoConnectId = (await window.shell.getSettings()).autoConnectServerId;
  renderStartup();
  list.innerHTML = '';
  $<HTMLButtonElement>('export-all').hidden = servers.length === 0;

  $('intro').hidden = servers.length > 0;
  if (servers.length === 0) {
    list.innerHTML = `<div class="hint">${t('no servers yet | add the url of a sharkord server')}</div>`;
    return;
  }

  for (const server of servers) {
    const row = document.createElement('div');
    const failure = failures.get(server.id);
    row.className = `item${server.id === editingId ? ' on' : ''}${failure ? ' failed' : ''}`;
    row.innerHTML = `
      <span class="dot"></span>
      <div class="grow"><div class="name"></div><div class="meta"></div></div>
      <button class="pill small alt connect">${t('open')}</button>`;
    row.querySelector('.dot')!.className = `dot ${failure ? 'bad' : server.lastTest ? (server.lastTest.ok ? 'ok' : 'bad') : 'none'}`;
    row.querySelector('.name')!.textContent = server.name;
    row.querySelector('.meta')!.textContent = failure
      ? `! ${failure}`
      : `${server.url.replace(/^https?:\/\//, '')}${server.basicAuth ? ` | ${t('proxy login')}` : ''}${startsInto(server) ? ` | ${t('opens at start')}` : ''}${testLabel(server)}`;
    row.querySelector<HTMLButtonElement>('.connect')!.onclick = (e) => {
      e.stopPropagation();
      window.shell.connect(server.id);
    };
    row.onclick = () => openEditor(server);
    list.appendChild(row);
  }
};

// ---- editor ----------------------------------------------------------------------------------

const formInput = (): TServerInput => ({
  id: editingId,
  url: fUrl.value,
  name: fName.value,
  basicAuth: authBox.checked && fUser.value ? { username: fUser.value, password: fPass.value } : null,
  keepLogin: keepBox.checked
});

const resetRemove = () => {
  confirmingRemove = false;
  deleteBtn.textContent = t('remove');
};

const openEditor = (server?: TServerEntry) => {
  editingId = server?.id;
  $('editor-title').textContent = server ? t('edit server') : t('add server');
  fUrl.value = server?.url ?? '';
  fName.value = server?.name ?? '';
  fUser.value = server?.basicAuth?.username ?? '';
  fPass.value = '';
  fPass.placeholder = server?.basicAuth ? 'unchanged' : '';
  authBox.checked = !!server?.basicAuth;
  authFields.hidden = !authBox.checked;
  checkUrl();
  deleteBtn.hidden = !server;
  openBtn.hidden = !server;
  autoRow.hidden = !server;
  shareRow.hidden = !server;
  autoBox.checked = !!server && startsInto(server);
  autoBox.disabled = !!server && servers.length === 1;
  autoRow.title = autoBox.disabled ? t('the only server opens at start') : '';
  keepBox.checked = !server || server.keepLogin !== false;
  resetRemove();
  hint(testStatus, '');
  hint(shareStatus, '');
  editorPanel.hidden = false;
  editorPanel.classList.add('enter');
  right.classList.add('editing');
  renderServers();
  fUrl.focus();
};

const closeEditor = () => {
  editingId = undefined;
  editorPanel.hidden = true;
  editorPanel.classList.remove('enter');
  right.classList.remove('editing');
  $('editor-title').textContent = t('server');
  resetRemove();
  renderServers();
};

// saving tests the connection too; a failed test still saves
const save = async () => {
  if (editorPanel.hidden) return;
  if (!fUrl.value.trim()) return hint(testStatus, t('url missing'), 'bad');

  hint(testStatus, t('testing'));

  try {
    const { server, test } = await window.shell.saveServer(formInput());
    fx.burstAt($('save'), 10);
    toast(t('saved'));
    failures.delete(server.id);
    openEditor(server);
    if (test.ok) {
      hint(testStatus, `saved | ${test.info.name}${test.version ? ` | sharkord ${test.version}` : ''}`, 'good');
    } else {
      hint(testStatus, `${t('saved')} | ${test.error}`, 'bad');
    }
  } catch (err) {
    hint(testStatus, (err as Error).message.replace(/^.*Error: /, ''), 'bad');
  }
};

$('add-server').onclick = () => openEditor();
$('editor-close').onclick = () => closeEditor();
authBox.onchange = () => {
  authFields.hidden = !authBox.checked;
  if (authBox.checked) fUser.focus();
};
$('save').onclick = save;
openBtn.onclick = () => editingId && window.shell.connect(editingId);
for (const input of [fUrl, fName, fUser, fPass]) {
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
}

// a plain http server sends the proxy login in clear
const urlNote = $('url-note');
const checkUrl = () => {
  urlNote.textContent = /^http:\/\/(?!(localhost|127\.|10\.|192\.168\.|\[::1\]))/i.test(fUrl.value.trim()) ? '! http: the proxy login travels unencrypted' : '';
};
fUrl.addEventListener('input', checkUrl);

// remove needs a second click
deleteBtn.onclick = async () => {
  if (!editingId) return;
  if (!confirmingRemove) {
    confirmingRemove = true;
    deleteBtn.textContent = t('sure? remove');
    return;
  }
  await window.shell.removeServer(editingId);
  toast(t('removed'));
  closeEditor();
};

autoBox.onchange = async () => {
  if (!editingId) return;
  autoConnectId = autoBox.checked ? editingId : null;
  await window.shell.saveSettings({ autoConnectServerId: autoConnectId });
  toast(t('saved'));
  renderServers();
};

keepBox.onchange = async () => {
  if (!editingId) return;
  await window.shell.setKeepLogin(editingId, keepBox.checked);
  toast(keepBox.checked ? t('saved') : t('login forgotten'));
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); save(); }
  if (e.key === 'Escape' && !editorPanel.hidden) closeEditor();
});

// ---- sharing ---------------------------------------------------------------------------------

const withPasswords = () => $<HTMLInputElement>('share-passwords').checked;

$('share-copy').onclick = async () => {
  if (!editingId) return;
  try {
    const code = await window.shell.shareCode([editingId], withPasswords());
    await navigator.clipboard.writeText(code);
    fx.burstAt($('share-copy'), 10);
    hint(shareStatus, `copied${withPasswords() ? ' with password' : ''}`, 'good');
  } catch (err) {
    hint(shareStatus, (err as Error).message, 'bad');
  }
};

$('share-file').onclick = async () => {
  if (!editingId) return;
  try {
    const path = await window.shell.exportFile([editingId], withPasswords());
    if (path) hint(shareStatus, `saved | ${path}`, 'good');
  } catch (err) {
    hint(shareStatus, (err as Error).message, 'bad');
  }
};

$('export-all').onclick = async () => {
  try {
    const path = await window.shell.exportFile(null, false);
    if (path) hint(listStatus, `saved | ${path}`, 'good');
  } catch (err) {
    hint(listStatus, (err as Error).message, 'bad');
  }
};

const afterImport = (names: string[] | null) => {
  if (!names) return;
  toast(names.length === 1 ? t('imported one server') : t('imported {n} servers', { n: names.length }));
  hint(listStatus, `imported | ${names.join(' | ')}`, 'good');
  $<HTMLInputElement>('import-code').value = '';
  $('import-row').hidden = true;
  closeEditor(); // an imported server may have replaced the one being edited
};

const importText = async () => {
  const text = $<HTMLInputElement>('import-code').value.trim();
  if (!text) return hint(listStatus, t('no code'), 'bad');
  try {
    afterImport(await window.shell.importText(text));
  } catch (err) {
    hint(listStatus, (err as Error).message.replace(/^.*Error: /, ''), 'bad');
  }
};

$('import-toggle').onclick = () => {
  const row = $('import-row');
  row.hidden = !row.hidden;
  if (!row.hidden) $<HTMLInputElement>('import-code').focus();
};
$('import-go').onclick = importText;
$<HTMLInputElement>('import-code').addEventListener('keydown', (e) => e.key === 'Enter' && importText());
$('import-file').onclick = async () => {
  try {
    afterImport(await window.shell.importFile());
  } catch (err) {
    hint(listStatus, (err as Error).message.replace(/^.*Error: /, ''), 'bad');
  }
};

// ---- app panel -------------------------------------------------------------------------------

const renderBridge = async () => {
  const status = await window.shell.bridgeStatus();
  if (status.ownedByUs) {
    hint($('bridge-text'), status.keyUp ? t('hotkeys and push-to-talk ready') : t('hotkeys ready | no push-to-talk on this system'), 'good');
  } else {
    hint($('bridge-text'), t('hotkeys | port {port} taken, using the sharkord bridge', { port: status.port }), '');
  }
};

const renderSettings = async () => {
  const settings = await window.shell.getSettings();
  const platform = window.shell.platform;

  const audio = await window.shell.screenAudioInfo();
  hint($('screen-audio-text'), audio.text, audio.ok ? 'good' : 'bad');

  const spell = $<HTMLInputElement>('spellcheck');
  spell.checked = settings.spellcheck;
  spell.onchange = () => {
    window.shell.saveSettings({ spellcheck: spell.checked });
    // the dictionary host is only unblocked on the next start
    toast(spell.checked && !settings.spellcheckAtStart ? t('on after restart') : t('saved'));
  };

  $('diagnostics').onclick = async () => {
    await navigator.clipboard.writeText(await window.shell.diagnostics());
    fx.burstAt($('diagnostics'), 10);
    toast(t('copied'));
  };

  const updates = $<HTMLInputElement>('check-updates');
  $('updates-row').hidden = window.shell.storeUpdates || !['win32', 'linux', 'darwin'].includes(platform);
  if (window.shell.storeUpdates) $('privacy-line').textContent = t('talks to your servers only | updates come from flathub');
  updates.checked = settings.checkUpdates;
  updates.onchange = () => { window.shell.saveSettings({ checkUpdates: updates.checked }); toast('saved'); };

  segment($('on-close'), [{ value: 'minimize', label: t('minimizes') }, { value: 'tray', label: t('hides to tray') }, { value: 'quit', label: t('quits') }], settings.onClose, (v) => {
    window.shell.saveSettings({ onClose: v });
    toast(t('saved'));
  });

  // a theme on the server page: the app's own lcd look, or custom.css next to the settings
  const themeOn = $<HTMLInputElement>('theme-on');
  let themeKind: 'jollyboat' | 'custom' = settings.theme === 'custom' ? 'custom' : 'jollyboat';
  const showTheme = () => {
    $('theme-options').hidden = !themeOn.checked;
    $('css-row').hidden = themeKind !== 'custom';
  };
  themeOn.checked = settings.theme !== 'none';
  segment($('theme-kind'), [{ value: 'jollyboat' as const, label: 'Jollyboat' }, { value: 'custom' as const, label: t('custom') }], themeKind, (v) => {
    themeKind = v;
    showTheme();
    window.shell.saveSettings({ theme: v });
    toast(t('saved'));
  });
  showTheme();
  themeOn.onchange = () => {
    showTheme();
    window.shell.saveSettings({ theme: themeOn.checked ? themeKind : 'none' });
    toast(t('saved'));
  };
  $('css-edit').onclick = async () => { await window.shell.editCustomCss(); toast(t('opened in your editor')); };
  $('css-example').onclick = async () => { await window.shell.useCssExample(); toast(t('lcd theme in custom.css')); };

  // voice overlay: on/off and its background; the slider saves as it moves (a little later)
  const overlay = $<HTMLInputElement>('overlay');
  const opacity = $<HTMLInputElement>('overlay-opacity');
  const showOpacity = () => {
    $('overlay-opacity-value').textContent = `${opacity.value}%`;
    opacity.style.setProperty('--fill', `${opacity.value}%`);
  };
  overlay.checked = settings.overlay;
  opacity.value = String(settings.overlayOpacity);
  $('overlay-options').hidden = !overlay.checked;
  if (window.shell.wayland) $('overlay-hint').textContent = t('shows while you are in a call and Jollyboat is in the background | on wayland the desktop places it (kde: a window rule keeps it on top)');
  showOpacity();
  overlay.onchange = () => {
    $('overlay-options').hidden = !overlay.checked;
    window.shell.saveSettings({ overlay: overlay.checked });
    toast(t('saved'));
  };
  const clickThrough = $<HTMLInputElement>('overlay-click-through');
  clickThrough.checked = settings.overlayClickThrough;
  clickThrough.onchange = () => { window.shell.saveSettings({ overlayClickThrough: clickThrough.checked }); toast('saved'); };
  let opacityTimer = 0;
  opacity.oninput = () => {
    showOpacity();
    clearTimeout(opacityTimer);
    opacityTimer = window.setTimeout(() => window.shell.saveSettings({ overlayOpacity: Number(opacity.value) }), 120);
  };

  // mic check: the level of the default microphone for a few seconds, no server involved
  const meter = $('mic-meter');
  const SEGMENTS = 16;
  meter.replaceChildren(...Array.from({ length: SEGMENTS }, () => document.createElement('i')));
  const segments = Array.from(meter.children) as HTMLElement[];
  let micStop: (() => void) | null = null;
  const showLevel = (level: number, peak: number) => {
    const lit = Math.round(level * SEGMENTS);
    const held = Math.round(peak * SEGMENTS);
    segments.forEach((s, i) => {
      s.classList.toggle('on', i < lit);
      s.classList.toggle('peak', i === held - 1 && i >= lit);
    });
  };
  $('mic-test').onclick = async () => {
    if (micStop) return micStop();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      hint($('mic-status'), t('no microphone'), 'bad');
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let peak = 0;
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      // rms on a log scale: quiet speech lights a few blocks, a shout all of them
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-6);
      const level = Math.min(1, Math.max(0, (db + 50) / 50));
      peak = Math.max(level, peak - 0.012);
      showLevel(level, peak);
      const left = Math.ceil(12 - (performance.now() - started) / 1000);
      $('mic-status').textContent = t('say something | {s} s', { s: left });
      if (left <= 0) return micStop?.();
      frame = requestAnimationFrame(tick);
    };
    micStop = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      micStop = null;
      showLevel(0, 0);
      $('mic-test').textContent = t('test the mic');
      hint($('mic-status'), peak > 0.05 ? t('the mic works') : t('nothing heard'), peak > 0.05 ? 'good' : 'bad');
    };
    $('mic-test').textContent = t('stop');
    tick();
  };
  $('intro-add').onclick = () => $('add-server').click();

  // the app's own language; the sharkord page keeps its own setting. a change reloads this page
  segment(
    $('language'),
    [{ value: 'system' as const, label: t('system') }, { value: 'en' as const, label: 'English' }, { value: 'de' as const, label: 'Deutsch' }, { value: 'pl' as const, label: 'Polski' }],
    settings.language,
    async (v) => {
      await window.shell.saveSettings({ language: v });
      location.reload();
    }
  );

  const notify = $<HTMLInputElement>('notify-tray');
  notify.checked = settings.notifyTray;
  notify.onchange = () => { window.shell.saveSettings({ notifyTray: notify.checked }); toast('saved'); };

  const autostart = $<HTMLInputElement>('autostart');
  const auto = await window.shell.getAutoStart();
  $('autostart-row').hidden = !auto.supported;
  autostart.checked = auto.enabled;
  autostart.onchange = async () => {
    autostart.checked = await window.shell.setAutoStart(autostart.checked);
    toast(t('saved'));
  };

  const updateLine = $('update-line');
  const showUpdate = (s: TUpdateStatus) => {
    const text = {
      idle: '',
      checking: t('checking for updates'),
      available: platform === 'win32' ? t('downloading {v}', { v: s.version ?? t('update') }) : t('{v} available | click to open', { v: s.version ?? t('a newer version') }),
      downloaded: t('{v} ready | click to install', { v: s.version ?? t('update') }),
      none: t('up to date'),
      error: `${t('update check failed')} | ${s.message ?? ''}`
    }[s.state];
    const clickable = s.state === 'downloaded' || (platform !== 'win32' && s.state === 'available');
    hint(updateLine, text, clickable ? 'good' : s.state === 'error' ? 'bad' : '');
    updateLine.onclick = !clickable ? null : s.state === 'downloaded' ? () => window.shell.installUpdate() : () => window.shell.openReleasePage();
    updateLine.style.cursor = clickable ? 'pointer' : '';
  };
  if (['win32', 'linux', 'darwin'].includes(platform)) {
    if (!settings.checkUpdates) hint(updateLine, t('update checks off'));
    else showUpdate(await window.shell.updateStatus());
    window.shell.onUpdateStatus(showUpdate);
  }

  $('version').textContent = `Jollyboat ${window.shell.version}${platform === 'darwin' ? ' (experimental mac build)' : ''}`;
  hint($('keyring'), settings.secureStorage ? '' : t('no keyring | passwords stored unencrypted'), 'bad');
};

$('website').onclick = () => window.shell.openWebsite();

// a failure without a known server (a crash, say) has no row to sit on
const failed = query.get('error');
if (failed) {
  toast(t('could not open the server'));
  if (!query.get('server')) hint(listStatus, `${t('could not open the server')} | ${failed}`, 'bad');
}

renderServers();
renderBridge();
renderSettings();
