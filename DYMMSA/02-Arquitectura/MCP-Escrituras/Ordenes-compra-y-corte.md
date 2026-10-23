# MCP escrituras — Órdenes: planificador de compra y plan de corte

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[02-Arquitectura/MCP-Escrituras/Ordenes]]
> ADRs: [[04-Decisiones-Tecnicas/ADR-018-Mayoreo-vs-Menudeo]] · [[04-Decisiones-Tecnicas/ADR-022-Modulo-de-Corte]] · [[04-Decisiones-Tecnicas/ADR-034-MCP-Reglas-de-Crecimiento]]

## Resumen

Dos sub-pantallas de una orden que **no mueven stock ni dinero**. Lo que guardan es la decisión de cómo pedir el material. El **planificador de compra** (`/dashboard/orders/[id]/planner`) guarda la decisión mayoreo/menudeo por grupo código+marca (`order_purchase_decisions`), y de ahí salen el Excel URREA y el "Copiar para Excel". El **plan de corte** (`/dashboard/orders/[id]/cutting`) guarda las piezas de tubo y placa DYMMSA que se mandan a hacer (`cut_plan_pieces`). El MCP hoy las **lee** (`get_purchase_plan`, `get_cut_plan`) y solo escribe el catálogo de presentaciones (`save_material_presentation`). Riesgo general **medio**. Las dos rutas son replace-all: un payload incompleto borra lo que no viene. Además, el servidor confía en lo que calcula la pantalla, como el STD, la necesidad o que no queden grupos "Revisar".

## Rutas que escriben

### `PUT /api/orders/[id]/purchase-decisions` — `src/app/api/orders/[id]/purchase-decisions/route.ts`
- **Auth / rol:** `requireAuth`. RLS de `order_purchase_decisions`: `FOR ALL TO authenticated USING (true)`.
- **Entrada:** `{ decisions: [{ model_code, brand, std_snapshot, needed_qty, packages_wholesale, qty_retail }] }`. Validación **inline** en la ruta:
  - Normaliza el código y la marca con `normalizeCatalogCode`/`normalizeCatalogBrand` (business-rules). Sin código → 400.
  - `std_snapshot` y `needed_qty` deben ser enteros ≥ 1. `packages_wholesale` y `qty_retail` deben ser enteros ≥ 0.
  - Valida antes el CHECK `check_decision_covers_needed`: `paq × std + retail ≥ needed`, con mensaje claro.
  - Un `(marca, código)` duplicado → 400.
- **Qué hace:**
  1. Lee la orden: 404 si no existe, 400 si está `completed` o `cancelled`.
  2. Hace upsert de todas las filas (`onConflict: 'order_id,model_code,brand'`, `decided_at = now`).
  3. Lee las existentes y borra las que no vinieron en el payload.
  4. Responde `{ decisions: saved }`.
- **Reglas y efectos secundarios:**
  - **Replace-all** (ADR-018): el upsert va **antes** del delete. Si la limpieza falla, se ignora a propósito: quedan huérfanas inofensivas, que el plan muestra como `orphanDecisions`. Un arreglo vacío borra todas.
  - Errores de constraint → `explainPgError` → 400. El resto → 500.
  - No hay transacción, pero el orden upsert→delete hace que un fallo no pierda decisiones.
  - **Lo que el servidor no verifica** (hoy lo garantiza la pantalla):
    - `std_snapshot` y `needed_qty` llegan del cliente. El servidor no los compara contra el catálogo ni contra la necesidad consolidada actual. Un payload con STD inventado se guarda tal cual, y luego el Excel URREA multiplica `paquetes × std_snapshot`.
    - **Los grupos "Revisar" no bloquean el guardado en el servidor.** El bloqueo vive en `PurchasePlanner` (`pendingCount` → toast). La ruta acepta cualquier subconjunto de grupos y borra los que falten.
    - Acepta cualquier reparto que cubra la necesidad, por ejemplo 100 paquetes para 37 piezas. La pantalla solo produce los tres repartos de `applyChoice` (`wholesale`, `mixed`, `retail`).
    - No valida que el código y la marca pertenezcan a un grupo del plan de esa orden. Puede guardar una decisión huérfana desde el primer día.
- **Dónde vive la lógica:**
  - **Mixta.** La matemática vive en `src/lib/purchase-plan.ts` y es reutilizable: `buildPurchasePlan`, `consolidateOrderItems`, `computeGroupMath`, `recommendPurchase`, `applyChoice`, `isDecisionStale`, `summarizePlanDecisions`, `resolveThresholds`. Las demás piezas también ya existen: `fetchCatalogEntryMap` en `urrea-catalog.ts` y la normalización en `business-rules.ts`.
  - En cambio, el armado del payload desde la elección (`buildDecisions`, `savedChoice`, `isDirty`) vive en el componente `PurchasePlanner.tsx`. La validación de filas vive inline en la ruta.
  - **Hay que extraer** a `src/lib/purchase-decisions-store.ts`:
    - `parseDecisions()`, la validación de la ruta.
    - `choiceOf()`, hoy duplicado entre `PurchasePlanner` (`savedChoice`) y `src/lib/mcp/tools/purchase.ts`.
    - Una función que, a partir del plan **calculado en el servidor**, arme el set completo de decisiones.
- **Quién la usa en la UI:** `useSavePurchaseDecisions` (`src/hooks/usePurchasePlan.ts`) → `PurchasePlanner`, en tres lugares:
  - el botón "Guardar decisiones";
  - **implícitamente** antes de "Descargar pedido URREA" y de "Copiar para Excel", cuando `isDirty`. Los tres se bloquean si hay grupos sin decidir.

### `PUT /api/orders/[id]/cut-plan` — `src/app/api/orders/[id]/cut-plan/route.ts`
- **Auth / rol:** `requireAuth`. RLS de `cut_plan_pieces`: `FOR ALL TO authenticated USING (true)` (GRANT ALL incluso a `anon`).
- **Entrada:** `{ pieces: [{ material_type, diameter_mm?, thickness_mm?, width_mm?, length_mm, quantity, requested_label?, source_item_id? }] }`. Validación **inline**, por pieza:
  - `material_type` debe ser `tube` o `plate`.
  - `length_mm > 0` y `quantity` entero ≥ 1.
  - Replica el CHECK `cut_piece_shape`: un tubo exige diámetro y no admite ancho ni espesor; una placa exige espesor y ancho y no admite diámetro.
  - `requested_label` se recorta (trim; vacío → null).
- **Qué hace:**
  1. Lee la orden: 404 si no existe, 400 si está `completed` o `cancelled`.
  2. Valida las piezas y asigna `sort_order = índice`.
  3. Toma un **snapshot** de las piezas actuales.
  4. Borra todas las piezas de la orden. Si la lista nueva está vacía, termina ahí.
  5. Inserta la lista nueva. Si el insert falla, **reinserta el snapshot** (sin `id`) y responde 400 vía `explainPgError` o 500.
- **Reglas y efectos secundarios:**
  - Replace-all con restauración (ADR-022). **No es transaccional**: si también falla la restauración, solo se loguea y la lista se pierde.
  - Unidades en mm (`numeric`). Los `numeric` regresan de supabase-js como string. El GET de esta ruta y `get_cut_plan` los convierten en la frontera, nunca en la lib.
  - **`source_item_id` no se valida contra la orden**: la FK solo exige que el ítem exista. Una pieza puede apuntar a una línea de otra orden.
  - No toca `material_presentations` ni el margen. La pantalla guarda las presentaciones aparte, después (`savePresentation`, `POST /api/material-presentations`), y el margen en `PATCH /api/settings`.
  - El botón solo aparece si la orden tiene líneas DYMMSA, pero la ruta acepta cualquier orden.
- **Dónde vive la lógica:** **mixta**. La matemática vive en `src/lib/cut-plan.ts`: `tubeNetNeeds`, `plateNetNeeds`, `packBars`, `packSheets`, `resolveCutMargin`, y `parsePresentationInput` para presentaciones. **La validación de piezas no está en lib.** Hay que extraer un `parseCutPieces()` a `cut-plan.ts`, con la misma forma que `parsePresentationInput`, y el delete→insert→restore a un `saveCutPlanPieces()`. Puede ir en `cut-plan.ts` si se acepta I/O ahí, o en un `cut-plan-store.ts`.
- **Quién la usa en la UI:** `useSaveCutPlan` (`src/hooks/useCutPlan.ts`) → `CutPlanner` en modo orden, en el botón "Guardar". En modo `standalone` (**Corte rápido**, `/dashboard/cutting`) nunca se llama: las piezas viven en localStorage `dymmsa-cut-draft` (#71).

## Cobertura MCP actual

- **`get_purchase_plan`** (lectura): recibe `orden` (id o nombre, vía `resolveOrder`) y arma el mismo `buildPurchasePlan` que la pantalla. Devuelve, por grupo:
  - el bucket (`catálogo`, `catálogo sin precio`, `compra local`);
  - la matemática (paquetes completos, resto, excedente, dinero y % parado);
  - la recomendación (`revisar (decide el usuario)` cuando aplica);
  - la decisión guardada (elección, paquetes, piezas, `desactualizada`).
  
  Trae además los umbrales y un resumen con `decisiones_huerfanas`.
- **`get_cut_plan`** (lectura): recibe `orden` (id o nombre). Devuelve las piezas agrupadas por diámetro o espesor, la necesidad neta con margen y, por cada presentación capturada, cuántas barras u hojas salen y qué piezas no caben.
- **`save_material_presentation`** (escritura, **no** `adminOnly`): registra o refresca una barra de tubo o una hoja de placa en `material_presentations`. Usa `parsePresentationInput` y `PRESENTATION_KEY`, compartidas con `POST /api/material-presentations`. No borra.
- **`get_app_settings`** (lectura) da los umbrales y el margen. Escribir esos settings es de la ficha de Configuración.
- **Hoy no se puede desde el chat:** decidir mayoreo, mixto o menudeo de un grupo; resolver los "Revisar"; recalcular decisiones desactualizadas; capturar, editar o quitar piezas de corte. Tampoco hay tool que genere el Excel URREA ni el texto de "Copiar para Excel". Es salida de archivo o portapapeles, no escritura, pero es el paso siguiente natural.

## Casos de uso desde el chat

1. "En la orden de GE acepta todas las recomendaciones." → `purchase-decisions`: el set completo con `recommendation.suggested` de cada grupo. Falla si queda algún "Revisar".
2. "El 6954 mándalo todo a menudeo y el 4410 mixto." → `purchase-decisions` con esos dos grupos y el resto como esté guardado o recomendado (replace-all).
3. "Hay tres en Revisar: los tres a mayoreo." → `purchase-decisions`. Desbloquea el Excel URREA.
4. "La orden cambió, recalcula las decisiones desactualizadas." → `purchase-decisions` reaplicando la elección guardada sobre la matemática actual (`applyChoice`), igual que hace la pantalla al guardar con `isStale`.
5. "Agrega a la lista de corte de la orden 12 cuatro tubos de 1 pulgada de 300 mm." → `cut-plan` (lista actual + nuevas). Pulgadas ×25.4, confirmando la conversión.
6. "El cliente pidió 'punta 30/300', usa tubo de 30 mm por 300." → `cut-plan` con `requested_label`.
7. "Quita las placas de 6 mm de la lista de corte." → `cut-plan` (replace-all sin esas piezas).
8. "Borra toda la lista de corte de la orden 12." → `cut-plan` con `pieces: []`.

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Decidir uno o varios grupos (mayoreo/mixto/menudeo) | medio | Define qué y cuánto se pide a URREA (Excel y copiado) y qué va a compra local. Error = dinero parado o faltantes. Reversible; no mueve stock. |
| Aceptar todas las recomendaciones | medio | Igual, en bloque. Debe frenar si hay "Revisar" (hoy solo lo frena la pantalla). |
| Guardar un set parcial | medio | Replace-all: los grupos omitidos pierden su decisión. La tool debe completar el set, nunca mandar parcial. |
| Agregar piezas de corte | bajo | Solo agrega a la lista; no toca stock ni dinero; error visible en `get_cut_plan`. |
| Editar o quitar piezas de corte / reemplazar la lista | medio | Replace-all borra lo que no viene; la restauración no es transaccional; es la cifra para pedir material. |
| Vaciar la lista de corte | medio | Borra todas las piezas de la orden (recuperable solo recapturando). |

## Propuesta de tools

### 1. `save_purchase_decisions` — entidad: decisiones de compra de una orden (adminOnly)
- **Parámetros:**
  - `orden`: id o nombre, vía `resolveOrder`.
  - `decisiones?: [{ codigo, marca?, eleccion: 'mayoreo' | 'mixto' | 'menudeo' }]`. Cada código se resuelve a su grupo con `requireSingleMatch`; si el mismo código existe en varias marcas, pide la marca.
  - `aceptar_recomendaciones?: boolean`: llena con `recommendation.suggested` los grupos no mencionados que no tengan decisión vigente.
  - `confirmar?: boolean`.
- **Regla central:** la tool **nunca recibe números**, solo la elección. El servidor:
  1. Calcula el plan (`buildPurchasePlan` con el catálogo y los umbrales actuales).
  2. Calcula el reparto con `applyChoice`. Así `std_snapshot` y `needed_qty` salen del plan, nunca del chat.
  3. Arma el **set completo** de grupos con matemática: lo mencionado, más lo guardado vigente, más la recomendación si se pidió. Las decisiones desactualizadas se reaplican sobre la matemática actual, como hace la pantalla.
  4. **Rechaza si queda algún grupo sin decidir.** Pasa al servidor la regla que hoy solo vive en `PurchasePlanner`.
- **Confirmación (medio):** sin `confirmar` devuelve el resumen y no escribe. El resumen trae, por grupo, de→a; los totales de `summarizePlanDecisions` (paquetes y piezas a URREA, piezas a menudeo, dinero parado y ahorrado); y las huérfanas que se limpiarán. Con `confirmar: true` guarda por la misma función que la ruta.
- **Store/refactor:** `src/lib/purchase-decisions-store.ts` con:
  - `parseDecisions()` (sale de la ruta);
  - `choiceOf()` (deduplicar `savedChoice` y el de `tools/purchase.ts`);
  - `buildDecisionSet(plan, choices, opts)`;
  - `savePurchaseDecisions(db, orderId, rows)`: upsert, luego delete, compartida con la ruta.
  
  La tool llama `requireLiveAdmin`, porque la RLS no distingue rol.
- **Fusión:** no se puede fusionar con `get_purchase_plan` (ADR-034: lectura y escritura separadas). Al revés sí: `get_purchase_plan` puede entrar a `get_order` como `incluir: ['compra']` y liberar un lugar.

### 2. `save_cut_plan` — entidad: lista de corte de una orden (adminOnly)
- **Parámetros:**
  - `orden`.
  - `accion: 'agregar' | 'quitar' | 'reemplazar'`.
  - `piezas[]` (para `agregar` y `reemplazar`): `{ tipo: 'tubo' | 'placa', diametro_mm?, espesor_mm?, ancho_mm?, largo_mm, cantidad, pedido_como?, linea_origen? }`.
  - `quitar_piezas[]` (para `quitar`): número de pieza según `get_cut_plan`, o filtro por medida.
  - `confirmar?`.
  
  Siempre en mm: convierte pulgadas y metros y confirma la conversión, igual que `save_material_presentation`. `linea_origen` se resuelve a un `order_items.id` **de esa orden**; hoy la ruta no lo valida.
- **Implementación:**
  - `agregar` y `quitar` leen la lista actual, la combinan y mandan el estado completo al replace-all.
  - Al leer hay que convertir los `numeric` que llegan como string, en la frontera.
  - Debe preservar `requested_label`, `source_item_id` y el orden (`sort_order`) de las piezas existentes.
- **Confirmación:**
  - `agregar`: **directo** (bajo).
  - `quitar` y `reemplazar`: **confirmar** (medio). Sin `confirmar` devuelve qué piezas se van y cómo queda la necesidad neta (`tubeNetNeeds`/`plateNetNeeds`).
- **Store/refactor:**
  - `parseCutPieces()` en `cut-plan.ts`, compartido con la ruta.
  - `saveCutPlanPieces(db, orderId, rows)` con delete→insert→restore, compartido.
  - Validar `source_item_id` contra la orden, en los dos lados.
  - `requireLiveAdmin`.
- **Fusión posible:** `save_cut_plan` puede absorber `save_material_presentation` como `accion: 'presentacion'`. La pantalla guarda las dos cosas en el mismo botón. Eso **deja este grupo en 1 tool neta nueva**. El costo: `save_material_presentation` hoy **no** es `adminOnly`, y si se fusiona un member pierde esa escritura (pregunta 4).

**Total: 2 tools nuevas** (`save_purchase_decisions`, `save_cut_plan`), o **1 neta** si `save_cut_plan` absorbe `save_material_presentation`. El bloque app está en 36 de 36, así que hay que subir `TOOL_BUDGET.tools.app` o liberar lugares. Las fusiones de lectura de la ficha [[02-Arquitectura/MCP-Escrituras/Ordenes]] liberan hasta 3: `get_cut_plan`, `get_purchase_plan` y `list_orders` entrarían en `get_order`.

## Fuera a propósito

- **Margen de corte (`cut_margin_mm`) y umbrales del planificador:** se escriben por `PATCH /api/settings` (whitelist por key). Son configuración global, no de la orden: van a la ficha de Configuración.
- **Borrar presentaciones de material** (`/dashboard/materials`): ruta de `material-presentations`, no de este grupo; el precedente es que el MCP no borra medidas.
- **Corte rápido** (`/dashboard/cutting`): efímero por diseño, sin BD; no hay nada que escribir.
- **Generar el Excel URREA o de compra local:** no escribe en la BD. Si se quiere desde el chat, sería una tool de lectura que devuelva las filas `código⇥piezas` a partir de lo **guardado**. Queda fuera del alcance de escrituras (pregunta 3).

## Preguntas abiertas

1. ¿El servidor (ruta y tool) debe recalcular `std_snapshot` y `needed_qty` desde el plan, en vez de confiar en el cliente, y rechazar sets con grupos sin decidir? La propuesta lo hace en la tool. Hacerlo también en la ruta cerraría el hueco de la pantalla.
2. ¿Se permiten repartos libres desde el chat (por ejemplo "3 paquetes y 12 sueltas")? ¿O solo las tres elecciones de `applyChoice`, como en la pantalla? La propuesta: solo las tres.
3. ¿Quieren "dame lo de URREA para copiar" (texto `código⇥piezas` de lo guardado) como lectura, quizá dentro de `get_purchase_plan`? Hoy solo sale de la pantalla.
4. ¿`save_cut_plan` absorbe `save_material_presentation` (ahorra un lugar, pero un member pierde esa escritura) o quedan separadas?
5. ¿El plan de corte por chat aplica a cualquier orden o solo a las que tienen líneas DYMMSA, como el botón de la pantalla?
6. Al quitar piezas de corte, ¿cómo las identifica el chat? ¿Por número de pieza de `get_cut_plan`, que hoy no lo expone, o por medida y "pedido como"? Hay que agregar un identificador estable a la salida de `get_cut_plan`.
