'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import Image from 'next/image'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      toast.error('Error al iniciar sesion', {
        description: error.message,
      })
      setLoading(false)
      return
    }

    toast.success('Sesion iniciada correctamente')
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="login-page-bg relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Ambient glows — light: soft rose / dark: deep red */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-56 -top-56 h-[580px] w-[580px] rounded-full bg-rose-300/15 blur-[180px] dark:bg-red-950/35" />
        <div className="absolute -bottom-56 -right-56 h-[580px] w-[580px] rounded-full bg-red-200/20 blur-[180px] dark:bg-red-900/20" />
      </div>

      {/* Card with rotating border */}
      <div className="login-card-border relative z-10 w-full max-w-md">
        <Card className="login-card-inner border-0">
          <CardHeader className="gap-0 text-center">
            <Image
              src="/dymmsa-logo.webp"
              alt="DYMMSA Logo"
              width={320}
              height={160}
              className="mx-auto h-auto w-40"
              priority
            />
            <CardDescription className="-mt-10">Sistema de Cotizaciones</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="-mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electronico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contrasena</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Tu contrasena"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 hover:cursor-pointer"
                    aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Iniciando sesion...' : 'Iniciar sesion'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
