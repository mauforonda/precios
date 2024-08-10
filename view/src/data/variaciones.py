#!/usr/bin/env python3

import pandas as pd
import os
from pathlib import Path
import json

fuente = "./data/hipermaxi/"
departamentos = ["cochabamba", "la_paz", "santa_cruz"]
output = os.path.dirname(os.path.abspath(__file__))
periodos = {
    1: "ayer",
    3: "hace 3 días",
    7: "hace una semana",
    14: "hace 2 semanas",
    30: "hace 1 mes",
    60: "hace 2 meses",
    90: "hace 3 meses",
    180: "hace 6 meses",
    365: "hace 1 año"
}
cobertura = []


def verCambios(pivot, dias):
    cobertura.append(dias)
    vista = pd.concat(
        [
            pivot.iloc[-1 - dias],
            pivot.pct_change(periods=dias, fill_method=None).iloc[-1],
        ],
        axis=1,
    ).dropna()
    vista.columns = [f"{dias}", f"{dias}_cambio"]
    return vista


for departamento in departamentos:
    df = pd.concat(
        [
            pd.read_csv(Path(fuente, departamento, csv), parse_dates=["fecha"])
            for csv in os.listdir(Path(fuente, departamento))
        ]
    ).pivot_table(index="fecha", columns="id_producto", values="precio")

    pd.concat(
        [df.iloc[-1].rename("hoy")]
        + [
            verCambios(df, dias)
            for dias in periodos.keys()
            if df.shape[0] >= (dias + 1)
        ],
        axis=1,
    ).to_csv(f"{output}/{departamento}.csv", float_format="%.3g")


with open(f"{output}/productos.json", "w+") as f:
    productos = pd.read_csv(Path(fuente, "productos.csv")).set_index("id_producto")
    json.dump(productos.to_dict(orient="index"), f, ensure_ascii=False)

with open(f"{output}/cobertura.json", "w+") as f:
    json.dump({d: periodos[d] for d in cobertura}, f, ensure_ascii=False)