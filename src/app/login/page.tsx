'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2 } from '@/components/icons'
import { isSafeNext } from '@/lib/safe-next'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { push, refresh } = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      toast.error('Error al iniciar sesión', { description: error.message })
      setLoading(false)
      return
    }

    toast.success('Sesión iniciada')
    // Honor ?next= (ADR-023) behind the isSafeNext guard; window.location avoids requiring Suspense.
    const next = new URLSearchParams(window.location.search).get('next')
    push(isSafeNext(next) ? next : '/dashboard')
    refresh()
  }

  return (
    <div className="flex min-h-screen">
      {/* No hard width cap: `max-w-2xl` froze it at 672px and left a huge gap on wide screens.
          Dark in both themes on purpose — this is a brand surface, not UI. */}
      <aside className="login-brand relative hidden w-[46%] max-w-[920px] flex-col justify-end overflow-hidden px-14 pb-28 pt-16 lg:flex">
        {/* justify-end: the photo's tools sit up top, so centered text would land on them. */}
        {/* `priority` stays (desktop LCP). `sizes` in px, NOT vw: a vw value floors the
            srcset at 384w and mobile — where the panel is hidden — preloaded 14.7 KB for nothing. */}
        <Image
          src="/login-brand.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 920px, 0px"
          className="login-brand-photo object-cover"
        />
        {/* Scrim guarantees text contrast whatever the photo does behind it. */}
        <div className="login-brand-scrim pointer-events-none absolute inset-0" aria-hidden />
        <div
          className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-red-600/70 to-transparent"
          aria-hidden
        />

        <div className="relative">
          {/* self-start: the aside is flex-column, and the default `stretch` deforms the image, ignoring w-auto. */}
          {/* sizes: the panel is hidden on mobile but still downloads; without this Next fetched w=1080 (45 KB). */}
          <Image
            src="/dymmsa.webp"
            alt=""
            width={440}
            height={180}
            sizes="(min-width: 1024px) 280px, 1px"
            className="login-rise h-24 w-auto self-start drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] xl:h-28"
            priority
          />

          {/* Typographic name, not the raster logo: that one is steel gray with a black outline and vanishes on dark. */}
          <p className="login-rise login-delay-1 mt-10 text-6xl font-semibold tracking-tight text-zinc-50 xl:text-7xl">
            D<span className="text-red-600">Y</span>MMSA
          </p>

          <div className="login-rise login-delay-2 mt-7 h-px w-16 bg-red-600" />

          <p className="login-rise login-delay-2 mt-7 max-w-md text-lg leading-relaxed text-zinc-400">
            Sistema de cotizaciones y gestión de inventario.
          </p>
        </div>

        <p className="login-rise login-delay-3 absolute bottom-12 left-14 text-sm text-zinc-500">
          Distribuidor URREA · Morelia, México
        </p>
      </aside>

      <main className="login-form-bg relative flex flex-1 items-center justify-center overflow-hidden px-6 py-8 sm:py-12">
        <div className="login-form-grid pointer-events-none absolute inset-0" aria-hidden />

        <div className="relative w-full max-w-md">
          {/* Mobile has no brand panel, so the logo lands here on the light background it was designed for. */}
          {/* width/height are the REAL 1024x1024 (wrong ratio reserves the wrong box); `sizes` in px,
              NOT vw — a vw value drops the small srcset candidates and desktop fetched 36 KB it never shows. */}
          <Image
            src="/dymmsa-logo.webp"
            alt="DYMMSA"
            width={1024}
            height={1024}
            sizes="(min-width: 1024px) 1px, 300px"
            className="login-rise mx-auto mb-4 h-auto w-[80vw] max-w-[170px] lg:hidden [@media(min-height:780px)]:max-w-[300px]"
            priority
          />

          {/* Rotating border, same one docs/changelog use. */}
          <div className="login-rise login-delay-1 login-card-border">
            <div className="login-card-inner p-8 sm:p-10">
              <div className="mb-8">
                <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Ingresa tus credenciales para continuar.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@dymmsa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={loading}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:cursor-pointer hover:text-foreground disabled:opacity-50"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="h-11 w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Iniciando sesión...
                    </>
                  ) : (
                    'Iniciar sesión'
                  )}
                </Button>
              </form>
            </div>
          </div>

          <p className="login-rise login-delay-2 mt-6 text-center text-xs text-muted-foreground">
            ¿Problemas para entrar? Contacta al administrador del sistema.
          </p>
        </div>
      </main>
    </div>
  )
}
