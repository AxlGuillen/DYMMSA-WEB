import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Iniciar Sesion',
  description: 'Inicia sesion en el sistema de cotizaciones DYMMSA',
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
