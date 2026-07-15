# ADR-017 — Sonidos de interacción de UI (cuelume)

**Fecha:** 2026-07-14
**Estado:** Aceptado
**Relacionado:** issue #28

## Contexto

Se quiere feedback sonoro sutil en los clicks de la app (pulido/carácter), con un
botón de mute junto a los toggles de tema y modo discreto. Candidato: `cuelume`
(sonidos sintetizados en vivo con Web Audio API — sin archivos de audio).

## Evaluación de la librería

| Criterio | Resultado |
|---|---|
| Licencia / deps / peso | MIT · **0 dependencias** · 33 KB unpacked · ESM-only |
| Madurez | ⚠️ v0.1.1, **recién publicada**, un mantenedor |
| API | `bind()` (data-attributes), `play(name)`, `setEnabled(bool)`, 10 sonidos, tipo `SoundName` |
| SSR | Importar en server es no-op ✅ |
| Autoplay | Reanuda el AudioContext suspendido sin lanzar errores ✅ |

## Decisión

Adoptarla **con aislamiento total**: el riesgo de una librería tan joven se
mitiga porque es diminuta, sin dependencias, y su rol es 100% cosmético — si
muere, se quita sin tocar lógica de negocio.

1. **Wrapper único** — `src/lib/sound.ts` es el ÚNICO módulo que importa
   `cuelume`. Cambiarla o eliminarla = tocar un archivo. `playSound()` nunca
   lanza (un fallo de audio jamás rompe la UI).
2. **Un listener delegado global**, no data-attributes por botón: un solo
   `click` listener a nivel documento toca `press` sobre
   `button / a / [role=button]`. Cobertura total sin tocar 50 componentes.
   Ignora `disabled`/`aria-disabled` y trae **throttle de 80 ms** (una ráfaga
   de clicks = un sonido). No se usa `bind()` de cuelume: no hay
   `data-cuelume-*` en el codebase, sería peso muerto.
3. **Preferencia en Zustand persistido** (`stores/soundStore.ts`,
   `dymmsa-sound`), espejo de `discreteModeStore`. **Default: activado, salvo
   `prefers-reduced-motion`** — no existe "prefers-reduced-sound"; esa
   preferencia es el mejor proxy de "sin efectos". La elección manual del
   usuario persiste por encima del default.
4. **`SoundToggle`** (Headphones / HeadphonesOff, iconos exactos en la librería
   animada) en el footer del Sidebar junto a `DiscreteModeToggle` y
   `ThemeToggle`, en ambas variantes (colapsado/expandido). Al re-activar toca
   `toggle` como confirmación audible.
5. **Solo dashboard** — `SoundInit` se monta en el layout del dashboard. El
   login y la página pública `/approve/[token]` (el cliente final) quedan sin
   sonidos a propósito.

## Testing

`tests/components/` (jsdom): wrapper con `cuelume` mockeado (delegación,
closest, throttle, disabled, playSound no lanza), store (defaults con/sin
reduced-motion, persistencia gana al default, toggle) y `SoundToggle`
(orquestación store↔wrapper, feedback solo al re-activar).

## Consecuencias

- ✅ Sonido sutil en toda la app con ~60 líneas propias; mute persistente.
- ✅ Quitarla = borrar 4 archivos chicos + 2 líneas del Sidebar/layout.
- ⚠️ Librería v0.1: vigilar. El aislamiento hace el swap barato.
- ⚠️ El listener global suena para TODO control interactivo; si algún flujo
  no debe sonar (p. ej. un editor con muchos clicks), se le puede excluir por
  selector en el wrapper.
