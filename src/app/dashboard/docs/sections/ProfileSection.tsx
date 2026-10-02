import { Users } from '@/components/icons'
import { DocSection, List, Sub } from './shared'

export function ProfileSection() {
  return (
    <DocSection id="perfil" icon={Users} title="Mi perfil" description="Tu nombre, tu foto y tu Numero de Seguridad Social. Se entra dando clic a tu nombre en el pie del menu lateral.">
      <Sub>Lo que editas tu</Sub>
      <List>
        <li><strong>Nombre</strong>: es como te ve el equipo en Horas, Equipo y el menu.</li>
        <li><strong>Foto</strong>: JPG, PNG o WebP. Se recorta sola en cuadro al centro y se reduce antes de subir; al hacerlo se borra la ubicacion que traen las fotos del celular. Sin foto se muestran tus iniciales.</li>
        <li><strong>NSS</strong>: 11 digitos. Se revisa el digito verificador, asi que un digito de mas, de menos o dos cifras invertidas se detectan antes de guardar. Se muestra oculto hasta que tocas el ojo y el modo discreto lo mantiene tapado.</li>
      </List>
      <Sub>Lo que administra el equipo</Sub>
      <List>
        <li>Correo, rol, jornada e id del checador se ven de solo lectura. Los cambia un administrador desde <strong>Equipo</strong>, donde tambien puede capturar o corregir el NSS de cada persona.</li>
        <li>Tu NSS solo lo ven tu y los administradores. El asistente tambien puede consultarlo si se lo pides.</li>
      </List>
    </DocSection>
  )
}
