# ADR-035 — El reporte del checador por el MCP: filas transcritas, no el archivo

**Fecha:** 2026-10-07
**Estado:** Aceptado · issues #132 y #134 (bloque Horas)
**Relacionado:** [[ADR-015-MCP-Interno]] · [[ADR-026-Perfiles-y-Permisos-por-Rol]] · [[ADR-029-Jornada-y-Horas-por-MCP]] · [[ADR-033-Nomina-Horas-por-Corte]] · [[ADR-034-MCP-Reglas-de-Crecimiento]]

## Contexto

El cliente quiere armar la nómina del viernes desde Claude, sin abrir la app: subir el reporte
del checador de la oficina, pasar esas horas al corte y cargar la hoja del taller. Los dos
primeros pasos solo existían como botones (Horas → Importar reporte, Nómina → Traer de Horas).

La issue proponía recibir el `.xls` de NGTeco **en base64**. No funciona en la práctica: un
conector remoto no tiene un canal para recibir el archivo que el usuario suelta en el chat. El
modelo tendría que escribir el archivo como texto en la llamada (~40,000 caracteres de base64
para un reporte de ~30 KB): tarda minutos, y un solo carácter mal copiado rompe el binario.

Que el modelo **interprete** las checadas y mande parejas entrada/salida ya digeridas también
es frágil: el formato tiene filas de continuación sin fecha (segunda checada del día), salidas
vacías, y la lógica para leerlas ya existe y está probada en `parseNgtecoReport`.

## Decisión

1. **El modelo transcribe, la app interpreta.** `save_time_entries` recibe `filas`: todas las
   filas de la hoja, celda por celda, en su columna original. El servidor las pasa por el mismo
   `parseNgtecoReport` y la misma `importTimeReport()` (`src/lib/time-entries-store.ts`) que usa
   `POST /api/time-entries/import`; la ruta solo añade la lectura del `.xls`. Un reporte de
   cuatro personas son ~1,900 caracteres.
2. **Lo transcrito debe cuadrar con el propio reporte** (`reportMismatches()` en
   `timesheet.ts`): cada pareja contra su "Tiempo de trabajo" y cada bloque contra su "Horas
   totales". El checador cuenta segundos e imprime HH:MM, así que se toleran 1 minuto por pareja
   y 1 por pareja en el total del bloque (con el reporte real del 2026-09-28 las diferencias
   son de ±1). Si algo no cuadra, **no se guarda nada** y el error dice qué filas revisar; un
   bloque con checadas y sin "Horas totales" tampoco pasa. La respuesta lista a las personas
   con checador que no venían en el reporte: un bloque omitido entero se lee así.
3. **Mismas garantías que el botón**, porque es el mismo camino: la RPC `import_time_entries`
   (INVOKER, `is_admin()`), idempotente por `source_clock_in`, sin pisar filas corregidas por un
   admin. En `time_imports.file_name` queda `Asistente (MCP): <archivo>`.
4. **"Traer de Horas" no es una herramienta nueva** (regla 1 de ADR-034: una escritura por
   entidad): es `traer_de_horas: true` en `record_payroll_hours`, que ya escribe `payroll_days`.
   Envuelve `prefillFromHours()` con sus reglas (borrador; nunca sobre un día confirmado, de otro
   origen ni de un corte cerrado). `dias` y `traer_de_horas` no van juntos.
5. Las dos son `adminOnly`. La rutina vive en las instrucciones del rol admin:
   `preview_time_report` (la vista de ADR-036) → `save_time_entries` → `record_payroll_hours` con
   `traer_de_horas` → `record_payroll_hours` con la hoja del taller → el admin confirma y cierra
   en la app (ADR-033: es dinero).

6. **Corregir una checada es la misma herramienta** (#134, regla 1 de ADR-034): `checada` con
   `entrada_actual` (la entrada que tiene hoy, que el modelo ve en `get_week_hours`) corrige esa
   pareja; sin ella, con `entrada`, registra una manual. Mismas reglas que el diálogo de la app,
   porque es el mismo código (`correctTimeEntry` / `createManualEntry`): jamás toca
   `source_clock_in`, solo un cambio de hora sella el rastro y `original` se escribe una vez.
   Borrar una checada se queda en la app.
7. **`save_excused_day`** (#134): marca, cambia o quita (`quitar: true`) un feriado o una salida
   autorizada, para el equipo o una persona, con el `parseExcusedDay` de la ruta. Si ya hay uno
   esa fecha para esa persona (o el equipo) lo actualiza en vez de chocar con el UNIQUE.

## Consecuencias

- Séptima y octava escrituras del MCP, ambas `adminOnly`.
- `tools/list` del admin: ~35,700 de 36,000 caracteres e instrucciones ~7,450 de 7,500 (se
  recortaron las descripciones para caber). Lo que sigue de la #134 (proveedores, facturas,
  empleados de nómina, materiales) obliga a la etapa 2 de ADR-034 (fusionar lecturas) o a subir
  el tope con su porqué.
- Si el chat no puede abrir el `.xls`, el usuario lo exporta o lo copia como tabla: la
  herramienta solo necesita las filas.

## Alternativas descartadas

- **Base64 del archivo:** descrita arriba.
- **Parejas ya interpretadas por el modelo:** duplica el parser en el prompt y pierde la
  comprobación por fila contra "Tiempo de trabajo".
- **Un enlace de subida a la app:** obliga a abrir la app, que es justo lo que la rutina evita.
