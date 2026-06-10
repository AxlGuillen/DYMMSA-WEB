import { describe, test, expect } from 'vitest'
import { parseChangelog } from '@/lib/changelog'

const SAMPLE = `# Novedades

Registro de mejoras y correcciones.

## 2026-06-09 — v1.4

### Corregido
- Las cotizaciones grandes se cargaban
  incompletas. Ahora se cargan completas.

### Mejorado
- Errores más claros al guardar.
- El editor responde más rápido.

---

## 2026-05-07

### Nuevo
- Modo Discreto.
`

describe('parseChangelog', () => {
  test('parsea releases en el orden del archivo', () => {
    const releases = parseChangelog(SAMPLE)
    expect(releases).toHaveLength(2)
    expect(releases[0].date).toBe('2026-06-09')
    expect(releases[1].date).toBe('2026-05-07')
  })

  test('extrae la versión cuando está presente y la omite cuando no', () => {
    const [first, second] = parseChangelog(SAMPLE)
    expect(first.version).toBe('v1.4')
    expect(second.version).toBeUndefined()
  })

  test('mapea los encabezados a categorías', () => {
    const [first] = parseChangelog(SAMPLE)
    const cats = first.entries.map((e) => e.category)
    expect(cats).toContain('corregido')
    expect(cats).toContain('mejorado')
    expect(cats).not.toContain('nuevo')
  })

  test('une las líneas de continuación (wrap) de una entrada', () => {
    const [first] = parseChangelog(SAMPLE)
    const corregido = first.entries.find((e) => e.category === 'corregido')
    expect(corregido?.text).toBe(
      'Las cotizaciones grandes se cargaban incompletas. Ahora se cargan completas.',
    )
  })

  test('agrupa varias entradas bajo la misma categoría', () => {
    const [first] = parseChangelog(SAMPLE)
    const mejoras = first.entries.filter((e) => e.category === 'mejorado')
    expect(mejoras).toHaveLength(2)
    expect(mejoras[1].text).toBe('El editor responde más rápido.')
  })

  test('ignora intro, separadores y el título principal', () => {
    const releases = parseChangelog(SAMPLE)
    const allText = releases.flatMap((r) => r.entries.map((e) => e.text))
    expect(allText).not.toContain('Registro de mejoras y correcciones.')
    expect(allText.join(' ')).not.toContain('---')
  })

  test('archivo vacío → []', () => {
    expect(parseChangelog('')).toEqual([])
  })

  test('ignora entradas sin categoría activa', () => {
    const raw = `## 2026-01-01\n- huérfana sin categoría\n`
    const [release] = parseChangelog(raw)
    expect(release.entries).toHaveLength(0)
  })

  test('encabezado ## sin fecha no abre release', () => {
    const raw = `## Sin fecha aquí\n### Nuevo\n- algo\n`
    expect(parseChangelog(raw)).toEqual([])
  })
})
