<link rel="stylesheet" href="style.css">

```js
// Imports
import { files } from "./components/files.js";
import { Trend } from "./components/format.js";
```

```js
// Ciudades
const ciudades = Inputs.radio(Object.keys(files), {
    format: (d) => files[d].name,
    label: "En",
    value: "la_paz",
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
// Tiempo
const nombres = {
    1: "ayer",
    3: "hace 3 días",
    7: "hace una semana",
    14: "hace 2 semanas",
    30: "hace 1 mes",
};
const dias = Inputs.select([1, 3, 7], {
    value: 1,
    format: (d) => nombres[d],
    label: "Cambios desde",
});
const dia = Generators.input(dias);
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
        [dia]: nombres[dia],
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

<div class="grid grid-cols-3 controls">
    <div class="card grid-colspan-1">
        ${ciudades}
        ${dias}
    </div>
    <div class="card grid-colspan-2">
        <div class="sugerencias">
          ${sugerencias}
        </div>
        ${busqueda}
    </div>
</div>
<div class="card">
    ${tabla}
</div>
