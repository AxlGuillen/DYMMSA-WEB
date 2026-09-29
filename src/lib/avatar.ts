/** Profile picture rules (#122): shared by the uploader, the API route and the initials fallback. */

export const AVATAR_BUCKET = 'avatars'
export const AVATAR_SIZE_PX = 256
export const AVATAR_MAX_PX = 512
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export function avatarPublicUrl(path: string | null): string | null {
  if (!path) return null
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[1]][0]]
  return letters.join('').toLocaleUpperCase('es-MX')
}

const AVATAR_TONES = [
  'bg-teal-600 text-white',
  'bg-blue-600 text-white',
  'bg-violet-600 text-white',
  'bg-rose-600 text-white',
  'bg-amber-600 text-white',
  'bg-emerald-600 text-white',
  'bg-sky-600 text-white',
  'bg-fuchsia-600 text-white',
] as const

/** Stable per person: the same id always lands on the same color. */
export function avatarTone(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

/** Largest centered square of a width × height image. */
export function centerSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height)
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size }
}
