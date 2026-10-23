/** Expected tool error: its message reaches the client verbatim; anything else is logged and genericized. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}
