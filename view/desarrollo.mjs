// Servidor de desarrollo con recarga en caliente.
// Sirve view/ tal como está en disco y view/dist/parquet en /parquet/ (generados por view/preparar.py).
// Cambios en CSS: se recarga la hoja sin recargar la página.
// Cambios en HTML, JS o parquet: se recarga la página.
// Uso: node view/desarrollo.mjs [puerto=8080] [latencia_parquet_ms=0]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const raiz = aquí;                          // sitio
const parquet = path.resolve(aquí, 'dist', 'parquet');
const puerto = Number(process.argv[2] ?? 8080);
// Latencia artificial (ms) para las respuestas de parquet, útil para probar indicadores de carga
const latencia = Number(process.argv[3] ?? 0);

const tipos = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.parquet': 'application/octet-stream',
};

const cliente = `
<script>
  (() => {
    const eventos = new EventSource('/__recargar');
    eventos.onmessage = (e) => {
      if (e.data === 'css') {
        const ts = Date.now();
        for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
          const url = new URL(l.href);
          url.searchParams.set('v', ts);
          l.href = url.toString();
        }
      } else {
        location.reload();
      }
    };
  })();
</script>`;

// Clientes conectados para avisarles de los cambios
const clientes = new Set();
function manejar(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__recargar') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }

  let archivo;
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/parquet/')) archivo = path.join(parquet, p.slice('/parquet/'.length));
  else {
    if (p.endsWith('/')) p += 'index.html';
    archivo = path.join(raiz, p);
  }
  const permitido = archivo.startsWith(parquet) || archivo.startsWith(raiz);
  if (!permitido) { res.writeHead(403); return res.end(); }

  fs.stat(archivo, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('no encontrado'); }
    const cabeceras = {
      'Content-Type': tipos[path.extname(archivo)] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (path.extname(archivo) === '.html') {
      fs.readFile(archivo, 'utf8', (e, html) => {
        const salida = html.replace('</body>', `${cliente}\n</body>`);
        res.writeHead(200, { ...cabeceras, 'Content-Length': Buffer.byteLength(salida) });
        res.end(salida);
      });
      return;
    }
    const rango = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (rango) {
      const inicio = rango[1] ? Number(rango[1]) : st.size - Number(rango[2]);
      const fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), st.size - 1) : st.size - 1;
      if (inicio > fin || inicio >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...cabeceras, 'Content-Range': `bytes ${inicio}-${fin}/${st.size}`, 'Content-Length': fin - inicio + 1 });
      return fs.createReadStream(archivo, { start: inicio, end: fin }).pipe(res);
    }
    res.writeHead(200, { ...cabeceras, 'Content-Length': st.size });
    fs.createReadStream(archivo).pipe(res);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (latencia > 0 && url.pathname.startsWith('/parquet/')) {
    setTimeout(() => manejar(req, res), latencia);
  } else {
    manejar(req, res);
  }
}).listen(puerto, () => console.log(`Desarrollo: http://localhost:${puerto}  (sitio: ${raiz}, datos: ${parquet}, latencia parquet: ${latencia} ms)`));

// Vigilancia de cambios por sondeo de fechas de modificación (cada 250 ms).
// No depende de fs.watch, que no recibe eventos en algunos sistemas de archivos
// (redes, contenedores, WSL). Solo mira view/ y view/dist/parquet.
function listarVigilados() {
  const archivos = new Map();
  const recorrer = (dir, recursivo) => {
    for (const nombre of fs.readdirSync(dir, { withFileTypes: true })) {
      if (nombre.name.startsWith('.') || nombre.name.startsWith('dist') || nombre.name.endsWith('~')) continue;
      const ruta = path.join(dir, nombre.name);
      if (nombre.isDirectory()) { if (recursivo) recorrer(ruta, true); continue; }
      if (dir === parquet && !/\.(json|parquet)$/.test(nombre.name)) continue;
      archivos.set(ruta, true);
    }
  };
  recorrer(raiz, true);
  recorrer(parquet, true);
  return archivos;
}

const marcas = new Map();
for (const ruta of listarVigilados().keys()) {
  try { marcas.set(ruta, fs.statSync(ruta).mtimeMs); } catch { /* desaparecido */ }
}

setInterval(() => {
  const cambiados = [];
  const actuales = listarVigilados();
  for (const ruta of actuales.keys()) {
    let m;
    try { m = fs.statSync(ruta).mtimeMs; } catch { continue; }
    if (marcas.get(ruta) !== m) { marcas.set(ruta, m); cambiados.push(ruta); }
  }
  for (const ruta of [...marcas.keys()]) if (!actuales.has(ruta)) marcas.delete(ruta);
  if (!cambiados.length) return;
  const recargarPagina = cambiados.some((r) => !r.endsWith('.css'));
  const tipo = recargarPagina ? 'pagina' : 'css';
  for (const c of clientes) c.write(`data: ${tipo}\n\n`);
  console.log(`recargado (${tipo}): ${cambiados.map((r) => path.basename(r)).join(', ')} clientes=${clientes.size}`);
}, 250);
