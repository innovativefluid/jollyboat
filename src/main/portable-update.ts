// The portable exe updates itself. It looks at GitHub's releases like the notice did; a newer
// release with latest-portable.json (written by CI, tools/update-info.cjs) has the new portable
// exe for this architecture with its size and sha512. The exe is downloaded next to the running
// one and checked: the size and sha512 must match, and once our downloads are signed, the new
// file must carry a valid signature from the same publisher as the running one.
//
// The checked file waits next to the exe as <name>.update. The running exe cannot be renamed or
// replaced (the portable launcher holds its own file until it has cleaned up after the app), so
// the files trade places after the app has quit: a small powershell script waits until the
// launcher lets go, puts the old exe aside, gives the new one its name (so
// shortcuts and the Jollyboat-data folder next to it stay as they are) and clears the old one
// away. That happens on every quit while an update waits; "click to install" also starts the new
// version. A release without latest-portable.json (before 0.4.5) keeps the old notice.
//
// The script is started through WMI (Win32_Process.Create), not as a child of the app: a child
// would go down with the app and its launcher (CI showed a detached child never getting to run),
// a process WMI creates belongs to nobody of ours. Quitting waits the moment that takes.

import { app, net } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { log } from './log';

// (tests: JOLLYBOAT_UPDATE_BASE points at a local copy of a release)
const DOWNLOADS = process.env.JOLLYBOAT_UPDATE_BASE || 'https://github.com/innovativefluid/jollyboat/releases/download';

type TPortableInfo = { version: string; files: { arch: string; name: string; size: number; sha512: string }[] };

/** the portable exe this app runs from (the launcher that unpacked it), or null */
export const portableFile = () => (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) || null;

/** leftovers of an update: an old exe the last swap could not clear, an unfinished download */
export const cleanPortableLeftovers = () => {
  const exe = portableFile();
  if (!exe) return;
  const dir = dirname(exe);
  const name = basename(exe);
  try {
    for (const f of readdirSync(dir)) {
      const leftover = f === `${name}.old` || f === `${name}.download` || (f.startsWith(`${name}.old.`) && /^\d+$/.test(f.slice(name.length + 5)));
      if (leftover) {
        try {
          rmSync(join(dir, f), { force: true });
          log('portable-update', 'cleared', f);
        } catch (err) {
          log('portable-update', 'could not clear', f, (err as Error).message);
        }
      }
    }
  } catch {
    /* the folder cannot be read: nothing to do */
  }
};

/** the signer of a file and whether its signature holds (powershell's Get-AuthenticodeSignature) */
const signatureOf = (file: string) =>
  new Promise<{ status: string; subject: string }>((resolve) => {
    const quoted = file.replace(/'/g, "''");
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${quoted}'; "$($s.Status)"; "$($s.SignerCertificate.Subject)"`],
      { windowsHide: true, timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve({ status: 'Unknown', subject: '' });
        const [status = 'Unknown', subject = ''] = stdout.split(/\r?\n/).map((l) => l.trim());
        resolve({ status, subject });
      }
    );
  });

/** the new file must be signed like the running one (a running unsigned build takes any) */
const checkSignature = async (current: string, next: string) => {
  const now = await signatureOf(current);
  if (now.status !== 'Valid') return;
  const then = await signatureOf(next);
  if (then.status !== 'Valid') throw new Error(`the download is not signed (${then.status.toLowerCase()})`);
  if (then.subject !== now.subject) throw new Error('the download is signed by someone else');
};

/** the new exe, checked, waiting for the app to quit */
export const pendingFile = (exe: string) => `${exe}.update`;

/** the swap, run after the app quits: waits (up to a minute) until the launcher lets go of the
 *  exe, puts it aside, moves the update into its place, clears the old one away; and with
 *  `start`, starts the new version */
export const swapAfterQuit = (exe: string, start: boolean): Promise<string> => {
  const q = (p: string) => `'${p.replace(/'/g, "''")}'`;
  const name = basename(exe);
  // (a script file, not a -Command line: powershell takes a file as it is)
  const dir = app.getPath('userData');
  const file = join(dir, 'update-swap.ps1');
  const logFile = join(dir, 'update-swap.log');
  const script = [
    `$exe = ${q(exe)}; $upd = ${q(pendingFile(exe))}; $old = ${q(`${exe}.old`)}; $log = ${q(logFile)}`,
    'function Say($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $m" }',
    "Say 'waiting for the exe'",
    "if (-not (Test-Path -LiteralPath $upd)) { Say 'no update waiting'; exit }",
    '$moved = $false',
    'for ($i = 0; $i -lt 120; $i++) {',
    '  try {',
    '    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction Stop }',
    `    Rename-Item -LiteralPath $exe -NewName ${q(`${name}.old`)} -ErrorAction Stop`,
    '    $moved = $true',
    '    break',
    '  } catch { $last = $_.Exception.Message; Start-Sleep -Milliseconds 500 }',
    '}',
    'if (-not $moved) { Say "the exe stayed busy: $last"; exit }',
    'try {',
    `  Rename-Item -LiteralPath $upd -NewName ${q(name)} -ErrorAction Stop`,
    "  Say 'swapped'",
    '} catch {',
    '  Say "could not move the update in: $($_.Exception.Message)"',
    `  Rename-Item -LiteralPath $old -NewName ${q(name)}`,
    '  exit',
    '}',
    'for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath $old); $i++) { try { Remove-Item -LiteralPath $old -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 } }',
    start ? "Say 'starting the new version'; Start-Process -FilePath $exe" : ''
  ].join('\r\n');
  writeFileSync(file, `${script}\r\n`);
  const q2 = (p: string) => p.replace(/'/g, "''");
  const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${file}"`;
  const launcher = [
    '$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }',
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${q2(command)}'; CurrentDirectory = '${q2(dir)}'; ProcessStartupInformation = $si }`,
    '"$($r.ReturnValue) $($r.ProcessId)"'
  ].join('; ');
  return new Promise<string>((resolve) =>
    // (encoded: no quoting on the way through the command line)
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000 }, (err, stdout) => {
      const result = err ? `failed: ${err.message}` : stdout.trim().startsWith('0 ') ? 'started' : `failed: ${stdout.trim()}`;
      log('portable-update', 'swap after quit', start ? '(and start)' : '', result);
      resolve(result);
    })
  );
};

/** the new release's portable exe for this architecture, or null when that release has none */
export const portableInfo = async (version: string) => {
  const res = await net.fetch(`${DOWNLOADS}/v${version}/latest-portable.json`, { signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`http ${res.status}`);
  const info = (await res.json()) as TPortableInfo;
  if (info.version !== version) throw new Error('latest-portable.json is for another version');
  return info.files.find((f) => f.arch === process.arch && /^Jollyboat-[\d.]+-windows-(x64|arm64)-portable\.exe$/.test(f.name)) ?? null;
};

/** download, check and put in place; resolves when the new version waits for a restart */
export const downloadPortable = async (version: string, file: { name: string; size: number; sha512: string }) => {
  const exe = portableFile();
  if (!exe) throw new Error('not a portable copy');
  const part = `${exe}.download`;
  const res = await net.fetch(`${DOWNLOADS}/v${version}/${file.name}`, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`download: http ${res.status}`);
  const hash = createHash('sha512');
  let size = 0;
  const out = createWriteStream(part);
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.length;
      if (size > file.size) throw new Error('download is larger than announced');
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (size !== file.size) throw new Error('download is incomplete');
    if (hash.digest('base64') !== file.sha512) throw new Error('download does not match its checksum');
    await checkSignature(exe, part);
    rmSync(pendingFile(exe), { force: true });
    renameSync(part, pendingFile(exe));
    log('portable-update', 'ready', version);
  } catch (err) {
    out.destroy();
    rmSync(part, { force: true });
    throw err;
  }
};

// the swap is on its way (from "click to install"): the quit does not start another
let swapStarted = false;

/** an update waits: on quit the files trade places (registered once, at start); the quit waits
 *  until the swap script is on its way */
export const swapOnQuit = () => {
  const exe = portableFile();
  if (!exe) return;
  app.on('will-quit', (e) => {
    if (swapStarted || !existsSync(pendingFile(exe))) return;
    swapStarted = true;
    e.preventDefault();
    void swapAfterQuit(exe, false).finally(() => app.quit());
  });
};

/** "click to install": quit, and the swap starts the new version */
export const restartPortable = () => {
  const exe = portableFile();
  if (!exe || !existsSync(pendingFile(exe))) return;
  swapStarted = true;
  void swapAfterQuit(exe, true).finally(() => app.quit());
};
