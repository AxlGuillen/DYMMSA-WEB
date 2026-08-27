# ADR-022 — Módulo de corte de material (tubos y placas DYMMSA)

**Fecha:** 2026-07-31
**Estado:** Implementado (issue #59, Fases 1–5)
**Rama:** `feat/59-cut-module`

## Contexto

Los productos de marca **DYMMSA** se mandan a hacer: se compra tubo o placa de
cobre y se corta a la medida. Todo el cálculo era manual: hacer match de la
medida pedida con la que existe, sumar un margen de 1–2 cm por partición,
juntar piezas para saber cuánto material pedir, y en placas acomodar los cortes
para aprovechar el ancho.

Restricción clave: **no se conoce el catálogo del proveedor**. Se le pide, él
dice qué tiene ("tengo barras de 6 m") y el taller se adapta.

## Decisión

### El problema vive en dos momentos

1. **Necesidad neta** (sin proveedor): `Σ (longitud + margen) × cantidad` por
   diámetro; en placas, área total + **ancho mínimo** de tira (la pieza más
   ancha manda). Es la cifra para PEDIR — sobreestima ligera y a propósito.
2. **Acomodo** (con la presentación capturada): patrón de corte por barra
   (first-fit decreasing 1D) o por tira (filas/shelf), con sobrante visible.

Cada presentación capturada se guarda en `material_presentations` → **el
catálogo del proveedor se arma solo con el uso** (solo tubos: las tiras de
placa se venden por largo, sin presentación fija).

### Decisiones técnicas

| Decisión | Porqué |
|---|---|
| Medidas **estructuradas**, no parseo del texto | Las descripciones traen formatos mixtos (`30/300`, `25x300`); un error de parseo = material mal pedido |
| `cut_plan_pieces` **por orden**, no columnas del producto | Las longitudes pedidas varían por pedido; `etm_products.cut_*` solo PRE-llenan |
| Unidades **siempre en mm**, `numeric` | 1/2" = 12.7 mm rompería un integer |
| Coerción numeric→number **en la frontera del API** | supabase-js entrega `numeric` como string; la lib matemática solo ve numbers |
| **SVG 2D**, no 3D | Un corte prismático ES una barra segmentada / un rectángulo; el SVG se imprime para el taller |
| Modelo físico del margen: `[pieza][corte]…[sobrante]` | La última partición puede caer a ras (su margen no se exige al entrar); el sobrante descuenta un corte por segmento con clamp en 0 |
| Ajuste manual que **avisa, no bloquea** | El taller conoce restricciones que el algoritmo no; exceso en rojo con mm exactos. El layout manual se descarta por firma de entradas si cambian piezas/barra/margen |
| PUT **replace-all con restauración** | Sin llave natural para upsert → delete+insert; si el insert falla se reinsertan las filas previas |
| `requested_label` por pieza | Conserva el match "lo que pidió el cliente ↔ medida usada", que antes se perdía |
| Placas = **tira de ancho conocido** (strip/shelf), v1 sin rotación | Coincide con cómo se compra ("¿cuánto largo de esta tira?"); puede haber veta/acabado que respetar |
| Margen configurable `cut_margin_mm` (default 20, **0 válido**) | En `app_settings` con whitelist, como los umbrales de compra |

### Lo que quedó fuera (a posta)

- **Rotación de piezas** en placas y **retazos reutilizables**: mejoras futuras
  con modelo de datos propio.
- **Lote multi-orden**: las tablas nacen con `order_id`; agregarse en lote sería
  una vista de agregación, no un refactor.
- **Persistir el layout manual**: se recalcula al recargar (v1).
- **Costo del material**: solo cantidades.

## Consecuencias

- Entrada: botón "Planificar corte" en `OrderDetail` (solo si hay ítems DYMMSA)
  y desde la card de compra local del planificador.
- La lógica vive en `src/lib/cut-plan.ts` (funciones puras, 21 tests) — NO en
  `business-rules.ts`, igual que `purchase-plan.ts`.
- Excel "pedido de material" con la necesidad neta por medida; la página es
  imprimible (`print:hidden` en controles).


---

## Enmienda 2026-08-13 (issue #64): la placa se compra como HOJA, no como tira

La suposición original ("la placa se compra por largo de tira, con el ancho fijo del proveedor") resultó falsa: el proveedor vende **hojas de medida fija** (ancho × largo). El modelo cambió:

- `packStrip` → **`packSheets`**: mismas filas (shelf FFD por largo), pero paginadas en hojas de largo fijo (first-fit decreciente). Respuesta = cuántas hojas pedir y el acomodo de cada una.
- `CutStripDiagram` → **`CutSheetDiagram`**: una hoja por diagrama, con el sobrante punteado (como las barras) y aprovechamiento por hoja.
- La UI captura **ancho × largo de la hoja**; imposibles ahora incluyen piezas más LARGAS que la hoja, no solo más anchas.
- Las **hojas de placa SÍ se guardan como presentaciones** (`material_presentations` con thickness+width+length) — la exclusión "solo tubos" aplicaba al modelo de tira, que no tenía medida fija.

---

## Enmienda 2026-08-20 (issue #71): corte rápido, siembra desde cotización y control de medidas

El planificador solo se alcanzaba desde una orden. Tres accesos nuevos:

### Modo rápido efímero (`/dashboard/cutting`, sidebar DYMMSA)

- **Decisión: EFÍMERO, sin migración.** `cut_plan_pieces` tiene FK `order_id NOT NULL` y el caso de uso ("un corte al vuelo") no amerita persistir planes sin orden. Las piezas viven en el store Zustand **`dymmsa-cut-draft`** (localStorage — un refresh no pierde la captura; botón "Limpiar" con confirmación). Las **presentaciones del proveedor SÍ persisten** (son globales, el catálogo se sigue armando solo desde este modo).
- `CutPlanner` ganó el prop `standalone` (initialDrafts + onDraftsChange + onClear + seededFrom): mismo componente, con el guardado de lista APAGADO — el footer cambia a "Registrar medidas del proveedor" (solo `POST /material-presentations`). El modo orden queda intacto.
- `GET /api/material-presentations` nuevo (el modo rápido no tiene el cut-plan de orden que las traía embebidas) + `useCutMargin()` (settings global).

### Siembra desde la cotización

- `GET /api/quotations/[id]/cut-candidates`: misma forma que los candidatos del cut-plan de orden (cruce con los `cut_*` nominales de `etm_products`, marca trim+upper), sobre `quotation_items`. Separadores fuera e **`is_sold=false` fuera** (lo que no se vende no se manda a hacer).
- Botón "Planificar corte" en `QuotationDetail` (solo con piezas DYMMSA): siembra los candidatos en el borrador rápido y navega. Efímero a propósito: cuando la orden exista, el plan real nace de la orden como siempre — no hay dos verdades.

### Control de medidas (`/dashboard/materials`, sidebar DYMMSA)

- El catálogo `material_presentations` se arma solo → no había forma de corregir una captura errónea. Página nueva: tubos y placas con último uso, alta manual y **eliminar** (`DELETE /api/material-presentations/[id]`). Borrar es seguro: `cut_plan_pieces` no referencia presentaciones — solo desaparece la sugerencia.

### Diagramas más entendibles (punto 3 de la issue)

- El paso de la sierra ahora es un **achurado diagonal** (patrón SVG con id por instancia via `useId`) en vez de un bloque sólido confundible con una pieza delgada; tooltip con el margen.
- El sobrante punteado muestra su medida dentro del área cuando cabe el texto.
- **`CutLegend`** compartida (pieza / corte de sierra / sobrante), una por grupo — no por diagrama.

---

## Enmienda 2026-08-26 (issue #81): acomodo de placas por CARRILES, no por filas

Reporte de campo: hoja 150×420 con piezas 30×400 + 2×100×200 pedía **2 hojas** cuando todo cabe en **1**. Causa: el modelo shelf armaba filas definidas por el LARGO de su pieza más larga — todas las piezas de una fila compartían el mismo inicio en X, así que una pieza jamás podía ir DESPUÉS de otra a lo largo.

- `packSheets` ahora acomoda por **carriles a lo ancho** (FFD por ancho): dentro de un carril las piezas van **punta con punta a lo largo** con margen entre cortes — el mismo modelo 1D de las barras, por banda. Una pieza angosta puede rellenar el largo restante de un carril ancho.
- `PackedSheet` pasa de `shelves` a `lanes` con **posiciones explícitas** (`xMm`, `yMm`) por pieza; `CutSheetDiagram` dibuja en coordenadas reales, con sobrante punteado POR CARRIL + banda de ancho libre, y el corte entre carriles corre a lo largo de lo usado (rip).
- El caption de la hoja ahora reporta también el **ancho libre**.
- Regresión fijada en tests con el caso reportado (1 hoja, encaje exacto 420 y 150).
- **Rotación 90° (misma enmienda):** cada pieza puede girarse si así cabe — a veces rotar evita comprar otra hoja. `packSheets` acepta `{ allowRotation }` (default `false` en la lib, conservador); la UI lo activa POR DEFECTO con un toggle por espesor ("Rotar piezas si así caben") que se apaga cuando la veta/acabado manda — la reserva original de v1 pasa de prohibición a opción. Reglas de orientación: en carril existente gana la de MENOR largo (conserva carril); en carril/hoja nuevos la más ANGOSTA (conserva ancho). Las piezas rotadas se marcan (`rotated`) y el tooltip del diagrama lo dice.
