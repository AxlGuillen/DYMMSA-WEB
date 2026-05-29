import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCard } from '@/components/dashboard/MetricCard'

describe('MetricCard', () => {
  test('muestra título y valor', () => {
    render(<MetricCard title="Cotizaciones" value={42} />)
    expect(screen.getByText('Cotizaciones')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  test('muestra la descripción cuando se provee', () => {
    render(<MetricCard title="Total" value="$1,000.00" description="últimos 30 días" />)
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('últimos 30 días')).toBeInTheDocument()
  })

  test('en isLoading oculta el valor y muestra skeletons', () => {
    const { container } = render(
      <MetricCard title="Órdenes" value={99} description="x" isLoading />,
    )
    expect(screen.queryByText('99')).not.toBeInTheDocument()
    // shadcn Skeleton lleva la clase utilitaria "animate-pulse".
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  test('renderiza el icono cuando se provee', () => {
    render(
      <MetricCard title="Con icono" value={1} icon={<svg data-testid="ic" />} color="blue" />,
    )
    expect(screen.getByTestId('ic')).toBeInTheDocument()
  })
})
