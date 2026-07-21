/**
 * Global setup del E2E: deja la BD local en estado conocido antes de correr.
 * Reusa resetDb() del harness de integración (trunca lo transaccional y reaplica
 * los fixtures). El usuario de prueba de auth persiste del `supabase start`.
 */
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
