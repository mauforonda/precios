#!/usr/bin/env python

import requests
import pandas as pd
import datetime as dt
from pytz import timezone
from pathlib import Path
from time import sleep

PRODUCTOS = "productos.csv"
PRECIOS = "precios"
HOY = dt.datetime.now(timezone("America/La_Paz")).date()
TIMEOUT = 10

def getPagina(sesion, domain, pageNum, pageSize=250):
    def parseProducto(p):
        return dict(
            id_producto=p["id"],
            producto=p["title"],
            proveedor=p["vendor"],
            categoria=p["product_type"],
            precio=p["variants"][0]["price"],
        )

    RETRIES = 3
    url = f"{domain}/collections/all/products.json?limit={pageSize}&page={pageNum}"

    for attempt in range(RETRIES):
        try:
            response = sesion.get(url, timeout=TIMEOUT)
            return [parseProducto(producto) for producto in response.json()["products"]]
        except Exception as e:
            print(e)
            if attempt < RETRIES:
                sleep(2)
            else:
                raise Exception("unavailable source")

    return [parseProducto(producto) for producto in response.json()["products"]]

def crearSesion(retries=3):
    sesion = requests.Session()
    sesion.mount("http://", requests.adapters.HTTPAdapter(max_retries=retries))
    sesion.mount("https://", requests.adapters.HTTPAdapter(max_retries=retries))
    return sesion

def getProductos(domain):
    pageSize = 250
    p = 1
    productos = []

    with crearSesion() as sesion:
        while True:
            page = getPagina(sesion, domain, p, pageSize)
            productos.extend(page)
            print(f"{p} consultas: {len(productos)}")
            if len(page) < pageSize:
                break
            p += 1
    return productos


def organize(productos):
    df = pd.DataFrame(productos)
    precios = df[["id_producto", "precio"]].copy()
    precios["precio"] = precios["precio"].astype(float)
    precios.insert(0, "fecha", HOY)
    definiciones = df[["id_producto", "producto", "proveedor", "categoria"]].copy()
    return precios, definiciones

def save(dataDirectory, precios, definiciones):
    print("Guardando ...")
    base = Path(dataDirectory)
    base.mkdir(exist_ok=True)
    def saveDefiniciones(definiciones):
        if (base / PRODUCTOS).exists():
            df = pd.read_csv(base / PRODUCTOS)
            pd.concat([df, definiciones]).drop_duplicates(subset=["id_producto"], keep="last").to_csv(base / PRODUCTOS, index=False)
        else:
            definiciones.to_csv(base / PRODUCTOS, index=False)
    def savePrecios(precios):
        (base / PRECIOS).mkdir(exist_ok=True)
        fn = (base / PRECIOS / HOY.strftime("%Y_%m.csv"))
        if fn.exists():
            df = pd.read_csv(fn, parse_dates=["fecha"])
            pd.concat([df, precios]).to_csv(fn, index=False)
        else:
            precios.to_csv(fn, index=False)
    saveDefiniciones(definiciones)
    savePrecios(precios)

def getShopify(domain, dataDirectory):

  productos = getProductos(domain)
  precios, definiciones = organize(productos)
  save(dataDirectory, precios, definiciones)