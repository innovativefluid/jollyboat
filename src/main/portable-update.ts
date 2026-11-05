// The portable exe updates itself. It looks at GitHub's releases like the notice did; a newer
// release with latest-portable.json (written by CI, tools/update-info.cjs) has the new portable
// exe for this architecture with its size and sha512. The exe is downloaded next to the running
// one and checked: the size and sha512 must match, and once our downloads are signed, the new
// file must carry a valid signature from the same publisher as the running one.
//
// Then the files trade places while the app runs: windows lets a running exe be renamed, not
// overwritten. The running file becomes <name>.old, the new one takes its name (so shortcuts and
// the Jollyboat-data folder next to it stay as they are). "click to install" starts the new
// file and quits; the next start clears the .old file away. A release without
// latest-portable.json (before 0.4.5) keeps the old notice.

import { app, net } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { log } from './log';

// (tests: JOLLYBOAT_UPDATE_BASE points at a local copy of a release)
const DOWNLOADS = process.env.JOLLYBOAT_UPDATE_BASE || 'https://github.com/innovativefluid/jollyboat/releases/download';

type TPortableInfo = { version: string; files: { arch: string; name: string; size: number; sha512: string }[] };

/** the portable exe this app runs from (the launcher that unpacked it), or null */
export const portableFile = () => (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) || null;

/** leftovers of an update: the old exe (it ran until the last quit) and an unfinished download */
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

/** the running exe aside, the new file in its place */
export const swapPortable = (exe: string, next: string) => {
  let old = `${exe}.old`;
  // an .old file still there (its process did not let go): the next free number
  for (let i = 1; existsSync(old); i++) {
    try {
      rmSync(old, { force: true });
    } catch {
      old = `${exe}.old.${i}`;
    }
  }
  renameSync(exe, old);
  try {
    renameSync(next, exe);
  } catch (err) {
    renameSync(old, exe); // back as it was
    throw err;
  }
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
    swapPortable(exe, part);
    log('portable-update', 'ready', version);
  } catch (err) {
    out.destroy();
    rmSync(part, { force: true });
    throw err;
  }
};

/** start the (new) portable exe once this one has gone, then quit */
export const restartPortable = () => {
  const exe = portableFile();
  if (!exe) return;
  // the launcher of this copy still cleans up after the app quits: the new one starts a moment
  // later, from a powershell that is not tied to us
  const quoted = exe.replace(/'/g, "''");
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Start-Sleep -Seconds 3; Start-Process -FilePath '${quoted}'`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  app.quit();
};
