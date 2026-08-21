import type { OverviewStep } from '@/lib/tours'

/** Overview del módulo de tareas (issue #74): GitHub Issues como backend. */
export const TASKS_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="tk-filters"]',
    title: 'Abiertas, cerradas y prioridad',
    description:
      'Las pestañas separan lo pendiente del histórico; los chips filtran por prioridad. Una tarea cerrada dice si se <b>completó</b> o se <b>descartó</b>.',
  },
  {
    selector: '[data-tour="tk-table"]',
    title: 'Las tareas del equipo',
    description:
      'Cada fila abre el detalle con su descripción, quién la reportó y los comentarios. Viven sincronizadas con GitHub — lo que se registre aquí lo ve también el desarrollador, y viceversa (el asistente puede crearlas y comentarlas).',
  },
  {
    selector: '[data-tour="tk-new"]',
    title: 'Reportar algo',
    description:
      '¿Un bug, una idea, algo que ajustar? Regístralo aquí con su prioridad; puedes adjuntar imágenes en la descripción.',
    side: 'bottom',
  },
]
