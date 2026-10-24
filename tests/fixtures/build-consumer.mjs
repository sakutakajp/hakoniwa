import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const source = fileURLToPath(new URL('./consumer/', import.meta.url));
const layer = fileURLToPath(new URL('../../', import.meta.url));
const target = resolve(process.env.LAYER_CONSUMER_DIR || join(tmpdir(), 'hakoniwa-consumer-nuxt3'));
const marker = join(target, '.hakoniwa-consumer-fixture');
const cache = process.env.npm_config_cache || join(tmpdir(), 'hakoniwa-npm-cache');

// A separate project + an installed tarball models a downloaded layer, catches
// omitted package files, and cannot accidentally reuse this checkout's Nuxt.
if (target === resolve(source) || target.startsWith(resolve(layer) + '/')) {
  throw new Error('LAYER_CONSUMER_DIR must be outside the layer checkout.');
}
let entries = [];
try { entries = await readdir(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (entries.length && await readFile(marker, 'utf8').catch(() => '') !== layer) {
  throw new Error(`Refusing to overwrite an unrelated directory: ${target}`);
}
await mkdir(target, { recursive: true });
await writeFile(marker, layer);
for (const entry of await readdir(source)) {
  if (['node_modules', '.nuxt', '.output'].includes(entry)) continue;
  await cp(join(source, entry), join(target, entry), { recursive: true });
}
const archiveDir = await mkdtemp(join(tmpdir(), 'hakoniwa-layer-package-'));
const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--cache', cache, '--json', '--pack-destination', archiveDir], {
  cwd: layer, encoding: 'utf8', env: process.env,
});
if (packed.error) throw packed.error;
if (packed.status !== 0) { process.stderr.write(packed.stderr); process.exit(packed.status || 1); }
const archive = join(archiveDir, JSON.parse(packed.stdout)[0].filename);
const installedLayer = join(target, 'node_modules/@sakutakajp/hakoniwa');
const env = { ...process.env, HAKONIWA_LAYER_ROOT: installedLayer };
for (const args of [
  ['ci', '--ignore-scripts', '--cache', cache],
  ['install', '--no-save', '--ignore-scripts', '--cache', cache, archive],
]) {
  const result = spawnSync('npm', args, { cwd: target, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const requireFromConsumer = createRequire(join(target, 'package.json'));
for (const [name, expected] of Object.entries({ nuxt: '3.14.1592', vue: '3.5.13', 'vue-router': '4.4.5', nitropack: '2.10.4', vite: '5.4.14' })) {
  const actual = requireFromConsumer(`${name}/package.json`).version;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, received ${actual}`);
}
for (const script of ['build', 'typecheck']) {
  const result = spawnSync('npm', ['run', script], { cwd: target, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Builds must write to the consumer, never into the installed layer package.
for (const path of ['.nuxt', '.output', 'public/ja/hakoniwa/exhibits']) {
  if (await readdir(join(installedLayer, path)).then(() => true, () => false)) {
    throw new Error(`Generated output leaked into installed package: ${path}`);
  }
}
console.log(`Verified installed Nuxt 3 layer: ${archive}\nConsumer: ${target}`);
