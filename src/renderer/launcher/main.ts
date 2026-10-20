import type { TServerEntry, TServerInput, TUpdateStatus } from '../../shared/types';
import { bootTheme, hint, toast } from '../theme/ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const { fx } = bootTheme();

const list = $('server-list');
const form = $('editor-form');
const empty = $('editor-empty');
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
const shareRow = $('share-row');

let editingId: string | undefined;
let servers: TServerEntry[] = [];
let autoConnectId: string | null = null;
let confirmingRemove = false;

$('quit').onclick = () => window.shell.quit();

// ---- servers list ---------------------------------------------------------------------------

const testLabel = (s: TServerEntry) => {
  if (!s.lastTest || s.lastTest.ok) return '';
  return s.lastTest.status === 401 ? ' | auth problem' : ' | unreachable';
};

const renderStartup = () => {
  const auto = servers.find((s) => s.id === autoConnectId);
  $('startup-line').textContent = auto
    ? `starts with ${auto.name} | ctrl+shift+s brings this screen back | ctrl+q quit`
    : 'starts with this screen | tick open at start on a server to skip it | ctrl+q quit';
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
      `${server.url.replace(/^https?:\/\//, '')}${server.basicAuth ? ' | basic auth' : ''}${server.id === autoConnectId ? ' | opens at start' : ''}${testLabel(server)}`;
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
  basicAuth: fUser.value ? { username: fUser.value, password: fPass.value } : null
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
  deleteBtn.hidden = !server;
  openBtn.hidden = !server;
  autoRow.hidden = !server;
  shareRow.hidden = !server;
  autoBox.checked = !!server && server.id === autoConnectId;
  resetRemove();
  hint(testStatus, '');
  hint(shareStatus, '');
  empty.hidden = true;
  form.hidden = false;
  renderServers();
  fUrl.focus();
};

const closeEditor = () => {
  editingId = undefined;
  form.hidden = true;
  empty.hidden = false;
  $('editor-title').textContent = 'server';
  resetRemove();
  renderServers();
};

// saving tests the connection too; a failed test still saves
const save = async () => {
  if (form.hidden) return;
  if (!fUrl.value.trim()) return hint(testStatus, 'a url is needed', 'bad');

  hint(testStatus, 'saving and testing');

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
  toast(autoBox.checked ? 'opens at start' : 'saved');
  renderServers();
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); save(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'q') { e.preventDefault(); window.shell.quit(); }
  if (e.key === 'Escape' && !form.hidden) closeEditor();
});

// ---- sharing ---------------------------------------------------------------------------------

const withPasswords = () => $<HTMLInputElement>('share-passwords').checked;

$('share-copy').onclick = async () => {
  if (!editingId) return;
  try {
    const code = await window.shell.shareCode([editingId], withPasswords());
    await navigator.clipboard.writeText(code);
    fx.burstAt($('share-copy'), 10);
    hint(shareStatus, `code copied${withPasswords() ? ' | password included, share with care' : ''}`, 'good');
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
    if (path) hint(listStatus, `saved all servers without passwords | ${path}`, 'good');
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
  if (!text) return hint(listStatus, 'paste a code first', 'bad');
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
    hint($('bridge-text'), `hotkeys | built-in bridge on port ${status.port}, pairing is automatic | bind keys in sharkord under user settings, hotkeys${status.keyUp ? '' : ' | push to talk not available yet'}`, 'good');
  } else {
    hint($('bridge-text'), `hotkeys | port ${status.port} is in use, the official sharkord bridge will handle them with its own token`, '');
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
    toast(spell.checked && !settings.spellcheckAtStart ? 'spellcheck on after a restart' : spell.checked ? 'spellcheck on' : 'spellcheck off');
  };

  const updates = $<HTMLInputElement>('check-updates');
  $('updates-row').hidden = platform !== 'win32';
  updates.checked = settings.checkUpdates;
  updates.onchange = () => { window.shell.saveSettings({ checkUpdates: updates.checked }); toast(updates.checked ? 'checks for updates' : 'no update checks'); };

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
    toast(autostart.checked ? 'starts with the system' : 'saved');
  };

  const updateLine = $('update-line');
  const showUpdate = (s: TUpdateStatus) => {
    const text = {
      idle: '',
      checking: 'checking for updates',
      available: `update ${s.version ?? ''} found | downloading`,
      downloaded: `update ${s.version ?? ''} ready | click to install now, or it installs when you quit`,
      none: 'up to date',
      error: `update check failed | ${s.message ?? ''}`
    }[s.state];
    hint(updateLine, text, s.state === 'downloaded' ? 'good' : s.state === 'error' ? 'bad' : '');
    updateLine.onclick = s.state === 'downloaded' ? () => window.shell.installUpdate() : null;
    updateLine.style.cursor = s.state === 'downloaded' ? 'pointer' : '';
  };
  if (platform === 'win32') {
    if (!settings.checkUpdates) hint(updateLine, 'update checks are off | new versions on the github releases page');
    else showUpdate(await window.shell.updateStatus());
    window.shell.onUpdateStatus(showUpdate);
  } else if (platform === 'linux') {
    hint(updateLine, 'updates come through flatpak | or the releases page for other installs');
  }

  $('version').textContent = `jollyboat ${window.shell.version} | ${platform}${settings.secureStorage ? '' : ' | no keyring found, passwords are stored unencrypted'}`;
};

// a server that failed to load sends us back here with the reason in the query
const failed = new URLSearchParams(location.search).get('error');
if (failed) {
  toast('could not open the server');
  hint(empty, `could not open the server | ${failed}`, 'bad');
}

renderServers();
renderBridge();
renderSettings();
