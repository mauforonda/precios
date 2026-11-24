#!/usr/bin/env python3
"""Arma view/dist con los archivos del sitio.

Los parquet no se copian: los genera view/preparar.py directamente en dist/parquet.
Orden de uso: python view/build.py && python view/preparar.py
"""

import shutil
from pathlib import Path

raiz = Path(__file__).resolve().parent
salida = raiz / "dist"

archivos_sitio = ["index.html", "app.js", "style.css"]

if salida.exists():
    shutil.rmtree(salida)
salida.mkdir()

for f in archivos_sitio:
    shutil.copy2(raiz / f, salida / f)

print(f"Listo: {salida}")
