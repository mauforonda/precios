#!/usr/bin/env python

import requests
from pathlib import Path
import pandas as pd

def crearSesion(retries=3):
    sesion = requests.Session()
    sesion.mount("http://", requests.adapters.HTTPAdapter(max_retries=retries))
    sesion.mount("https://", requests.adapters.HTTPAdapter(max_retries=retries))
    return sesion

def saveProductos(dataDirectory, precios, preciosPath, definiciones, definicionesPath, hoy):
    print("Guardando ...")
    base = Path(dataDirectory)
    base.mkdir(exist_ok=True)
    def saveDefiniciones(definiciones):
        if (base / definicionesPath).exists():
            df = pd.read_csv(base / definicionesPath)
            pd.concat([df, definiciones]).drop_duplicates(subset=["id_producto"], keep="last").to_csv(base / definicionesPath, index=False)
        else:
            definiciones.to_csv(base / definicionesPath, index=False)
    def savePrecios(precios):
        (base / preciosPath).mkdir(exist_ok=True)
        fn = (base / preciosPath / hoy.strftime("%Y_%m.csv"))
        if fn.exists():
            df = pd.read_csv(fn, parse_dates=["fecha"])
            pd.concat([df, precios]).to_csv(fn, index=False)
        else:
            precios.to_csv(fn, index=False)
    saveDefiniciones(definiciones)
    savePrecios(precios)