<!--
  Plantilla de PR de DYMMSA — optimizada para que el revisor de IA (y el yo-futuro)
  entiendan QUÉ cambió, POR QUÉ y CÓMO se validó SIN releer todo el repo.
  El diff ya dice el "qué"; el valor de este cuerpo es el CONTEXTO que el diff no muestra.
  Rellena cada sección, borra los comentarios <!-- --> y pon "N/A" en lo que no aplique.
-->

## Resumen
<!-- 1-2 frases en lenguaje llano: qué hace este PR. Es lo primero que lee el revisor. -->

Closes #<!-- número de la issue (usa "Closes #12, #13" si cierra varias; "N/A" si ninguna) -->

## Por qué
<!-- El contexto que el diff NO muestra: qué problema resuelve, qué se decidió y por qué,
     qué alternativas se descartaron. Es la señal de mayor valor para el revisor. -->

## Qué cambió
<!-- Bullets de los cambios concretos, agrupados por área. Menciona archivos/rutas clave. -->
-

## Fuera de alcance
<!-- Qué NO toca este PR a propósito (controla el scope y evita que el revisor lo busque). N/A si no aplica. -->

## Reglas de negocio tocadas
<!-- Fuente de verdad: sección "Reglas de negocio críticas" de CLAUDE.md + src/lib/business-rules.ts.
     Marca lo que aplique y, abajo, explica CÓMO se respetó la regla. -->
- [ ] **No toca ninguna regla de negocio crítica**
- [ ] Totales / separadores / `is_sold` "no lo vendemos" (vía `business-rules.ts`)
- [ ] Descripción DYMMSA (jerarquía catálogo URREA > curada > null)
- [ ] Stock / órdenes / invariante `in_stock + to_order = approved`
- [ ] Aprobación pública `/approve/[token]` (Guardar avance vs Enviar)
- [ ] Auth en rutas API (`requireAuth`)

<!-- Si marcaste alguna, explica aquí cómo se respetó: -->

## Cómo se probó
<!-- Evidencia concreta — marca lo hecho y agrega detalle. -->
- [ ] `bun run test` en verde (menciona tests agregados/actualizados)
- [ ] `bunx tsc --noEmit` limpio
- [ ] Probado en el **preview de Vercel** de este PR
- [ ] `/api/health` responde `ok` (si el cambio toca backend/datos)
- [ ] Verificación manual del flujo afectado: <!-- qué probaste a mano -->

## Riesgo y rollback
<!-- Nivel (bajo/medio/alto) + por qué. Cómo revertir si rompe prod (normalmente `git revert` del merge).
     Marca migraciones de BD o cambios de env vars si los hay. -->

## Para el revisor (IA)
<!-- Opcional pero útil: dónde enfocar, qué te preocupa, y qué YA validaste para que no lo re-cuestione. -->

## Checklist
- [ ] Documenté lo que amerita (`CHANGELOG.md` / bóveda `DYMMSA/`) según CLAUDE.md
- [ ] Sin `any` de TypeScript donde hay tipos en `src/types/database.ts`
- [ ] Capturas / video si hay cambio visual
