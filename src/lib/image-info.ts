/** Image type and size read from the file's own bytes — never trust the extension or Content-Type (#122). */

export type ImageKind = 'jpeg' | 'png' | 'webp'

export interface ImageInfo {
  kind: ImageKind
  mime: `image/${ImageKind}`
  width: number
  height: number
}

const ascii = (b: Uint8Array, at: number, text: string) =>
  b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0))

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function readPng(b: Uint8Array): [number, number] | null {
  if (b.length < 24 || !PNG_SIGNATURE.every((v, i) => b[i] === v) || !ascii(b, 12, 'IHDR')) return null
  return [u32be(b, 16), u32be(b, 20)]
}

function readWebp(b: Uint8Array): [number, number] | null {
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff]
  }
  if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
    const width = 1 + (((b[22] & 0x3f) << 8) | b[21])
    const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))
    return [width, height]
  }
  // Animated WebP (ANIM flag) is refused: a direct POST would skip the browser's single-frame re-encode.
  if (ascii(b, 12, 'VP8X') && b.length >= 30 && !(b[20] & 0x02)) return [1 + u24le(b, 24), 1 + u24le(b, 27)]
  return null
}

// SOF markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but are not frames.
const isStartOfFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc

function readJpeg(b: Uint8Array): [number, number] | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null
  let at = 2
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = u16be(b, at + 2)
    if (isStartOfFrame(marker)) {
      if (at + 9 > b.length) return null
      return [u16be(b, at + 7), u16be(b, at + 5)]
    }
    at += 2 + length
  }
  return null
}

const READERS: [ImageKind, (b: Uint8Array) => [number, number] | null][] = [
  ['png', readPng],
  ['jpeg', readJpeg],
  ['webp', readWebp],
]

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  for (const [kind, read] of READERS) {
    const size = read(bytes)
    if (size && size[0] > 0 && size[1] > 0) return { kind, mime: `image/${kind}`, width: size[0], height: size[1] }
  }
  return null
}
