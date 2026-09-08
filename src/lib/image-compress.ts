/** Browser-side compression (canvas → WebP). On failure or no gain it returns the original —
 *  it must never break the upload. */

// GIF excluded: canvas would drop the animation.
const COMPRESSIBLE = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function shouldCompress(type: string): boolean {
  return COMPRESSIBLE.has(type)
}

export async function compressImage(
  file: File,
  { maxDim = 1600, quality = 0.8 }: { maxDim?: number; quality?: number } = {},
): Promise<File> {
  if (!shouldCompress(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    )
    // No gain (already small): keep the original.
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
    return new File([blob], name, { type: 'image/webp' })
  } catch {
    return file
  }
}
