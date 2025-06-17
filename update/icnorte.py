#!/usr/bin/env python

from time import sleep
import datetime as dt
from pytz import timezone
import pandas as pd

from utils.general import crearSesion, saveProductos

PRODUCTOS = "productos.csv"
PRECIOS = "precios"
TIMEOUT = 10
HOY = dt.datetime.now(timezone("America/La_Paz")).date()

def getPagina(sesion, offset, pageSize):
    def parseProducto(p):
        return dict(
            id_producto=p["productId"],
            producto=p["productName"],
            proveedor=p["brand"],
            categoria=p["categories"][0],
            precio=p["items"][0]["sellers"][0]["commertialOffer"]["Price"],
        )

    RETRIES = 5
    url = f"https://www.icnorte.com/api/catalog_system/pub/products/search?ft=&O=OrderByNameASC&_from={offset}&_to={offset + pageSize - 1}"

    for attempt in range(RETRIES):
        response = sesion.get(url, timeout=TIMEOUT)
        try:
            return [parseProducto(producto) for producto in response.json()]
        except Exception as e:
            print(f"{e}: {response.text}")
            if attempt < RETRIES:
                sleep(5)
            else:
                raise Exception("unavailable source")

def getProductos(pageSize=30):
    offset = 0
    productos = []

    with crearSesion() as sesion:
        while True:
            page = getPagina(sesion, offset, pageSize)
            productos.extend(page)
            print(f"{len(productos)} productos")
            if len(page) < pageSize:
                break
            offset += pageSize
            sleep(1)
    return productos

def organize(productos):
    df = pd.DataFrame(productos)
    precios = df[["id_producto", "precio"]].copy()
    precios["precio"] = precios["precio"].astype(float)
    precios.insert(0, "fecha", HOY)
    definiciones = df[[
        "id_producto", "producto", "proveedor", "categoria"
    ]].sort_values('id_producto').copy()
    return precios, definiciones

productos = getProductos()
precios, definiciones = organize(productos)
saveProductos(
  dataDirectory="data/icnorte",
  precios=precios,
  preciosPath="precios",
  definiciones=definiciones,
  definicionesPath="productos.csv",
  hoy=HOY
)
