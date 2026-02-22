'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  const router = useRouter()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        {/* Logo */}
        <Link href="/dashboard">
          <Image
            src="/dymmsa-logo.webp"
            alt="DYMMSA Logo"
            width={320}
            height={160}
            className="mx-auto h-auto w-36 opacity-80"
            priority
          />
        </Link>

        <Separator />

        {/* 404 Block */}
        <div className="space-y-3">
          <p className="text-8xl font-bold tracking-tighter text-muted-foreground/40">
            404
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Pagina no encontrada
          </h1>
          <p className="text-sm text-muted-foreground">
            La pagina que buscas no existe o fue movida.
            <br />
            Verifica la URL o regresa al inicio.
          </p>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/dashboard">
              <Home className="mr-2 h-4 w-4" />
              Ir al inicio
            </Link>
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Regresar
          </Button>
        </div>
      </div>

      {/* Footer */}
      <p className="absolute bottom-6 text-xs text-muted-foreground">
        DYMMSA &copy; {new Date().getFullYear()}
      </p>
    </div>
  )
}
