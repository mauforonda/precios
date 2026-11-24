// Visor de precios: JavaScript sin frameworks.
// Los datos son parquet generados por preparar.py en dist/parquet. Cada cobertura
// es un rango contiguo de filas, así que solo se descarga el rango elegido.

import {
  asyncBufferFromUrl,
  parquetMetadataAsync,
  parquetReadObjects,
} from "https://cdn.jsdelivr.net/npm/hyparquet@1.32.0/+esm";

const SUPERMERCADO_DEFECTO = "hipermaxi";
const DIA_DEFECTO = "3";
// Solo se muestran ciudades con datos de los últimos días
const DIAS_VIGENTES = 2;
const FILAS_TABLA = 34;
const ALTURA_FILA = 22; // px, como Inputs.table
const TIPOS_CLASIFICACION = [
  ["categoria", "Categoría"],
  ["subcategoria", "Subcategoría"],
  ["proveedor", "Proveedor"],
];
const COLUMNAS_LECTURA = [
  "id_producto",
  "producto",
  "categoria",
  "subcategoria",
  "proveedor",
  "hoy",
  "previo",
  "cambio",
];

const $ = (sel) => document.querySelector(sel);

// ---------- almacenamiento local (opcional) ----------

function leer(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardar(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: el visor sigue funcionando */
  }
}

// ---------- utilidades ----------

function el(tag, attrs = {}, hijos = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    nodo.setAttribute(k, v === true ? "" : String(v));
  }
  for (const h of [].concat(hijos)) {
    if (h === null || h === undefined) continue;
    nodo.append(h);
  }
  return nodo;
}

// Valor definido y no NaN
const definido = (v) => v != null && !Number.isNaN(v);

// Formato de variación en porcentaje con flecha
function tendencia(valor, format = {}) {
  const variante = valor > 0 ? "up" : valor < 0 ? "down" : "muted";
  const texto = valor.toLocaleString("en-US", {
    signDisplay: "always",
    style: "percent",
    ...format,
  });
  const sufijo = valor > 0 ? " ↗︎" : valor < 0 ? " ↘︎" : "";
  return el("span", { class: variante }, texto + sufijo);
}

// Igual que el formato por defecto de Inputs.table para números
const numero = (n) => (n === 0 ? "0" : n.toLocaleString("en"));

const escapar = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

// Igual que Inputs.search: cada término debe empezar una palabra
// en alguna de las columnas indicadas
function filtrar(filas, query, columnas) {
  const terminos = `${query ?? ""}`
    .split(/\s+/g)
    .filter((t) => t)
    .map((t) => new RegExp(`(?:^|[^\\p{L}-])${escapar(t)}`, "iu"));
  return filas.filter((f) =>
    terminos.every((re) => columnas.some((c) => re.test(f[c] ?? "")))
  );
}

// Igual que el orden de Inputs.table (valores indefinidos al final)
function comparar(a, b, desc) {
  if (desc) {
    return (definido(b) - definido(a)) || (b < a ? -1 : b > a ? 1 : b >= a ? 0 : NaN);
  }
  return (definido(b) - definido(a)) || (a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN);
}

// ---------- datos (parquet) ----------

// Un archivo se abre una vez: se leen sus metadatos (cola, 128 KB) y se reutilizan
const archivos = new Map();
function abrirArchivo(ruta) {
  if (!archivos.has(ruta)) {
    archivos.set(
      ruta,
      (async () => {
        const file = await asyncBufferFromUrl({ url: ruta });
        const metadata = await parquetMetadataAsync(file, { initialFetchSize: 32 * 1024 });
        return { file, metadata };
      })()
    );
  }
  return archivos.get(ruta);
}

async function cargarManifiesto() {
  const r = await fetch("parquet/manifiesto.json");
  if (!r.ok) throw new Error(`manifiesto: ${r.status}`);
  return r.json();
}

// Filas de una cobertura: rango contiguo [inicio, fin) del archivo de la ciudad
async function leerCobertura(ciudad, dias) {
  // La clave incluye el supermercado: "nacional" existe en varias fuentes
  const clave = `${estado.supermercado}/${ciudad}/${dias}`;
  if (!estado.cache.has(clave)) {
    const info = estado.ciudades[ciudad];
    const rango = info.coberturas[dias];
    const { file, metadata } = await abrirArchivo(`parquet/${info.archivo}`);
    const filas = await parquetReadObjects({
      file,
      metadata,
      columns: COLUMNAS_LECTURA,
      rowStart: rango.inicio,
      rowEnd: rango.fin,
    });
    // hyparquet devuelve int64 como BigInt; los códigos caben en Number
    for (const f of filas) f.id_producto = Number(f.id_producto);
    estado.cache.set(clave, filas);
  }
  return estado.cache.get(clave);
}

// Ranking de clasificaciones por cobertura: archivo pequeño, se descarga completo una vez
const rankings = new Map();
function leerRanking(ciudad) {
  const clave = `${estado.supermercado}/${ciudad}`;
  if (!rankings.has(clave)) {
    const info = estado.ciudades[ciudad];
    const promesa = abrirArchivo(`parquet/${info.ranking}`)
      .then(({ file, metadata }) =>
        parquetReadObjects({
          file,
          metadata,
          columns: ["dias", "tipo", "grupo", "n", "promedio", "promedio_cambio"],
        })
      );
    rankings.set(clave, promesa);
  }
  return rankings.get(clave);
}

// ---------- estado ----------

const estado = {
  clasificacion: null, // { tipo, grupo } elegido en el ranking; null = sin filtro
  ranking: [],
  manifiesto: null,
  supermercado: null,
  ciudades: null,
  ciudad: null,
  ciudadRecordada: {}, // última ciudad elegida por supermercado con ciudades
  dia: null,
  dataDia: [],
  cache: new Map(),
  token: 0,
};

// ---------- controles ----------

function coberturas() {
  return estado.ciudades[estado.ciudad].coberturas;
}

// Si la cobertura elegida no existe en el nuevo supermercado o ciudad,
// usa la más cercana: la mayor que no supere la elegida, o la menor si no hay ninguna.
function coberturaCercana(dia) {
  const disponibles = Object.keys(coberturas()).map(Number).sort((a, b) => a - b);
  const n = Number(dia);
  const menores = disponibles.filter((d) => d <= n);
  return String(menores.length ? menores[menores.length - 1] : disponibles[0]);
}

function renderSupermercados() {
  const botones = Object.entries(estado.manifiesto.supermercados).map(([id, info]) =>
    el(
      "button",
      {
        type: "button",
        "data-id": id,
        "aria-pressed": id === estado.supermercado ? "true" : "false",
        class: "segmento",
      },
      info.nombre
    )
  );
  const grupo = $("#supermercados");
  grupo.replaceChildren(...botones);
  grupo.onclick = async (ev) => {
    const boton = ev.target.closest("button[data-id]");
    if (!boton || boton.dataset.id === estado.supermercado) return;
    await seleccionarSupermercado(boton.dataset.id);
  };
}

async function seleccionarSupermercado(id) {
  estado.supermercado = id;
  estado.clasificacion = null; // los grupos cambian con el supermercado
  guardar("supermercado", id);
  estado.ciudades = estado.manifiesto.supermercados[id].ciudades;
  const recordada = estado.ciudadRecordada[id];
  estado.ciudad = estado.ciudades[recordada] ? recordada : Object.keys(estado.ciudades)[0];
  estado.dia = coberturaCercana(estado.dia);
  for (const b of $("#supermercados").children) {
    b.setAttribute("aria-pressed", b.dataset.id === id ? "true" : "false");
  }
  renderCiudades();
  renderTiempo();
  await renderDia();
}

// Solo aparece si el supermercado tiene más de una ciudad
function renderCiudades() {
  const contenedor = $("#ciudades");
  const entradas = Object.entries(estado.ciudades);
  if (entradas.length <= 1) {
    contenedor.replaceChildren();
    contenedor.hidden = true;
    return;
  }
  contenedor.hidden = false;
  const botones = entradas.map(([id, info]) =>
    el(
      "button",
      {
        type: "button",
        "data-id": id,
        "aria-pressed": id === estado.ciudad ? "true" : "false",
        class: "segmento",
      },
      info.nombre
    )
  );
  contenedor.replaceChildren(
    el("span", { class: "etiqueta" }, "en"),
    el("div", { class: "segmentos", role: "group", "aria-label": "Ciudad" }, botones)
  );
  contenedor.querySelector(".segmentos").onclick = async (ev) => {
    const boton = ev.target.closest("button[data-id]");
    if (!boton || boton.dataset.id === estado.ciudad) return;
    const id = boton.dataset.id;
    for (const b of contenedor.querySelectorAll("button[data-id]")) {
      b.setAttribute("aria-pressed", b.dataset.id === id ? "true" : "false");
    }
    estado.ciudad = id;
    estado.clasificacion = null;
    estado.ciudadRecordada[estado.supermercado] = id;
    guardar("ciudad", JSON.stringify(estado.ciudadRecordada));
    estado.dia = coberturaCercana(estado.dia);
    renderTiempo();
    await renderDia();
  };
}

// Selector propio (no <select>) para que la opción resaltada use --accent.
function crearSelector(opciones, valor, alCambiar, etiqueta) {
  const raiz = el("div", { class: "selector" });
  const boton = el("button", {
    type: "button",
    class: "selector-boton",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-label": etiqueta,
  });
  const lista = el("ul", { class: "selector-lista", role: "listbox", tabindex: "-1", hidden: true });
  for (const o of opciones) {
    lista.append(el("li", { role: "option", class: "selector-opcion", "data-valor": o.valor }, o.texto));
  }
  let actual = valor;
  let activa = -1;

  const items = () => [...lista.children];
  const resaltar = (i) => {
    activa = i;
    items().forEach((li, k) => li.classList.toggle("activa", k === i));
    items()[i]?.scrollIntoView({ block: "nearest" });
  };
  const pintar = () => {
    boton.textContent = opciones.find((o) => o.valor === actual)?.texto ?? "";
    items().forEach((li) => li.setAttribute("aria-selected", li.dataset.valor === actual ? "true" : "false"));
  };
  const abrir = (abierto) => {
    lista.hidden = !abierto;
    boton.setAttribute("aria-expanded", String(abierto));
    if (abierto) resaltar(Math.max(0, items().findIndex((li) => li.dataset.valor === actual)));
  };
  const elegir = (v) => {
    abrir(false);
    boton.focus();
    if (v === actual) return;
    actual = v;
    pintar();
    alCambiar(v);
  };

  boton.addEventListener("click", () => abrir(lista.hidden));
  lista.addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-valor]");
    if (li) elegir(li.dataset.valor);
  });
  lista.addEventListener("mousemove", (ev) => {
    const li = ev.target.closest("li[data-valor]");
    if (li) resaltar(items().indexOf(li));
  });
  raiz.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") return abrir(false);
    if (lista.hidden && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      return abrir(true);
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const paso = ev.key === "ArrowDown" ? 1 : -1;
      resaltar(Math.min(items().length - 1, Math.max(0, activa + paso)));
    } else if (ev.key === "Enter" && !lista.hidden && activa >= 0) {
      ev.preventDefault();
      elegir(items()[activa].dataset.valor);
    }
  });
  document.addEventListener("click", (ev) => {
    if (!raiz.contains(ev.target)) abrir(false);
  });

  raiz.append(boton, lista);
  pintar();
  return raiz;
}

function renderTiempo() {
  const selector = crearSelector(
    Object.entries(coberturas()).map(([k, v]) => ({ valor: k, texto: v.etiqueta })),
    estado.dia,
    async (valor) => {
      estado.dia = valor;
      guardar("dias", valor);
      await renderDia();
    },
    "Cobertura"
  );
  $("#tiempo").replaceChildren(selector);
}

// Igual que Inputs.radio sin valor inicial: ninguna opción marcada
const esActiva = (tipo, grupo) =>
  estado.clasificacion !== null &&
  estado.clasificacion.tipo === tipo &&
  estado.clasificacion.grupo === grupo;

// Una fila por tipo de clasificación. Primero las subidas de precio promedio más altas.
// Cada grupo es un botón; al pulsarlo filtra la tabla y vuelve a pulsarlo lo quita.
// Intensidad del fondo de un grupo según |promedio| relativo al máximo visible.
// El color (subida/bajada) sale de las variables de tema en style.css.
function tinte(valor, maximo) {
  if (!valor || !maximo) return "--tinte-alfa: 0";
  const intensidad = Math.min(Math.abs(valor) / maximo, 1);
  const color = valor > 0 ? "var(--up-rgb)" : "var(--down-rgb)";
  const alfa = (0.07 + 0.2 * intensidad).toFixed(3);
  return `--tinte-rgb: ${color}; --tinte-alfa: ${alfa}`;
}

function renderClasificaciones() {
  const dias = Number(estado.dia);
  const maximo = Math.max(
    0,
    ...estado.ranking.filter((g) => g.dias === dias).map((g) => Math.abs(g.promedio_cambio))
  );
  const filas = TIPOS_CLASIFICACION.map(([tipo, titulo]) => {
    const grupos = estado.ranking
      .filter((g) => g.dias === dias && g.tipo === tipo)
      .sort((a, b) => b.promedio_cambio - a.promedio_cambio);
    if (!grupos.length) return null;
    const chips = grupos.map((g) =>
      el(
        "button",
        {
          type: "button",
          class: "chip",
          style: tinte(g.promedio_cambio, maximo),
          "data-tipo": tipo,
          "data-grupo": g.grupo,
          "aria-pressed": esActiva(tipo, g.grupo) ? "true" : "false",
          title: `${g.n} productos con cambio`,
        },
        g.grupo
      )
    );
    return el("div", { class: "fila-clasificacion" }, [
      el("div", { class: "etiqueta-clasificacion" }, titulo),
      el("div", { class: "chips", role: "group", "aria-label": titulo }, chips),
    ]);
  }).filter(Boolean);

  const contenedor = $("#sugerencias");
  contenedor.replaceChildren(...filas);
  contenedor.onclick = (ev) => {
    const boton = ev.target.closest("button.chip");
    if (!boton) return;
    const tipo = boton.dataset.tipo;
    const grupo = boton.dataset.grupo;
    estado.clasificacion = esActiva(tipo, grupo) ? null : { tipo, grupo };
    for (const c of contenedor.querySelectorAll("button.chip")) {
      c.setAttribute("aria-pressed", esActiva(c.dataset.tipo, c.dataset.grupo) ? "true" : "false");
    }
    actualizarTabla();
  };
}

// Igual que Inputs.search: al cambiar sugerencias o datos, la búsqueda empieza vacía
// (salvo que se pida conservar el texto actual)
function renderBusqueda(query = "") {
  const input = el("input", {
    name: "input",
    type: "search",
    placeholder: "Busca ...",
  });
  const salida = el("output", { name: "output" });
  const form = el("form", { class: "busqueda-campo", role: "search" }, [input, salida]);
  input.value = query;
  input.addEventListener("input", actualizarTabla);
  $("#busqueda").replaceChildren(form);
  actualizarTabla();
}

function actualizarTabla() {
  const query = $("#busqueda input").value;
  const base = estado.clasificacion
    ? estado.dataDia.filter((f) => f[estado.clasificacion.tipo] === estado.clasificacion.grupo)
    : estado.dataDia;
  const resultado = filtrar(base, query, ["producto", "subcategoria"]);
  $("#busqueda output").textContent = `${resultado.length} productos`;
  renderTabla(resultado);
}

// ---------- tabla ----------

function renderTabla(filas) {
  const dia = estado.dia;
  const columnas = [
    { clave: "producto", titulo: "producto", derecha: false, fmt: (v) => `${v}` },
    { clave: "previo", titulo: coberturas()[dia].etiqueta, derecha: true, fmt: numero },
    { clave: "hoy", titulo: "hoy", derecha: true, fmt: numero },
    { clave: "cambio", titulo: "variación", derecha: true, fmt: (v) => tendencia(v) },
  ];

  let orden = { clave: "cambio", desc: true };
  const cuerpo = el("tbody");
  const cabeceras = columnas.map((c) => {
    const flecha = el("span");
    const th = el(
      "th",
      { title: c.clave, class: c.derecha ? "num" : null },
      [flecha, c.titulo]
    );
    th._flecha = flecha;
    th._clave = c.clave;
    return th;
  });

  // Solo se pintan las filas visibles y se añaden bloques al hacer scroll
  let ordenadas = [];
  let pintadas = 0;

  const filaEl = (f) => {
    const tr = el("tr");
    tr.append(el("td", {}, [el("input", { type: "checkbox", value: f.id_producto, disabled: true })]));
    for (const c of columnas) {
      const v = f[c.clave];
      const td = el("td", { class: c.derecha ? "num" : null });
      if (definido(v)) td.append(c.fmt(v));
      tr.append(td);
    }
    return tr;
  };

  const pintarBloque = (n) => {
    const hasta = Math.min(ordenadas.length, pintadas + n);
    const nuevas = [];
    for (let i = pintadas; i < hasta; i++) nuevas.push(filaEl(ordenadas[i]));
    cuerpo.append(...nuevas);
    pintadas = hasta;
  };

  const pintarFilas = () => {
    ordenadas = filas
      .slice()
      .sort((a, b) => comparar(a[orden.clave], b[orden.clave], orden.desc));
    cuerpo.replaceChildren();
    pintadas = 0;
    pintarBloque(FILAS_TABLA * 2);
    form.scrollTop = 0;
  };

  const alScroll = () => {
    if (pintadas >= ordenadas.length) return;
    if (form.scrollHeight - form.scrollTop < ALTURA_FILA * FILAS_TABLA * 1.5 + form.clientHeight) {
      pintarBloque(FILAS_TABLA);
    }
  };

  const pintarFlechas = () => {
    for (const th of cabeceras) {
      th._flecha.textContent =
        th._clave === orden.clave ? (orden.desc ? "▾" : "▴") : "";
    }
  };

  cabeceras.forEach((th) => {
    th.addEventListener("click", (ev) => {
      if (orden.clave === th._clave) {
        orden = { clave: th._clave, desc: !orden.desc };
      } else {
        orden = { clave: th._clave, desc: ev.altKey };
      }
      pintarFlechas();
      pintarFilas();
    });
  });

  const encabezado = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, [el("input", { type: "checkbox", disabled: true })]),
      ...cabeceras,
    ]),
  ]);
  // Encabezado y cuerpo son tablas separadas con las mismas columnas.
  // El encabezado queda fuera del área que se desplaza: no baila ni dejan ver filas.
  const anchos = ["0", "auto", "18%", "14%", "24%"];
  const colgrupo = () =>
    el("colgroup", {}, anchos.map((w) => el("col", { style: `width: ${w}` })));
  const cabecera = el("div", { class: "tabla-cabecera" }, [
    el("table", { class: "tabla-tabla" }, [colgrupo(), encabezado]),
  ]);
  const form = el(
    "form",
    {
      class: "tabla-scroll",
      style: `max-height: ${FILAS_TABLA * ALTURA_FILA}px;`,
    },
    [el("table", { class: "tabla-tabla" }, [colgrupo(), cuerpo])]
  );
  form.addEventListener("scroll", alScroll);

  pintarFlechas();
  pintarFilas();
  $("#tabla").replaceChildren(cabecera, form);
  performance.mark(`tabla-lista-${estado.dia}`);
}

// ---------- ciclo principal ----------

// La búsqueda se conserva al cambiar de supermercado, ciudad o cobertura
async function renderDia({ conservarBusqueda = true } = {}) {
  const token = ++estado.token;
  const query = conservarBusqueda ? $("#busqueda input")?.value ?? "" : "";
  performance.mark(`cobertura-pedida-${estado.dia}`);
  const [filas, ranking] = await Promise.all([
    leerCobertura(estado.ciudad, estado.dia),
    leerRanking(estado.ciudad).catch((e) => {
      console.error(e);
      return [];
    }),
  ]);
  if (token !== estado.token) return; // llegó una selección más reciente
  // Solo filas con precio hoy y previo; el orden ya viene del archivo
  estado.dataDia = filas;
  estado.ranking = ranking;
  renderClasificaciones();
  renderBusqueda(query);
}

function fechaHace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Quita las ciudades sin datos recientes y los supermercados que se quedan sin ciudades
function filtrarVigentes(supers) {
  const minima = fechaHace(DIAS_VIGENTES);
  const vigentes = {};
  for (const [id, info] of Object.entries(supers)) {
    const ciudades = Object.fromEntries(
      Object.entries(info.ciudades).filter(([, c]) => c.ultima_fecha >= minima)
    );
    if (Object.keys(ciudades).length) vigentes[id] = { ...info, ciudades };
  }
  return vigentes;
}

function leerCiudadesRecordadas() {
  try {
    return JSON.parse(leer("ciudad")) ?? {};
  } catch {
    return {};
  }
}

async function iniciar() {
  performance.mark("inicio");
  try {
    estado.manifiesto = await cargarManifiesto();
    performance.mark("manifiesto");
  } catch (e) {
    console.error(e);
    $("#tabla").textContent = "No se pudieron cargar los datos.";
    return;
  }


  const supers = filtrarVigentes(estado.manifiesto.supermercados);
  estado.manifiesto.supermercados = supers;
  if (!Object.keys(supers).length) {
    $("#supermercados").replaceChildren();
    $("#tabla").textContent = "No hay supermercados con datos recientes.";
    return;
  }
  const guardado = leer("supermercado");
  const supermercado = supers[guardado]
    ? guardado
    : supers[SUPERMERCADO_DEFECTO]
      ? SUPERMERCADO_DEFECTO
      : Object.keys(supers)[0];
  estado.ciudadRecordada = leerCiudadesRecordadas();
  estado.dia = leer("dias") ?? DIA_DEFECTO;

  renderSupermercados();
  await seleccionarSupermercado(supermercado);
}

iniciar();
