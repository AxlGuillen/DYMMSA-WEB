import Image from 'next/image'
import { ShieldCheck } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'

interface SuccessScreenProps {
  approvedCount: number
  notApprovedCount: number
}

/** Pantalla de confirmación tras enviar la aprobación definitiva. */
export function SuccessScreen({ approvedCount, notApprovedCount }: SuccessScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 [background-image:radial-gradient(1000px_500px_at_70%_-10%,rgba(163,3,5,0.06),transparent_60%),radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:auto,22px_22px]">
      <div className="mb-8">
        <Image src="/dymmsa-logo.webp" alt="DYMMSA" width={210} height={84} className="object-contain" priority />
      </div>
      <Card className="w-full max-w-md border border-border/60 bg-card/70 text-center shadow-xl backdrop-blur-xl">
        <CardContent className="space-y-5 pb-10 pt-10">
          <div className="flex justify-center">
            <div className="rounded-full bg-green-100 p-4 dark:bg-green-900/30">
              <ShieldCheck className="size-14 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">¡Aprobación enviada!</h2>
            <p className="text-sm text-muted-foreground">
              Tu selección ha sido registrada. El equipo de DYMMSA la recibirá de inmediato.
            </p>
          </div>
          <div className="flex justify-center gap-8 pt-2">
            <div className="text-center">
              <p className="text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">{approvedCount}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Aprobados</p>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold tabular-nums text-muted-foreground">{notApprovedCount}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">No aprobados</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <p className="mt-8 text-xs text-muted-foreground">
        DYMMSA · Distribuidor autorizado URREA · Morelia, Mich.
      </p>
    </div>
  )
}
