#!/usr/bin/env python3
"""Arma view/dist con los archivos del sitio.

Los datos no se copian: los genera view/preparar.py directamente en dist/datos.
Orden de uso: python view/build.py && python view/preparar.py
"""

import shutil
from datetime import datetime
from pathlib import Path

raiz = Path(__file__).resolve().parent
salida = raiz / "dist"

archivos_sitio = ["index.html", "app.js", "style.css"]

if salida.exists():
    shutil.rmtree(salida)
salida.mkdir()

for f in archivos_sitio:
    shutil.copy2(raiz / f, salida / f)

# Versión en app.js y style.css: el navegador y Pages no mezclan archivos de publicaciones distintas
version = datetime.now().strftime("%Y%m%d%H%M%S")
html = (salida / "index.html").read_text(encoding="utf-8")
for archivo in ["app.js", "style.css"]:
    html = html.replace(f'"{archivo}"', f'"{archivo}?v={version}"')
(salida / "index.html").write_text(html, encoding="utf-8")

print(f"Listo: {salida}")
