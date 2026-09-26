import type { OverviewStep } from '@/lib/tours'

/** Hours overview (#120); the employee selector is admin-only and skips itself for a member. */
export const HOURS_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="hrs-week-nav"]',
    title: 'Una semana a la vez',
    description:
      'Las flechas cambian de semana (lunes a domingo, igual que el periodo del checador) y <b>Esta semana</b> te regresa a la actual. Aquí también eliges el formato de las fechas.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="hrs-employee"]',
    title: 'Elegir a quién ver',
    description:
      'Como administrador puedes ver la semana de cualquier persona del equipo; las gráficas y la rejilla siguen a quien elijas. Cada quien, por su cuenta, ve solo lo suyo.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="hrs-week-chart"]',
    title: 'Horas del día contra la jornada',
    description:
      'Una barra por día. Las dos líneas son las referencias de <b>medio tiempo (4 h)</b> y <b>tiempo completo (8 h)</b>; la de la jornada de la persona va resaltada. Arriba, el total de la semana contra su objetivo (20 h o 40 h) y si cumple o cuánto le falta. Un día con checada <b>sin salida</b> se pinta aparte: no suma horas y no es un día corto.',
  },
  {
    selector: '[data-tour="hrs-trend"]',
    title: 'Las últimas 8 semanas',
    description:
      'El total de cada semana contra las referencias semanales, con la semana visible resaltada. Aquí se nota si alguien viene cumpliendo o no, más que en un día suelto.',
  },
  {
    selector: '[data-tour="hrs-grid"]',
    title: 'Las checadas tal cual',
    description:
      'Día por día, cada pareja de entrada y salida como la registró el checador, con el total diario. Los administradores pueden corregir una checada o agregar una manual; la corrección queda con rastro (quién y cuándo) y sobrevive a la siguiente importación del reporte.',
    side: 'top',
  },
]
