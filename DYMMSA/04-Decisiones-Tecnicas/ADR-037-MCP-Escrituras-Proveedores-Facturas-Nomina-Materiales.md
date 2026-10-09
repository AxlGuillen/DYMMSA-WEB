# ADR-037 — Más escrituras del MCP: proveedores, facturas, empleados de nómina y medidas de material

**Fecha:** 2026-10-08
**Estado:** Aceptado · issue #134 (bloques Proveedores, Finanzas, Nómina y Materiales)
**Relacionado:** [[ADR-015-MCP-Interno]] · [[ADR-022-Modulo-de-Corte]] · [[ADR-028-Bitacora-Generica]] · [[ADR-030-MCP-Cobertura-y-Escrituras-Payables]] · [[ADR-033-Nomina-Horas-por-Corte]] · [[ADR-034-MCP-Reglas-de-Crecimiento]] · [[ADR-035-Reporte-del-Checador-por-el-MCP]]

## Contexto

La #134 propuso seis escrituras para los módulos donde el asistente obligaba a abrir la app. El
bloque de Horas entró con el PR #138 (ADR-035). Quedaban cuatro: proveedores, facturas por pagar,
empleados de nómina y medidas de material de corte.

El presupuesto de ADR-034 no alcanzaba: la app tenía 35 de 36 herramientas y la lista completa
36,352 de 37,000 caracteres. Cuatro herramientas más eran unas 3,400 y dejaban la app en 39.

## Decisión

1. **Cuatro escrituras, una por entidad, con la regla en `src/lib/`** (la ruta y la tool usan el
   mismo código):
   - **`save_supplier`** — `src/lib/suppliers-store.ts` (`parseSupplierInput`, `createSupplier`
     con rollback si fallan las marcas, `updateSupplier` con las marcas por diff), compartida con
     `POST`/`PATCH /api/suppliers`. Las marcas van por nombre con `agregar_marcas` /
     `quitar_marcas`, nunca como la lista completa: "agrégale TRUPER" no debe borrar SURTEK. Una
     marca que no existe es un error que lista el catálogo; **no se crea** (decisión 2026-10-08:
     un error de dedo no debe dejar una marca basura en un catálogo que cruza por valor). No borra.
   - **`update_payable`** — `parsePayableUpdate()` en `src/lib/payables.ts`, compartida con
     `PATCH /api/payables/[id]`. Se llama `update_` y no `save_` porque `create_payable` y
     `mark_payable_paid` se quedan como están (ADR-034 no renombra escrituras en uso): es la
     excepción explícita a la regla 1. Corrige y **cancela una pendiente**. Una pagada no se cancela
     directo, porque cancelar limpia `paid_at`, la fecha real de pago; primero regresa a pendiente.
     Reactivar una cancelada y borrar siguen en la app. Cambiar la fecha de factura no recalcula el
     vencimiento en silencio: la respuesta lo dice. No menciona la bitácora (ADR-028).
   - **`save_payroll_employee`** (adminOnly) — `createEmployee`/`updateEmployee` en
     `payroll-store.ts` con `parseEmployeeInput`, compartidas con las rutas de empleados. El perfil
     se liga por nombre (`resolvePerson`); `""` o `null` desliga y nunca cae en "sin nombre = quien
     pregunta". La baja es `activo: false`. Un 42501 (member) llega como mensaje claro. Las horas,
     confirmar y cerrar el corte siguen con sus reglas (ADR-033).
   - **`save_material_presentation`** — `parsePresentationInput` y `PRESENTATION_KEY` en
     `cut-plan.ts`, compartidas con `POST /api/material-presentations`. Siempre en mm: la
     descripción pide convertir pulgadas y metros y confirmar la conversión. Dice si la medida ya
     existía. No borra.
2. **Fechas reales en facturas** (prerrequisito de `update_payable`, sugerencia #15 del review
   del PR #128): `ISO_DATE` solo revisaba la forma; ahora `isRealDate` valida en `POST`/`PATCH`,
   en `resolvePaymentUpdate` y en `create_payable`. Un `2026-02-30` responde 400 en vez de 500.
3. **Segunda etapa de ADR-034, para hacer espacio:**
   - fuera `get_quotation_stats` y `get_inventory_stats`, duplicados exactos de
     `get_business_summary`, que llama las mismas funciones;
   - `get_order_by_quotation` se fusiona en `get_quotation`, que trae `orden`;
   - la "regla de oro" de las instrucciones deja de repetir la lista de escrituras, que ya están
     marcadas en cada línea del bloque A.
4. **Presupuesto:** la app queda en 36 de 36 sin subir el tope de herramientas. Suben los de
   caracteres:
   - descripciones: de 18,000 a 18,500;
   - `tools/list`: de 37,000 a 40,000.
   
   Las instrucciones caben en 7,500.

## Medición (2026-10-08)

| | Admin antes | Admin después | Member después |
|---|---|---|---|
| Herramientas (app + Odoo) | 50 (35 + 15) | 51 (36 + 15) | 44 |
| Descripciones | 17,135 | 18,329 | 13,985 |
| `tools/list` completa | 36,352 | 39,724 | 31,683 |
| Instrucciones | 7,308 | 7,442 | 6,893 |

## Consecuencias

- Doce escrituras. Tras el deploy hay que reconectar el conector, porque desaparecen tres nombres.
- La app está en su tope de herramientas: la siguiente reemplaza o fusiona otra. Candidatas:
  - `get_payable` dentro de `list_payables`;
  - `get_task` dentro de `list_tasks`.
- A las instrucciones del admin les quedan 58 caracteres.
- Siguen fuera, a propósito (#134):
  - el Catálogo ETM;
  - el núcleo transaccional;
  - confirmar o cerrar la nómina;
  - roles y la corona;
  - la configuración.
