# ADR-012 — Notificaciones por email (Resend)

**Fecha:** 2026-07-07
**Estado:** Aceptado — ⚠️ **temporalmente DESHABILITADO** (2026-07-07)

> **Nota:** el envío de correos está apagado por un interruptor en
> `src/lib/email/send-approval-notification.ts` (`EMAIL_NOTIFICATIONS_ENABLED = false`)
> hasta configurar Resend en producción (dominio verificado + env vars + decidir
> destinatarios). El código sigue en su lugar; para reactivar, poner el flag en `true`.
> Por eso también se retiró la entrada de `CHANGELOG.md` (Novedades) hasta que funcione.

## Contexto

Cuando el cliente finaliza la aprobación de una cotización en `/approve/[token]`
(sin auth, público), los empleados de DYMMSA no se enteran hasta que revisan el
sistema manualmente. Se necesita un aviso automático para que continúen el proceso
(crear la orden, etc.).

## Decisión

Enviar un correo transaccional vía **Resend** cuando la aprobación finaliza en
estado `approved` (al menos un ítem aprobado).

### Reglas

1. **Disparador único:** rama `finalize=true` **y** `newStatus === 'approved'` en
   `POST /api/approve/[token]`. NO se envía en "guardar avance" (`finalize=false`)
   ni cuando el cliente rechaza todo (`rejected`). El rechazo no dispara aviso
   porque la decisión de negocio es notificar sólo cuando hay trabajo que continuar.
2. **Un solo envío garantizado sin lógica extra:** tras finalizar, el status deja
   de ser `sent_for_approval`, por lo que un segundo POST devuelve 400. No hay
   riesgo de correos duplicados.
3. **Aislamiento de fallo (igual que auto-learn / [[ADR-009-Errores-Descriptivos]]):**
   el envío va en su propio `try/catch` y `sendApprovalNotification` **nunca lanza**
   (devuelve `{ ok }`). Un fallo de correo jamás revierte la aprobación ni cambia
   el `200`. Lo sagrado es que el cliente ya aprobó.
4. **Destinatario fijo por env** (`NOTIFICATION_EMAIL_TO`), no derivado de
   `created_by`. Cliente único → un buzón de empleados basta y simplifica.
5. **Sin config → no-op silencioso:** si falta `RESEND_API_KEY` / `RESEND_FROM_EMAIL`
   / `NOTIFICATION_EMAIL_TO`, se omite (`skipped: true`), no es error. Cliente lazy
   (`getResend()`) para no romper build/tests sin la key.

### Variables de entorno

- `RESEND_API_KEY` — key de Resend.
- `RESEND_FROM_EMAIL` — remitente. Modo pruebas: `onboarding@resend.dev` (sólo
  entrega al correo de la propia cuenta Resend). Producción: dominio verificado.
- `NOTIFICATION_EMAIL_TO` — buzón de los empleados.
- `NOTIFICATION_REPLY_TO` — opcional, a dónde van las respuestas.
- `NEXT_PUBLIC_APP_URL` — base para el link "Ver cotización".

## Alternativas descartadas

- **Revenue-share / notificar al vendedor por `created_by`:** innecesario con
  cliente único; complica sin beneficio.
- **Nodemailer + Gmail SMTP:** sin dominio, pero peor entregabilidad, "vía gmail",
  límite ~500/día y acopla el código a Gmail. Resend deja el envío desacoplado y
  migrable con sólo cambiar env.
- **react-email:** template HTML plano evita otra dependencia; suficiente para un
  aviso simple.

## Módulo

- `src/lib/email/client.ts` — cliente Resend lazy (`getResend()` → `Resend | null`).
- `src/lib/email/send-approval-notification.ts` — arma el HTML y envía; nunca lanza.
- Enganche en `src/app/api/approve/[token]/route.ts` (paso 5, post-update de status).
- Tests: `tests/api/approve.test.ts` (mock del módulo de email; verifica disparo
  sólo en `approved`, no-envío en avance/rechazo, y 200 ante fallo de correo).

## Pendiente

- **Dominio de envío:** hoy en modo pruebas de Resend (plan free = 1 dominio, ya
  usado por otro proyecto). Producción real requiere verificar un dominio —
  idealmente el de DYMMSA — y actualizar `RESEND_FROM_EMAIL` + `NOTIFICATION_EMAIL_TO`.
  Sin cambios de código: sólo env.
