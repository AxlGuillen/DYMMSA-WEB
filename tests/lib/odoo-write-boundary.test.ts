/**
 * Static scan of src/ (#144, ADR-040): one door to Odoo's JSON-2, one place that builds the
 * writer, issues admin proofs or writes internal_note. A new file that bypasses them fails here.
 */

import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()

interface SourceFile {
  /** POSIX path relative to the repo root. */
  path: string
  text: string
}

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts)$/.test(entry)) {
      out.push({ path: relative(ROOT, full).split(sep).join('/'), text: readFileSync(full, 'utf8') })
    }
  }
  return out
}

const SOURCES = walk(join(ROOT, 'src'))

const parsed = new Map<string, ts.SourceFile>()
function ast(file: SourceFile): ts.SourceFile {
  let source = parsed.get(file.path)
  if (!source) {
    const kind = file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, kind)
    parsed.set(file.path, source)
  }
  return source
}

function anyNode(file: SourceFile, match: (node: ts.Node) => boolean): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (match(node)) found = true
    else ts.forEachChild(node, visit)
  }
  visit(ast(file))
  return found
}

/** Files (after a cheap text prefilter) where the AST matches. */
function filesWhere(needle: string, match: (node: ts.Node) => boolean): string[] {
  return SOURCES.filter((f) => f.text.includes(needle) && anyNode(f, match))
    .map((f) => f.path)
    .sort()
}

const filesContaining = (pattern: RegExp) =>
  SOURCES.filter((f) => pattern.test(f.text))
    .map((f) => f.path)
    .sort()

function propertyName(name: ts.PropertyName | ts.MemberName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return null
}

function calleeName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

/** An object key or an assignment target named `field` — a value being BUILT, not read. */
function writesField(field: string) {
  return (node: ts.Node): boolean => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      return propertyName(node.name) === field
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left
      if (ts.isPropertyAccessExpression(target)) return target.name.text === field
      if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)) {
        return target.argumentExpression.text === field
      }
    }
    return false
  }
}

const WRITE_KEY_VAR = 'ODOO_WRITE_API_KEY'

/** Code that names the key (access, destructuring); messages and comments that mention it don't count. */
function readsWriteKey(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === WRITE_KEY_VAR
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text === WRITE_KEY_VAR
  }
  if (ts.isBindingElement(node) && node.propertyName) return propertyName(node.propertyName) === WRITE_KEY_VAR
  return false
}

describe('frontera de escritura en Odoo (#144)', () => {
  test('el escaneo ve el código fuente', () => {
    expect(SOURCES.length).toBeGreaterThan(100)
    expect(SOURCES.map((f) => f.path)).toContain('src/lib/odoo/writer.ts')
  })

  test('solo client.ts y health.ts hablan JSON-2 directo', () => {
    expect(filesContaining(/json\/2/)).toEqual(['src/lib/health.ts', 'src/lib/odoo/client.ts'])
  })

  test('el escritor solo se construye en writer.ts', () => {
    const builders = new Set(['createOdooRawWriter', 'createOdooWriter'])
    const builtIn = filesWhere('createOdoo', (node) => builders.has(calleeName(node) ?? ''))
    expect(builtIn).toEqual(['src/lib/odoo/writer.ts'])
    // By name, imports included: an aliased import (`as raw`) would dodge the callee check.
    expect(filesContaining(/\bcreateOdooRawWriter\b/)).toEqual(['src/lib/odoo/client.ts', 'src/lib/odoo/writer.ts'])
    expect(filesContaining(/\bOdooRawWriter\b/)).toEqual(['src/lib/odoo/client.ts', 'src/lib/odoo/writer.ts'])
    expect(filesContaining(/\bcreateOdooWriter\b/)).toEqual(['src/lib/odoo/writer.ts'])
  })

  test('issueAdminProof solo se llama desde shared.ts', () => {
    const named = filesContaining(/\bissueAdminProof\b/).filter((path) => path !== 'src/lib/odoo/write-guard.ts')
    for (const path of named) expect(path).toBe('src/lib/mcp/shared.ts')
    // Not even the guard calls it on its own behalf.
    const called = filesWhere('issueAdminProof', (node) => calleeName(node) === 'issueAdminProof')
    for (const path of called) expect(path).toBe('src/lib/mcp/shared.ts')
  })

  test('internal_note solo lo arma writer.ts', () => {
    // write-catalog.ts only declares its schema; reading the field elsewhere is fine.
    expect(filesWhere('internal_note', writesField('internal_note'))).toEqual([
      'src/lib/odoo/write-catalog.ts',
      'src/lib/odoo/writer.ts',
    ])
  })

  test('fuera de write-catalog.ts ningún archivo nombra action_post, action_invoice_sent, action_send_and_print, button_draft ni _create_invoices', () => {
    for (const name of ['action_post', 'action_invoice_sent', 'action_send_and_print', 'button_draft', '_create_invoices']) {
      const files = SOURCES.filter((f) => f.text.includes(name) && f.path !== 'src/lib/odoo/write-catalog.ts')
      expect(
        files.map((f) => f.path),
        name,
      ).toEqual([])
    }
  })

  test('la llave de escritura solo se lee en env.ts', () => {
    // Everyone else goes through odooWriteEnv(), read per call and never at import.
    expect(filesWhere(WRITE_KEY_VAR, readsWriteKey)).toEqual(['src/lib/odoo/env.ts'])
  })

  test('el detector de la llave ve accesos y destructuraciones, no textos', () => {
    for (const snippet of [
      'const k = process.env.ODOO_WRITE_API_KEY',
      "const k = process.env['ODOO_WRITE_API_KEY']",
      'const k = process.env[`ODOO_WRITE_API_KEY`]',
      'const { ODOO_WRITE_API_KEY } = process.env',
      'const { ODOO_WRITE_API_KEY: key } = process.env',
      "const { 'ODOO_WRITE_API_KEY': key } = process.env",
      'const env = process.env; const k = env.ODOO_WRITE_API_KEY',
    ]) {
      expect(anyNode({ path: `${snippet}.ts`, text: snippet }, readsWriteKey), snippet).toBe(true)
    }
    for (const snippet of [
      "const m = 'falta ODOO_WRITE_API_KEY'",
      'const m = `(ODOO_WRITE_API_KEY) ${x}`',
      '// ODOO_WRITE_API_KEY is read per call',
    ]) {
      expect(anyNode({ path: `${snippet}.ts`, text: snippet }, readsWriteKey), snippet).toBe(false)
    }
  })

  test('el detector reconoce cada forma de armar un campo', () => {
    const sample: SourceFile = {
      path: 'sample.ts',
      text: [
        "interface Row { internal_note: string }",
        "const read = (row: Row) => row.internal_note",
        "const fields = ['internal_note']",
      ].join('\n'),
    }
    expect(anyNode(sample, writesField('internal_note'))).toBe(false)
    for (const snippet of [
      "const vals = { internal_note: '<p>x</p>' }",
      "const vals = { 'internal_note': x }",
      "const vals = { ['internal_note']: x }",
      'const vals = { internal_note }',
      "vals.internal_note = '<p>x</p>'",
      "vals['internal_note'] = x",
    ]) {
      expect(anyNode({ path: `${snippet}.ts`, text: snippet }, writesField('internal_note')), snippet).toBe(true)
    }
  })
})
