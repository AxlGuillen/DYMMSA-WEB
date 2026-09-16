/** E2E global setup: resets the local DB to a known state via the integration harness. */
import { resetDb, closePool } from '../integration/helpers/db'

export default async function globalSetup() {
  try {
    await resetDb()
  } catch (err) {
    throw new Error(
      `No se pudo preparar la BD local. ¿Está corriendo \`bunx supabase start\`?\n${(err as Error).message}`,
    )
  } finally {
    await closePool()
  }
}
