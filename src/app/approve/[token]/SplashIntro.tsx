'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

const SPLASH_KEY = 'dymmsa-approval-splash'

/**
 * Intro del logo DYMMSA: aparece al centro y vuela a su lugar en el header
 * (issue #24). Se muestra **solo la primera vez por sesión** y respeta
 * `prefers-reduced-motion`. SSR-safe: no renderiza nada hasta decidir en el
 * cliente. Si no puede medir el logo del header, hace un fade simple.
 *
 * El logo aterriza exactamente sobre `[data-approval-logo]` (mismo asset), así
 * que al desmontarse el overlay la transición al header es continua.
 */
export function SplashIntro() {
  const [active, setActive] = useState(false)
  const logoRef = useRef<HTMLImageElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const seen = sessionStorage.getItem(SPLASH_KEY)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (seen || reduced) return
    sessionStorage.setItem(SPLASH_KEY, '1')
    // setState diferido (rAF) para no disparar render en cascada dentro del
    // efecto — mismo patrón que useMounted.
    const id = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!active) return
    const logo = logoRef.current
    const target = document.querySelector('[data-approval-logo]')
    let timer: number

    if (logo && target) {
      const t = target.getBoundingClientRect()
      const s = logo.getBoundingClientRect()
      const dx = t.left + t.width / 2 - (s.left + s.width / 2)
      const dy = t.top + t.height / 2 - (s.top + s.height / 2)
      const scale = s.width > 0 ? t.width / s.width : 1
      logo.animate(
        [
          { transform: 'translate(-50%,-50%) scale(1.06)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.16 },
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.44 },
          {
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`,
            opacity: 1,
            offset: 1,
          },
        ],
        { duration: 1900, easing: 'cubic-bezier(.66,0,.24,1)', fill: 'forwards' },
      )
      backdropRef.current?.animate(
        [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
        { duration: 1900, easing: 'ease-in-out', fill: 'forwards' },
      )
      timer = window.setTimeout(() => setActive(false), 1850)
    } else {
      timer = window.setTimeout(() => setActive(false), 400)
    }

    return () => window.clearTimeout(timer)
  }, [active])

  if (!active) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <div ref={backdropRef} className="absolute inset-0 bg-background" />
      <Image
        ref={logoRef}
        src="/dymmsa-logo.webp"
        alt="DYMMSA"
        width={280}
        height={112}
        priority
        className="absolute left-1/2 top-1/2 h-auto w-[220px] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_12px_50px_rgba(163,3,5,0.35)]"
      />
    </div>
  )
}
