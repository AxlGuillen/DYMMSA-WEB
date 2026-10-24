/** Base of the store errors (#157): routes answer `error.status` with `error.body`; an MCP tool turns it into a ToolError. */

export type DomainErrorKind = 'invalid' | 'not_found' | 'conflict' | 'failed'

const STATUS_BY_KIND: Record<DomainErrorKind, number> = { invalid: 400, not_found: 404, conflict: 409, failed: 500 }

/** A rule the user broke (400/404), a concurrent change (409) or a write that failed (500). */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly kind: DomainErrorKind = 'invalid',
  ) {
    super(message)
    this.name = 'DomainError'
  }

  get status(): number {
    return STATUS_BY_KIND[this.kind]
  }

  get body(): { message: string } {
    return { message: this.message }
  }
}
