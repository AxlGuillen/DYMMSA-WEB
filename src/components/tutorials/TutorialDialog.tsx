'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { VideoFacade } from './VideoFacade'
import { isPublished, type Tutorial } from '@/lib/tutorials'

/**
 * The shared player: a trigger opens a dialog with the video; with two or more, buttons pick one.
 * Closing unmounts the content, so the video stops and reopening starts on the cover.
 */
export function TutorialDialog({
  tutorials,
  children,
  showDocsLink = true,
}: {
  tutorials: readonly Tutorial[]
  /** The trigger: Radix returns the focus to it on close. */
  children: ReactNode
  /** Off inside Documentación itself: the link would point to the page you are on. */
  showDocsLink?: boolean
}) {
  // embedUrl/coverUrl throw on a pending id: a catalog slip hides the video instead of breaking the screen.
  const playable = tutorials.filter(isPublished)
  if (playable.length === 0) return null
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <TutorialPanel tutorials={playable} showDocsLink={showDocsLink} />
      </DialogContent>
    </Dialog>
  )
}

function TutorialPanel({ tutorials, showDocsLink }: { tutorials: readonly Tutorial[]; showDocsLink: boolean }) {
  const [slug, setSlug] = useState(tutorials[0].slug)
  const selected = tutorials.find((t) => t.slug === slug) ?? tutorials[0]

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1 pr-8">
        <DialogTitle>{selected.title}</DialogTitle>
        <DialogDescription>{selected.description}</DialogDescription>
      </div>
      {tutorials.length > 1 && (
        <div role="group" aria-label="Elige un video" className="flex flex-wrap gap-2">
          {tutorials.map((t) => (
            <Button
              key={t.slug}
              type="button"
              size="sm"
              variant={t.slug === selected.slug ? 'secondary' : 'outline'}
              aria-pressed={t.slug === selected.slug}
              onClick={() => setSlug(t.slug)}
            >
              {t.title}
            </Button>
          ))}
        </div>
      )}
      <VideoFacade key={selected.slug} tutorial={selected} />
      {showDocsLink && selected.docs && (
        <Link href={`/dashboard/docs#${selected.docs}`} className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Leer en la documentación →
        </Link>
      )}
    </div>
  )
}
