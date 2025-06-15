#!/usr/bin/env python

import json
import requests
import base64
from time import sleep
import datetime as dt
from pytz import timezone
import pandas as pd

from utils.general import crearSesion, saveProductos

PRODUCTOS = "productos.csv"
PRECIOS = "precios"
TIMEOUT = 10
HOY = dt.datetime.now(timezone("America/La_Paz")).date()


def getPagina(sesion, categoryId, offset, pageSize):
    def parseProduct(p):
        return dict(
            id_producto=p["productId"],
            producto=p["productName"],
            proveedor=p["brand"],
            categoria=p["categories"][0],
            precio=p["items"][0]["sellers"][0]["commertialOffer"]["Price"],
        )

    url = "https://www.multicenter.com/_v/segment/graphql/v1"

    variables = {
        "hideUnavailableItems": False,
        "skusFilter": "ALL",
        "simulationBehavior": "skip",
        "installmentCriteria": "MAX_WITHOUT_INTEREST",
        "productOriginVtex": True,
        "map": "category-1",
        "query": str(categoryId),
        "orderBy": "OrderByNameASC",
        "from": offset,
        "to": offset + pageSize - 1,
        "selectedFacets": [{"key": "category-1", "value": str(categoryId)}],
        "facetsBehavior": "Static",
        "categoryTreeBehavior": "default",
        "withFacets": False,
    }

    extensions = {
        "persistedQuery": {
            "version": 1,
            "sha256Hash": "e48b7999b5713c9ed7d378bea1bd1cf64c81080be71d91e0f0b427f41e858451",
            "sender": "vtex.store-resources@0.x",
            "provider": "vtex.search-graphql@0.x",
        },
        "variables": base64.b64encode(json.dumps(variables).encode("utf-8")).decode(
            "utf-8"
        ),
    }

    params = {
        "workspace": "master",
        "maxAge": "short",
        "appsEtag": "remove",
        "domain": "store",
        "locale": "es-BO",
        "operationName": "productSearchV3",
        "variables": "{}",
        "extensions": json.dumps(extensions),
    }

    RETRIES = 5

    response = requests.get(url, params=params)

    for attempt in range(RETRIES):
        response = sesion.get(url, params=params, timeout=TIMEOUT)
        try:
            responseData = response.json()
            total = responseData["data"]["productSearch"]["recordsFiltered"]
            productos = [
                parseProduct(producto)
                for producto in responseData["data"]["productSearch"]["products"]
            ]
            return [productos, total]
        except Exception as e:
            print(f"{e}: {response.text}")
            if attempt < RETRIES:
                sleep(5)
            else:
                raise Exception("unavailable source")


def getCategoria(sesion, categoryId, pageSize=50):
    offset = 0
    productos = []

    while True:
        page, total = getPagina(sesion, categoryId, offset, pageSize)
        productos.extend(page)
        print(f"{len(productos)} / {total} productos")
        if len(productos) >= total:
            break
        offset += pageSize
    return productos


def getProductos():
    url = "https://www.multicenter.com/api/catalog_system/pub/category/tree/1"
    response = requests.get(url)
    categorias = [
        dict(categoryId=cat["id"], categoryName=cat["name"]) for cat in response.json()
    ]

    data = []

    with crearSesion() as sesion:
        for categoria in categorias:
            print(f"{categoria['categoryName']}")
            cat = getCategoria(sesion, categoria["categoryId"])
            data.extend(cat)

    return data

def organize(productos):
    df = pd.DataFrame(productos)
    df.drop_duplicates(subset=["id_producto"])
    df["id_producto"] = df["id_producto"].astype(int)
    precios = df[["id_producto", "precio"]].copy()
    precios["precio"] = precios["precio"].astype(float)
    precios.insert(0, "fecha", HOY)
    definiciones = df[["id_producto", "producto", "proveedor", "categoria"]].copy()
    return precios, definiciones


productos = getProductos()
precios, definiciones = organize(productos)
saveProductos(
  dataDirectory="data/multicine",
  precios=precios,
  preciosPath="precios",
  definiciones=definiciones,
  definicionesPath="productos.csv",
  hoy=HOY
)