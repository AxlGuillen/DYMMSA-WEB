/**
 * Parser del changelog técnico de la bóveda (pestaña Actividad). Lo que se
 * cuida aquí es la heterogeneidad del formato: los meses viejos escriben los
 * bloques distinto que los recientes y ambos tienen que renderizar.
 */

import { describe, test, expect } from 'vitest'
import { parseVaultChangelog, groupActivityByMonth } from '@/lib/vault-changelog'

describe('parseVaultChangelog — formato reciente', () => {
  const raw = `# Changelog técnico — Agosto 2026

## 2026-08-26

**[Corte/#81]:** el acomodo de placas ya no desperdicia hojas.
- \`packSheets\` cambia a carriles por ancho.
- Tests de matemática reescritos.

**Motivo:** el caso reportado pedía dos hojas.

---
`

  test('extrae área, issue, título y viñetas del bloque', () => {
    const [day] = parseVaultChangelog(raw)
    expect(day.date).toBe('2026-08-26')
    expect(day.blocks).toHaveLength(1)
    expect(day.blocks[0].area).toBe('Corte')
    expect(day.blocks[0].issues).toEqual([81])
    expect(day.blocks[0].title).toBe('el acomodo de placas ya no desperdicia hojas.')
    expect(day.blocks[0].details).toHaveLength(2)
  })

  test('el Motivo se pega al bloque abierto, no al día', () => {
    const [day] = parseVaultChangelog(raw)
    expect(day.blocks[0].motivo).toBe('el caso reportado pedía dos hojas.')
  })
})

describe('parseVaultChangelog — estructura del día', () => {
  test('varios bloques en el día y el Total cierra la jornada', () => {
    const [day] = parseVaultChangelog(`## 2026-07-16 (III)

**[Feature]:** algo nuevo.
- detalle

**[Fix]:** algo roto.
- otro detalle

**Total:** 636 tests, 0 fallos.
`)
    expect(day.label).toBe('III')
    expect(day.blocks.map((b) => b.area)).toEqual(['Feature', 'Fix'])
    // El Total es del día: pegarlo al último bloque lo atribuiría solo al Fix.
    expect(day.total).toBe('636 tests, 0 fallos.')
    expect(day.blocks[1].details).toEqual(['otro detalle'])
  })

  test('las etiquetas de apoyo amplían el bloque en vez de abrir uno nuevo', () => {
    const [day] = parseVaultChangelog(`## 2026-07-01

**[Test]:** batería nueva.
**Decisión:** se quedó en Vitest.
`)
    expect(day.blocks).toHaveLength(1)
    expect(day.blocks[0].details).toEqual(['Decisión: se quedó en Vitest.'])
  })
})

describe('parseVaultChangelog — formato viejo', () => {
  test('migración: el folio pasa al título y el badge queda "Migración"', () => {
    const [day] = parseVaultChangelog(`## 2026-04-09

**Migración \`20260409055423\`:** \`rename_order_statuses_to_generic\`

Renombró los estados de \`orders.status\`:
- \`pending_urrea_order\` → \`ordered\`

**Motivo:** los nombres eran muy específicos.
`)
    expect(day.blocks[0].area).toBe('Migración')
    expect(day.blocks[0].title).toBe('`20260409055423` — `rename_order_statuses_to_generic`')
    // El párrafo suelto también es cuerpo del bloque.
    expect(day.blocks[0].details).toEqual([
      'Renombró los estados de `orders.status`:',
      '`pending_urrea_order` → `ordered`',
    ])
    expect(day.blocks[0].motivo).toBe('los nombres eran muy específicos.')
  })

  test('etiqueta demasiado larga se degrada a título (no cabe como badge)', () => {
    const [day] = parseVaultChangelog(`## 2026-07-20

**Fixes de correctness (post code-review del branch):** tres ajustes.
`)
    expect(day.blocks[0].area).toBe('')
    expect(day.blocks[0].title).toBe('Fixes de correctness (post code-review del branch) — tres ajustes.')
  })
})

describe('parseVaultChangelog — ruido', () => {
  test('headings sin fecha, separadores y días vacíos se descartan', () => {
    const days = parseVaultChangelog(`# Changelog técnico

## Notas sueltas

**[Feature]:** esto no debería aparecer, su heading no tiene fecha.

---

## 2026-06-10

**[UI]:** sí aparece.
`)
    expect(days).toHaveLength(1)
    expect(days[0].date).toBe('2026-06-10')
  })

  test('archivo vacío → sin días', () => {
    expect(parseVaultChangelog('')).toEqual([])
  })
})

describe('groupActivityByMonth', () => {
  test('agrupa por el mes de la FECHA, no por el archivo que la contiene', () => {
    // `2026-04.md` arrastra días de marzo: agrupar por archivo los mandaría a abril.
    const months = groupActivityByMonth([
      { date: '2026-04-01', blocks: [] },
      { date: '2026-03-30', blocks: [] },
    ])
    expect(months.map((m) => m.month)).toEqual(['2026-04', '2026-03'])
  })

  test('ordena de lo más reciente a lo más antiguo y conserva el orden del día repetido', () => {
    const months = groupActivityByMonth([
      { date: '2026-07-16', label: 'II', blocks: [] },
      { date: '2026-07-31', blocks: [] },
      { date: '2026-07-16', blocks: [] },
    ])
    expect(months).toHaveLength(1)
    expect(months[0].days.map((d) => `${d.date}${d.label ?? ''}`)).toEqual([
      '2026-07-31', '2026-07-16II', '2026-07-16',
    ])
  })
})
