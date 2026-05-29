/**
 * SMOKE TEST — valida el harness de componentes:
 *   1. entorno jsdom + React 19 + @vitejs/plugin-react (JSX)
 *   2. alias @/ resuelve componentes reales (incl. shadcn/ui Badge)
 *   3. Testing Library + matchers de jest-dom funcionan
 *
 * Si esto pasa, la batería de tests de componentes se construye sobre la misma base.
 */

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotationStatusBadge } from '@/components/quotations/QuotationStatusBadge'

describe('smoke: harness de componentes (jsdom + React 19)', () => {
  test('renderiza el label del estado aprobado', () => {
    render(<QuotationStatusBadge status="approved" />)
    expect(screen.getByText('Aprobada')).toBeInTheDocument()
  })

  test('cambia el label según el estado', () => {
    render(<QuotationStatusBadge status="draft" />)
    expect(screen.getByText('Borrador')).toBeInTheDocument()
  })
})
