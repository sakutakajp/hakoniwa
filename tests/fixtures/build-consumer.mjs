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
const mode = process.env.LAYER_PACKAGE_MODE || 'source';
if (!['source', 'npm'].includes(mode)) throw new Error('LAYER_PACKAGE_MODE must be source or npm.');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env: process.env, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  return result.stdout;
}

async function assertCleanLayer(directory) {
  // Nuxt must prepare/build only the consumer, not silently repair the layer.
  for (const path of ['.nuxt', '.output', 'public/ja/hakoniwa/exhibits']) {
    if (await readdir(join(directory, path)).then(() => true, () => false)) {
      throw new Error(`Generated output leaked into consumed layer: ${path}`);
    }
  }
}

// A separate project cannot accidentally reuse this checkout's Nuxt or .nuxt.
// Source archives deliberately contain repository tests/configs, unlike npm files.
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
let archive;
let installedLayer;
if (mode === 'source') {
  let ref = process.env.LAYER_SOURCE_REF;
  if (!ref) {
    // Snapshot current work without touching the user's real Git index. Ignored
    // artifacts are excluded, while new authored files and deletions are included.
    const gitEnv = { ...process.env, GIT_INDEX_FILE: join(archiveDir, 'snapshot-index') };
    run('git', ['read-tree', 'HEAD'], { cwd: layer, env: gitEnv });
    run('git', ['add', '--all', '--', '.'], { cwd: layer, env: gitEnv });
    ref = run('git', ['write-tree'], { cwd: layer, env: gitEnv, encoding: 'utf8' }).trim();
  }
  const tar = run('git', ['archive', '--format=tar', ref], { cwd: layer, maxBuffer: 64 * 1024 * 1024 });
  installedLayer = join(archiveDir, 'source');
  await mkdir(installedLayer);
  run('tar', ['-xf', '-', '-C', installedLayer], { input: tar });
  // This regression check must not accidentally fall back to npm's files list.
  await readFile(join(installedLayer, 'tests/indexing/policy.test.ts'), 'utf8');
  await assertCleanLayer(installedLayer);
  run('npm', ['ci', '--ignore-scripts', '--cache', cache], { cwd: installedLayer, stdio: 'inherit' });
  await assertCleanLayer(installedLayer);
  archive = `git archive ${ref}`;
} else {
  const packed = run('npm', ['pack', '--ignore-scripts', '--cache', cache, '--json', '--pack-destination', archiveDir], {
    cwd: layer, encoding: 'utf8',
  });
  archive = join(archiveDir, JSON.parse(packed)[0].filename);
  installedLayer = join(target, 'node_modules/@sakutakajp/hakoniwa');
}
const env = { ...process.env, HAKONIWA_LAYER_ROOT: installedLayer };
run('npm', ['ci', '--ignore-scripts', '--cache', cache], { cwd: target, env, stdio: 'inherit' });
if (mode === 'npm') {
  run('npm', ['install', '--no-save', '--ignore-scripts', '--cache', cache, archive], { cwd: target, env, stdio: 'inherit' });
}
await assertCleanLayer(installedLayer);
const requireFromConsumer = createRequire(join(target, 'package.json'));
for (const [name, expected] of Object.entries({ nuxt: '3.14.1592', vue: '3.5.13', 'vue-router': '4.4.5', nitropack: '2.10.4', vite: '5.4.14' })) {
  const actual = requireFromConsumer(`${name}/package.json`).version;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, received ${actual}`);
}
// Explicit prepare catches source-archive failures before the production build.
run(process.execPath, ['node_modules/nuxi/bin/nuxi.mjs', 'prepare'], { cwd: target, env, stdio: 'inherit' });
await assertCleanLayer(installedLayer);
for (const script of ['build', 'typecheck']) {
  run('npm', ['run', script], { cwd: target, env, stdio: 'inherit' });
}
await assertCleanLayer(installedLayer);
console.log(`Verified ${mode} Nuxt 3 layer: ${archive}\nLayer: ${installedLayer}\nConsumer: ${target}`);
