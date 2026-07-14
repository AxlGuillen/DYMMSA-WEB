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
    push('/dashboard')
    refresh()
  }

  return (
    <div className="flex min-h-screen">
      {/* Panel de marca — oscuro fijo en ambos temas (es superficie de marca, no de UI) */}
      <aside className="relative hidden w-[44%] max-w-2xl flex-col justify-between overflow-hidden bg-zinc-950 p-12 lg:flex">
        <div className="login-brand-grid pointer-events-none absolute inset-0" aria-hidden />
        {/* Filo rojo: separa el panel del formulario sin una línea dura */}
        <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-red-600/70 to-transparent" aria-hidden />

        {/* self-start: el aside es flex-column y `stretch` (default) deformaría
            la imagen a todo el ancho, ignorando w-auto. */}
        <Image
          src="/dymmsa.webp"
          alt=""
          width={220}
          height={90}
          className="relative h-11 w-auto self-start"
          priority
        />

        <div className="relative">
          {/* Nombre tipográfico, no el logo raster: el logo es gris acero con contorno
              negro y se pierde sobre oscuro. La Y roja conserva la marca. */}
          <p className="text-5xl font-semibold tracking-tight text-zinc-50">
            D<span className="text-red-600">Y</span>MMSA
          </p>
          <div className="mt-6 h-px w-14 bg-red-600" />
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-zinc-400">
            Sistema de cotizaciones y gestión de inventario.
          </p>
        </div>

        <p className="relative text-sm text-zinc-500">Distribuidor URREA · Morelia, México</p>
      </aside>

      {/* Formulario */}
      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          {/* En móvil el panel de marca no existe: el logo entra aquí, sobre fondo claro,
              que es donde está diseñado para vivir. */}
          <Image
            src="/dymmsa-logo.webp"
            alt="DYMMSA"
            width={320}
            height={160}
            className="mb-10 h-16 w-auto lg:hidden"
            priority
          />

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
                  className="pr-10"
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

            <Button type="submit" className="w-full" disabled={loading}>
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

          <p className="mt-10 text-xs text-muted-foreground">
            ¿Problemas para entrar? Contacta al administrador del sistema.
          </p>
        </div>
      </main>
    </div>
  )
}
