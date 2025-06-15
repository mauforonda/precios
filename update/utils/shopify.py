#!/usr/bin/env python

import requests
import pandas as pd
import datetime as dt
from pytz import timezone
from pathlib import Path
from time import sleep

from utils.general import crearSesion, saveProductos

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

    RETRIES = 5
    url = f"{domain}/collections/all/products.json?limit={pageSize}&page={pageNum}"

    for attempt in range(RETRIES):
        response = sesion.get(url, timeout=TIMEOUT)
        try:
            return [parseProducto(producto) for producto in response.json()["products"]]
        except requests.exceptions.JSONDecodeError:
            print(response.text)
            if attempt < RETRIES:
                sleep(5)
            else:
                raise Exception("unavailable source")

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
            sleep(1)
    return productos


def organize(productos):
    df = pd.DataFrame(productos)
    precios = df[["id_producto", "precio"]].copy()
    precios["precio"] = precios["precio"].astype(float)
    precios.insert(0, "fecha", HOY)
    definiciones = df[["id_producto", "producto", "proveedor", "categoria"]].copy()
    return precios, definiciones

def getShopify(domain, dataDirectory):

  productos = getProductos(domain)
  precios, definiciones = organize(productos)
  saveProductos(dataDirectory, precios, PRECIOS, definiciones, PRODUCTOS, HOY)