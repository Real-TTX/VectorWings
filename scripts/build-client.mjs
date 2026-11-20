// Bundles the browser part of VectorWings (src/client → wwwroot/vendor/flight-bundle.js).
// The MatGame SDK is copied from the neighbouring MatGame repository first, the bundle imports it from there.
import { build, context } from 'esbuild';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const matgame = new URL('../../MatGame/sdk/js/', import.meta.url);
const output = new URL('../src/VectorWings.Module/wwwroot/', import.meta.url);
const sdk = new URL('matgame/', output);
const watch = process.argv.includes('--watch');

await mkdir(sdk, { recursive: true });
for (const name of await readdir(matgame)) {
    if (name.endsWith('.js')) await copyFile(new URL(name, matgame), new URL(name, sdk));
}

const options = {
    absWorkingDir: root,
    entryPoints: { 'flight-bundle': 'src/client/main.js' },
    outdir: fileURLToPath(new URL('vendor/', output)),
    bundle: true,
    format: 'esm',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    target: ['es2022'],
    legalComments: 'inline',
    logLevel: 'info'
};

if (watch) {
    const ctx = await context(options);
    await ctx.watch();
} else {
    await build(options);
}

await copyFile(new URL('../node_modules/@babylonjs/core/license.md', import.meta.url),
    new URL('vendor/BabylonJS-LICENSE.txt', output)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
});
