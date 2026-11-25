// Visor de precios: JavaScript sin frameworks.
// Los datos son JSON generados por preparar.py en datos/. Cada archivo lleva el hash de su
// contenido en el nombre y nunca cambia. El manifiesto es lo único mutable: apunta a los archivos
// vigentes y se revalida sin avisar al volver a la pestaña y al hacer una selección. Cada cobertura tiene una cabeza pequeña
// (ranking y filas extremas, para pintar de inmediato) y un archivo completo (búsqueda y filtros).

// Debe coincidir con ESQUEMA en preparar.py
const ESQUEMA = 2;
// Entre dos revisiones del manifiesto por selecciones del usuario
const REVISION_MIN_MS = 30 * 1000;

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

function leerSesion(clave) {
  try {
    return sessionStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarSesion(clave, valor) {
  try {
    sessionStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento */
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

// ---------- datos (JSON) ----------

// Los archivos de datos no cambian nunca (el hash va en el nombre): "force-cache" evita
// revalidar. GitHub Pages ignora el query string, por eso el nombre es la única versión.
async function pedirJSON(ruta) {
  const r = await fetch(`datos/${ruta}`, { cache: "force-cache" });
  if (!r.ok) throw new Error(`${ruta}: ${r.status}`);
  return r.json();
}

class EsquemaDistinto extends Error {}

// Siempre se revalida (ETag): el manifiesto es el único archivo mutable
async function cargarManifiesto() {
  // index.html empieza a pedirlo antes de que este módulo cargue; solo sirve la primera vez
  const adelantado = window.__manifiesto;
  window.__manifiesto = null;
  let m;
  try {
    m = await (adelantado ?? fetchManifiesto());
  } catch (e) {
    if (!adelantado) throw e;
    m = await fetchManifiesto();
  }
  if (m.esquema !== ESQUEMA) throw new EsquemaDistinto();
  return m;
}

async function fetchManifiesto() {
  const r = await fetch("datos/manifiesto.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`manifiesto: ${r.status}`);
  return r.json();
}

// Esta página es de una publicación anterior a los datos: se recarga una vez
function recargarPorEsquema() {
  if (leerSesion("recarga-esquema")) return false;
  guardarSesion("recarga-esquema", "1");
  location.reload();
  return true;
}

// Columnas -> filas. Los precios vienen en centavos; el cambio se calcula aquí.
function filasDesdeColumnas(d) {
  const n = d.producto.length;
  const filas = new Array(n);
  const texto = (tipo, i) => (d[tipo][i] < 0 ? null : d.dic[tipo][d[tipo][i]]);
  for (let i = 0; i < n; i++) {
    const previo = d.previo[i] / 100;
    const hoy = d.hoy[i] / 100;
    filas[i] = {
      i,
      producto: d.producto[i],
      categoria: texto("categoria", i),
      subcategoria: texto("subcategoria", i),
      proveedor: texto("proveedor", i),
      previo,
      hoy,
      cambio: hoy / previo - 1,
    };
  }
  return filas;
}

const cabezas = new Map(); // ruta -> promesa de { completo, ranking, filas }
const completos = new Map(); // ruta -> promesa de filas
const completosListos = new Map(); // ruta -> filas, solo si ya llegaron

function leerCabeza(ruta, dias) {
  if (!cabezas.has(ruta)) {
    const p = pedirJSON(ruta).then((d) => ({
      completo: d.completo,
      ranking: d.ranking.map((g) => ({ ...g, dias })),
      filas: filasDesdeColumnas(d.filas),
    }));
    p.catch(() => cabezas.delete(ruta));
    cabezas.set(ruta, p);
  }
  return cabezas.get(ruta);
}

function leerCompleto(ruta) {
  if (!completos.has(ruta)) {
    const p = pedirJSON(ruta).then((d) => {
      const filas = filasDesdeColumnas(d);
      completosListos.set(ruta, filas);
      return filas;
    });
    p.catch(() => completos.delete(ruta));
    completos.set(ruta, p);
  }
  return completos.get(ruta);
}

// ---------- estado ----------

const estado = {
  clasificacion: null, // { tipo, grupo } elegido en el ranking; null = sin filtro
  ranking: [],
  manifiesto: null, // solo supermercados y ciudades vigentes
  generado: null, // identificador del manifiesto publicado que se está usando
  completo: false, // dataDia tiene todas las filas (y no solo la cabeza)
  error: false,
  supermercado: null,
  ciudades: null,
  ciudad: null,
  ciudadRecordada: {}, // última ciudad elegida por supermercado con ciudades
  dia: null,
  dataDia: [],
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
  animarAltura(document.querySelector(".controles"), () => {
    renderCiudades();
    renderTiempo();
  });
  await renderDia();
}

// Solo aparece si el supermercado tiene más de una ciudad
// Muestra u oculta la fila de ciudades con la altura animada del bloque de tiendas
function renderCiudades() {
  animarAltura(document.querySelector(".fila-tiendas"), pintarCiudades);
}

function pintarCiudades() {
  const contenedor = $("#ciudades");
  const entradas = Object.entries(estado.ciudades);
  const fila = $("#fila-ciudades");
  if (entradas.length <= 1) {
    contenedor.replaceChildren();
    fila.hidden = true;
    return;
  }
  fila.hidden = false;
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
    animarAltura(document.querySelector(".controles"), renderTiempo);
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
      .sort((a, b) =>
        estado.direccion === "sube"
          ? b.promedio_cambio - a.promedio_cambio
          : a.promedio_cambio - b.promedio_cambio
      );
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
  const filtrando = estado.clasificacion !== null || query.trim() !== "";
  // Con solo la cabeza, filtrar daría resultados incompletos: se espera al archivo completo
  const esperando = !estado.completo && filtrando;
  mostrarCarga(esperando);
  if (esperando) {
    $("#busqueda output").textContent = "cargando…";
    return;
  }
  const base = estado.clasificacion
    ? estado.dataDia.filter((f) => f[estado.clasificacion.tipo] === estado.clasificacion.grupo)
    : estado.dataDia;
  const resultado = filtrar(base, query, ["producto", "subcategoria"]);
  $("#busqueda output").textContent = `${(estado.completo ? resultado.length : coberturaActual().n).toLocaleString("en")} productos`;
  renderTabla(resultado);
}

// ---------- tabla ----------

// Filas con el nombre expandido en móvil (por posición en el archivo). Se reinicia al cambiar de selección.
const expandidas = new Set();

// Alterna el nombre de una fila entre una línea y todo el texto, animando la altura.
function alternarNombre(div) {
  const id = div.dataset.id;
  const antes = div.getBoundingClientRect().height;
  if (expandidas.has(id)) expandidas.delete(id);
  else expandidas.add(id);
  div.classList.toggle("expandida", expandidas.has(id));
  const despues = div.getBoundingClientRect().height;
  if (Math.abs(despues - antes) < 1) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  div.getAnimations().forEach((a) => a.cancel());
  div.style.overflow = "hidden";
  const animacion = div.animate(
    [{ height: `${antes}px` }, { height: `${despues}px` }],
    { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" }
  );
  const terminar = () => {
    if (div.getAnimations().length) return setTimeout(terminar, 50);
    div.style.overflow = "";
  };
  animacion.finished.then(terminar, terminar);
  setTimeout(terminar, 300);
}

function renderTabla(filas) {
  const dia = estado.dia;
  const columnas = [
    { clave: "producto", titulo: "producto", derecha: false, fmt: (v) => `${v}` },
    { clave: "previo", titulo: coberturas()[dia].etiqueta, derecha: true, fmt: numero },
    { clave: "hoy", titulo: "hoy", derecha: true, fmt: numero },
    { clave: "cambio", titulo: "variación", derecha: true, fmt: (v) => tendencia(v) },
  ];

  let orden = { clave: "cambio", desc: estado.direccion === "sube" };
  const cuerpo = el("tbody");
  cuerpo.addEventListener("click", (ev) => {
    const texto = ev.target.closest(".nombre-texto");
    if (!texto || !matchMedia("(max-width: 600px)").matches) return;
    alternarNombre(texto);
  });
  const cabeceras = columnas.map((c) => {
    const flecha = el("span");
    const th = el(
      "th",
      {
        title: c.clave,
        class: [c.derecha ? "num" : null, c.clave === "cambio" ? "sin-orden" : null].filter(Boolean).join(" ") || null,
      },
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
    tr.append(el("td", {}, [el("input", { type: "checkbox", value: f.i, disabled: true })]));
    for (const c of columnas) {
      const v = f[c.clave];
      const td = el("td", { class: c.derecha ? "num" : null });
      if (c.clave === "producto") {
        const texto = el("div", {
          class: expandidas.has(String(f.i)) ? "nombre-texto expandida" : "nombre-texto",
          "data-id": f.i,
        });
        if (definido(v)) texto.textContent = c.fmt(v);
        td.append(texto);
      } else if (definido(v)) {
        td.append(c.fmt(v));
      }
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
      // La variación no tiene flecha: su orden lo fija el control "precios que"
      th._flecha.textContent =
        th._clave !== "cambio" && th._clave === orden.clave ? (orden.desc ? "▾" : "▴") : "";
    }
  };

  cabeceras.forEach((th) => {
    if (th._clave === "cambio") return; // sin orden propio: sigue el control "precios que"
    th.addEventListener("click", (ev) => {
      // Con solo la cabeza, ordenar mostraría un subconjunto
      if (!estado.completo) return;
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
// Carga: la tabla pulsa suavemente. Su altura es fija desde el inicio.
function mostrarCarga(activa) {
  $("#tabla").classList.toggle("cargando", activa);
}

// "precios que [suben|bajan]": un solo botón que alterna la dirección.
// Define el orden de la tabla y de las sugerencias.
const TEXTO_DIRECCION = { sube: "suben", baja: "bajan" };

function renderDireccion() {
  const boton = el("button", {
    type: "button",
    class: "boton-direccion",
    "data-direccion": estado.direccion,
    "aria-label": "Cambiar entre precios que suben y precios que bajan",
  }, TEXTO_DIRECCION[estado.direccion]);
  boton.addEventListener("click", () => {
    estado.direccion = estado.direccion === "sube" ? "baja" : "sube";
    guardar("direccion", estado.direccion);
    boton.dataset.direccion = estado.direccion;
    boton.textContent = TEXTO_DIRECCION[estado.direccion];
    renderClasificaciones();
    actualizarTabla();
  });
  $("#direccion").replaceChildren(boton);
}

// Anima el cambio de altura de un elemento cuando cambia su contenido
function animarAltura(elemento, cambiar) {
  const antes = elemento.getBoundingClientRect().height;
  cambiar();
  const despues = elemento.getBoundingClientRect().height;
  if (Math.abs(despues - antes) < 1) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Una animación nueva reemplaza a la anterior en el mismo elemento
  elemento.getAnimations().forEach((a) => a.cancel());
  const version = (elemento.dataset.version = String(Number(elemento.dataset.version || 0) + 1));
  elemento.style.overflow = "hidden";
  const animacion = elemento.animate(
    [{ height: `${antes}px` }, { height: `${despues}px` }],
    { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" }
  );
  // Solo la última animación quita el recorte
  const terminar = () => {
    if (elemento.dataset.version !== version) return;
    // Si la animación sigue en curso, se vuelve a intentar en un instante
    if (elemento.getAnimations().length) return setTimeout(terminar, 50);
    elemento.style.overflow = "";
  };
  animacion.finished.then(terminar, terminar);
  setTimeout(terminar, 300); // respaldo si el evento de fin no llega
}

function coberturaActual() {
  return coberturas()[estado.dia];
}

// Si la clasificación elegida ya no está en el ranking (datos nuevos), se quita el filtro
function validarClasificacion() {
  const c = estado.clasificacion;
  if (!c) return;
  const dias = Number(estado.dia);
  if (!estado.ranking.some((g) => g.dias === dias && g.tipo === c.tipo && g.grupo === c.grupo)) {
    estado.clasificacion = null;
  }
}

function pintarDia(query) {
  expandidas.clear();
  validarClasificacion();
  animarAltura(document.querySelector(".controles"), renderClasificaciones);
  renderBusqueda(query);
}

async function renderDia({ conservarBusqueda = true } = {}) {
  const token = ++estado.token;
  const query = conservarBusqueda ? $("#busqueda input")?.value ?? "" : "";
  const cob = coberturaActual();
  performance.mark(`cobertura-pedida-${estado.dia}`);
  mostrarCarga(true);
  estado.error = false;
  revisarEnSegundoPlano();
  try {
    const completoListo = cob.datos ? completosListos.get(cob.datos) : null;
    // El archivo completo se pide ya, en paralelo con la cabeza
    const pedidoCompleto = cob.datos && !completoListo ? leerCompleto(cob.datos) : null;
    pedidoCompleto?.catch(() => {}); // el error se atiende más abajo, si la selección sigue vigente
    const cabeza = await leerCabeza(cob.cabeza, Number(estado.dia));
    if (token !== estado.token) return; // llegó una selección más reciente
    estado.ranking = cabeza.ranking;
    const listo = cob.datos ? completosListos.get(cob.datos) : null;
    estado.completo = cabeza.completo || Boolean(listo);
    estado.dataDia = listo ?? cabeza.filas;
    pintarDia(query);
    if (estado.completo) return;
    performance.mark(`cabeza-lista-${estado.dia}`);
    estado.dataDia = await pedidoCompleto;
    if (token !== estado.token) return;
    estado.completo = true;
    expandidas.clear();
    actualizarTabla();
  } catch (e) {
    if (token !== estado.token) return;
    console.error(e);
    // Un archivo puede haber desaparecido por una publicación nueva: se revisa el manifiesto.
    // Si cambió, esa revisión ya vuelve a pintar la selección.
    if (await revisarManifiesto()) return;
    if (token !== estado.token) return;
    estado.error = true;
    $("#tabla").textContent = "No se pudieron cargar los datos.";
  } finally {
    if (token === estado.token && (estado.completo || estado.error)) mostrarCarga(false);
  }
}

// ---------- manifiesto vigente ----------

let revisando = null;

// Pide el manifiesto. Si hay una publicación nueva, lo adopta y vuelve a pintar la selección
// actual conservando búsqueda y clasificación. Devuelve true si cambió.
function revisarManifiesto() {
  if (!revisando) {
    ultimaRevision = Date.now();
    revisando = (async () => {
      try {
        const nuevo = await cargarManifiesto();
        if (nuevo.generado === estado.generado) return false;
        await adoptarManifiesto(nuevo);
        return true;
      } catch (e) {
        if (e instanceof EsquemaDistinto) recargarPorEsquema();
        else console.warn("No se pudo revisar el manifiesto", e);
        return false;
      } finally {
        revisando = null;
      }
    })();
  }
  return revisando;
}

async function adoptarManifiesto(nuevo) {
  const supers = filtrarVigentes(nuevo.supermercados);
  estado.generado = nuevo.generado;
  estado.manifiesto = { ...nuevo, supermercados: supers };
  if (!Object.keys(supers).length) return;
  if (!estado.supermercado) return; // todavía en el inicio: lo termina iniciar()
  if (!supers[estado.supermercado]) estado.supermercado = Object.keys(supers)[0];
  estado.ciudades = supers[estado.supermercado].ciudades;
  if (!estado.ciudades[estado.ciudad]) estado.ciudad = Object.keys(estado.ciudades)[0];
  estado.dia = coberturaCercana(estado.dia);
  renderSupermercados();
  renderCiudades();
  renderTiempo();
  await renderDia();
}

// Una pestaña puede quedar abierta días: al volver a ella se revisa si hay datos nuevos.
// También se revisa en segundo plano al hacer una selección (sin esperar el resultado).
let ultimaRevision = Date.now();
function revisarEnSegundoPlano() {
  if (Date.now() - ultimaRevision < REVISION_MIN_MS) return;
  revisarManifiesto();
}

function vigilarManifiesto() {
  const revisar = () => {
    if (document.visibilityState !== "visible") return;
    revisarManifiesto().then((cambio) => {
      // Si la última carga falló (sin red) y no hubo cambio, se reintenta
      if (!cambio && estado.error) renderDia();
    });
  };
  document.addEventListener("visibilitychange", revisar);
  window.addEventListener("online", revisar);
  window.addEventListener("pageshow", (ev) => ev.persisted && revisar());
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
  mostrarCarga(true);
  let inicial;
  try {
    inicial = await cargarManifiesto();
    performance.mark("manifiesto");
  } catch (e) {
    if (e instanceof EsquemaDistinto && recargarPorEsquema()) return;
    console.error(e);
    mostrarCarga(false);
    $("#tabla").textContent = "No se pudieron cargar los datos.";
    return;
  }


  const supers = filtrarVigentes(inicial.supermercados);
  estado.generado = inicial.generado;
  estado.manifiesto = { ...inicial, supermercados: supers };
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
  estado.direccion = leer("direccion") === "baja" ? "baja" : "sube";

  renderSupermercados();
  renderDireccion();
  await seleccionarSupermercado(supermercado);
  vigilarManifiesto();
}

iniciar();
