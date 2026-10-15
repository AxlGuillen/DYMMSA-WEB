'use client'

import { Button } from '@/components/ui/button'
import { Play } from '@/components/icons'
import { TutorialDialog } from './TutorialDialog'
import { isPublished, type Tutorial } from '@/lib/tutorials'

/** "Ver tutorial": next to a screen's guided tour, or at the top of a Documentación section (ADR-038). */
export function TutorialButton({ tutorials, showDocsLink = true }: { tutorials: readonly Tutorial[]; showDocsLink?: boolean }) {
  if (!tutorials.some(isPublished)) return null
  return (
    <TutorialDialog tutorials={tutorials} showDocsLink={showDocsLink}>
      <Button variant="ghost" size="sm" aria-haspopup="dialog">
        <Play className="mr-2 size-4" />
        Ver tutorial
      </Button>
    </TutorialDialog>
  )
}
