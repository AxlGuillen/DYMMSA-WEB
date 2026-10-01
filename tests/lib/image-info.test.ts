import { describe, test, expect } from 'vitest'
import { hasMetadata, readImageInfo } from '@/lib/image-info'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]

const png = (w: number, h: number) =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0])

const jpeg = (w: number, h: number) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10], 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 3],
  )

const webpLossy = (w: number, h: number) =>
  bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h))

const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14)
  return bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', [0, 0, 0, 0], [0x2f], [bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff])
}

const webpExtended = (w: number, h: number) =>
  bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], le24(w - 1), le24(h - 1))

describe('readImageInfo', () => {
  test.each([
    ['PNG', png(640, 480), 'image/png', 640, 480],
    ['JPEG', jpeg(1024, 768), 'image/jpeg', 1024, 768],
    ['WebP con pérdida', webpLossy(256, 256), 'image/webp', 256, 256],
    ['WebP sin pérdida', webpLossless(300, 200), 'image/webp', 300, 200],
    ['WebP extendido', webpExtended(512, 400), 'image/webp', 512, 400],
  ])('%s: tipo y medidas salen de los bytes', (_label, file, mime, width, height) => {
    expect(readImageInfo(file)).toMatchObject({ mime, width, height })
  })

  test('un WebP animado no pasa (el recorte del navegador no lo aplanó)', () => {
    const animated = webpExtended(100, 100)
    animated[20] = 0x02
    expect(readImageInfo(animated)).toBeNull()
  })

  test('un SVG (aunque se llame .png) no es imagen aceptada', () => {
    expect(readImageInfo(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull()
  })

  test('un GIF o un PDF renombrados no pasan', () => {
    expect(readImageInfo(bytes('GIF89a', [1, 0, 1, 0]))).toBeNull()
    expect(readImageInfo(bytes('%PDF-1.7'))).toBeNull()
  })

  test('un archivo cortado a la mitad no pasa', () => {
    expect(readImageInfo(png(10, 10).slice(0, 20))).toBeNull()
    expect(readImageInfo(jpeg(10, 10).slice(0, 24))).toBeNull()
    expect(readImageInfo(new Uint8Array())).toBeNull()
  })
})

describe('hasMetadata', () => {
  const exifJpeg = () =>
    bytes([0xff, 0xd8], [0xff, 0xe1, 0x00, 0x08], 'Exif', [0, 0], [0xff, 0xc0, 0x00, 0x11, 0x08, 0, 10, 0, 10, 3])

  test('JPEG con EXIF (APP1) sí; JPEG limpio no', () => {
    expect(readImageInfo(exifJpeg())).toMatchObject({ width: 10, height: 10 })
    expect(hasMetadata(exifJpeg(), 'jpeg')).toBe(true)
    expect(hasMetadata(jpeg(10, 10), 'jpeg')).toBe(false)
  })

  test('PNG con chunk eXIf sí; PNG limpio no', () => {
    const withExif = bytes([...png(10, 10)], [0, 0, 0, 0], be32(4), 'eXIf', [1, 2, 3, 4], [0, 0, 0, 0])
    expect(hasMetadata(withExif, 'png')).toBe(true)
    expect(hasMetadata(png(10, 10), 'png')).toBe(false)
  })

  test('WebP extendido con bandera EXIF o XMP sí; el de canvas no', () => {
    const exif = webpExtended(100, 100)
    exif[20] = 0x08
    const xmp = webpExtended(100, 100)
    xmp[20] = 0x04
    expect(hasMetadata(exif, 'webp')).toBe(true)
    expect(hasMetadata(xmp, 'webp')).toBe(true)
    expect(hasMetadata(webpExtended(100, 100), 'webp')).toBe(false)
    expect(hasMetadata(webpLossy(256, 256), 'webp')).toBe(false)
  })
})
