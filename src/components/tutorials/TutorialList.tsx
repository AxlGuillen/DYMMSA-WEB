'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Play } from '@/components/icons'
import { TutorialDialog } from './TutorialDialog'
import { coverUrl, isPublished, type Tutorial } from '@/lib/tutorials'

/** The Tutoriales tab: every video in order; a card opens the shared player, its link goes to the docs section. */
export function TutorialList({ tutorials }: { tutorials: readonly Tutorial[] }) {
  return (
    <ol aria-label="Tutoriales" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {tutorials.filter(isPublished).map((tutorial) => (
        <li key={tutorial.slug} className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <TutorialDialog tutorials={[tutorial]}>
            <button
              type="button"
              aria-haspopup="dialog"
              className="group relative aspect-video w-full cursor-pointer overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Image src={coverUrl(tutorial.youtubeId)} alt="" fill unoptimized className="object-cover" />
              <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" aria-hidden="true" />
              <span
                className="absolute top-1/2 left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
                aria-hidden="true"
              >
                <Play className="ml-0.5 size-5" />
              </span>
              <span className="sr-only">Ver {tutorial.title}</span>
            </button>
          </TutorialDialog>
          <div className="flex flex-1 flex-col gap-1.5 p-4">
            <p className="font-medium leading-snug">{tutorial.title}</p>
            {tutorial.duration && <p className="text-xs text-muted-foreground tabular-nums">{tutorial.duration}</p>}
            <p className="text-sm text-muted-foreground">{tutorial.description}</p>
            <Link
              href={`/dashboard/docs#${tutorial.docs}`}
              className="mt-auto pt-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Leer en la documentación →
            </Link>
          </div>
        </li>
      ))}
    </ol>
  )
}
