# Precios de productos en tiendas de Bolivia

## Qué es

Precios diarios de productos en tiendas en línea de Bolivia. Cada día, un script consulta el catálogo público de cada tienda y guarda el precio de cada producto. El resultado es una serie de precios a nivel de producto, con frecuencia diaria y sin rezago de publicación. Sirve como insumo para monitorear y hacer nowcasting de inflación.

| Tienda | Qué vende | Ciudades | Estado |
| --- | --- | --- | --- |
| [Hipermaxi](data/hipermaxi/) | Supermercado: abarrotes, bebidas, lácteos, carnes, frutas y verduras, limpieza, cuidado personal, bazar | La Paz, Cochabamba, Santa Cruz | Activa |
| [Fidalga](data/fidalga/) | Abarrotes y bebidas de consumo masivo | Nacional | Activa |
| [Farmacorp](data/farmacorp/) | Farmacia: medicamentos, cuidado personal, bebés, algunos abarrotes | Nacional | Activa |
| [Multicenter](data/multicenter/) | Hogar, ferretería, juguetes, decoración, tecnología. Casi sin alimentos | Nacional | Activa |
| [IC Norte](data/icnorte/) | Supermercado: abarrotes, limpieza, cuidado personal, frutas y verduras, carnes | Nacional | Sin actualizar desde 2026-09-24 |
| [Ketal](data/ketal/) | Supermercado | Nacional | Cerrada: 2021-11-15 a 2022-10-31 |

Para medir inflación de alimentos y de consumo básico, la fuente principal es Hipermaxi. Es la que tiene más historia (desde 2024-07-28), más productos de supermercado y precios por ciudad. Fidalga e IC Norte son canastas pequeñas de consumo masivo. Farmacorp sirve para medicamentos y cuidado personal. Multicenter sirve para bienes durables y del hogar.

Qué no hay en los datos:

- No hay ventas ni cantidades vendidas. No se pueden calcular ponderadores con estos datos.
- No hay unidad de medida ni precio por unidad. El peso o volumen, si existe, está dentro del nombre del producto (`Leche 1 L`).
- No hay un código común entre tiendas. Un mismo producto tiene un `id_producto` distinto en cada tienda.
- No hay precio regular. Hipermaxi marca con `oferta = 1` los precios rebajados, pero `precio` ya es el precio rebajado.
- No hay indicador de falta de stock. Un producto sin fila ese día no estaba listado.
- Hipermaxi usa una sola sucursal por ciudad: Achumani (La Paz), Sacaba (Cochabamba) y Las Brisas (Santa Cruz). `sucursales.csv` lista todas las sucursales, pero los precios no son por sucursal.
- Los productos son los del catálogo de la tienda, no una canasta fija. No es la canasta del INE.

### Cobertura

<!-- cobertura:inicio -->
Datos al **2026-11-26**. Se genera con `update/cobertura.py` y también está en [cobertura.json](cobertura.json).

| Tienda | Ciudad | Desde | Hasta | Días con datos | Días sin datos | Productos en el último día | Productos en total |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| [Hipermaxi](data/hipermaxi/) | La Paz | 2024-07-28 | 2026-11-25 | 841 | 10 | 13,890 | 23,180 |
| [Hipermaxi](data/hipermaxi/) | Cochabamba | 2024-07-28 | 2026-11-25 | 841 | 10 | 13,358 | 22,901 |
| [Hipermaxi](data/hipermaxi/) | Santa Cruz | 2024-07-28 | 2026-11-25 | 841 | 10 | 13,522 | 22,768 |
| [Fidalga](data/fidalga/) | Nacional | 2025-06-13 | 2026-11-26 | 532 | 0 | 879 | 1,128 |
| [Farmacorp](data/farmacorp/) | Nacional | 2025-06-13 | 2026-11-26 | 532 | 0 | 16,820 | 24,269 |
| [Multicenter](data/multicenter/) | Nacional | 2025-06-15 | 2026-11-26 | 530 | 0 | 10,847 | 23,567 |
| [IC Norte](data/icnorte/) | Nacional | 2025-06-15 | 2026-09-24 (sin actualizar) | 467 | 0 | 1,771 | 1,775 |
| [Ketal](data/ketal/) | Nacional | 2021-11-15 | 2022-10-31 (cerrada) | 346 | 5 | n/d | 10,011 |

Días sin datos:

- Hipermaxi (La Paz, Cochabamba, Santa Cruz): 2025-06-04 a 2025-06-10, 2025-12-22, 2026-01-11, 2026-03-12

Categorías principales entre los productos del último día:

- Hipermaxi en La Paz: Abarrotes (4,918), Cuidado Personal (2,410), Bebidas (1,518), Cuidado del Hogar (1,254), Bazar Importación (827), Bazar (704)
- Multicenter: Herramientas (2,292), Hogar (1,620), Juguetería (1,027), navidad (667), Dormitorio y Baño (607), Oficina (530)
- IC Norte: CUIDADO PERSONAL (1,102), ABARROTES Y DESPENSA (920), LIMPIEZA Y DETERGENTES (434), Panadería y Repostería (172), CARNES, MARISCOS Y PESCADO (162), FRUTAS Y VERDURAS (162)
- Fidalga y Farmacorp: sin categoría principal (ver más abajo).
<!-- cobertura:fin -->

## Cómo usarlo

### Estructura

```
data/
├── hipermaxi/
│   ├── productos.csv            catálogo: id_producto, producto, categoria, subcategoria
│   ├── sucursales.csv           sucursales y regiones
│   ├── la_paz/AAAA_MM.csv       precios: fecha, id_producto, precio, oferta
│   ├── cochabamba/AAAA_MM.csv
│   └── santa_cruz/AAAA_MM.csv
├── fidalga/ farmacorp/ multicenter/ icnorte/
│   ├── productos.csv            catálogo: id_producto, producto, proveedor, categoria
│   └── precios/AAAA_MM.csv      precios: fecha, id_producto, precio
├── ketal/                       histórico, con otro esquema (id, name, brand, category; time, id, price, quantity)
│   ├── productos.csv
│   └── AAAA_MM.csv
└── */datapackage.json           esquema, claves y notas de cada tienda
cobertura.json                   cobertura actual, para programas
update/                          scripts que consultan cada tienda
view/                            visor web: https://mauforonda.github.io/precios/
```

Cada tienda tiene su `datapackage.json` con los campos, tipos y advertencias. Léelo antes de usar una tienda por primera vez.

Los precios están en bolivianos (BOB). Hay un archivo por mes (y por ciudad en Hipermaxi). La `fecha` es el día en que se consultó el precio, en hora de La Paz. La consulta ocurre de madrugada.

### Leer los datos

Cada tienda se lee con una consulta de DuckDB sobre sus archivos. Por ejemplo, el precio diario de la leche en La Paz:

```sql
SELECT p.fecha::DATE AS fecha, c.producto, p.precio, p.oferta
FROM read_csv('data/hipermaxi/la_paz/*.csv') p
JOIN read_csv('data/hipermaxi/productos.csv') c USING (id_producto)
WHERE c.producto ILIKE '%leche pil%entera%'
ORDER BY c.producto, fecha;
```

El mismo patrón sirve para las otras tiendas. Cambia la ruta de precios a `data/<tienda>/precios/*.csv` y quita `oferta`. En Multicenter, IC Norte, Fidalga y Farmacorp, `fecha` incluye una hora (`2026-11-01 00:00:00`): usa `fecha::DATE`.

### Preguntas comunes

**¿Hasta qué fecha hay datos? ¿Cuántos productos hay?** Lee `cobertura.json` o la tabla de cobertura de este archivo. No cuentes archivos ni filas: las filas repetidas y los días sin datos distorsionan el resultado.

**¿Cuánto cuesta un producto hoy?** Busca el producto en `productos.csv` por nombre. Toma su precio en la `fecha` más reciente de esa tienda. Si el producto no tiene fila en esa fecha, la tienda no lo listaba ese día.

**¿Cuánto cambió el precio de una categoría o de toda la tienda?** No promedies los precios de todos los productos de cada día. El conjunto de productos cambia de un día a otro y el promedio mezcla productos baratos y caros. Compara solo los productos que existen en ambos períodos y promedia las razones de precios con media geométrica (índice de Jevons). Este ejemplo calcula un índice mensual encadenado, base 100 en el primer mes, para Hipermaxi en La Paz:

```sql
WITH p AS (
  SELECT DISTINCT fecha::DATE AS fecha, id_producto, precio
  FROM read_csv('data/hipermaxi/la_paz/*.csv')
  WHERE precio > 0),
m AS (
  SELECT date_trunc('month', fecha) AS mes, id_producto, avg(precio) AS precio
  FROM p GROUP BY ALL),
r AS (
  SELECT a.mes, exp(avg(ln(a.precio / b.precio))) AS razon
  FROM m a JOIN m b ON b.id_producto = a.id_producto AND b.mes = a.mes - INTERVAL 1 MONTH
  GROUP BY a.mes)
SELECT mes, round(100 * exp(sum(ln(razon)) OVER (ORDER BY mes)), 2) AS indice
FROM r ORDER BY mes;
```

Para una categoría, une con `productos.csv` y filtra por `categoria` en la CTE `p`. El primer mes (2024-07) y el último mes de cualquier serie son parciales. Es un índice no ponderado: todos los productos pesan igual.

**¿Cómo se compara una ciudad con otra?** Solo Hipermaxi tiene ciudades. El catálogo es compartido, pero cerca de la mitad de los productos (45 %) no está en las tres ciudades. Compara solo productos con precio en las dos ciudades. Cerca de dos tercios de los productos comunes tienen precios distintos entre La Paz y Santa Cruz.

**¿Qué tan seguido cambian los precios?** Depende de la tienda. En Hipermaxi, Fidalga e IC Norte cambia menos del 1 % de los productos por día. En Farmacorp cambia cerca del 2.6 %. En Multicenter cambia cerca del 9 % y cerca de 3 de cada 10 cambios se revierten en la observación siguiente. Probablemente son rebajas temporales y no inflación. Para Multicenter usa promedios mensuales y no cambios diarios.

### Cuidados con los datos

- **Filas repetidas.** Hay filas idénticas para el mismo `fecha` y `id_producto` (Farmacorp, Multicenter, Hipermaxi). Vienen de ejecuciones repetidas el mismo día. Usa `SELECT DISTINCT` antes de agregar. Los precios repetidos nunca difieren.
- **Precio cero.** Farmacorp, Multicenter y Fidalga tienen filas con `precio = 0` (productos sin precio, pocos). Excluye `precio > 0` en todo cálculo.
- **Precios extremos.** Hay productos muy caros (medicamentos especializados en Farmacorp, cámaras en Multicenter). Un promedio de precios los domina. Usa razones de precios o la mediana.
- **Productos que aparecen y desaparecen.** Cada día solo hay fila de los productos listados. El catálogo crece, se reduce y rota: entre un cuarto y dos quintos de los productos de hoy no existían hace un año. Nunca interpretes la ausencia de fila como precio cero o como cambio de precio.
- **Días sin datos.** Algunos días no se guardó ningún precio (lista en la cobertura). Una serie diaria necesita interpolar o ignorar esos días. Una tienda sin actualizar no tiene filas después de su fecha `Hasta`.
- **Categorías.** Cada tienda usa su propia clasificación, y no coinciden entre tiendas.
  - Hipermaxi: `categoria` (27) y `subcategoria` (162). Algunas categorías son pequeñas y están duplicadas con otro nombre (`Cuidados Otc` y `CUDADOS OTC`).
  - Multicenter e IC Norte: `categoria` es una ruta con barras, `/Nivel1/Nivel2/Nivel3/`. Separa por `/` para tener cada nivel. Multicenter escribe algunos niveles con mayúsculas distintas (`Tecnología` y `tecnología`).
  - Fidalga: `categoria` es un tipo de producto muy específico (cerca de 500 valores).
  - Farmacorp: `categoria` está siempre vacía. Usa `proveedor` o busca por nombre.
  - Hipermaxi no tiene `proveedor`.
- **Codificación.** Algunos nombres de Fidalga y Multicenter tienen texto dañado (`NescafÃ©` en vez de `Nescafé`). Se puede reparar con `texto.encode('latin-1').decode('utf-8')`. `view/preparar.py` ya lo hace.
- **Precio de la primera variante.** En las tiendas Shopify (Fidalga, Farmacorp) y en las VTEX (Multicenter, IC Norte), el script guarda el precio de la primera presentación del producto. Un producto con varias presentaciones tiene un solo precio.
- **Combos.** Los combos y paquetes son productos distintos, con su propio `id_producto`.
- **Series con otro esquema.** Ketal usa `id`, `name`, `brand`, `category`, `time`, `price` y `quantity`. `quantity` es la cantidad que reporta la fuente. Tiene muchos ceros y el valor 9999 en unas 48 mil filas. No la uses como stock sin revisarla.

### Cómo se actualiza

Cada tienda tiene un script en `update/` y un flujo de GitHub Actions en `.github/workflows/` que lo ejecuta una vez al día y guarda los cambios en el repositorio:

| Flujo | Tiendas | Hora (La Paz) |
| --- | --- | --- |
| `update.yml` | Hipermaxi | 00:00 |
| `update_shopify.yml` | Fidalga y Farmacorp | 01:00 |
| `update_multicenter.yml` | Multicenter | 02:00 |
| `update_icnorte.yml` | IC Norte | 02:00 |
| `cobertura.yml` | Recalcula `cobertura.json` y la tabla de cobertura de este archivo | Después de cada actualización |
| `publish.yml` | Publica el visor en GitHub Pages | Después de cada actualización |

Los scripts agregan filas a `precios/AAAA_MM.csv` y actualizan `productos.csv`. Si se ejecutan dos veces el mismo día, repiten las filas.

Para recalcular la cobertura en local:

```bash
pip install -r update/requirements_cobertura.txt
python update/cobertura.py
```

Para agregar una tienda:

1. Crea `update/<tienda>.py`. Si la tienda usa Shopify, reutiliza `update/utils/shopify.py`.
2. Crea un flujo en `.github/workflows/`.
3. Escribe `data/<tienda>/datapackage.json`.
4. Agrega la tienda a `SERIES` en `update/cobertura.py`, a `FUENTES` en `view/preparar.py` y a la tabla de este archivo.

### Visor

[Explora](https://mauforonda.github.io/precios/) variaciones de precios en las tiendas activas. El código está en [view/](view/readme.md).
