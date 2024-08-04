#!/usr/bin/env python3

import pandas as pd
import os
from pathlib import Path
import json

fuente = "./data/hipermaxi/"
departamentos = ["cochabamba", "la_paz", "santa_cruz"]
output = os.path.dirname(os.path.abspath(__file__))


def verCambios(pivot, dias):
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
        + [verCambios(df, dias) for dias in [1, 3, 7, 14, 30] if df.shape[0] >= (dias + 1)],
        axis=1,
    ).to_csv(f"{output}/{departamento}.csv", float_format="%.3g")


with open(f"{output}/productos.json", "w+") as f:
    productos = pd.read_csv(Path(fuente, "productos.csv")).set_index("id_producto")
    json.dump(productos.to_dict(orient="index"), f, ensure_ascii=False)
