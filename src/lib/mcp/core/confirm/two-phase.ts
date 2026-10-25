/** The phases of a `confirm: 'two_phase'` tool (#155 C4, ADR-041 §5): the core decides, the tool only plans and commits. */

import type { McpContext } from '../context'
import type { TwoPhaseSpec } from '../define'
import { ToolError } from '../errors'
import { writeResult } from '../envelope'
import { hashOf } from './canonical'
import {
  changedSinceSummaryMessage,
  CONFIRM_UNAVAILABLE_MESSAGE,
  issuePreviewKey,
  previewSecret,
  verifyPreviewKey,
} from './preview-key'

/** The one line both connectors' instructions carry about the two phases (#155 C4); tests keep it identical. */
export const CONFIRMATION_RULE =
  'Escritura en dos fases (la que devuelve `clave`): la primera llamada NO escribe y trae el resumen; muéstralo, espera el sí del usuario y solo entonces repite con la misma entrada y la clave. Nunca encadenes las dos fases sin su respuesta.'

/** Phase 1's note: the same sentence for every tool, so the model learns one flow. */
export const PHASE_ONE_NOTE =
  'Nada se ha escrito. Muestra el resumen al usuario y, solo con su sí, repite la llamada con los mismos datos y esta clave.'
const BLOCKED_NOTE = 'Hay bloqueos: no se puede guardar así. Corrígelos y vuelve a pedir el resumen.'

/** `clave` is the only field the core adds to a two-phase tool's input. */
export type TwoPhaseInput = Record<string, unknown> & { clave?: string }

export async function runTwoPhase(tool: string, spec: TwoPhaseSpec, raw: TwoPhaseInput, ctx: McpContext): Promise<unknown> {
  // Fail closed before reading anything: without the secret no phase can be honest (MCP_PREVIEW_SECRET).
  // A tool that may answer some calls directly (low risk) plans first and only needs the secret for the rest.
  const confirmable = previewSecret() !== null
  if (!confirmable && !spec.direct) throw new ToolError(CONFIRM_UNAVAILABLE_MESSAGE)
  const { clave, ...args } = raw
  const key = typeof clave === 'string' ? clave.trim() : ''
  const scope = { userId: ctx.userId, tool, args }

  // Signature, user, tool, arguments and expiry are checked before the plan reads a single row.
  const signed = key ? verifyPreviewKey(key, scope) : null
  const plan = await spec.plan(args, ctx)

  // Nothing to write in either phase (also when the world caught up after the summary): no fingerprint to compare.
  if (plan.sinCambios) return writeResult('sin_cambios', plan.entity.key, plan.entity.value, { avisos: plan.avisos, nota: plan.nota })

  if (!signed) {
    const blocked = (plan.bloqueos?.length ?? 0) > 0
    // Low risk (the tool says so per call): it writes now, with no key. Blocks are always shown first.
    if (plan.directo && !blocked) return spec.commit(args, ctx, plan)
    if (!blocked && !confirmable) throw new ToolError(CONFIRM_UNAVAILABLE_MESSAGE)
    const issued = blocked ? null : issuePreviewKey({ ...scope, fingerprint: plan.fingerprint })
    return writeResult('simulado', plan.entity.key, plan.entity.value, {
      cambios: plan.cambios,
      avisos: plan.avisos,
      bloqueos: plan.bloqueos,
      clave: issued?.clave,
      vence: issued?.vence,
      nota: blocked ? BLOCKED_NOTE : (plan.nota ?? PHASE_ONE_NOTE),
    })
  }

  if (signed.fingerprint !== hashOf(plan.fingerprint)) throw new ToolError(changedSinceSummaryMessage(plan.subject))
  if (plan.bloqueos?.length) throw new ToolError(`${plan.bloqueos.join(' ')} No escribí nada.`)
  return spec.commit(args, ctx, plan)
}
