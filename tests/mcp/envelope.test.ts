/** The standard answers (#155 C3, ADR-041 §9): the helpers C6 and Phase D build on, and what every result carries. */

import { describe, test, expect } from 'vitest'
import {
  diff,
  LIST_KEYS,
  listResult,
  previewEnvelope,
  RECORD_KEYS,
  recordResult,
  refOf,
  WRITE_ACTIONS,
  WRITE_KEYS,
  writeResult,
} from '@/lib/mcp/core/envelope'
import { toolResultOf, withResultMeta } from '@/lib/mcp/core/result'

const UUID = '3F2A9C1B-0000-4000-8000-000000000001'

describe('colección: listResult', () => {
  test('total, pagina, por_pagina y hay_mas, y la nota dice cómo pedir la página siguiente', () => {
    const result = listResult('facturas', [{ n: 1 }, { n: 2 }], { total: 5, pagina: 1, por_pagina: 2 })
    expect(result).toEqual({ total: 5, pagina: 1, por_pagina: 2, hay_mas: true, nota: 'Hay 3 más: pide pagina=2.', facturas: [{ n: 1 }, { n: 2 }] })
    // The envelope first, the list last: the model reads the totals before the rows.
    expect(Object.keys(result)).toEqual(['total', 'pagina', 'por_pagina', 'hay_mas', 'nota', 'facturas'])
  })

  test('hay_mas sale de lo mostrado: en la última página no hay más ni nota, y una nota propia gana', () => {
    expect(listResult('facturas', [5], { total: 5, pagina: 3, por_pagina: 2 })).toEqual({ total: 5, pagina: 3, por_pagina: 2, hay_mas: false, facturas: [5] })
    expect(listResult('facturas', [], { total: 0, pagina: 1, por_pagina: 20 })).toMatchObject({ hay_mas: false, facturas: [] })
    expect(listResult('facturas', [1], { total: 9, pagina: 1, por_pagina: 1 }, 'Filtra por proveedor.').nota).toBe('Filtra por proveedor.')
  })

  test('el nombre de la lista no puede ser una llave de la envoltura', () => {
    expect(LIST_KEYS).toEqual(['total', 'pagina', 'por_pagina', 'hay_mas', 'nota'])
    for (const key of LIST_KEYS) expect(() => listResult(key as string, [], { total: 0, pagina: 1, por_pagina: 1 })).toThrow(/envelope key/)
  })
})

describe('registro: recordResult y refOf', () => {
  test('ref primero, la entidad tal cual, avisos y nota al final; lo vacío no viaja', () => {
    const result = recordResult({ nombre: 'Perfiles', monto: 10 }, { ref: refOf(UUID), avisos: ['Vence hoy'], nota: 'Pagada a medias.' })
    expect(result).toEqual({ ref: '3f2a9c1b', nombre: 'Perfiles', monto: 10, avisos: ['Vence hoy'], nota: 'Pagada a medias.' })
    expect(Object.keys(result)).toEqual(['ref', 'nombre', 'monto', 'avisos', 'nota'])
    expect(recordResult({ nombre: 'Perfiles' }, { avisos: [], nota: null })).toEqual({ nombre: 'Perfiles' })
  })

  test('una entidad que ya trae ref, avisos o nota es error: la envoltura no la pisa en silencio', () => {
    expect(RECORD_KEYS).toEqual(['ref', 'avisos', 'nota'])
    expect(() => recordResult({ nota: 'x' } as never)).toThrow(/envelope key/)
  })

  test('refOf: los 8 primeros caracteres del UUID, en minúsculas; nunca de algo que no es UUID', () => {
    expect(refOf(UUID)).toBe('3f2a9c1b')
    expect(() => refOf('S00912')).toThrow(/not a UUID/)
  })
})

describe('escritura: writeResult', () => {
  test('escrito sale de la acción: solo creado, actualizado y borrado escriben', () => {
    const written = Object.fromEntries(WRITE_ACTIONS.map((accion) => [accion, writeResult(accion, 'factura', {}).escrito]))
    expect(written).toEqual({ simulado: false, creado: true, actualizado: true, borrado: true, sin_cambios: false, ya_existia: false })
  })

  test('las llaves en el orden del plan §4 y la entidad con su nombre', () => {
    const result = writeResult('actualizado', 'factura', { concepto: 'Perfiles' }, {
      cambios: { monto: { antes: 2300, ahora: 3200 } },
      avisos: ['Es una factura pagada.'],
      nota: 'Corregida.',
    })
    expect(result).toEqual({
      accion: 'actualizado',
      escrito: true,
      factura: { concepto: 'Perfiles' },
      cambios: { monto: { antes: 2300, ahora: 3200 } },
      avisos: ['Es una factura pagada.'],
      nota: 'Corregida.',
    })
    expect(Object.keys(result)).toEqual(['accion', 'escrito', 'factura', 'cambios', 'avisos', 'nota'])
  })

  test('fase 1 de una escritura en dos fases (C4): simulado, sin escribir, con bloqueos, clave y vence; lo vacío no viaja', () => {
    const result = writeResult('simulado', 'factura', { monto: 3200 }, { cambios: {}, avisos: [], bloqueos: ['Falta el proveedor'], clave: 'k.1', vence: '2026-10-24T18:30:00Z', nota: 'Nada guardado.' })
    expect(result).toEqual({ accion: 'simulado', escrito: false, factura: { monto: 3200 }, bloqueos: ['Falta el proveedor'], clave: 'k.1', vence: '2026-10-24T18:30:00Z', nota: 'Nada guardado.' })
  })

  test('el nombre de la entidad no puede ser una llave de la envoltura', () => {
    for (const key of WRITE_KEYS) expect(() => writeResult('creado', key as string, {})).toThrow(/envelope key/)
  })
})

describe('diff: antes/ahora', () => {
  const before = { id: 'p1', concepto: 'Perfiles', monto: 2300, marcas: ['URREA'], notas: null, dias_para_vencer: 3 }

  test('solo lo que cambió, y los derivados que se ignoran no cuentan', () => {
    const after = { ...before, monto: 3200, dias_para_vencer: 9 }
    expect(diff(before, after, ['id', 'dias_para_vencer'])).toEqual({ monto: { antes: 2300, ahora: 3200 } })
    expect(diff(before, { ...before })).toEqual({})
  })

  test('compara por JSON: una lista igual no es cambio, una distinta sí', () => {
    expect(diff(before, { ...before, marcas: ['URREA'] })).toEqual({})
    expect(diff(before, { ...before, marcas: ['URREA', 'SURTEK'] })).toEqual({ marcas: { antes: ['URREA'], ahora: ['URREA', 'SURTEK'] } })
  })

  test('un campo que aparece o desaparece se lee como null, y null contra ausente no es cambio', () => {
    expect(diff({ a: 1 }, { b: 2 })).toEqual({ b: { antes: null, ahora: 2 }, a: { antes: 1, ahora: null } })
    expect(diff({ notas: null }, {})).toEqual({})
  })

  test('mismo resultado que el cálculo de update_payable antes de #155 C3', () => {
    const after = { ...before, concepto: 'Perfiles de aluminio', notas: 'urgente', dias_para_vencer: 1 }
    const legacy = Object.fromEntries(
      Object.entries(after)
        .filter(([key, value]) => key !== 'id' && key !== 'dias_para_vencer' && (before as Record<string, unknown>)[key] !== value)
        .map(([key, value]) => [key, { antes: (before as Record<string, unknown>)[key], ahora: value }]),
    )
    expect(diff(before, after, ['id', 'dias_para_vencer'])).toEqual(legacy)
  })
})

test('vista previa (§3.5): las llaves que una vista y la fase 2 leen de cualquier vista previa', () => {
  expect(Object.keys(previewEnvelope)).toEqual(['puede_guardar', 'bloqueos', 'avisos', 'clave', 'vence', 'siguiente_paso'])
})

describe('toolResultOf: el texto y su structuredContent (#155 C3)', () => {
  test('un objeto viaja en el texto y como structuredContent, con el mismo JSON', () => {
    const data = { accion: 'creado', proveedor: { nombre: 'Tornillos MX', marcas: ['SURTEK'] } }
    const result = toolResultOf(data)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(data) }])
    expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text))
    expect(result._meta).toBeUndefined()
  })

  test('es el JSON del texto, no el objeto: undefined desaparece y una fecha llega como texto', () => {
    const result = toolResultOf({ fuera: undefined, cuando: new Date('2026-10-24T00:00:00Z'), nota: null })
    expect(result.structuredContent).toStrictEqual({ cuando: '2026-10-24T00:00:00.000Z', nota: null })
    expect(JSON.stringify(result.structuredContent)).toBe(result.content[0].text)
  })

  test('una lista o un escalar se quedan en el texto: la spec solo admite un objeto en structuredContent', () => {
    for (const value of [[1, 2], 'hola', 3, null]) {
      const result = toolResultOf(value)
      expect(result.content[0].text).toBe(JSON.stringify(value))
      expect(result).not.toHaveProperty('structuredContent')
    }
  })

  test('withResultMeta: la meta va en _meta y nunca en el texto ni en structuredContent', () => {
    const result = toolResultOf(withResultMeta({ modo: 'crear' }, { 'dymmsa/autorizacion': 'firma' }))
    expect(result).toEqual({ content: [{ type: 'text', text: '{"modo":"crear"}' }], structuredContent: { modo: 'crear' }, _meta: { 'dymmsa/autorizacion': 'firma' } })
  })
})
