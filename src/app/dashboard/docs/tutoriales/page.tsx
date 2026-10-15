import type { Metadata } from 'next'
import { Play } from '@/components/icons'
import { DocsTabs } from '@/components/docs/DocsTabs'
import { TutorialList } from '@/components/tutorials/TutorialList'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/api-helpers'
import { publishedTutorials, TUTORIALS } from '@/lib/tutorials'

export const metadata: Metadata = {
  title: 'Tutoriales',
  description: 'Videos cortos para aprender a usar cada módulo de DYMMSA',
}

export default async function TutorialsPage() {
  const auth = await requireRole(await createClient())
  const isAdmin = !('error' in auth) && auth.profile?.role === 'admin'
  const tutorials = publishedTutorials(TUTORIALS, isAdmin)

  return (
    <div className="docs-page-bg -mx-4 -my-8 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-4">
          <DocsTabs active="tutoriales" />
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
              <Play className="size-8" />
              Tutoriales
            </h1>
            <p className="mt-2 text-muted-foreground">
              Videos cortos de cada módulo. También los encuentras con el botón <strong>Ver tutorial</strong> junto a la
              vista guiada de cada pantalla.
            </p>
          </div>
        </div>
        {tutorials.length === 0 ? (
          <p className="text-muted-foreground">Pronto habrá videos aquí.</p>
        ) : (
          <TutorialList tutorials={tutorials} />
        )}
      </div>
    </div>
  )
}
