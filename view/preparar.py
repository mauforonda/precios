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

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent  # precios_supermercados
SALIDA = Path(__file__).resolve().parent / "dist" / "datos"

# Cambiar cuando cambie el formato de los archivos: el visor recarga si no coincide
ESQUEMA = 2
FILAS_CABEZA = 60  # filas con más subida y filas con más bajada en la cabeza
RETENCION_DIAS = 2  # versiones publicadas que se conservan

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


def centavos(serie):
    """Precio en centavos enteros. Avisa si algún precio no es múltiplo de un centavo."""
    c = np.round(serie.to_numpy(dtype="float64") * 100)
    desvio = np.abs(serie.to_numpy(dtype="float64") * 100 - c)
    if (desvio > 1e-3).any():
        print(f"    aviso: {(desvio > 1e-3).sum()} precios con fracciones de centavo (se redondean)")
    return c.astype("int64")


def diccionario(serie):
    """Valores únicos ordenados y el índice de cada fila en ellos (-1 = sin valor)."""
    valores = sorted(serie.dropna().unique())
    indice = {v: i for i, v in enumerate(valores)}
    return valores, [indice[v] if isinstance(v, str) else -1 for v in serie]


def columnar(f):
    """Filas como columnas: textos repetidos por diccionario, precios en centavos."""
    salida = {"producto": f["producto"].tolist()}
    dic = {}
    for tipo in TIPOS:
        dic[tipo], salida[tipo] = diccionario(f[tipo])
    salida["dic"] = dic
    salida["previo"] = f["previo_c"].tolist()
    salida["hoy"] = f["hoy_c"].tolist()
    return salida


def escribir_json(ruta_base, objeto):
    """Escribe <ruta_base>.<hash>.json y devuelve la ruta relativa a SALIDA."""
    datos = json.dumps(objeto, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    h = hashlib.sha256(datos).hexdigest()[:10]
    ruta = ruta_base.with_name(f"{ruta_base.name}.{h}.json")
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(datos)
    return ruta.relative_to(SALIDA).as_posix(), len(datos)


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
    filas["hoy_c"] = centavos(filas["hoy"])
    filas["previo_c"] = centavos(filas["previo"])
    ranking = calcular_ranking(filas)

    base = SALIDA / supermercado / ciudad
    coberturas = {}
    total = 0
    for dias, f in filas.groupby("dias", sort=True):
        dias = int(dias)
        # Por cambio descendente según los mismos centavos que ve el visor
        orden = (f["hoy_c"] / f["previo_c"]).to_numpy().argsort(kind="stable")[::-1]
        f = f.iloc[orden]
        n = len(f)
        completo = n <= 2 * FILAS_CABEZA
        extremos = f if completo else pd.concat([f.head(FILAS_CABEZA), f.tail(FILAS_CABEZA)])
        r = ranking[ranking["dias"] == dias].drop(columns="dias")
        cabeza = {
            "completo": completo,
            "ranking": r.to_dict("records"),
            "filas": columnar(extremos),
        }
        ruta_h, bytes_h = escribir_json(base / f"h{dias}", cabeza)
        info = {"etiqueta": PERIODOS[dias], "n": n, "cabeza": ruta_h}
        if completo:
            info["datos"] = None  # la cabeza ya trae todas las filas
        else:
            info["datos"], bytes_c = escribir_json(base / f"c{dias}", columnar(f))
            total += bytes_c
        total += bytes_h
        coberturas[str(dias)] = info

    print(
        f"  {supermercado}/{ciudad}: {len(filas)} filas, {len(coberturas)} coberturas, "
        f"{total/1e6:.1f} MB sin comprimir"
    )
    return {
        "nombre": nombre_ciudad,
        "ultima_fecha": df.index[-1].strftime("%Y-%m-%d"),
        "coberturas": coberturas,
    }


def archivos_de(manifiesto):
    """Rutas de datos que menciona un manifiesto."""
    rutas = set()
    for s in manifiesto["supermercados"].values():
        for c in s["ciudades"].values():
            for cob in c["coberturas"].values():
                rutas.update(r for r in (cob["cabeza"], cob["datos"]) if r)
    return rutas


def retener(previo, manifiesto, ahora):
    """Copia los archivos de versiones recientes ya publicadas y devuelve el historial nuevo."""
    historial = []
    if previo and (previo / "historial.json").exists():
        limite = (ahora - timedelta(days=RETENCION_DIAS)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for e in json.loads((previo / "historial.json").read_text(encoding="utf-8")):
            if e["generado"] < limite or e["generado"] == manifiesto["generado"]:
                continue
            copiados = 0
            for ruta in e["archivos"]:
                destino = SALIDA / ruta
                origen = previo / ruta
                if destino.exists():
                    continue
                if origen.exists():
                    destino.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(origen, destino)
                    copiados += 1
            historial.append(e)
            print(f"  retenida {e['generado']}: {copiados} archivos copiados")
    historial.append({"generado": manifiesto["generado"], "archivos": sorted(archivos_de(manifiesto))})
    return historial


def main():
    global RAIZ, SALIDA
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", type=Path, default=RAIZ, help="carpeta que contiene data/ (por defecto el repositorio)")
    ap.add_argument("--salida", type=Path, default=SALIDA)
    ap.add_argument("--previo", type=Path, help="carpeta datos/ de la publicación anterior, para retener sus archivos")
    args = ap.parse_args()
    RAIZ, SALIDA = args.datos.resolve(), args.salida.resolve()
    if args.previo and args.previo.resolve() == SALIDA:
        raise SystemExit("--previo no puede ser igual a --salida")
    previo = args.previo.resolve() if args.previo else None

    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    SALIDA.mkdir(parents=True)

    ahora = datetime.now(timezone.utc)
    manifiesto = {
        "esquema": ESQUEMA,
        "generado": ahora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "supermercados": {},
    }
    for s, cfg in FUENTES.items():
        if not (RAIZ / "data" / s / "productos.csv").exists():
            print(f"{s}: sin datos, se omite")
            continue
        print(s)
        productos = leer_productos(s)
        ciudades = {}
        for c, nombre_c in cfg["ciudades"].items():
            info = escribir_ciudad(s, c, nombre_c, productos)
            if info:
                ciudades[c] = info
        manifiesto["supermercados"][s] = {"nombre": cfg["nombre"], "ciudades": ciudades}

    historial = retener(previo, manifiesto, ahora)
    (SALIDA / "historial.json").write_text(json.dumps(historial, ensure_ascii=False), encoding="utf-8")
    # El manifiesto se escribe al final: nunca apunta a archivos que no existen
    (SALIDA / "manifiesto.json").write_text(
        json.dumps(manifiesto, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"manifiesto.json ({len(archivos_de(manifiesto))} archivos, {len(historial)} versiones en el historial)")


if __name__ == "__main__":
    main()
