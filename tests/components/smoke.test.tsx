/** Smoke test for the component harness: jsdom + React 19 JSX, the @/ alias, and jest-dom matchers. */

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
