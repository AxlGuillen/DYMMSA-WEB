import { describe, test, expect } from 'vitest'
import { parseChangelog, visibleReleases } from '@/lib/changelog'

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

describe('entradas solo para administradores', () => {
  const raw = [
    '## 2026-10-01',
    '### Nuevo',
    '- **Para todos.** Algo que ve el equipo.',
    '- [admin] **Días feriados.** En Equipo, un administrador',
    '  marca los días.',
    '## 2026-09-30',
    '### Corregido',
    '- [ADMIN] Solo admin.',
  ].join('\n')

  test('la etiqueta se quita del texto y marca la entrada', () => {
    const [release] = parseChangelog(raw)
    expect(release.entries[1]).toEqual({ category: 'nuevo', text: '**Días feriados.** En Equipo, un administrador marca los días.', adminOnly: true })
    expect(release.entries[0].adminOnly).toBe(false)
  })

  test('un miembro no las ve y una fecha que se queda vacía desaparece; el admin ve todo', () => {
    const releases = parseChangelog(raw)
    const member = visibleReleases(releases, false)
    expect(member).toHaveLength(1)
    expect(member[0].entries.map((e) => e.text)).toEqual(['**Para todos.** Algo que ve el equipo.'])
    expect(visibleReleases(releases, true)).toEqual(releases)
  })

  test('el CHANGELOG real no filtra a un miembro nada que mencione a "los administradores"', async () => {
    const { readFileSync } = await import('node:fs')
    const real = parseChangelog(readFileSync('CHANGELOG.md', 'utf8'))
    const leaked = visibleReleases(real, false).flatMap((r) => r.entries).filter((e) => /\badministrador(es)?\b.*\b(marca|suben|asignan|corregir|ven quién|ven y capturan)/i.test(e.text))
    expect(leaked.map((e) => e.text.slice(0, 60))).toEqual([])
  })
})
