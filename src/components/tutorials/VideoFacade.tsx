'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Play } from '@/components/icons'
import { coverUrl, embedUrl, type Tutorial } from '@/lib/tutorials'

/**
 * Cover first; the youtube-nocookie iframe mounts only on click, and unmounting it stops the video
 * (pattern from Minuto Dulce, ADR-038).
 */
export function VideoFacade({ tutorial }: { tutorial: Tutorial }) {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
      {playing ? (
        <iframe
          src={embedUrl(tutorial.youtubeId)}
          title={`Tutorial: ${tutorial.title}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Reproducir: ${tutorial.title}`}
          className="group absolute inset-0 size-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* hqdefault is 4:3 with black bars: object-cover in a 16:9 box crops them. */}
          <Image src={coverUrl(tutorial.youtubeId)} alt="" fill unoptimized sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
          <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" aria-hidden="true" />
          <span
            className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            aria-hidden="true"
          >
            <Play className="ml-1 size-7" />
          </span>
        </button>
      )}
    </div>
  )
}
