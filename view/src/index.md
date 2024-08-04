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
// Búsqueda
const dataDia = data.filter((d) => d.hoy && d[dia]);
const busqueda = Inputs.search(dataDia, {
  columns: ["producto", "subcategoria"],
  placeholder: "Busca ...",
  format: d => `${d} productos`
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

<div class="grid grid-cols-2 controls">
    <div class="card">
        ${ciudades}
        ${dias}
    </div>
    <div class="card">
        ${busqueda}
    </div>
</div>
<div class="card">
    ${tabla}
</div>
