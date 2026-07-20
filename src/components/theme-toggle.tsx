'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from '@/components/icons'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  const toggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

    // Aplica el tema al DOM de forma SÍNCRONA. next-themes lo hace en un
    // useEffect pasivo (asíncrono): dentro del callback de startViewTransition
    // el snapshot "new" se capturaría con el tema VIEJO todavía → el círculo no
    // revela nada y el cambio salta de golpe fuera de la transición ("la gota
    // sale de otro lado"). Aplicando la clase aquí, el snapshot "new" ya trae el
    // tema correcto. setTheme se llama igual para persistir/sincronizar el estado
    // (idempotente: su efecto reaplica la misma clase, sin parpadeo).
    const applyTheme = () => {
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(newTheme)
      root.style.colorScheme = newTheme
      setTheme(newTheme)
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (!document.startViewTransition || reducedMotion) {
      applyTheme()
      return
    }

    const x = e.clientX
    const y = e.clientY
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    // oxlint-disable-next-line react-doctor/no-document-start-view-transition -- intentional View Transitions API for theme toggle animation
    const transition = document.startViewTransition(applyTheme)

    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 500,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Cambiar tema"
    >
      <Sun className="size-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  )
}
