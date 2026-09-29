/** /api/profile/avatar (#122): the file is judged by its bytes, uploaded to the caller's folder, and the old one removed. */

import { describe, test, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { readJson } from '../helpers/request'
import { AUTH } from '../helpers/factories'
import * as avatarRoute from '@/app/api/profile/avatar/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const pngBytes = (w: number, h: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0])

interface StorageCalls {
  upload: { path: string; contentType?: string }[]
  remove: string[][]
}

function setup({ avatarPath = null as string | null, uploadError = null as unknown, updateError = null as unknown } = {}) {
  const client = createMockSupabase({
    user: AUTH,
    responses: {
      'profiles.select': { data: { avatar_path: avatarPath }, error: null },
      'profiles.update': { data: null, error: updateError },
    },
  })
  const calls: StorageCalls = { upload: [], remove: [] }
  const storage = {
    from: () => ({
      upload: async (path: string, _body: unknown, opts: { contentType?: string }) => {
        calls.upload.push({ path, contentType: opts.contentType })
        return { error: uploadError }
      },
      remove: async (paths: string[]) => {
        calls.remove.push(paths)
        return { error: null }
      },
    }),
  }
  activeClient = Object.assign(client, { storage })
  return calls
}

function upload(file?: File) {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return avatarRoute.POST(new NextRequest('http://localhost/api/profile/avatar', { method: 'POST', body: fd }))
}

const file = (bytes: BlobPart, name: string, type: string) => new File([bytes], name, { type })

describe('POST /api/profile/avatar', () => {
  test('sube a la carpeta propia con el tipo real, guarda la ruta y borra la anterior', async () => {
    const calls = setup({ avatarPath: `${AUTH.id}/old.webp` })
    const res = await upload(file(pngBytes(256, 256), 'foto.webp', 'image/webp'))
    expect(res.status).toBe(201)

    expect(calls.upload).toHaveLength(1)
    expect(calls.upload[0].path).toMatch(new RegExp(`^${AUTH.id}/[0-9a-f-]{36}\\.png$`))
    expect(calls.upload[0].contentType).toBe('image/png')
    expect(activeClient.updatePayload('profiles')).toEqual({ avatar_path: calls.upload[0].path })
    expect(calls.remove).toEqual([[`${AUTH.id}/old.webp`]])
    expect((await readJson<{ avatar_url: string }>(res)).avatar_url).toContain(calls.upload[0].path)
  })

  test('un SVG disfrazado de PNG → 400 sin subir nada', async () => {
    const calls = setup()
    const res = await upload(file('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'foto.png', 'image/png'))
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toBe('El archivo debe ser JPG, PNG o WebP')
    expect(calls.upload).toHaveLength(0)
  })

  test('un PDF con la extensión cambiada → 400', async () => {
    const calls = setup()
    expect((await upload(file('%PDF-1.7 ...', 'foto.jpg', 'image/jpeg'))).status).toBe(400)
    expect(calls.upload).toHaveLength(0)
  })

  test('más de 2 MB → 400', async () => {
    const calls = setup()
    const big = new Uint8Array(2 * 1024 * 1024 + 1)
    big.set(pngBytes(256, 256))
    const res = await upload(file(big, 'foto.png', 'image/png'))
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toBe('La imagen pesa más de 2 MB')
    expect(calls.upload).toHaveLength(0)
  })

  test('más de 512 × 512 → 400', async () => {
    const calls = setup()
    expect((await upload(file(pngBytes(1024, 300), 'foto.png', 'image/png'))).status).toBe(400)
    expect(calls.upload).toHaveLength(0)
  })

  test('sin archivo → 400; sin sesión → 401', async () => {
    setup()
    expect((await upload()).status).toBe(400)
    activeClient = createMockSupabase({ user: null })
    expect((await upload(file(pngBytes(10, 10), 'a.png', 'image/png'))).status).toBe(401)
  })

  test('si falla guardar la ruta, borra la foto recién subida y conserva la anterior', async () => {
    const calls = setup({ avatarPath: `${AUTH.id}/old.webp`, updateError: { code: '23514' } })
    const res = await upload(file(pngBytes(256, 256), 'foto.png', 'image/png'))
    expect(res.status).toBe(500)
    expect(calls.remove).toEqual([[calls.upload[0].path]])
  })

  test('si falla la subida no toca el perfil', async () => {
    setup({ uploadError: { message: 'Bucket lleno' } })
    expect((await upload(file(pngBytes(256, 256), 'foto.png', 'image/png'))).status).toBe(500)
    expect(activeClient.didCall('profiles', 'update')).toBe(false)
  })
})

describe('DELETE /api/profile/avatar', () => {
  test('vuelve a las iniciales y borra el archivo', async () => {
    const calls = setup({ avatarPath: `${AUTH.id}/old.webp` })
    const res = await avatarRoute.DELETE()
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('profiles')).toEqual({ avatar_path: null })
    expect(calls.remove).toEqual([[`${AUTH.id}/old.webp`]])
  })

  test('sin foto no hace nada', async () => {
    const calls = setup()
    expect((await avatarRoute.DELETE()).status).toBe(200)
    expect(activeClient.didCall('profiles', 'update')).toBe(false)
    expect(calls.remove).toHaveLength(0)
  })
})
