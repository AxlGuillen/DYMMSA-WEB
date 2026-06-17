# Novedades

Registro de mejoras y correcciones del sistema DYMMSA, en orden cronológico
(lo más reciente primero).

## 2026-06-16

### Nuevo
- Ahora puedes cambiar el estado de una cotización en cualquier momento desde su
  detalle (por ejemplo, regresar una de "En aprobación" a "Borrador" para volver a
  trabajarla) sin tener que crearla de nuevo. Las decisiones que el cliente ya marcó
  por producto se conservan. El cambio de estado se habilita solo cuando no hay cambios
  sin guardar. Para reabrir una cotización que ya se convirtió en orden, primero elimina
  su orden vinculada — el sistema te lo indica con un aviso en la cotización y un mensaje
  al pasar el cursor sobre el control de estado.

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
