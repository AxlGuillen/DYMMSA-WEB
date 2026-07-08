# Novedades

Registro de mejoras y correcciones del sistema DYMMSA, en orden cronológico
(lo más reciente primero).

## 2026-07-07

### Nuevo
- Cuando un cliente **aprueba una cotización**, ahora le llega un **correo de aviso** al equipo de
  DYMMSA para continuar el proceso sin tener que estar revisando el sistema. El correo incluye el
  cliente, el total aprobado y un botón directo a la cotización. (Solo se envía al aprobar; no cuando
  el cliente guarda su avance ni si rechaza todo.)
- En la **aprobación de cotizaciones** grandes, el cliente ahora puede **guardar su avance** sin
  enviar todavía: aprueba lo que alcanzó a revisar, guarda, y más tarde continúa desde el mismo
  enlace justo donde se quedó (le aparece un aviso con cuánto lleva aprobado). Al enviar la
  aprobación definitiva se le pide una **confirmación** para evitar envíos por error.
- En el **detalle de la cotización** ahora se muestra la **fecha y hora en que fue aprobada**.
- El **inventario** ahora tiene un campo de **Ubicación (gaveta)**: un texto libre para anotar dónde
  se guarda físicamente cada producto en la tienda, y así encontrarlo o verificar su existencia más
  rápido. Solo se muestra cuando hay stock del producto. También puedes cargarlo por Excel agregando
  una columna **`ubicacion`** (opcional). En las **órdenes** aparece una columna con la ubicación de
  los productos que se toman del inventario, para facilitar su recolección.
  La ubicación se conserva aunque el stock llegue a 0 (por ejemplo, al cancelar una orden que
  restablece el stock), así no tienes que volver a capturarla.

## 2026-07-06

### Mejorado
- Los **iconos** de toda la aplicación ahora son animados: reaccionan con un pequeño movimiento
  al pasar el cursor, para una interfaz más viva. Respetan la preferencia de "reducir movimiento"
  del sistema para quien la tenga activada.

### Nuevo
- Ahora puedes marcar un producto como **"No lo vendemos"**. Al editar un producto —tanto en el
  cotizador como en el módulo **Catálogo ETM**— hay un selector **¿Lo vendemos?** (Sin definir /
  Sí / No) y una columna **Venta** que muestra su estado. Los productos marcados como "No lo vendemos" se pintan de un color
  distinto para que los saltes de un vistazo, no piden precio ni cantidad, no suman al total,
  no se incluyen en el pedido a URREA, y al cliente le aparecen como **"No disponible"** en la
  página de aprobación. Además, la marca **se recuerda**: la próxima vez que ese producto
  aparezca en otra cotización, ya llega marcado — no tienes que volver a revisarlo.

## 2026-06-16

### Nuevo
- Nuevo módulo **URREA → Catálogo**: registra el catálogo de URREA con su código,
  descripción, STD (unidades por paquete, p. ej. paquetes de 6) y precio de catálogo.
  Puedes buscar, ordenar (por descripción, precio o unidades), agregar/editar/eliminar
  productos e importar el catálogo desde Excel (columnas: codigo, descripcion, std, precio),
  ya sea actualizando/agregando o reemplazando todo el catálogo.
- El menú lateral ahora se puede **colapsar** a solo iconos con un botón, para ganar
  espacio de trabajo. Al pasar el cursor sobre cada icono aparece su nombre, y el menú
  recuerda si lo dejaste colapsado. Además se reorganizó en secciones más claras
  (Inventario quedó bajo "DYMMSA", y "Novedades" y "Documentación" bajo "Recursos").
- Nueva página de **Novedades** (esta misma): un historial de mejoras y correcciones
  del sistema, accesible desde el menú lateral.
- Ahora puedes cambiar el estado de una cotización en cualquier momento desde su
  detalle (por ejemplo, regresar una de "En aprobación" a "Borrador" para volver a
  trabajarla) sin tener que crearla de nuevo. Las decisiones que el cliente ya marcó
  por producto se conservan. El cambio de estado se habilita solo cuando no hay cambios
  sin guardar. Para reabrir una cotización que ya se convirtió en orden, primero elimina
  su orden vinculada — el sistema te lo indica con un aviso en la cotización y un mensaje
  al pasar el cursor sobre el control de estado.
- Al reabrir una cotización para retrabajarla, el link de aprobación anterior deja de
  funcionar automáticamente (por seguridad, para que nadie apruebe con un link viejo).
  Las aprobaciones que el cliente ya hizo se conservan: si agregas productos nuevos y
  vuelves a enviar, el cliente solo tiene que aprobar los nuevos, no todo otra vez.

## 2026-06-09

### Corregido
- Las cotizaciones y órdenes muy grandes (más de 1000 productos) se cargaban
  incompletas y al volver a guardarlas se podían perder productos. Ahora se cargan
  y guardan completas.

### Mejorado
- Al guardar una cotización o convertirla en orden, si un producto tiene un dato
  inválido (cantidad en 0, precio negativo o le falta el ETM) ahora te decimos
  exactamente cuál es el producto y lo resaltamos en rojo, en lugar de un mensaje
  de error genérico.
- El editor de cotizaciones grandes (cientos de productos) responde mucho más
  rápido al editar, escribir o borrar filas.
- Si tu sesión expira mientras guardas, ahora te avisamos con claridad y te
  llevamos a iniciar sesión, en vez de mostrar un error confuso.
- El saludo de la pantalla de inicio ahora usa tu nombre en lugar de tu correo.

## 2026-05-24

### Corregido
- No se podían convertir en orden las cotizaciones que tenían encabezados o
  separadores entre secciones. Ahora funcionan correctamente.

## 2026-05-16

### Nuevo
- Filtro "Todo" en el panel de inicio para ver las métricas de todo el histórico,
  sin estar limitado a las últimas semanas.

## 2026-05-07

### Nuevo
- Modo Discreto: oculta los montos de dinero en pantalla con un solo clic, para
  poder mostrar la app a personas externas sin revelar precios. Se activa y
  desactiva como en las apps de banco.
