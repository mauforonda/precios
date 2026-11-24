# Visor de precios (view)

Sitio estático del visor. No usa frameworks ni dependencias de build.

Los datos son parquet generados por `preparar.py` directamente en `dist/parquet/`. No se guardan en el repositorio: solo existen dentro del sitio publicado.

## Archivos

- `index.html`, `app.js`, `style.css`: el visor.
- `desarrollo.mjs`: servidor local con recarga en caliente.
- `build.py`: arma `dist/` con los archivos del sitio.
- `preparar.py`: genera los parquet en `dist/parquet/`. Requiere `requirements.txt` y los datos en `data/`.
- `requirements.txt`: dependencias de `preparar.py`.

## Desarrollo

```bash
node view/desarrollo.mjs 8090
```

Abre http://localhost:8090. Al guardar CSS, la hoja se recarga sin recargar la página. Al guardar HTML o JS, la página se recarga.

## Build local

```bash
python view/build.py
python view/preparar.py
```

Después, `view/dist/` tiene el sitio completo, con sus parquet. Para probarlo, usa `node view/desarrollo.mjs` o cualquier servidor que soporte `Range` (los parquet se leen por rangos).
