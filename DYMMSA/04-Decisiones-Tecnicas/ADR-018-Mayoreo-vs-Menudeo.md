# ADR-018 — Planificador de compra: mayoreo vs menudeo (STD)

**Fecha:** 2026-07-15 · **Implementado:** 2026-07-15
**Estado:** Implementado
**Issue:** #20

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

## Addendum de implementación (2026-07-15)

Se implementó todo en una sola rama (`feat/20-purchase-planner`) en vez de las
4 issues planeadas. Desviaciones y hallazgos respecto a la definición:

1. **La lógica pura vive en `src/lib/purchase-plan.ts`** (espejo de
   `quotation-validation.ts`), no en `business-rules.ts` como decía el plan —
   es un dominio completo (consolidación, math, recomendación, staleness), no
   un helper suelto. Los defaults de umbrales también viven ahí.
2. **El caso "sin STD" del bucket _sin datos_ es inalcanzable**:
   `urrea_catalog.std` es `NOT NULL DEFAULT 1 CHECK > 0`. En la práctica
   _sin datos_ = en catálogo pero **sin precio utilizable** (todas las líneas
   con `unit_price = 0`; 0 = "sin capturar"). Hay guarda defensiva de todos
   modos (std inválido → bucket local).
3. **Precio del grupo = promedio ponderado por cantidad** de las líneas con
   precio > 0 (líneas duplicadas pueden tener precios distintos; el excedente
   es fungible entre ellas → media ponderada es el valor por pieza no sesgado;
   los 0 se excluyen para no subestimar el dinero parado).
4. **`order_items.model_code` se guarda crudo** (create-order copia verbatim)
   → todo cruce vía `catalogKey()`; las decisiones se persisten normalizadas.
5. **Recomendación "mixto" con 0 paquetes completos se sugiere como
   "menudeo"** (mismo reparto, nombre honesto). En la UI, la opción Mixto se
   oculta cuando duplica a otra (resto 0 o floor 0).
6. **PUT replace-all con upsert ANTES del delete** de removidas: una limpieza
   fallida deja filas de más (salen como huérfanas, inofensivas), nunca
   decisiones perdidas.
7. **Template URREA**: fórmulas pre-cargadas hasta la fila 1026 → máximo 1012
   filas de datos; el generador lanza error descriptivo si se excede.
8. **Órdenes `completed`/`cancelled`**: el PUT las rechaza (400) y la vista va
   read-only; cancelar NO borra decisiones (histórico), eliminar la orden sí
   (CASCADE).

Piezas: migración `create_purchase_planner_tables` · lib `purchase-plan.ts` +
`fetchCatalogEntryMap` · rutas `GET /api/orders/[id]/purchase-plan`,
`PUT /api/orders/[id]/purchase-decisions`, `GET/PATCH /api/settings` · hooks
`usePurchasePlan`/`useSavePurchaseDecisions`/`useUpdateSettings` · vista
`/dashboard/orders/[id]/planner` (`PurchasePlanner`) · Excel URREA desde
decisiones + export de compra local. 69 tests nuevos.
