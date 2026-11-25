# Visor de precios (view)

Sitio estático del visor. No usa frameworks ni dependencias de build.

Los datos son JSON generados por `preparar.py` en `dist/datos/`. No se guardan en el repositorio: solo existen dentro del sitio publicado.

## Cómo se cargan los datos

GitHub Pages ignora el query string y fija `Cache-Control: max-age=600`. Por eso:

- Cada archivo de datos lleva el hash de su contenido en el nombre (`c3.a72cb4fad9.json`) y nunca cambia. El visor lo pide con `cache: "force-cache"`: no hay revalidaciones.
- `manifiesto.json` es lo único mutable. Apunta a los archivos vigentes y se pide siempre con `no-cache` (ETag, un 304 barato).
- Cada cobertura tiene una **cabeza** (`h<días>.<hash>.json`, ~4 KB: ranking y las filas con más subida y más bajada) y un archivo **completo** (`c<días>.<hash>.json`, ~220 KB gzip en Hipermaxi). La cabeza pinta la tabla al instante; el completo llega en paralelo y habilita búsqueda, filtro por clasificación y orden por columna.
- Una pestaña abierta días revisa el manifiesto sin avisar: al volver a ella, al recuperar la red y, en segundo plano, al hacer una selección (como mucho cada 30 s). Si hay datos nuevos, repinta la selección actual conservando la búsqueda. No hay intervalo ni aviso visible. Si un archivo da 404 o falla, revisa el manifiesto y reintenta.
- `preparar.py --previo <datos anterior>` copia los archivos de las versiones de los últimos 2 días publicadas (`historial.json`). Así una pestaña con un manifiesto viejo, o un CDN que aún sirva el manifiesto viejo, no recibe 404. `publish.yml` lo usa con la rama `gh-pages` y publica con `force_orphan` para que la rama no acumule historial.
- Si cambia el formato de los archivos, se sube `ESQUEMA` en `preparar.py` y en `app.js`. Una página vieja que lo detecta se recarga una vez.

## Archivos

- `index.html`, `app.js`, `style.css`: el visor.
- `desarrollo.mjs`: servidor local con recarga en caliente.
- `build.py`: arma `dist/` con los archivos del sitio.
- `preparar.py`: genera los JSON en `dist/datos/`. Requiere `requirements.txt` y los datos en `data/`. Opciones: `--datos`, `--salida`, `--previo`.
- `requirements.txt`: dependencias de `preparar.py`.

## Desarrollo

```bash
node view/desarrollo.mjs 8090 [latencia_ms]
```

Abre http://localhost:8090. Al guardar CSS, la hoja se recarga sin recargar la página. Al guardar HTML o JS, la página se recarga.

## Build local

```bash
python view/build.py
python view/preparar.py
```

Después, `view/dist/` tiene el sitio completo. Para probarlo, usa `node view/desarrollo.mjs` o cualquier servidor estático.

Para probarlo con las mismas reglas de caché que GitHub Pages (max-age=600, ETag, gzip, query ignorado):

```bash
node view/desarrollo.mjs 8091 0 pages
```
