/** Typed proof that the caller was a live admin a moment ago; writers and the confirmation keys refuse anything else (#144, #155 C4). */

import { DomainError } from '@/lib/domain-error'

declare const adminProofBrand: unique symbol

export interface AdminProof {
  readonly userId: string
  /** Snapshot of profiles.display_name: it signs the trail in internal_note. */
  readonly displayName: string
  readonly issuedAt: number
  readonly [adminProofBrand]: true
}

/** Long enough for one tool call (~13 s), short enough that a demoted admin can't reuse it. */
export const ADMIN_PROOF_TTL_MS = 90_000

export const ADMIN_ONLY_MESSAGE =
  'Solo un administrador puede escribir en Odoo. Si tu rol cambió, vuelve a conectar el conector.'

// Identity, not shape: a copied or hand-built object never passes.
const issued = new WeakSet<object>()

/** Only requireLiveAdmin (src/lib/mcp/core/auth/live-admin.ts) calls this, after reading profiles without cache. */
export function issueAdminProof(input: { userId: string; displayName: string }, now: number = Date.now()): AdminProof {
  const userId = input.userId.trim()
  const displayName = input.displayName.trim()
  if (!userId || !displayName) throw new DomainError(ADMIN_ONLY_MESSAGE, 'forbidden')
  const proof = Object.freeze({ userId, displayName, issuedAt: now }) as AdminProof
  issued.add(proof)
  return proof
}

export function assertAdminProof(proof: AdminProof, now: number = Date.now()): void {
  if (typeof proof !== 'object' || proof === null || !issued.has(proof)) {
    throw new DomainError(ADMIN_ONLY_MESSAGE, 'forbidden')
  }
  const age = now - proof.issuedAt
  if (!(age >= 0 && age <= ADMIN_PROOF_TTL_MS)) {
    throw new DomainError('La verificación de administrador venció: vuelve a intentarlo. No se escribió nada.', 'forbidden')
  }
}
