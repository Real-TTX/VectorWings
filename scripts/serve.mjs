// Serves the browser part without a MatGame host: http://localhost:<port>/vectorwings/?preview=river
// Used for the visual previews (?preview=<world>&t=<seconds>, ?preview=arena, ?preview=hangar). Online play needs MatGame.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? 2789);
const root = fileURLToPath(new URL('../src/VectorWings.Module/wwwroot/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain' };

createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/vectorwings/')) {
        response.writeHead(302, { Location: '/vectorwings/' + url.search });
        return response.end();
    }
    let path = decodeURIComponent(url.pathname.slice('/vectorwings/'.length)) || 'index.html';
    path = normalize(path).replace(/^([.][.][\\/])+/, '');
    try {
        const body = await readFile(join(root, path));
        response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        response.end(body);
    } catch {
        response.writeHead(404);
        response.end('Not found');
    }
}).listen(port, () => console.log(`VectorWings preview: http://localhost:${port}/vectorwings/?preview=river`));
