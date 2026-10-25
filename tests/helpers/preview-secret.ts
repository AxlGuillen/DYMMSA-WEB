/** The secret the confirmation keys are signed with in tests (#155 C4): a throwaway, never a real MCP_PREVIEW_SECRET. */

import { afterEach, beforeEach, vi } from 'vitest'

export const TEST_PREVIEW_SECRET = 'test-preview-secret-0123456789-abcdefghijklmnop'

/** Registers the hooks that set the secret before each test and clear it after. */
export function withPreviewSecret(secret: string = TEST_PREVIEW_SECRET): void {
  beforeEach(() => {
    vi.stubEnv('MCP_PREVIEW_SECRET', secret)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })
}
