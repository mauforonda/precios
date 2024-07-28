#!/usr/bin/env python3

import requests
import pandas as pd
import re
import datetime as dt
from pytz import timezone
import os
from time import time

requests.packages.urllib3.disable_warnings()

# Las sucursales con el id más bajo (probablemente de mayor antigüedad en cada ciudad)
sucursales_representativas = {
    "la_paz": 32,  # Calacoto
    "cochabamba": 47,  # Juan de la Rosa
    "santa_cruz": 57,  # Cañoto
}
hipermaxi = "data/hipermaxi"


def construirHeaders():
    def conseguirMain():
        response = requests.get("https://tienda.hipermaxi.com", verify=False)
        js = re.findall(r"src=\"\/static\/js\/(main.+\.js)\">", response.text)[0]
        response = requests.get(
            f"https://tienda.hipermaxi.com/static/js/{js}", verify=False
        )
        return response.text

    def conseguirToken():
        response = requests.put(
            "https://tienda-api.hipermaxi.com/api/v1/CuentasMarket/Anonimo-Por-Token",
            verify=False,
        )
        return [response.json()["Dato"][i] for i in ["Codigo", "Token"]]

    def conseguirAplicacion():
        main = conseguirMain()
        return [
            re.findall(rf"{variable}:\"([^\"]*)\"", main)[0]
            for variable in [
                "REACT_APP_CUENTA",
                "REACT_APP_APLICACION",
                "REACT_APP_PASSWORD",
                "REACT_APP_GRANT_TYPE",
            ]
        ]

    print("preparando sesión ...")
    codigo, token = conseguirToken()
    cuenta, aplicacion, password, grant_type = conseguirAplicacion()
    response = requests.post(
        "https://tienda-api.hipermaxi.com/token",
        data=dict(
            grant_type=grant_type,
            aplicacion=aplicacion,
            cuenta=cuenta,
            password=password,
            CodigoAcceso=codigo,
            Token=token,
        ),
        verify=False,
    )
    bearer = response.json()["access_token"]
    return dict(
        authorization=f"Bearer {bearer}",
        origin="https://tienda.hipermaxi.com",
        referer="https://tienda.hipermaxi.com",
    )


def actualizarSucursales(sesion):
    def listarRegiones(sesion):
        response = sesion.get(
            "https://tienda-api.hipermaxi.com/api/v1/markets/ciudades"
        )
        return {r["IdRegion"]: r["Nombre"] for r in response.json()["Dato"]}

    def listarSucursales(sesion):
        params = dict(IdMarket="0", IdTipoServicio="0")
        response = sesion.get(
            "https://tienda-api.hipermaxi.com/api/v1/markets/activos", params=params
        )
        return pd.DataFrame(
            [
                {
                    nombre: sucursal[campo]
                    for campo, nombre in zip(
                        ["IdMarket", "Descripcion", "IdRegion"],
                        ["id_sucursal", "sucursal", "id_region"],
                    )
                }
                for sucursal in response.json()["Dato"]
            ]
        )

    print("consultando sucursales ...")
    regiones = listarRegiones(sesion)
    sucursales = listarSucursales(sesion)
    sucursales["region"] = sucursales["id_region"].map(regiones)
    sucursales.to_csv(f"{hipermaxi}/sucursales.csv", index=False)


def consultarPrecios(sesion, sucursal):
    def consultarCategorias(sesion, sucursal):
        response = sesion.get(
            "https://tienda-api.hipermaxi.com/api/v1/markets/clasificaciones",
            params=dict(IdMarket=sucursal, IdSucursal=sucursal),
        )
        categorias = []
        for grupo in response.json()["Dato"]:
            for categoria in grupo["Categorias"]:
                for subcategoria in categoria["SubCategorias"]:
                    categorias.append(
                        dict(
                            id_categoria=categoria["IdCategoria"],
                            categoria=categoria["Descripcion"],
                            id_subcategoria=subcategoria["IdSubcategoria"],
                            subcategoria=subcategoria["Descripcion"],
                        )
                    )
        return categorias

    categorias = consultarCategorias(sesion, sucursal)
    data = []
    for subcategoria in categorias:
        print(f"{subcategoria['categoria']} - {subcategoria['subcategoria']}")
        categoria_data = []
        pagina = 1
        while True:
            response = sesion.get(
                "https://tienda-api.hipermaxi.com/api/v1/productos",
                params={
                    "IdMarket": sucursal,
                    "IdCategoria": subcategoria["id_categoria"],
                    "IdsSubcategoria[0]": subcategoria["id_subcategoria"],
                    "Pagina": pagina,
                    "Cantidad": 50,
                },
            )
            listado = response.json()["Dato"]
            if listado:
                categoria_data.extend(
                    [
                        {
                            nombre: producto[campo]
                            for campo, nombre in zip(
                                [
                                    "IdProducto",
                                    "Descripcion",
                                    "PrecioVenta",
                                    "PrecioOriginal",
                                ],
                                ["id_producto", "producto", "precio", "original"],
                            )
                        }
                        for producto in listado
                    ]
                )
                pagina += 1
            else:
                break
        data.extend(
            [
                {
                    **dict(
                        categoria=subcategoria["categoria"],
                        subcategoria=subcategoria["subcategoria"],
                    ),
                    **producto,
                }
                for producto in categoria_data
            ]
        )
    precios = pd.DataFrame(data)
    precios.loc[:, "oferta"] = (precios.original > 0) * 1
    return precios[["categoria", "subcategoria", "id_producto", "producto", "precio", "oferta"]]


def consolidar(precios, ciudad):
    def consolidarProductos(precios):
        columnas = ["id_producto", "producto", "categoria", "subcategoria"]
        path_productos = f"{hipermaxi}/productos.csv"
        if os.path.exists(path_productos):
            productos = pd.concat([pd.read_csv(path_productos), precios[columnas]])
        else:
            productos = precios[columnas].copy()
        productos["id_producto"] = productos.id_producto.astype(int)
        productos.drop_duplicates(subset=["id_producto"], keep="last").sort_values(
            "id_producto"
        ).to_csv(path_productos, index=False)

    def consolidarPrecios(precios, ciudad):
        columnas = ["fecha", "id_producto", "precio", "oferta"]
        hoy = dt.datetime.now(timezone("America/La_Paz")).date()
        path_precios = f"{hipermaxi}/{ciudad}/{hoy.strftime("%Y_%m")}.csv"
        precios.insert(0, "fecha", pd.to_datetime(hoy))
        if os.path.exists(path_precios):
            tabla = pd.concat(
                [pd.read_csv(path_precios, parse_dates=["fecha"]), precios[columnas]]
            )
        else:
            tabla = precios[columnas].copy()
        tabla["fecha"] = pd.to_datetime(tabla.fecha)
        tabla["id_producto"] = tabla.id_producto.astype(int)
        tabla.sort_values(["fecha", "id_producto"]).to_csv(path_precios, index=False)

    consolidarProductos(precios)
    consolidarPrecios(precios, ciudad)


def main():
    inicio = time()
    headers = construirHeaders()
    with requests.Session() as sesion:
        sesion.headers.update(headers)
        sesion.verify = False
        sucursales = actualizarSucursales(sesion)
        for ciudad, sucursal in sucursales_representativas.items():
            print(f"\nconsultando precios en {ciudad} ...\n")
            precios = consultarPrecios(sesion, sucursal)
            consolidar(precios, ciudad)
    print(f"Duración: {time() - inicio} segundos")


if __name__ == "__main__":
    main()
