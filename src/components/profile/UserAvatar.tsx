import { avatarTone, initials } from '@/lib/avatar'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-24 text-3xl',
} as const

interface UserAvatarProps {
  id: string
  name: string
  url?: string | null
  size?: keyof typeof SIZES
  /** Next to the visible name it is decorative; alone it carries the name. */
  labelled?: boolean
  className?: string
}

export function UserAvatar({ id, name, url, size = 'md', labelled = false, className }: UserAvatarProps) {
  const base = cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold', SIZES[size], className)
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- already a 256 px WebP from the bucket
    return <img src={url} alt={labelled ? name : ''} className={cn(base, 'object-cover')} />
  }
  return (
    <span className={cn(base, avatarTone(id))} {...(labelled ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}>
      {initials(name)}
    </span>
  )
}
