/** TimeImportPanel (#93): the result panel reports counts, skipped edits and unmapped employees. */

import { describe, test, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { TimeImportPanel } from '@/components/hours/TimeImportPanel'
import type { TimeImportResult } from '@/types/database'

const RESULT: TimeImportResult = {
  period: { start: '2026-08-31', end: '2026-09-06' },
  inserted: 12,
  updated: 3,
  skipped_edited: 1,
  unmapped: [{ clockId: 7, name: 'Nuevo Empleado' }],
  warnings: ['Diego Baltazar (1): 2026-09-03 salida sin entrada'],
}

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/hooks/useTimeEntries', () => ({
  useImportTimeEntries: () => ({ mutateAsync, isPending: false }),
  useTimeImports: () => ({
    data: [{
      id: 'imp-1', period_start: '2026-08-24', period_end: '2026-08-30', file_name: 'NGTimereport-20260824.xls',
      inserted: 20, updated: 0, skipped_edited: 0, imported_by: 'u1', created_at: '2026-08-31T15:00:00Z',
    }],
  }),
}))

describe('TimeImportPanel', () => {
  test('sube el archivo y muestra el resumen con no mapeados y saltadas', async () => {
    mutateAsync.mockResolvedValueOnce(RESULT)
    const user = userEvent.setup()
    renderWithProviders(<TimeImportPanel />)

    expect(screen.getByText('NGTimereport-20260824.xls')).toBeInTheDocument()

    const file = new File(['x'], 'NGTimereport-20260831.xls', { type: 'application/vnd.ms-excel' })
    await user.upload(screen.getByLabelText('Seleccionar archivo Excel'), file)
    await user.click(screen.getByRole('button', { name: 'Procesar archivo' }))

    expect(mutateAsync).toHaveBeenCalledWith(file)
    const panel = await screen.findByTestId('import-result')
    expect(panel).toHaveTextContent('12')
    expect(panel).toHaveTextContent('Saltadas por edición')
    expect(panel).toHaveTextContent('Nuevo Empleado')
    expect(panel).toHaveTextContent('checador 7')
    expect(screen.getByRole('link', { name: 'Equipo' })).toHaveAttribute('href', '/dashboard/hours/team')
    expect(panel).toHaveTextContent('1 aviso del archivo')
  })
})
