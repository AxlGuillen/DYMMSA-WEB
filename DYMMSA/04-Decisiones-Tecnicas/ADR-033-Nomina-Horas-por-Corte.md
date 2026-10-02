# ADR-033 — Nómina: horas por día, corte sábado→viernes y la primera escritura del MCP en un módulo sensible

**Fecha:** 2026-09-30
**Estado:** Aceptado · issue #123
**Relacionado:** [[ADR-026-Perfiles-y-Permisos-por-Rol]] · [[ADR-015-MCP-Interno]] · [[ADR-030-MCP-Cobertura-y-Escrituras-Payables]] · [[ADR-029-Horas-por-MCP]] · [[ADR-031-Manifiesto-del-MCP-en-la-Documentacion]] · [[ADR-028-Bitacora-Admin-Only]]

## Contexto

El taller registra la asistencia en una hoja semanal impresa, llenada a mano y escaneada; la
oficina ya checa en el reloj (módulo Horas, #93). Se paga los **viernes** y el pago cubre el
sábado y domingo de la semana anterior más el lunes a viernes de la actual. Se pidió un módulo
**solo para administradores** donde el asistente cargue la hoja y el admin tenga las horas del
corte listas, sin duplicar lo que la oficina ya checa.

## Decisión

1. **Se guardan horas por empleado y por día (`payroll_days`), no totales por hoja.** La hoja va
   de lunes a domingo y el corte de sábado a viernes: una misma hoja cae en **dos** cortes. Con
   una fila por día, el corte es un rango de fechas (`payrollPeriod()`), no depende de cómo venga
   el papel y la hoja se reparte sola.
2. **El multiplicador no se guarda: sale de la fecha** (`classifyDay()` en `src/lib/payroll.ts`).
   Lunes a viernes: normal hasta la jornada del empleado (8 h, 4 h en medio tiempo) y el resto
   extra, **ambas ×1** (decisión 2026-09-30); sábado **×2** y domingo **×3** sobre todas las
   horas del día. Si la regla de extras cambia, cambia una función y no los datos.
3. **Solo horas, nunca montos.** Sin tarifas ni salarios en la base. El total del corte es el
   "equivalente" en horas (`normal + extra + sábado×2 + domingo×3`).
4. **Empleados propios (`payroll_employees`) con liga opcional a `profiles`.** Los del taller no
   tienen cuenta. La liga solo sirve para el prellenado desde Horas; `shift` se copia al ligar
   pero vive en nómina (el tope de horas normales es dato del corte, no del perfil).
5. **Borrador → confirmado → corte cerrado.** Lo que llega de la hoja (`source = sheet`) o de
   Horas (`hours`) nace `draft` y **no suma**. Lo que el admin teclea (`manual`) nace
   `confirmed`. "Confirmar borradores" los pasa todos; cerrar exige cero borradores. Las cargas
   automáticas (`overwrite: false`) **nunca pisan** un día confirmado, uno de otro origen ni un
   corte cerrado: los devuelven en `skipped` con el motivo. Solo la edición del admin sobrescribe.
6. **El corte cerrado lo congela un trigger, no la ruta.** `payroll_days_guard_closed` rechaza
   con 23514 cualquier INSERT/UPDATE/DELETE de un día cuyo corte está `closed` — también con
   service_role y por PostgREST directo. La ruta revisa antes solo para dar un mensaje claro. El
   trigger y `payrollPeriod()` calculan el sábado con la misma expresión (`(dow + 1) % 7`).
   Reabrir es explícito y deja `reopened_at` / `reopened_by_name`; quién cerró se conserva.
7. **"Prellenar y congelar" con Horas** (decisión del usuario). Nómina no lee `time_entries` en
   vivo: "Traer de Horas" copia los minutos por día como borrador y, una vez confirmados o
   cerrado el corte, corregir una checada el lunes ya no mueve una nómina pagada. Una checada sin
   salida no suma y se reporta (`open`).
8. **RLS `is_admin()` FOR ALL en las tres tablas + `requireAdmin` en cada ruta + link del
   sidebar solo para admin.** GRANTs sin `anon`. La policy dice lo mismo que la ruta (review PR
   #99): el MCP entra con el token del usuario.
9. **MCP: `get_payroll_period` y la escritura `record_payroll_hours`** — sexta escritura del MCP
   y primera en un módulo sensible. Se acota así:
   - Solo **borradores**: no confirma, no cierra, no crea empleados, no pisa nada confirmado.
   - Sin lógica de permisos en la tool: a un member la RLS le devuelve cero empleados y la tool
     responde con un mensaje, no con un corte vacío que parezca real.
   - El nombre se resuelve con `requireSingleMatch` (el exacto gana sobre el parcial, sin acentos).
   - **La interpretación de la hoja no es lógica del módulo**: vive en `SERVER_INSTRUCTIONS`
     (enderezar el escaneo, qué es "°" y qué una hora escrita, cuadrar el círculo de HRS EXT,
     preguntar por el número de encima, mostrar la tabla antes de guardar). La tool recibe horas
     por día ya interpretadas.
10. **No se guarda el PDF** (decisión del usuario): el conector solo manda texto y no hay interés
    en archivar la hoja. Sin bucket.
11. **Fuera de la documentación in-app y sin tour**: las dos tools llevan `hidden: true` en el
    manifiesto y `DOCS_MANIFEST` las excluye de la página que lee todo el equipo. El test del
    manifiesto sigue exigiendo que estén registradas y listadas.

## Alternativas descartadas

- **Guardar el total de la hoja por empleado.** No se puede repartir entre dos cortes.
- **Leer Horas en vivo desde Nómina.** Una corrección posterior cambiaría un pago ya hecho.
- **Guardar horas ya multiplicadas.** Cambiar la tarifa de fin de semana exigiría reescribir datos.
- **Que la tool confirme o cierre.** Un 3.5 mal leído es dinero: el paso humano es obligatorio.
- **Bloquear el corte cerrado solo en la ruta.** El MCP y PostgREST no pasan por ella.

## Pendiente

- Tarifa de las extras entre semana si deja de ser ×1; qué hacer con HRS NO TRABAJADAS (hoy
  solo se registran); el número de encima en HRS EXT (el asistente pregunta, no se guarda);
  montos, si algún día se decide meter tarifas.

## Pruebas

`tests/lib/payroll.test.ts` (corte, clasificación, vista), `tests/api/payroll.test.ts` (403/401 en
las ocho rutas sin tocar tablas de nómina, borrador/confirmado, corte cerrado, prefill),
`tests/mcp/payroll.test.ts`, `tests/components/PayrollView.test.tsx` y
`tests/integration/payroll.integration.test.ts` (RLS real para member y anon, trigger con
service_role, flujo hoja → confirmar → cerrar → reabrir, prefill idempotente).
