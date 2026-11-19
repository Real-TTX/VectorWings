import { build } from 'esbuild';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const matgame = new URL('../../MatGame/sdk/js/', import.meta.url);
const output = new URL('../src/VectorWings.Module/wwwroot/', import.meta.url);
const sdk = new URL('matgame/', output);
await mkdir(sdk, { recursive: true });
for (const name of await readdir(matgame)) {
    if (name.endsWith('.js')) await copyFile(new URL(name, matgame), new URL(name, sdk));
}
await build({
    absWorkingDir: root,
    entryPoints: { 'flight-bundle': 'src/client/renderer.js', 'signalr-bundle': '@microsoft/signalr' },
    outdir: fileURLToPath(new URL('vendor/', output)),
    bundle: true,
    format: 'esm',
    minify: true,
    legalComments: 'inline'
});
await copyFile(new URL('../node_modules/@babylonjs/core/license.md', import.meta.url),
    new URL('vendor/BabylonJS-LICENSE.txt', output)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
});
