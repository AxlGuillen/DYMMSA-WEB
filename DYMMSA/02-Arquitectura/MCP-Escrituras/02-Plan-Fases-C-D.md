# MCP — Plan de las fases C y D en dos PRs

> Issue #155 · 2026-10-24 · **Aprobado el 2026-10-24** (el usuario aceptó el plan y las 8 recomendaciones)
> Insumos:
> - [[02-Arquitectura/MCP-Escrituras/01-Plan]] §4 y §7;
> - [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]] §3–§5 (catálogo objetivo, convenciones y 25 tareas de evaluación);
> - [[02-Arquitectura/MCP-Escrituras/Auditoria-codigo]] §4–§5 (secuencia y reglas de código);
> - [[04-Decisiones-Tecnicas/ADR-041-Dos-Conectores-MCP-y-Composicion-de-Tools]] (decisiones 1–13 aceptadas).

## Por qué dos PRs y no siete

Los PRs apilados nos hicieron repetir trabajo: cada merge movía las ramas de encima y había que resolver los mismos conflictos de documentación una y otra vez. Desde aquí:
- **Un PR por fase** (C y D), contra `stg`, uno después del otro y nunca apilados.
- **Commits por paso dentro del PR.** Cada commit deja `bun run check` en verde. La review puede leerse por commit y el historial queda ordenado.
- **El PR de D se abre cuando C ya está mergeado**, nunca antes.

## Estado de partida (stg, 2026-10-24)

| Qué | Estado |
|---|---|
| Fase A, B, C1–C3 | En stg |
| Track 0 (#157) | En stg, con sus cuatro migraciones aplicadas en la nube |
| DYMMSA-WEB | 36 tools (24 lecturas, 12 escrituras). `tools/list` admin 37,324 de 53,000; descripciones 12,584 de 19,000; instrucciones 5,978 de 6,000 |
| Odoo DYMMSA | 15 tools. `tools/list` admin 21,369 de 21,500 |
| Stores existentes | órdenes, cotizaciones, aprobación, facturas, nómina, productos, catálogo URREA, proveedores, checadas |
| Stores que faltan | ajustes, decisiones de compra, lista de corte, inventario, perfiles (lado admin), tareas, días justificados |

---

## PR C — «Convenciones y confirmación de DYMMSA-WEB» (C4 + C5 + C6)

**Objetivo:** que el conector DYMMSA-WEB quede con su forma final antes de agregar las escrituras nuevas. Cambian nombres, enums y referencias, pero no se agrega ninguna capacidad nueva salvo `delete_record`.

### Commit 1 · Confirmación en dos fases (C4)
- **`src/lib/mcp/core/confirm/`** con `MCP_PREVIEW_SECRET`, fuera de `src/lib/odoo/` (hallazgo 3 de la Matriz).
  - La clave HMAC se ata a:
    - el usuario;
    - el nombre de la tool;
    - el hash de los argumentos canónicos (sin `clave`);
    - la huella de lo afectado (`version`, stock leído, conjunto de borradores…);
    - una caducidad de 30 min.
  - Separación por propósito, para que una clave de una tool nunca sirva para otra.
- **`defineTool` gana `confirm: 'none' | 'two_phase'`.**
  - Con `two_phase`, la tool implementa `plan()`, que valida, calcula, devuelve el resumen y la huella y nunca escribe, y `commit()`.
  - El core decide la fase:
    - **Sin `clave`:** fase 1 → `accion: 'simulado'`, `escrito: false`, resumen, `avisos`, `bloqueos`, `clave` y `vence` (con `previewEnvelope` de C3).
    - **Con `clave`:** verifica la firma, vuelve a correr `plan()` y compara la huella. Si algo cambió no escribe: «X cambió desde el resumen; vuelve a pedirlo».
- **Fail closed:** sin `MCP_PREVIEW_SECRET`, las tools `two_phase` responden en la fase 1 que la confirmación no está disponible y nunca escriben (mismo patrón que Odoo sin `ODOO_WRITE_API_KEY`).
- **Odoo se monta encima:**
  - `preview-token.ts` usa el firmador común y conserva sus claims (`ks`, `a`, `write_date`);
  - `odoo_create_draft_invoice` cambia `confirmar: true` por la `clave`, porque ADR-041 decisión 5 reemplaza `confirmar` en todo;
  - `AdminProof` se mueve a `src/lib/auth/`.
- **`save_time_entries` con filas** pasa a exigir la `clave` de `preview_time_report`, como define el catálogo.
- **Instrucciones:** una línea fija para los dos conectores: «muestra el resumen y espera el sí; nunca encadenes las dos fases sin la respuesta del usuario».
- **Tests:**
  - firma y caducidad;
  - otro usuario, otra tool u otros argumentos → rechazo;
  - huella cambiada → no escribe;
  - sin secreto → no escribe;
  - harness con el SDK real.
  - Los tests de `preview-token` de Odoo pasan sobre la base nueva.

### Commit 2 · Red de cobertura de escritura (C5)
- **`tests/mcp/write-coverage.test.ts`:** cada handler `POST`/`PATCH`/`PUT`/`DELETE` de `src/app/api/` se clasifica como una de dos cosas:
  - `ToolName` que lo cubre;
  - `fuera: <motivo>`, con el motivo escrito.
- **Se clasifican aparte:**
  - los POST que solo leen (`quotes/lookup`, `urrea-catalog/lookup`);
  - los refrescos de caché;
  - la ruta pública de aprobación (`fuera: la responde el cliente, nunca el MCP`).
- **Falla** si aparece una ruta de escritura sin decisión. En C nacen muchas como `fuera: Fase D`; el PR de D las va cambiando a su tool, y al terminar D no queda ninguna con ese motivo.

### Commit 3 · Infraestructura de convenciones (C6, parte 1)
- **Enums en español** en la entrada y en la salida, con los mismos tokens (ADR-041 decisión 7). Las constantes de dominio ganan su mapa español ↔ BD:
  - cotización: `borrador | en_revision | aprobada | rechazada | convertida`;
  - orden: `pedida | recibida | entregada | completada | cancelada`;
  - factura: `pendiente | vencida | pagada | cancelada`;
  - tarea, entrega, prioridad, área, jornada.
- **Referencias:**
  - `refOf()` deja de ser solo para mostrar: un `resolveByName()` común acepta UUID, `ref` (`id::text like '<8hex>%'`) o nombre, y termina en `requireSingleMatch` con hasta 5 candidatos y su `ref`;
  - `linea` (1-based sobre todas las filas) y `version` (huella de ids + `updated_at`) en `get_quotation` y `get_order`.
- **`BUSINESS_RULES_MD` reescrito** con los tokens nuevos. Es la oportunidad de recortar instrucciones, porque hoy van a 22 caracteres del tope.
- **Limpieza que dejó la review de B3:**
  - `ToolBlock` y `ConnectorId` pasan a ser el mismo tipo;
  - `serverInfo.title` dice `DYMMSA-WEB`, amarrado a `CONNECTOR_NAMES` con un test.

### Commit 4 · Renombres y fusiones de las tools que ya existen (C6, parte 2)
| Hoy | Queda | Nota |
|---|---|---|
| `create_payable` + `update_payable` + `mark_payable_paid` | `save_payable` | E(1,0). Directo; dos fases solo al cambiar cifras de una pagada |
| `create_task` + `update_task` | `save_task` | E(1,0). Directo; título o descripción en dos fases (ADR-015 reabierto) |
| `set_inventory_location` | `save_inventory_item` | En C **solo gaveta**; las cantidades llegan en D |
| `record_payroll_hours` | `save_payroll_hours` | `corregir` un día confirmado entra en D |
| `get_profiles` | `list_profiles` | Más `area` |
| los `get_*` | igual | Aceptan nombre o `ref` |

- Las respuestas de las tools renombradas pasan a las envolturas de C3 (`listResult`, `recordResult`, `writeResult`), como acordamos: se rompen las rutinas una sola vez.
- Parámetros de DYMMSA-WEB en español (C1 lo hizo solo en Odoo).

### Commit 5 · `delete_record` (C6, parte 3)
- **Alcance:** `tipo` ∈ `proveedor`, `marca`, `medida`, `factura` (pendiente o cancelada), `checada`, `dia_justificado`. E(1,1), **dos fases siempre**.
- **Resumen de lo que se pierde:**
  - una checada importada vuelve con el re-import;
  - un proveedor con facturas, o una marca en uso, se bloquea con el conteo.
- **Stores que faltan:** `deleteSupplier`, `deleteBrand`, `deleteTimeEntry` y el de días justificados, compartidos con sus rutas.
- `save_excused_day` pierde su `quitar`.
- **Fuera:** borrar cotizaciones, órdenes, productos, inventario y catálogo.

### Commit 6 · Documentación, evaluación y medición
- **`docs.evals`** en cada definición, con 1–2 frases reales, y un test que exige que ninguna tool quede sin tarea (plan §6).
- **Guion de evaluación manual** en la bóveda: las 25 tareas de la Auditoría DYMMSA-WEB §5, las 10–15 de Odoo y los 2 controles negativos, con dónde anotar resultados.
- **Documentación:**
  - CLAUDE.md (fila del MCP y checklist de tool nueva);
  - ADR-041 (C4–C6 hechos y medidas);
  - documentación in-app, generada del catálogo, y el consentimiento;
  - changelog técnico y `CHANGELOG.md` (`[admin]`: nombres nuevos y la confirmación en dos pasos);
  - nota de rutinas a actualizar.
- **Snapshots** regenerados a propósito; el PR explica el diff.

### Presupuesto esperado al cerrar C
- **Tools:** baja de 36 a **31** (−5 por fusión, +1 `delete_record`).
- **`tools/list`:** similar al de hoy. Los enums en español y `delete_record` suben un poco y las fusiones bajan.
- **Instrucciones:** **se recortan** con la reescritura de `BUSINESS_RULES_MD`, para dejar margen a D.
- **Topes:** ninguno se sube en C.

---

## PR D — «Escrituras nuevas por módulo» (Fase D)

**Objetivo:** las 13 escrituras nuevas del catálogo objetivo, en el orden del plan. **Prerrequisito:** C mergeado, con su confirmación y su red de cobertura.

Un commit por módulo; cada uno lleva su store, su tool, sus tests y su documentación.

| # | Módulo | Tools nuevas o ampliadas | Confirmación | Store |
|---|---|---|---|---|
| 1 | Ajustes | `save_app_settings` (whitelist de 3 keys, `restablecer`) | Dos fases | `settings-store` (nuevo; la whitelist hoy solo vive en la ruta) |
| 2 | Productos ETM | `save_product` | Directo; cambiar `etm`, código o marca: dos fases | `products-store` (existe) |
| 3 | Catálogo URREA | `save_urrea_catalog_item` | Solo descripción: directo. Alta, `std` o identidad: dos fases, avisando cuántas decisiones de compra quedan desactualizadas | `urrea-catalog-store` (existe) |
| 4 | Equipo y perfil | `save_profile` (sin alta, sin rol, sin tarifa) | Lo propio: directo. Otra persona, checador, jornada o área: dos fases | `profiles-store` (nuevo) |
| 5 | Nómina | `save_payroll_period` (`confirmar_borradores`, `cerrar`, `reabrir`) y `save_payroll_hours.corregir` | Dos fases; al confirmar, la clave se ata al conjunto de borradores | `payroll-store` (existe; usa las RPC de #171) |
| 6 | Cotizaciones | `save_quotation` (crear, editar por `linea`, estado) y `get_quotation.link_aprobacion` | Crear o editar: dos fases. `en_revision` desde `borrador`: directo. Otro estado: dos fases (avisa que el link muere) | `quotations-store` (existe; #166 arregló los ids viejos) |
| 7a | Compra y corte | `save_purchase_decisions`, `save_cut_plan` | Decisiones: dos fases y rechaza si queda algún «revisar». Corte: `agregar` directo; `quitar`/`reemplazar` dos fases | `purchase-decisions-store` y `cut-plan-store` (nuevos) |
| 7b | Inventario | `save_inventory_item` con `cantidad_contada` / `ajuste` | Dos fases; la clave se ata al «antes» | `inventory-store` (nuevo, sobre `adjust_inventory`) |
| 7c | Órdenes | `save_order` (crear desde cotización o manual, estado, `cambios` de línea) y `save_order_reception` | Dos fases en todo lo de stock; solo la entrega es directa | `orders-store` (existe; stock atómico de #163) |

### Lo que se verifica en cada módulo
- **Unit del store** (lo comparten la ruta y la tool).
- **Test de la tool por el harness con el SDK real:**
  - entrada válida;
  - campo desconocido;
  - regla rota;
  - búsqueda ambigua;
  - fase 1 sin escribir y fase 2 con la clave;
  - huella cambiada.
- **Integración** para cualquier SQL nuevo.
- **La red de C5** pasa la ruta de `fuera: Fase D` a su tool.
- **Las tareas de evaluación** del módulo en `docs.evals`.

### Migraciones posibles en D
- Solo si un store necesita atomicidad que hoy no tiene. El candidato es el conteo de inventario «escribe el absoluto», que podría necesitar un `set_inventory_count` atómico.
- **Las aditivas las aplico** antes del merge. **Las que cambian comportamiento**, por ejemplo un trigger de bitácora para ajustes de stock, **te las pregunto**.

### Presupuesto esperado al cerrar D
- **Tools:** **44** de 45.
- **`tools/list`:** entre ~48,000 y 52,000 en el cable, contra el tope de 53,000. Se mide en cada commit.
- **Instrucciones:** el tope de 6,000 es el riesgo real. El mapa por módulo crece, y si C no deja margen suficiente, D sube el tope **a propósito** en su PR, con la medición y el porqué en ADR-041.

---

## Estándares de calidad (aplican a los dos PRs)
1. **`bun run check` en verde en cada commit**, no solo al final. El lint queda en cero.
2. **Checklist de tool nueva**, completo (Auditoría de código §5):
   - un archivo con `defineTool`;
   - la regla en el store, sin `db.from(...).insert/update/delete` en la tool;
   - entrada estricta con primitivas;
   - anotaciones fieles;
   - confirmación según la ficha;
   - validar todo antes de escribir;
   - envolturas;
   - dependencias por `ctx`;
   - tests;
   - presupuesto;
   - docs.
3. **Snapshots regenerados a propósito,** y el PR explica qué cambió y por qué.
4. **Presupuestos medidos en el cable** en cada commit. Subir un tope es explícito, con su porqué.
5. **SQL:**
   - INVOKER y `search_path = ''`;
   - sin EXECUTE para `anon`;
   - prueba de integración (corre en CI);
   - validado compilando en `pg_temp` cuando Docker no corre;
   - `CASE` entre paréntesis dentro de un `IF` (lección de #171);
   - la migración se aplica antes del merge.
6. **Documentación en el mismo PR:**
   - CLAUDE.md;
   - la ficha de la bóveda;
   - ADR-041;
   - changelog técnico;
   - `CHANGELOG.md` si el usuario lo nota.
7. **Review:** se atiende completa antes de pedir el merge. Lo que no se aplique queda escrito con su dueño.
8. **Commits** en Conventional Commits, en inglés, **sin línea de coautoría**.

## Decisiones de producto (aprobadas el 2026-10-24: sí a las ocho recomendaciones)

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿`save_quotation` acepta cambios de línea **y** de estado en una sola llamada («aprueba todo menos la 5 y márcala aprobada»)? | **No.** Una intención por llamada (R1); son dos llamadas, cada una con su resumen |
| 2 | ¿La orden manual (productos transcritos, sin cotización) entra en `save_order`? | **Sí**, sin `cotizacion` crea la orden manual |
| 3 | ¿Las ediciones de cotización desde el chat alimentan el auto-learn, como en la app? | **Sí**, por el mismo store |
| 4 | ¿Cambiar el precio de una línea ya aprobada la regresa a pendiente? | **No**, igual que la app hoy; el resumen lo avisa |
| 5 | ¿El chat puede dar el link de aprobación de una cotización? | **Sí**, en `get_quotation` con `link_aprobacion`, solo admin |
| 6 | Inventario: «conté 12», ¿se escribe 12 o 12 menos lo apartado por órdenes abiertas aún en tienda? | **12 menos lo apartado**, con el desglose en el resumen; `store_inventory` guarda lo disponible |
| 7 | ¿Los ajustes de stock y los borrados por chat dejan rastro en `audit_events`? | **Sí para ajustes de stock** (trigger nuevo, cambio de comportamiento); los borrados ya quedan en el log del servidor |
| 8 | ¿Cambiar el rol de una persona por chat? | **No**, se queda en la app |

## Lo que se necesita del usuario
- **`MCP_PREVIEW_SECRET`:** el usuario lo pone en Vercel **hasta que C llegue a `main`** (decisión del 2026-10-24) y ahí se prueba. Un valor aleatorio de 32 bytes o más, en Production, más un redeploy. Hasta entonces las tools en dos fases responden en la fase 1 que la confirmación no está disponible y **nunca escriben** (fail closed); las escrituras directas siguen funcionando. Los tests usan un secreto de prueba inyectado, nunca el de Vercel.
- **Después de cada PR:** correr el guion de evaluación en claude.ai cuando se haga el release.
