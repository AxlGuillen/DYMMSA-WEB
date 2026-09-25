import { CalendarClock } from '@/components/icons'
import { DocSection, List, Note, Sub } from './shared'

export function HoursSection() {
  return (
    <DocSection id="horas" icon={CalendarClock} title="Horas y Equipo" description="Las checadas del reloj (NGTeco) por persona, con graficas contra la jornada, y la administracion de roles del equipo.">
      <Sub>Mi semana</Sub>
      <List>
        <li>Cada quien ve sus propias checadas por dia (entrada, salida, notas) y el total de la semana. Un <strong>administrador</strong> ve a todos.</li>
        <li>Dos graficas: las horas por dia de la semana y la tendencia de las ultimas 8 semanas, con las lineas de referencia de <strong>medio tiempo</strong> (4 h / 20 h) y <strong>tiempo completo</strong> (8 h / 40 h) y el aviso de cumplimiento o de cuantas horas faltan.</li>
        <li>Una checada <strong>sin salida</strong> (se olvido checar) se pinta aparte: no suma horas y no es un dia corto.</li>
      </List>
      <Sub>Importar reporte (administradores)</Sub>
      <List>
        <li>Se sube el Excel semanal del checador. Cada persona se reconoce por su <strong>numero de empleado</strong> del reloj (el que esta entre parentesis en el reporte), configurado en Equipo.</li>
        <li>Volver a cargar el mismo periodo no duplica: actualiza. Las checadas que un administrador <strong>corrigio a mano</strong> se respetan y se reportan como saltadas.</li>
      </List>
      <Sub>Equipo (administradores)</Sub>
      <List>
        <li>Rol de cada persona: <strong>administrador</strong> o <strong>miembro</strong>. Un miembro solo ve lo suyo en Horas.</li>
        <li>Numero de checador y <strong>jornada</strong> (tiempo completo, medio tiempo o ninguna), que es la referencia de las graficas.</li>
        <li>Correcciones a una checada: se guarda el rastro (quien, cuando, valor original); la hora que dijo el reloj nunca se pierde.</li>
      </List>
      <Note>
        Dar de baja a alguien es <strong>desactivar</strong>, no borrar: sus checadas se conservan.
      </Note>
    </DocSection>
  )
}
