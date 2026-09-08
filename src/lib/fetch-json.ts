/** Shared fetch for hooks: normalizes errors into ApiError (with offendingEtm when the backend reports one). */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: 'AUTH_EXPIRED' | 'NETWORK' | 'VALIDATION' | 'SERVER',
    public readonly offendingEtm?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 401 → AUTH_EXPIRED, TypeError → NETWORK, 4xx/5xx → ApiError built from the body payload. */
export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    // TypeError (network down, CORS, DNS) or AbortError.
    throw new ApiError(
      'No se pudo conectar al servidor. Revisa tu conexión e intenta de nuevo.',
      'NETWORK',
    )
  }
  if (response.status === 401) {
    throw new ApiError('Tu sesión expiró. Inicia sesión de nuevo.', 'AUTH_EXPIRED', undefined, 401)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const code = response.status >= 400 && response.status < 500 ? 'VALIDATION' : 'SERVER'
    throw new ApiError(
      body?.message ?? `Error ${response.status}`,
      code,
      typeof body?.offendingEtm === 'string' ? body.offendingEtm : undefined,
      response.status,
    )
  }
  return response.json() as Promise<T>
}
