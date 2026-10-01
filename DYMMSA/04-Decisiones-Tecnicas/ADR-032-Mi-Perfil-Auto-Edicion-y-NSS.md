# ADR-032 — Mi perfil: auto-edición sin escalar rol, NSS en `profiles` y fotos validadas por sus bytes

**Fecha:** 2026-09-29
**Estado:** Aceptado · issue #122
**Relacionado:** [[ADR-026-Permisos-por-Rol]] · [[ADR-028-Bitacora-Admin-Only]] · [[ADR-029-Horas-por-MCP]] · [[ADR-024-Vistas-Guiadas]] · [[ADR-031-Manifiesto-del-MCP-en-la-Documentacion]]

## Contexto

Hasta ahora la app identificaba a cada persona por su correo y solo un admin podía editar
`profiles`. Se pidió que cada quien mantenga su **nombre**, su **foto** y su **Número de
Seguridad Social (NSS)**, que el módulo tenga su vista guiada y que el asistente lo lea desde
el primer día.

## Decisión

1. **Una policy de UPDATE "fila propia" más un trigger que protege los campos del admin.** La
   RLS decide filas, no columnas: con solo la policy, un member podría mandarse `role = 'admin'`
   por PostgREST con su token. `profiles_guard_admin_fields` (BEFORE UPDATE) rechaza con
   **42501** cualquier cambio a `role`, `clock_employee_id` o `shift` de quien no es admin. Sin
   `auth.uid()` (service role, SQL directo) pasa: el trigger protege la app, no la consola.
2. **El NSS es una columna de `profiles`, no una tabla aparte** (decisión del usuario,
   2026-09-29). La RLS de lectura de `profiles` ya dice exactamente "la persona y el admin", que
   es quien debe verlo. La BD valida el formato (CHECK 11 dígitos); el dígito verificador
   (Luhn) se valida en `src/lib/nss.ts`, compartido por la UI y las dos rutas.
3. **El MCP lee el NSS** (`get_profiles`, decisión del usuario: consulta rápida). Sin lógica de
   permisos en la tool — la RLS decide como en horas (ADR-029), con el buscador `resolvePerson()`
   compartido. `SERVER_INSTRUCTIONS` pide darlo solo cuando lo pidan y no repetirlo en resúmenes.
   Una instrucción de prompt no basta como freno (mismo criterio que ADR-028), así que la capa de
   datos lo acota (review PR #126): el **listado** sin `persona` solo trae el NSS de quien
   pregunta; el de otra persona viaja únicamente al pedirla por nombre.
4. **Fotos: bucket público `avatars`, subida con el token del usuario.** A diferencia de
   `task-images` (service role), las policies de `storage.objects` limitan SELECT/INSERT/DELETE a
   la carpeta `<auth.uid()>/`, y el CHECK `profiles_avatar_own_folder` impide apuntar
   `avatar_path` a un archivo ajeno. Lectura pública por URL con rutas `<uid>/<uuid>.<ext>`; cada
   subida cambia la ruta, así que no hay caché vieja que invalidar. Las fotos **no son privadas**:
   la policy de SELECT existe porque `remove()` la necesita, no para ocultarlas.
5. **La imagen se juzga por sus bytes, no por su nombre ni su Content-Type.** `readImageInfo()`
   reconoce la firma de JPEG/PNG/WebP y lee sus medidas; SVG (puede llevar scripts), GIF o un
   archivo renombrado no pasan. Tope de 2 MB y 512 × 512 en el servidor. El navegador recorta al
   centro, reduce a 256 px y re-codifica en canvas (`cropAvatar`), lo que además **borra el EXIF**
   (la ubicación GPS de las fotos del celular). Eso solo vale por la UI: el servidor no
   re-codifica, así que **rechaza** el archivo que traiga EXIF/XMP (`hasMetadata()`: APP1 en JPEG,
   `eXIf` en PNG, banderas EXIF/XMP del `VP8X`) — el recorte del navegador nunca los emite, y un
   POST directo no llega con la ubicación a un bucket público (review PR #126). Sin librería de
   recorte: si algún día se quiere mover el recorte a mano, se agrega aparte.

## Consecuencias

- La policy de fila propia debe decir lo mismo que la ruta: `display_name` gana el CHECK
  `profiles_display_name_length` (1–80, el límite de `parseDisplayName`) y `handle_new_user`
  recorta y topa el nombre de la metadata para que un alta no choque con él (review PR #126).
  El dígito verificador del NSS se queda en la API: el CHECK de formato ya acota lo suficiente.
- Un WebP animado se rechaza por sus bytes: el recorte del navegador lo aplanaría, pero un POST
  directo no pasa por ahí.

- Un member que intenta cambiarse el rol recibe un error explícito en vez de "0 filas"; el test
  de integración de horas se ajustó a 42501.
- Cambiar el nombre **no reescribe la bitácora**: `audit_events.actor_name` es el snapshot del día
  (ADR-028). Es lo correcto y no se documenta en la app porque la bitácora es solo del admin.
- Por la misma razón, "Pagada por" y el historial de facturas **no llevan avatar**: mostrarían
  la foto de hoy junto al nombre de aquel día.
- Nómina (#123) podrá leer el NSS del personal de oficina desde aquí; el del taller, que no tiene
  cuenta, vivirá en su propia lista de empleados.
