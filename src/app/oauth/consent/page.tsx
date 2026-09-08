/**
 * OAuth consent (ADR-023), behind the login on purpose. The /login redirect keeps
 * ?authorization_id — without it the screen has no idea what it was authorizing.
 */

import Image from 'next/image'
import { redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

import { approveAction, denyAction } from './actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Autorizar conexión | DYMMSA' }

function ConsentError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Solicitud inválida</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </main>
  )
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[] }>
}) {
  const raw = (await searchParams).authorization_id
  const authorizationId = Array.isArray(raw) ? raw[0] : raw
  if (!authorizationId) {
    return <ConsentError message="La solicitud llegó sin identificador de autorización." />
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The proxy already redirects; this is defense in depth, and it preserves the query.
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)

  if (error || !data) {
    return <ConsentError message={error?.message ?? 'La solicitud no es válida o ya expiró.'} />
  }

  // No `authorization_id` in the response means consent was already granted and Supabase returns the redirect URL.
  if (!('authorization_id' in data)) redirect(data.redirect_url)

  const clientName = data.client?.name ?? 'La aplicación'

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <Image
          src="/dymmsa-logo.webp"
          alt="DYMMSA"
          width={1024}
          height={1024}
          className="mx-auto mb-6 h-16 w-auto"
        />

        <h1 className="text-center text-xl font-semibold tracking-tight">
          {clientName} quiere conectarse
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Actuará como <span className="font-medium text-foreground">{user.email}</span> en el
          sistema DYMMSA.
        </p>

        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li>• Consulta cotizaciones, órdenes, inventario y catálogos — lo mismo que ves tú.</li>
          <li>• Puede crear tareas (quedan marcadas como creadas por el asistente).</li>
          <li>• No puede modificar cotizaciones, órdenes ni inventario.</li>
          <li>• Puedes revocar el acceso cuando quieras desde el panel de Supabase.</li>
        </ul>

        {/* Two forms instead of one submitter with name/value: intent lives in which action runs,
            not in a field the browser controls. */}
        <div className="mt-8 flex gap-2">
          <form action={denyAction} className="flex-1">
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <Button type="submit" variant="outline" className="w-full">
              Denegar
            </Button>
          </form>
          <form action={approveAction} className="flex-1">
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <Button type="submit" className="w-full">
              Autorizar
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}
