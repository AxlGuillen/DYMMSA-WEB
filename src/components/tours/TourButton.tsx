'use client'

import { Button } from '@/components/ui/button'
import { CircleHelp } from '@/components/icons'
import { startOverview } from '@/lib/tours'
import { TOURS, type TourId } from '@/lib/tours/registry'
import { tutorialsForTour } from '@/lib/tutorials'
import { TutorialButton } from '@/components/tutorials/TutorialButton'

export type { TourId }

/** The ONLY entry point to tours (ADR-024): always optional, never auto-started.
 *  Steps resolve client-side so server pages can place it without passing functions.
 *  A screen with a video tutorial gets "Ver tutorial" next to it, from the catalog (ADR-038). */
export function TourButton({ tour }: { tour: TourId }) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Vista guiada"
        onClick={() => startOverview(TOURS[tour])}
      >
        <CircleHelp className="mr-2 size-4" />
        Vista guiada
      </Button>
      <TutorialButton tutorials={tutorialsForTour(tour)} />
    </>
  )
}
