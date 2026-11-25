#!/usr/bin/env python
"""Calcula la cobertura de los datos y la publica en dos lugares:

- cobertura.json: versión legible por programas.
- readme.md: bloque entre <!-- cobertura:inicio --> y <!-- cobertura:fin -->.

Uso, desde la raíz del repositorio:  python update/cobertura.py
Requiere: pip install -r update/requirements_cobertura.txt
"""

import json
from datetime import date, timedelta
from pathlib import Path

import duckdb

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "data"
INICIO = "<!-- cobertura:inicio -->"
FIN = "<!-- cobertura:fin -->"
# Una fuente sin datos en los últimos días se marca como inactiva
TOLERANCIA_DIAS = 3
# Cuántos rangos de días faltantes se listan por serie
MAX_RANGOS = 12
# Categorías principales que se listan por fuente
TOP_CATEGORIAS = 6

# id, nombre, ciudad (id, nombre) -> glob de precios, catálogo y cómo sacar la categoría principal
SERIES = []
for ciudad, nombre in [("la_paz", "La Paz"), ("cochabamba", "Cochabamba"), ("santa_cruz", "Santa Cruz")]:
    SERIES.append(dict(
        fuente="hipermaxi", nombre="Hipermaxi", ciudad=ciudad, ciudad_nombre=nombre,
        precios=f"hipermaxi/{ciudad}/*.csv", productos="hipermaxi/productos.csv",
        nivel1="categoria",
    ))
for fuente, nombre in [("fidalga", "Fidalga"), ("farmacorp", "Farmacorp"), ("multicenter", "Multicenter"), ("icnorte", "IC Norte")]:
    SERIES.append(dict(
        fuente=fuente, nombre=nombre, ciudad="nacional", ciudad_nombre="Nacional",
        precios=f"{fuente}/precios/*.csv", productos=f"{fuente}/productos.csv",
        # Multicenter e IC Norte guardan la categoría como /Nivel1/Nivel2/Nivel3/
        nivel1="split_part(categoria, '/', 2)" if fuente in ("multicenter", "icnorte") else None,
    ))
# Ketal es histórico y tiene otro esquema: se resume aparte
KETAL = dict(fuente="ketal", nombre="Ketal", ciudad="nacional", ciudad_nombre="Nacional")


def rangos(dias):
    """[date, ...] ordenadas -> ['2025-06-04 a 2025-06-10', '2025-12-22']"""
    salida, i = [], 0
    while i < len(dias):
        j = i
        while j + 1 < len(dias) and dias[j + 1] - dias[j] == timedelta(days=1):
            j += 1
        salida.append(str(dias[i]) if i == j else f"{dias[i]} a {dias[j]}")
        i = j + 1
    return salida


def calcular_serie(con, s):
    ruta = lambda p: str(DATOS / p)
    con.execute(
        f"""create or replace temp table t as
        select try_cast(fecha as timestamp)::date f, id_producto, precio
        from read_csv('{ruta(s['precios'])}', union_by_name=true, types={{'fecha': 'VARCHAR'}})"""
    )
    desde, hasta, dias, filas, productos, distintas, ceros = con.execute(
        """select min(f), max(f), count(distinct f), count(*), count(distinct id_producto),
        (select count(*) from (select distinct * from t)), count(*) filter (where precio = 0) from t"""
    ).fetchone()
    existentes = {r[0] for r in con.execute("select distinct f from t").fetchall()}
    faltantes = [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)]
    faltantes = [d for d in faltantes if d not in existentes]
    ultimo = con.execute("select count(distinct id_producto) from t where f = ?", [hasta]).fetchone()[0]
    por_dia = con.execute(
        "select min(n), max(n) from (select count(distinct id_producto) n from t group by f)"
    ).fetchone()
    categorias = []
    if s["nivel1"]:
        categorias = con.execute(
            f"""select nullif(trim({s['nivel1']}), '') c, count(*) n
            from read_csv('{ruta(s['productos'])}', all_varchar=true)
            where id_producto in (select id_producto::varchar from t where f = ?)
            group by 1 order by 2 desc""",
            [hasta],
        ).fetchall()
    return dict(
        fuente=s["fuente"], nombre=s["nombre"], ciudad=s["ciudad"], ciudad_nombre=s["ciudad_nombre"],
        desde=str(desde), hasta=str(hasta), dias_con_datos=dias, dias_sin_datos=len(faltantes),
        rangos_sin_datos=rangos(faltantes),
        productos_historicos=productos, productos_ultimo_dia=ultimo,
        productos_por_dia_min=por_dia[0], productos_por_dia_max=por_dia[1],
        filas=filas, filas_repetidas=filas - distintas, filas_precio_cero=ceros,
        categorias_ultimo_dia=[dict(categoria=c, productos=n) for c, n in categorias if c],
    )


def calcular_ketal(con):
    r = DATOS / "ketal"
    desde, hasta, dias, filas, productos = con.execute(
        f"""select min(time), max(time), count(distinct time), count(*), count(distinct id)
        from read_csv('{r}/20*.csv', union_by_name=true)"""
    ).fetchone()
    return dict(
        fuente="ketal", nombre="Ketal", ciudad="nacional", ciudad_nombre="Nacional",
        desde=str(desde), hasta=str(hasta), dias_con_datos=dias,
        dias_sin_datos=(hasta - desde).days + 1 - dias, productos_historicos=productos, filas=filas,
    )


def tabla_markdown(series, ketal, corte):
    def activa(s):
        return date.fromisoformat(s["hasta"]) >= corte - timedelta(days=TOLERANCIA_DIAS)

    lineas = [
        "| Tienda | Ciudad | Desde | Hasta | Días con datos | Días sin datos | Productos en el último día | Productos en total |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for s in series:
        estado = "" if activa(s) else " (sin actualizar)"
        lineas.append(
            f"| [{s['nombre']}](data/{s['fuente']}/) | {s['ciudad_nombre']} | {s['desde']} | {s['hasta']}{estado} "
            f"| {s['dias_con_datos']:,} | {s['dias_sin_datos']} | {s['productos_ultimo_dia']:,} | {s['productos_historicos']:,} |"
        )
    lineas.append(
        f"| [Ketal](data/ketal/) | Nacional | {ketal['desde']} | {ketal['hasta']} (cerrada) "
        f"| {ketal['dias_con_datos']:,} | {ketal['dias_sin_datos']} | n/d | {ketal['productos_historicos']:,} |"
    )
    texto = ["\n".join(lineas), ""]
    # Las series de una misma tienda con los mismos huecos se agrupan en una línea
    huecos = {}
    for s in series:
        if s["rangos_sin_datos"]:
            huecos.setdefault((s["nombre"], tuple(s["rangos_sin_datos"])), []).append(s["ciudad_nombre"])
    if huecos:
        texto.append("Días sin datos:")
        texto.append("")
        for (nombre, r), ciudades in huecos.items():
            extra = f" y {len(r) - MAX_RANGOS} rangos más" if len(r) > MAX_RANGOS else ""
            donde = "" if ciudades == ["Nacional"] else f" ({', '.join(ciudades)})"
            texto.append(f"- {nombre}{donde}: {', '.join(r[:MAX_RANGOS])}{extra}")
        texto.append("")
    texto.append("Categorías principales entre los productos del último día:")
    texto.append("")
    vistas = set()
    for s in series:
        # Los tres Hipermaxi comparten catálogo: se listan solo una vez, con La Paz
        if not s["categorias_ultimo_dia"] or (s["fuente"], "cat") in vistas:
            continue
        vistas.add((s["fuente"], "cat"))
        top = ", ".join(f"{c['categoria']} ({c['productos']:,})" for c in s["categorias_ultimo_dia"][:TOP_CATEGORIAS])
        sufijo = f" en {s['ciudad_nombre']}" if s["fuente"] == "hipermaxi" else ""
        texto.append(f"- {s['nombre']}{sufijo}: {top}")
    texto.append("- Fidalga y Farmacorp: sin categoría principal (ver más abajo).")
    return "\n".join(texto)


def main():
    con = duckdb.connect()
    series = [calcular_serie(con, s) for s in SERIES]
    ketal = calcular_ketal(con)
    corte = max(date.fromisoformat(s["hasta"]) for s in series)
    salida = dict(
        datos_al=str(corte),
        moneda="BOB",
        series=series,
        ketal=ketal,
    )
    (RAIZ / "cobertura.json").write_text(
        json.dumps(salida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    readme = RAIZ / "readme.md"
    texto = readme.read_text(encoding="utf-8")
    if INICIO not in texto or FIN not in texto:
        raise SystemExit(f"Faltan los marcadores {INICIO} y {FIN} en readme.md")
    antes, resto = texto.split(INICIO, 1)
    _, despues = resto.split(FIN, 1)
    bloque = f"{INICIO}\nDatos al **{corte}**. Se genera con `update/cobertura.py` y también está en [cobertura.json](cobertura.json).\n\n{tabla_markdown(series, ketal, corte)}\n{FIN}"
    readme.write_text(antes + bloque + despues, encoding="utf-8")
    print(f"Cobertura al {corte}")


if __name__ == "__main__":
    main()
