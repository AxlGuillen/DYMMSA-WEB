# ADR-034 — Reglas para que las herramientas del MCP no crezcan sin control

**Fecha:** 2026-10-05
**Estado:** Aceptado · issue #133
**Relacionado:** [[ADR-015-MCP-Interno]] · [[ADR-023-MCP-OAuth-Supabase]] · [[ADR-031-Manifiesto-del-MCP-en-la-Documentacion]] · [[ADR-033-Nomina-Horas-por-Corte]]

## Contexto

El conector llegó a 47 herramientas (32 de la app, 15 de Odoo; 6 escriben) y le entregaba al
modelo ~40,700 caracteres por conversación: ~32,000 de lista de herramientas y ~8,700 de
instrucciones (medición del 2026-10-04). Las escrituras que vienen (#132, #134) lo llevarían a
57–60 si cada acción fuera una herramienta. El riesgo real no es el tamaño sino las herramientas
que se parecen entre sí; conviene fijar las reglas antes de sumar las nuevas.

## Decisión

1. **Una herramienta por entidad para las escrituras, nunca por acción.** `save_x` crea o edita
   según venga o no el identificador; corregir y cancelar van en la misma. **Nunca** se mezcla
   lectura y escritura en una herramienta: `readOnlyHint` va por herramienta y es lo que el
   cliente usa para pedir confirmación. Aplica desde la #132 en adelante; las 6 escrituras
   existentes se quedan como están (renombrarlas rompe las rutinas que ya las usan).
2. **La lista depende del rol.** El manifiesto marca `adminOnly` (hoy `list_time_imports`,
   `get_payroll_period`, `record_payroll_hours`); `registerDymmsaTools(server, role)` las salta
   para un member y `serverInstructions(role)` omite sus líneas. El rol viaja en la identidad del
   token (`verifyToken` lee la fila propia de `profiles` con el token del usuario; cualquier
   falla → member, nunca la lista ancha) y la ruta sirve uno de **dos handlers** construidos al
   arrancar, uno por rol. Esto reduce ruido y cierra el pendiente del PR #127 (un member veía que
   Nómina existía); **la RLS sigue siendo la barrera**: un member con la lista de admin no leería
   nada de todos modos.
3. **Instrucciones solo con lo que sirve siempre.** La guía para leer la hoja del taller vive en
   la descripción de `record_payroll_hours` (solo un admin la recibe) y no en las instrucciones. Las
   reglas de negocio viajan **solo** en las instrucciones: el recurso `dymmsa://reglas-negocio`
   se eliminó (era el mismo texto dos veces y muchos clientes nunca leen recursos). La pantalla
   `/oauth/consent` se genera del manifiesto (`consentSummary(role)`): decía que el asistente solo
   creaba tareas.
4. **Presupuesto vigilado por test** (`TOOL_BUDGET` en `manifest.ts`, `tests/mcp/manifest.test.ts`):
   app ≤ 36 y Odoo ≤ 16 herramientas; ≤ 1,000 caracteres de descripción por herramienta (excepción
   nombrada: `record_payroll_hours` ≤ 2,600, lleva la guía); ≤ 18,000 en total; instrucciones
   ≤ 7,500 por rol; y ≤ 36,000 de `tools/list` completa (nombre + título + descripción + esquema JSON: lo que el cliente paga de verdad). Subir un tope es un cambio explícito en el PR, con su porqué. El test registra
   el servidor real con un stub para medir lo que el cliente recibiría, por rol.
5. **Fusionar lecturas partidas** (listar + detalle; Odoo específicas vs primitivas) queda como
   segunda etapa, una por una y cuando el presupuesto lo pida: cambia nombres que las rutinas usan.

## Medición tras el cambio (2026-10-05)

| | Admin | Member |
|---|---|---|
| Herramientas | 47 | 44 |
| Descripciones | ~15,900 caracteres | ~13,200 |
| Instrucciones | ~7,250 | ~6,850 |
| `tools/list` completa (nombre + título + descripción + esquema) | ~33,300 | ~29,300 |

**2026-10-07:** `listTotal` sube a 37,000 por la tool de lectura gemela de la primera vista MCP Apps ([[ADR-036-Vistas-del-MCP-con-MCP-Apps]]); el test ahora suma también `_meta`.

El recurso duplicado (~3,100) desapareció; la guía (~1,500) solo la paga un admin.

## Alternativas descartadas

- **Partir el conector en dos** (app / Odoo): dos autorizaciones por persona y el cierre del mes
  cruza ambos lados.
- **Un wrapper del `McpServer` que filtre por nombre** en vez de guardas explícitas: la firma
  sobrecargada de `registerTool` obliga a castear; las guardas `if (forAdmin)` son visibles y el
  test falla si una y el manifiesto no coinciden.
- **Leer el rol en cada llamada** en vez de con la identidad: la identidad ya se cachea 60 s por
  token; una promoción a admin tarda hasta eso en verse, aceptable.
