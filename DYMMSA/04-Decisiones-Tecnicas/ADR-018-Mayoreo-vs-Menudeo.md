# ADR-018 — Planificador de compra: mayoreo vs menudeo (STD)

**Fecha:** 2026-07-15
**Estado:** Aceptado (definición) — implementación pendiente
**Issue:** #20 (el entregable de esa issue es este documento)

## Contexto

La mayoría de los productos que vende DYMMSA vienen del catálogo URREA, que se
compra por **paquetes** (`urrea_catalog.std` = unidades por paquete). Cuando la
cantidad necesitada no es múltiplo del STD hay dos opciones:

- **Mayoreo** (directo con URREA): precio mejor, pero el paquete completo deja
  piezas excedentes = dinero "parado" en mercancía + costo de almacenarla.
- **Menudeo** (proveedores locales): cantidad exacta, precio peor por pieza.

Hoy la orden manda TODO lo de marca URREA al formato de pedido URREA sin evaluar
esto, y además el filtro es incorrecto: usa `brand === 'URREA'` cuando el
criterio real es **pertenecer al catálogo URREA** (que incluye varias líneas:
URREA, SURTEK, FOY…).

## Decisión

Un módulo **"Planificar compra"**: vista dedicada dentro del detalle de la orden
(`/dashboard/orders/[id]`) que clasifica, calcula y recomienda por dónde comprar
cada producto — el sistema **sugiere, el usuario decide** (todo override-able).

### 1. Redefinición de "se le pide a URREA" ⚠️ regla crítica

```
pedible a URREA  ⇔  existe en urrea_catalog por catalogKey(model_code, brand)
```

Sustituye al filtro `brand === 'URREA'` del Excel URREA. Cruce estricto por
`(code, brand)` normalizados, consistente con [[ADR-013-Descripcion-DYMMSA]].
Al implementarse hay que actualizar la regla "Excel URREA" en `CLAUDE.md`.

### 2. Cubetas de clasificación

Cada ítem de la orden con `quantity_to_order > 0` (separadores excluidos, como
siempre):

| Cubeta | Criterio | Tratamiento |
|---|---|---|
| 🏭 Candidato URREA | En `urrea_catalog` con STD y precio | Matemática de decisión |
| 🛒 Compra local | No está en el catálogo | Lista para proveedores locales, sin math |
| ⚠️ Sin datos | En catálogo pero sin STD o sin precio | Decisión manual (solo regla de % si hay STD) |

### 3. Consolidación — la math corre sobre grupos

El cálculo se hace SIEMPRE sobre cantidades **consolidadas por
`catalogKey(model_code, brand)`**, nunca por línea. Razón: el mismo producto
puede aparecer en varias secciones de la orden (duplicados intencionales,
[[ADR-001-Separadores]]); 5+5 piezas con STD=10 es un paquete exacto (mayoreo
perfecto), pero por línea cada una diría "50% parado → menudeo".

El toggle agrupado/plano de la vista es **solo visualización** (agrupado por
default, con las líneas de origen expandibles). La decisión vive en el grupo.

### 4. Matemática de decisión (pedido MIXTO permitido)

Para cada grupo: necesidad `N`, paquete `M = std`, precio unitario `P`:

```
paquetes_completos = floor(N / M)     → casi siempre convienen en mayoreo
resto              = N mod M          → la decisión real es sobre el resto
excedente          = resto > 0 ? M − resto : 0
dinero_parado      = excedente × P
pct_parado         = excedente / M
```

Recomendación sobre el **resto** (umbrales configurables):

```
resto = 0                        → ✅ MAYOREO exacto (paquetes completos)
dinero_parado > umbral_dinero    → 🛒 resto a MENUDEO ($100 default)
pct_parado ≥ umbral_pct          → ⚠️ REVISAR (80% default; espacio vs precio, decide el usuario)
si no                            → ✅ MAYOREO redondeando al paquete extra
```

Resultado por grupo = plan mixto: `paquetes_mayoreo × M` piezas a URREA +
`qty_menudeo` piezas a compra local. Casos extremos: todo mayoreo
(`qty_menudeo = 0`) o todo menudeo (`paquetes_mayoreo = 0`, p. ej. N=2, M=10).

**Precio base:** `unit_price` de la orden (precio de venta) como **proxy** del
costo — sobreestima el dinero parado pero es proporcional y no exige capturar
costos. Si algún día se importan costos URREA (columna `cost` en
`urrea_catalog`), se cambia la fuente sin tocar la lógica. Limitación aceptada.

### 5. Persistencia — por orden, nunca global

**La recomendación se recalcula al vuelo en cada visita** con las cantidades de
ESA orden (hoy piden 4 → menudeo; el mes que entra piden 12 → mayoreo). No
existe "este producto ES de menudeo" como verdad global.

Lo que se **guarda** es la decisión final del usuario para esa orden, a nivel
grupo, en una tabla nueva:

```
order_purchase_decisions
  order_id     UUID FK → orders (ON DELETE CASCADE)
  model_code   TEXT    ┐ identidad del grupo (normalizados,
  brand        TEXT    ┘ UNIQUE(order_id, model_code, brand))
  std_snapshot INTEGER      -- STD usado al decidir
  needed_qty   INTEGER      -- N consolidado al decidir (para detectar staleness)
  packages_wholesale INTEGER -- paquetes a URREA
  qty_retail   INTEGER      -- piezas a menudeo local
  decided_at   TIMESTAMPTZ
```

- **Staleness:** si el `quantity_to_order` consolidado actual ≠ `needed_qty`
  guardado, la vista marca la decisión como desactualizada (⟳ recalcular);
  el Excel URREA avisa antes de generar si hay decisiones stale.
- Tabla separada (no columnas en `order_items`) porque la decisión es del
  grupo, no de la línea — evita desnormalizar el reparto paquete/resto entre
  filas duplicadas.

### 6. Salidas del módulo

- **Excel URREA (.xlsm):** incluye lo decidido mayoreo — cualquier línea del
  catálogo, no solo marca URREA — con cantidad en **PIEZAS múltiplo de STD**
  (`packages_wholesale × std_snapshot`). URREA recibe piezas, no paquetes
  (confirmado 2026-07-15).
- **Lista de compra local:** `qty_retail` de los grupos + la cubeta "compra
  local" completa. Exportable/imprimible para ir con proveedores.

### 7. Configuración de umbrales

Tabla `app_settings` (key-value, filas sueltas) con UI mínima en ajustes:
`purchase_threshold_money` (default 100 MXN) y `purchase_threshold_pct`
(default 0.80). Defaults ejecutables en `business-rules.ts` por si faltan filas.

### 8. Edge cases

- `STD = 1` → nunca hay excedente → siempre mayoreo.
- Precio 0/null → no hay dinero parado calculable → cubeta "sin datos" (se
  aplica solo la regla de % si hay STD).
- Producto en catálogo bajo OTRA marca (código existe solo en SURTEK pero el
  ítem dice URREA) → NO cruza (match estricto ADR-013) → cubeta compra local;
  el fix es corregir la marca en el catálogo ETM, igual que con la descripción.

## Fuera de alcance (ganchos futuros)

- **Excedente → inventario:** al recibir la orden, las piezas extra del
  redondeo (`packages × std − needed`) podrían sumarse a `store_inventory`
  automáticamente. El dato ya queda calculado en la decisión.
- **Columna `cost` en `urrea_catalog`** para dinero parado exacto (hoy proxy
  con precio de venta).

## Plan de issues de implementación (a crear al cerrar #20)

1. **Núcleo:** `computePurchasePlan()` en `business-rules.ts` (consolidación +
   math + recomendación, pura y testeable) + migración
   `order_purchase_decisions` + `app_settings`.
2. **Vista "Planificar compra"** en el detalle de orden: cubetas, grupos
   expandibles, chips de recomendación, overrides, staleness.
3. **Salidas:** Excel URREA desde decisiones (nuevo criterio de catálogo +
   piezas múltiplo de STD) + lista de compra local. Actualizar regla crítica
   en `CLAUDE.md`.
4. **Ajustes:** UI para umbrales (`app_settings`).
