#!/usr/bin/env python3
"""Convierte los precios diarios en parquet listos para el visor.

Navegación: supermercado -> ciudad (si aplica) -> cobertura -> clasificación/búsqueda.

Salida (dentro del sitio, view/dist/parquet, que es lo único que se publica):
  supermercado=<s>/ciudad=<c>/cambios.parquet   filas de productos
  supermercado=<s>/ciudad=<c>/ranking.parquet   clasificaciones con más variación
  manifiesto.json

Orden de filas en cambios.parquet: cobertura en orden creciente de días; dentro
de cada cobertura, cambio descendente. Elegir una cobertura es leer un rango
contiguo de filas (rowStart/rowEnd en manifiesto.json).

Ranking: por cobertura y por tipo de clasificación (categoria, subcategoria,
proveedor), promedio del valor absoluto del cambio de precio de los productos (para elegir) y promedio con signo (para ordenar)
de cada grupo. Solo grupos con al menos MIN_PRODUCTOS y solo los TOP_GRUPOS
primeros. Es lo único que el visor descarga antes de elegir una clasificación.
"""

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

RAIZ = Path(__file__).resolve().parent.parent  # precios_supermercados
SALIDA = Path(__file__).resolve().parent / "dist" / "parquet"

PERIODOS = {
    1: "ayer",
    3: "hace 3 días",
    7: "hace una semana",
    14: "hace 2 semanas",
    30: "hace 1 mes",
    60: "hace 2 meses",
    90: "hace 3 meses",
    180: "hace 6 meses",
    270: "hace 9 meses",
    365: "hace 1 año",
    730: "hace 2 años",
}

TIPOS = ["categoria", "subcategoria", "proveedor"]
MIN_PRODUCTOS = 5  # un grupo necesita al menos estos productos con cambio
TOP_GRUPOS = 30  # por cobertura y tipo

# Fuentes activas. Hipermaxi tiene una carpeta por ciudad; el resto es nacional.
FUENTES = {
    "hipermaxi": {
        "nombre": "Hipermaxi",
        "ciudades": {
            "la_paz": "La Paz",
            "cochabamba": "Cochabamba",
            "santa_cruz": "Santa Cruz",
        },
    },
    "fidalga": {"nombre": "Fidalga", "ciudades": {"nacional": "Nacional"}},
    "farmacorp": {"nombre": "Farmacorp", "ciudades": {"nacional": "Nacional"}},
    "multicenter": {"nombre": "Multicenter", "ciudades": {"nacional": "Nacional"}},
}

COLUMNAS = [
    "dias",
    "id_producto",
    "producto",
    "categoria",
    "subcategoria",
    "proveedor",
    "hoy",
    "previo",
    "cambio",
]


def archivos_precios(supermercado, ciudad):
    base = RAIZ / "data" / supermercado
    if supermercado == "hipermaxi":
        carpeta = base / ciudad
    else:
        carpeta = base / "precios"
    return sorted(carpeta.glob("*.csv"))


def arreglar_codificacion(texto):
    """Repara texto UTF-8 leído como latin-1 ("NescafÃ©" -> "Nescafé")."""
    if not isinstance(texto, str):
        return texto
    try:
        return texto.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return texto


def normalizar_nivel(serie):
    """Quita espacios y unifica mayúsculas: se usa la forma más frecuente de cada valor."""
    serie = serie.str.strip().replace("", None)
    formas = serie.dropna().value_counts()
    canonica = {}
    for forma, _ in formas.items():
        canonica.setdefault(forma.lower(), forma)  # value_counts va de más a menos frecuente
    return serie.map(lambda v: canonica[v.lower()] if isinstance(v, str) else None)


def clasificar(supermercado, productos):
    """Asigna categoria, subcategoria y proveedor según lo que trae cada fuente."""
    p = productos.copy()
    if supermercado == "hipermaxi":
        p["proveedor"] = None
    elif supermercado == "fidalga":
        # Fidalga solo tiene una categoría muy específica: se usa como subcategoría
        p["subcategoria"] = p["categoria"].map(arreglar_codificacion)
        p["categoria"] = None
        p["producto"] = p["producto"].map(arreglar_codificacion)
        p["proveedor"] = p["proveedor"].map(arreglar_codificacion)
    elif supermercado == "farmacorp":
        # Farmacorp no trae categoría en product_type; solo proveedor
        p["categoria"] = None
        p["subcategoria"] = None
    elif supermercado == "multicenter":
        # Ruta "/Nivel1/Nivel2/Nivel3/": nivel 1 es categoría, nivel 2 subcategoría
        rutas = p["categoria"].fillna("").str.strip("/").str.split("/")
        p["categoria"] = rutas.map(lambda r: r[0] if len(r) > 0 else None)
        p["subcategoria"] = rutas.map(lambda r: r[1] if len(r) > 1 else None)
        p["categoria"] = normalizar_nivel(p["categoria"].astype("object"))
        p["subcategoria"] = normalizar_nivel(p["subcategoria"].astype("object"))
    for c in ["categoria", "subcategoria", "proveedor"]:
        if c in p:
            p[c] = p[c].replace("", None)
    return p


def leer_productos(supermercado):
    productos = pd.read_csv(RAIZ / "data" / supermercado / "productos.csv")
    productos = productos.drop_duplicates("id_producto", keep="last")
    for c in ["categoria", "subcategoria", "proveedor"]:
        if c not in productos.columns:
            productos[c] = None
    productos = clasificar(supermercado, productos)
    return productos[
        ["id_producto", "producto", "categoria", "subcategoria", "proveedor"]
    ].set_index("id_producto")


def leer_precios(archivos):
    partes = []
    for a in archivos:
        df = pd.read_csv(a, usecols=["fecha", "id_producto", "precio"])
        # Un mismo archivo puede mezclar "2026-11-01" y "2026-11-01 00:00:00"
        df["fecha"] = pd.to_datetime(df["fecha"], format="mixed", errors="coerce").dt.normalize()
        n = len(df)
        df = df.dropna(subset=["fecha", "precio"])
        if len(df) < n:
            print(f"    {a.name}: {n - len(df)} filas descartadas")
        partes.append(df)
    precios = pd.concat(partes, ignore_index=True)
    # Duplicados (fecha, producto): se conserva el último registro
    precios = precios.drop_duplicates(["fecha", "id_producto"], keep="last")
    return precios


def pivotear_con_relleno(precios):
    """Precios diarios por producto. Rellena solo las fechas faltantes (como la versión anterior)."""
    df = precios.pivot_table(index="fecha", columns="id_producto", values="precio")
    completo = pd.date_range(df.index[0], df.index[-1], freq="D")
    faltan = completo.difference(df.index)
    df = df.reindex(completo)
    df.loc[faltan] = df.ffill(limit_area="inside").loc[faltan]
    return df


def cambios_por_cobertura(df):
    """Un bloque por cobertura, ordenado por cambio descendente."""
    bloques = []
    for dias in PERIODOS:
        if df.shape[0] < dias + 1:
            continue
        hoy = df.iloc[-1]
        previo = df.iloc[-1 - dias]
        cambio = hoy / previo - 1
        b = pd.DataFrame(
            {
                "dias": np.int16(dias),
                "id_producto": hoy.index.astype("int64"),
                "hoy": hoy.values,
                "previo": previo.values,
                "cambio": cambio.values,
            }
        )
        # Solo filas que el visor muestra: precio hoy y precio previo presentes y positivos
        b = b[(b["hoy"] > 0) & (b["previo"] > 0) & np.isfinite(b["cambio"])]
        b = b.sort_values("cambio", ascending=False, kind="stable")
        bloques.append(b)
    return bloques


def calcular_ranking(filas):
    """Grupos con mayor variación promedio (valor absoluto) por cobertura y tipo."""
    f = filas[["dias", "cambio", *TIPOS]].copy()
    f["absoluto"] = f["cambio"].abs()
    partes = []
    for tipo in TIPOS:
        g = f.dropna(subset=[tipo]).groupby(["dias", tipo], sort=False)
        r = g.agg(
            n=("absoluto", "size"),
            promedio=("absoluto", "mean"),
            promedio_cambio=("cambio", "mean"),
        ).reset_index()
        r = r[r["n"] >= MIN_PRODUCTOS]
        r = r.sort_values(["dias", "promedio"], ascending=[True, False], kind="stable")
        r = r.groupby("dias", sort=True).head(TOP_GRUPOS)
        r = r.rename(columns={tipo: "grupo"})
        r.insert(1, "tipo", tipo)
        partes.append(r)
    ranking = pd.concat(partes, ignore_index=True)
    ranking["dias"] = ranking["dias"].astype("int16")
    ranking["n"] = ranking["n"].astype("int32")
    ranking["promedio"] = ranking["promedio"].astype("float64")
    ranking["promedio_cambio"] = ranking["promedio_cambio"].astype("float64")
    return ranking[["dias", "tipo", "grupo", "n", "promedio", "promedio_cambio"]]


def escribir_ciudad(supermercado, ciudad, nombre_ciudad, productos):
    archivos = archivos_precios(supermercado, ciudad)
    if not archivos:
        print(f"  sin archivos: {supermercado}/{ciudad}")
        return None

    precios = leer_precios(archivos)
    df = pivotear_con_relleno(precios)
    bloques = cambios_por_cobertura(df)

    filas = pd.concat(bloques, ignore_index=True)
    filas = filas.join(productos, on="id_producto")
    filas["producto"] = filas["producto"].fillna("")

    esquema = pa.schema(
        [
            ("dias", pa.int16()),
            ("id_producto", pa.int64()),
            ("producto", pa.string()),
            ("categoria", pa.string()),
            ("subcategoria", pa.string()),
            ("proveedor", pa.string()),
            ("hoy", pa.float32()),
            ("previo", pa.float32()),
            ("cambio", pa.float32()),
        ]
    )
    tabla = pa.Table.from_pandas(filas[COLUMNAS], preserve_index=False, schema=esquema)

    carpeta = SALIDA / f"supermercado={supermercado}" / f"ciudad={ciudad}"
    carpeta.mkdir(parents=True, exist_ok=True)
    ruta = carpeta / "cambios.parquet"
    pq.write_table(tabla, ruta, row_group_size=4096, compression="snappy", write_statistics=False)

    ranking = calcular_ranking(filas)
    ruta_ranking = carpeta / "ranking.parquet"
    pq.write_table(pa.Table.from_pandas(ranking, preserve_index=False), ruta_ranking, compression="snappy")

    # Rangos de filas por cobertura (contiguos por orden de escritura)
    coberturas = {}
    inicio = 0
    for b in bloques:
        dias = int(b["dias"].iloc[0])
        fin = inicio + len(b)
        coberturas[str(dias)] = {"etiqueta": PERIODOS[dias], "inicio": inicio, "fin": fin}
        inicio = fin

    print(
        f"  {supermercado}/{ciudad}: {len(filas)} filas, {ruta.stat().st_size/1e6:.1f} MB; "
        f"ranking {len(ranking)} grupos, {ruta_ranking.stat().st_size/1e3:.1f} KB"
    )
    return {
        "nombre": nombre_ciudad,
        "archivo": ruta.relative_to(SALIDA).as_posix(),
        "bytes": ruta.stat().st_size,
        "ranking": ruta_ranking.relative_to(SALIDA).as_posix(),
        "bytes_ranking": ruta_ranking.stat().st_size,
        "filas": int(len(filas)),
        "ultima_fecha": df.index[-1].strftime("%Y-%m-%d"),
        "coberturas": coberturas,
    }


def main():
    manifiesto = {
        "generado": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "supermercados": {},
    }
    for s, cfg in FUENTES.items():
        print(s)
        productos = leer_productos(s)
        ciudades = {}
        for c, nombre_c in cfg["ciudades"].items():
            info = escribir_ciudad(s, c, nombre_c, productos)
            if info:
                ciudades[c] = info
        manifiesto["supermercados"][s] = {"nombre": cfg["nombre"], "ciudades": ciudades}

    with open(SALIDA / "manifiesto.json", "w", encoding="utf-8") as f:
        json.dump(manifiesto, f, ensure_ascii=False, indent=2)
    print("manifiesto.json")


if __name__ == "__main__":
    main()
