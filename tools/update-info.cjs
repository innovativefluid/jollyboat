// The update files of a windows build, from the files as they are now.
//
//   - every installer with a .blockmap next to it: its blockmap built again, and its entry in
//     latest.yml (sha512, size; the top-level path / sha512 too) set to the file as it is
//   - latest-portable.json: the portable exes (one per architecture) with size and sha512, read
//     by portable copies when they update themselves (src/main/portable-update.ts)
//
//   node tools/update-info.cjs [dist]

const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

const dir = process.argv[2] || 'dist';
const sha512 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64');

const main = async () => {
  const latestPath = join(dir, 'latest.yml');
  if (existsSync(latestPath)) {
    const latest = yaml.load(readFileSync(latestPath, 'utf8'));
    for (const entry of latest.files ?? []) {
      const file = join(dir, entry.url);
      if (!existsSync(file)) throw new Error(`latest.yml names ${entry.url}, which is not in ${dir}`);
      const info = existsSync(`${file}.blockmap`) ? await buildBlockMap(file, 'gzip', `${file}.blockmap`) : { sha512: sha512(file), size: statSync(file).size };
      if (info.sha512 !== sha512(file)) throw new Error(`blockmap of ${entry.url}: checksum differs from the file`);
      const changed = entry.sha512 !== info.sha512;
      entry.sha512 = info.sha512;
      entry.size = info.size;
      if (entry.blockMapSize !== undefined && info.blockMapSize !== undefined) entry.blockMapSize = info.blockMapSize;
      if (latest.path === entry.url) latest.sha512 = info.sha512;
      console.log(`${entry.url}: ${info.size} bytes${changed ? ' (changed since the build)' : ''}`);
    }
    writeFileSync(latestPath, yaml.dump(latest, { lineWidth: 8000 }));
  }

  const version = require(join(process.cwd(), 'package.json')).version;
  const files = readdirSync(dir)
    .map((name) => ({ name, m: /^Jollyboat-(\d+\.\d+\.\d+)-windows-(x64|arm64)-portable\.exe$/.exec(name) }))
    .filter(({ m }) => m && m[1] === version)
    .map(({ name, m }) => {
      const file = join(dir, name);
      return { arch: m[2], name, size: statSync(file).size, sha512: sha512(file) };
    });
  if (files.length) {
    writeFileSync(join(dir, 'latest-portable.json'), `${JSON.stringify({ version, files }, null, 2)}\n`);
    for (const f of files) console.log(`${f.name}: ${f.size} bytes (latest-portable.json)`);
  }
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
