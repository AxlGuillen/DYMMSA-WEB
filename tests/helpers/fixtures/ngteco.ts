/**
 * Shape of the real NGTeco weekly export (#93): one block per employee, a
 * continuation row for a second punch on the same day, blank days, and an
 * open punch. Shared by the lib, API and integration tests.
 */

export const NGTECO_PERIOD = { start: '2026-08-31', end: '2026-09-06' }

const HEADER = ['Fecha', '', 'ENTRADA', 'SALIDA', 'Tiempo de trabajo', 'Total diario', 'Nota', '']

export const NGTECO_WEEK: string[][] = [
  ['Informe de tarjetas horarias', '', '', '', '', '', '', ''],
  [],
  ['Período de pago', '', '', '2026-08-31-2026-09-06', '', '', '', ''],
  ['Empleado', '', '', 'Diego Baltazar\n(1)', '', '', '', ''],
  HEADER,
  ['LU', '2026-08-31', '10:06', '18:27', '08:21', '08:21', '', ''],
  ['M', '2026-09-01', '08:55', '19:20', '10:24', '', '', ''],
  ['', '', '19:21', '19:21', '00:00', '10:25', '', ''],
  ['X', '2026-09-02', '', '', '', '', '', ''],
  ['J', '2026-09-03', '09:02', '', '', '', 'olvidó checar salida', ''],
  ['V', '2026-09-04', '', '', '', '', '', ''],
  ['S', '2026-09-05', '', '', '', '', '', ''],
  ['D', '2026-09-06', '', '', '', '', '', ''],
  ['Horas totales', '', '', '', '', '18:46', '', ''],
  [],
  ['Período de pago', '', '', '2026-08-31-2026-09-06', '', '', '', ''],
  ['Empleado', '', '', 'Tania\n(5)', '', '', '', ''],
  HEADER,
  ['LU', '2026-08-31', '10:06', '18:11', '08:04', '08:04', '', ''],
  ['M', '2026-09-01', '10:05', '18:47', '08:42', '08:42', '', ''],
  ['X', '2026-09-02', '', '', '', '', '', ''],
  ['J', '2026-09-03', '', '', '', '', '', ''],
  ['V', '2026-09-04', '', '', '', '', '', ''],
  ['S', '2026-09-05', '', '', '', '', '', ''],
  ['D', '2026-09-06', '', '', '', '', '', ''],
  ['Horas totales', '', '', '', '', '16:46', '', ''],
]

/** Same first block with the cells typed as Excel numbers (serial date, day fractions). */
export const NGTECO_NUMERIC: unknown[][] = [
  ['Período de pago', '', '', '2026-08-31-2026-09-06', '', '', '', ''],
  ['Empleado', '', '', 'Diego Baltazar (1)', '', '', '', ''],
  HEADER,
  // 46265 = 2026-08-31 · 606/1440 = 10:06 · 1107/1440 = 18:27
  ['LU', 46265, 606 / 1440, 1107 / 1440, '', '', '', ''],
  ['Horas totales', '', '', '', '', '08:21', '', ''],
]

/** Clock ids known to the fixture, for mapping in API/integration tests. */
export const NGTECO_CLOCK_IDS = { diego: 1, tania: 5 } as const
