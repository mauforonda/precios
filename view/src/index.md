<link rel="stylesheet" href="style.css">

```js
// Imports
import * as aq from "npm:arquero";
import { files } from "./components/files.js";
import { Trend } from "./components/format.js";
```

```js
const default_ciudad = "la_paz";
const stored_ciudad = localStorage.getItem("ciudad");
const selected_ciudad = stored_ciudad
    ? stored_ciudad
    : default_ciudad;
```

```js
localStorage.setItem("ciudad", ciudad);
```

```js
// Ciudades
const ciudades = Inputs.radio(Object.keys(files), {
    format: (d) => files[d].name,
    label: "En",
    value: selected_ciudad,
});
const ciudad = Generators.input(ciudades);
```

```js
// Datos
const productos = await FileAttachment("data/productos.json").json();
let data = await files[ciudad].file.csv({ typed: true });
data = data.map((d) => {
    return { ...d, ...productos[d.id_producto] };
});
```

```js
const default_dias = "3";
const stored_dias = localStorage.getItem("dias");
const selected_dias = stored_dias
    ? stored_dias
    : default_dias;
```

```js
localStorage.setItem("dias", dia);
```

```js
// Tiempo
const cobertura = await FileAttachment("data/cobertura.json").json();
const dias = Inputs.select(Object.keys(cobertura), {
    value: selected_dias,
    format: (d) => cobertura[d],
    label: "Cambios desde",
});
const dia = Generators.input(dias);
```

```js
// Cotización del dolar
const dolarData = await aq.loadCSV(
    `https://raw.githubusercontent.com/mauforonda/dolares/main/buy.csv`
);
```

```js
// Variaciones del dólar
const dolarDiario = dolarData
    .filter((d) => d.vwap != null)
    .derive({
        date: aq.escape(
            (d) => aq.op.split(aq.op.format_date(d.timestamp), "T")[0]
        ),
    })
    .groupby("date")
    .rollup({
        median_vwap: (d) => aq.op.median(d.vwap),
    })
    .orderby(aq.desc("date"));
const dolarCambio = Object.fromEntries(
    Object.keys(cobertura).map((d) => {
        const dia = Number(d);
        const hoy = dolarDiario.get("median_vwap", 0);
        const previo = dolarDiario.get("median_vwap", dia);
        return [dia, (hoy - previo) / previo];
    })
);
const dolarString = Trend(dolarCambio[dia], {
    format: { minimumFractionDigits: 2 },
});
```

```js
// Sugerencias
const dataDia = data.filter((d) => d.hoy && d[dia]);
const categorias = Object.fromEntries(
    Object.entries(
        dataDia
            .filter((d) => d[`${dia}_cambio`] > 0)
            .reduce(
                (acc, d) => ({
                    ...acc,
                    [d.subcategoria]: (acc[d.subcategoria] || 0) + 1,
                }),
                {}
            )
    )
        .filter(([_, count]) => count >= 5)
        .sort(([, a], [, b]) => b - a)
);
const sugerencias = Inputs.radio(Object.keys(categorias).slice(0, 12));
const sugerencia = Generators.input(sugerencias);
```

```js
// Búsqueda
const busqueda = Inputs.search(dataDia, {
    query: sugerencia,
    columns: ["producto", "subcategoria"],
    placeholder: "Busca ...",
    format: (d) => `${d} productos`,
});
const resultado = Generators.input(busqueda);
```

```js
// Tabla
const tabla = Inputs.table(resultado, {
    columns: ["producto", dia, "hoy", `${dia}_cambio`],
    header: {
        [dia]: cobertura[dia],
        [`${dia}_cambio`]: "variación",
    },
    format: {
        [`${dia}_cambio`]: (d) => Trend(d),
    },
    width: {
        producto: 250,
        [dia]: 50,
        hoy: 50,
        [`${dia}_cambio`]: 60,
    },
    sort: `${dia}_cambio`,
    rows: 34,
    reverse: true,
});
```

<div class="header">
    <div class="title">Precios</div>
    <div class="subtitle">
        ¿ Qué precios <span class="up">suben</span> o <span class="down">bajan</span> en Bolivia ?
    </div>
</div>

<div class="grid grid-cols-3 controls">
    <div class="card grid-colspan-1">
        <div class="ciudades">
            ${ciudades}
        </div>
        <div class="tiempo">
            ${dias}
        </div>
    </div>
    <div class="card grid-colspan-2">
        <div class="sugerencias">
          ${sugerencias}
        </div>
        <div class="busqueda">
            ${busqueda}
        </div>
    </div>
</div>

<div class="dolar"> ... mientras tanto el dolar cambió en ${dolarString}</div>

<div class="card precios">
    ${tabla}
</div>

<div id="creditos">
    <div class="credito">
        <span><a href="https://hipermaxi.com/" target="_blank">Hipermaxi</a></span>
        <span class="creditoNota">fuente</span>
    </div>
    <div>&</div>
    <div class="credito">
        <span><a href="mailto:mauriforonda@gmail.com">Mauricio Foronda</a></span>
        <span class="creditoNota">creación</span>
    </div>
</div>
