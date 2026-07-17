import Image from 'next/image'
import { ShieldCheck } from '@/components/icons'

interface SuccessScreenProps {
  approvedCount: number
  notApprovedCount: number
}

/**
 * Pantalla de confirmación tras enviar la aprobación definitiva.
 * Mismo lenguaje glass que el resto de la página (issue #24): fondo con los
 * radiales + retícula de puntos de ApprovalClient, card `bg-card/40` con
 * blur, labels mono en mayúsculas (patrón SummaryTiles) y escudo con glow.
 */
export function SuccessScreen({ approvedCount, notApprovedCount }: SuccessScreenProps) {
  const label = 'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 [background-image:radial-gradient(1100px_540px_at_72%_-8%,rgba(163,3,5,0.07),transparent_58%),radial-gradient(900px_520px_at_6%_4%,rgba(80,80,120,0.08),transparent_55%),radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:auto,auto,22px_22px]">
      <div className="mb-8">
        <Image src="/dymmsa-logo.webp" alt="DYMMSA" width={210} height={84} className="object-contain" priority />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/40 p-10 text-center shadow-xl backdrop-blur-xl">
        <div className="flex justify-center">
          <div className="rounded-full border border-green-500/30 bg-green-500/10 p-4 shadow-[0_0_40px_-4px] shadow-green-500/40">
            <ShieldCheck className="size-14 text-green-600 dark:text-green-400" />
          </div>
        </div>

        <div className="mt-5 space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">¡Aprobación enviada!</h2>
          <p className="text-sm text-muted-foreground">
            Tu selección ha sido registrada. El equipo de DYMMSA la recibirá de inmediato.
          </p>
        </div>

        <div className="mt-7 grid grid-cols-2 divide-x divide-border/60 rounded-xl border border-border/60 bg-card/60 py-4 backdrop-blur">
          <div className="text-center">
            <p className="text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">{approvedCount}</p>
            <p className={label}>Aprobados</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold tabular-nums text-muted-foreground">{notApprovedCount}</p>
            <p className={label}>No aprobados</p>
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        DYMMSA · Distribuidor autorizado URREA · Morelia, Mich.
      </p>
    </div>
  )
}
