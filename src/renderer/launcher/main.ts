import type { TServerEntry, TServerInput, TUpdateStatus } from '../../shared/types';
import { bootTheme, hint, toast } from '../theme/ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

let editingId: string | undefined;
let servers: TServerEntry[] = [];
let autoConnectId: string | null = null;
let confirmingRemove = false;

// ---- servers list ---------------------------------------------------------------------------

const testLabel = (s: TServerEntry) => {
  if (!s.lastTest || s.lastTest.ok) return '';
  return s.lastTest.status === 401 ? ' | auth problem' : ' | unreachable';
};

// a lone server opens at start without being asked
const startsInto = (s: TServerEntry) => s.id === autoConnectId || servers.length === 1;

const renderStartup = () => {
  const auto = servers.find(startsInto);
  $('startup-line').textContent = `${auto ? `opens ${auto.name} at start | ` : ''}back here: menu bar on a server page or ctrl+shift+s`;
};

const renderServers = async () => {
  servers = await window.shell.listServers();
  autoConnectId = (await window.shell.getSettings()).autoConnectServerId;
  renderStartup();
  list.innerHTML = '';
  $('server-count').textContent = servers.length ? `${servers.length} ${servers.length === 1 ? 'server' : 'servers'}` : '';
  $<HTMLButtonElement>('export-all').hidden = servers.length === 0;

  if (servers.length === 0) {
    list.innerHTML = '<div class="hint">no servers yet | add the url of a sharkord server</div>';
    return;
  }

  for (const server of servers) {
    const row = document.createElement('div');
    row.className = `item${server.id === editingId ? ' on' : ''}`;
    row.innerHTML = `
      <span class="dot"></span>
      <div class="grow"><div class="name"></div><div class="meta"></div></div>
      <button class="pill small alt connect">open</button>`;
    row.querySelector('.dot')!.className = `dot ${server.lastTest ? (server.lastTest.ok ? 'ok' : 'bad') : 'none'}`;
    row.querySelector('.name')!.textContent = server.name;
    row.querySelector('.meta')!.textContent =
      `${server.url.replace(/^https?:\/\//, '')}${server.basicAuth ? ' | basic auth' : ''}${startsInto(server) ? ' | opens at start' : ''}${testLabel(server)}`;
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
  basicAuth: fUser.value ? { username: fUser.value, password: fPass.value } : null,
  keepLogin: keepBox.checked
});

const resetRemove = () => {
  confirmingRemove = false;
  deleteBtn.textContent = 'remove';
};

const openEditor = (server?: TServerEntry) => {
  editingId = server?.id;
  $('editor-title').textContent = server ? 'edit server' : 'add server';
  fUrl.value = server?.url ?? '';
  fName.value = server?.name ?? '';
  fUser.value = server?.basicAuth?.username ?? '';
  fPass.value = '';
  fPass.placeholder = server?.basicAuth ? 'unchanged' : '';
  checkUrl();
  deleteBtn.hidden = !server;
  openBtn.hidden = !server;
  autoRow.hidden = !server;
  shareRow.hidden = !server;
  autoBox.checked = !!server && startsInto(server);
  autoBox.disabled = !!server && servers.length === 1;
  autoRow.title = autoBox.disabled ? 'the only server opens at start' : '';
  keepBox.checked = !server || server.keepLogin !== false;
  resetRemove();
  hint(testStatus, '');
  hint(shareStatus, '');
  editorPanel.hidden = false;
  editorPanel.classList.add('enter');
  editorPanel.scrollIntoView({ block: 'nearest' });
  renderServers();
  fUrl.focus();
};

const closeEditor = () => {
  editingId = undefined;
  editorPanel.hidden = true;
  editorPanel.classList.remove('enter');
  $('editor-title').textContent = 'server';
  resetRemove();
  renderServers();
};

// saving tests the connection too; a failed test still saves
const save = async () => {
  if (editorPanel.hidden) return;
  if (!fUrl.value.trim()) return hint(testStatus, 'url missing', 'bad');

  hint(testStatus, 'testing');

  try {
    const { server, test } = await window.shell.saveServer(formInput());
    fx.burstAt($('save'), 10);
    toast('saved');
    openEditor(server);
    if (test.ok) {
      hint(testStatus, `saved | ${test.info.name}${test.version ? ` | sharkord ${test.version}` : ''}`, 'good');
    } else {
      hint(testStatus, `saved | ${test.error}`, 'bad');
    }
  } catch (err) {
    hint(testStatus, (err as Error).message.replace(/^.*Error: /, ''), 'bad');
  }
};

$('add-server').onclick = () => openEditor();
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
    deleteBtn.textContent = 'sure? remove';
    return;
  }
  await window.shell.removeServer(editingId);
  toast('removed');
  closeEditor();
};

autoBox.onchange = async () => {
  if (!editingId) return;
  autoConnectId = autoBox.checked ? editingId : null;
  await window.shell.saveSettings({ autoConnectServerId: autoConnectId });
  toast('saved');
  renderServers();
};

keepBox.onchange = async () => {
  if (!editingId) return;
  await window.shell.setKeepLogin(editingId, keepBox.checked);
  toast(keepBox.checked ? 'saved' : 'login forgotten');
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); save(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'q') { e.preventDefault(); window.shell.quit(); }
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
  toast(`imported ${names.length} ${names.length === 1 ? 'server' : 'servers'}`);
  hint(listStatus, `imported | ${names.join(' | ')}`, 'good');
  $<HTMLInputElement>('import-code').value = '';
  closeEditor(); // an imported server may have replaced the one being edited
};

const importText = async () => {
  const text = $<HTMLInputElement>('import-code').value.trim();
  if (!text) return hint(listStatus, 'no code', 'bad');
  try {
    afterImport(await window.shell.importText(text));
  } catch (err) {
    hint(listStatus, (err as Error).message.replace(/^.*Error: /, ''), 'bad');
  }
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
    hint($('bridge-text'), `hotkeys ready${status.keyUp ? '' : ' | no push to talk yet'}`, 'good');
  } else {
    hint($('bridge-text'), `hotkeys | port ${status.port} taken, using the sharkord bridge`, '');
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
    toast(spell.checked && !settings.spellcheckAtStart ? 'on after restart' : 'saved');
  };

  $('diagnostics').onclick = async () => {
    await navigator.clipboard.writeText(await window.shell.diagnostics());
    fx.burstAt($('diagnostics'), 10);
    toast('copied');
  };

  const updates = $<HTMLInputElement>('check-updates');
  $('updates-row').hidden = platform !== 'win32' && platform !== 'linux';
  updates.checked = settings.checkUpdates;
  updates.onchange = () => { window.shell.saveSettings({ checkUpdates: updates.checked }); toast('saved'); };

  const tray = $<HTMLInputElement>('minimize-to-tray');
  tray.checked = settings.minimizeToTray;
  tray.onchange = () => { window.shell.saveSettings({ minimizeToTray: tray.checked }); toast('saved'); };

  const notify = $<HTMLInputElement>('notify-tray');
  notify.checked = settings.notifyTray;
  notify.onchange = () => { window.shell.saveSettings({ notifyTray: notify.checked }); toast('saved'); };

  const autostart = $<HTMLInputElement>('autostart');
  const auto = await window.shell.getAutoStart();
  $('autostart-row').hidden = !auto.supported;
  autostart.checked = auto.enabled;
  autostart.onchange = async () => {
    autostart.checked = await window.shell.setAutoStart(autostart.checked);
    toast('saved');
  };

  const updateLine = $('update-line');
  const showUpdate = (s: TUpdateStatus) => {
    const text = {
      idle: '',
      checking: 'checking for updates',
      available: platform === 'win32' ? `downloading ${s.version ?? 'update'}` : `${s.version ?? 'a newer version'} available | click to open`,
      downloaded: `${s.version ?? 'update'} ready | click to install`,
      none: 'up to date',
      error: `update check failed | ${s.message ?? ''}`
    }[s.state];
    const clickable = s.state === 'downloaded' || (platform === 'linux' && s.state === 'available');
    hint(updateLine, text, s.state === 'downloaded' || (platform === 'linux' && s.state === 'available') ? 'good' : s.state === 'error' ? 'bad' : '');
    updateLine.onclick = !clickable ? null : s.state === 'downloaded' ? () => window.shell.installUpdate() : () => window.shell.openReleasePage();
    updateLine.style.cursor = clickable ? 'pointer' : '';
  };
  if (platform === 'win32' || platform === 'linux') {
    if (!settings.checkUpdates) hint(updateLine, 'update checks off');
    else showUpdate(await window.shell.updateStatus());
    window.shell.onUpdateStatus(showUpdate);
  }

  $('version').textContent = `Jollyboat ${window.shell.version}${settings.secureStorage ? '' : ' | no keyring, passwords unencrypted'}`;
};

$('website').onclick = () => window.shell.openWebsite();

// a server that failed to load sends us back here with the reason in the query
const failed = new URLSearchParams(location.search).get('error');
if (failed) {
  toast('could not open the server');
  hint($('list-status'), `could not open the server | ${failed}`, 'bad');
}

renderServers();
renderBridge();
renderSettings();

// the Settings menu item lands on the app panel
if (new URLSearchParams(location.search).get('panel') === 'app') {
  const panel = $('app-panel');
  panel.classList.add('lit');
  panel.scrollIntoView({ block: 'center' });
  setTimeout(() => panel.classList.remove('lit'), 1800);
}
