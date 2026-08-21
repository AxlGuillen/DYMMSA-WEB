# Novedades

Registro de mejoras y correcciones del sistema DYMMSA, en orden cronológico
(lo más reciente primero).

## 2026-08-20

### Nuevo
- **El asistente ahora da seguimiento a tareas y registra gavetas.** Vía el
  conector puede **comentar, cambiar prioridad y cerrar/reabrir tareas** (los
  comentarios quedan firmados como "Asistente (MCP)") y **registrar en qué
  gaveta quedó un producto** del inventario — solo la ubicación, nunca las
  cantidades. Además, al conectar ahora recibe un mapa claro de qué
  herramientas son de la app y cuáles del Odoo externo.
- **Planificar corte sin orden.** Nueva entrada **"Planificar corte"** en el menú:
  un modo rápido para calcular un corte al vuelo — capturas las piezas a mano,
  ves el acomodo y el Excel de pedido, sin necesidad de una orden. El borrador
  se queda guardado en tu navegador hasta que lo limpies.
- **Planificar corte desde la cotización.** Si la cotización tiene piezas DYMMSA,
  el botón **"Planificar corte"** abre el modo rápido con esas piezas sugeridas —
  para pensar el material desde antes de que exista la orden.
- **Control de medidas de material.** Nueva página **"Medidas de material"**: las
  barras y hojas que ofrece el proveedor (que se registran solas al usarlas) ahora
  se pueden revisar, dar de alta a mano y borrar si se capturaron mal.

### Mejorado
- **Diagramas de corte más claros.** El paso de la sierra se dibuja con rayado
  (ya no se confunde con una pieza delgada), el sobrante muestra su medida y
  cada grupo trae una leyenda de qué es pieza, corte y sobrante.
- **El asistente ya revisa los complementos de pago (REP).** Al preguntarle por un
  pago (p. ej. "PAY00068") ahora responde si su complemento de pago está **timbrado
  y validado ante el SAT**, y desglosa qué facturas paga, cada una con su saldo y su
  propio CFDI. También puede hacer el **barrido del mes**: qué pagos quedaron en
  regla, cuáles no tienen REP y cuáles lo tienen fallido — el pendiente más fácil de
  olvidar, porque el REP se timbra después del cobro.

## 2026-08-13

### Mejorado
- **Las placas ahora se planifican como hojas de verdad.** En Planificar corte, la
  placa ya no se pide "por largo de tira": capturas la **hoja que vende el proveedor
  (ancho × largo)** y el sistema acomoda las piezas y te dice **cuántas hojas pedir**,
  con el dibujo de cada hoja, su sobrante y el aprovechamiento. Las hojas capturadas
  se recuerdan para la próxima vez.
- **Copiar el pedido URREA directo a su Excel.** En Planificar compra hay un botón
  **"Copiar para Excel"**: copia código y cantidad de forma que al pegar en el Excel
  de URREA caen en dos columnas, listos para su sistema (que no abre bien el archivo
  moderno).
- **Imprimir desde la orden.** El detalle de la orden tiene botón **Imprimir** que
  saca la tabla de productos en limpio.
- **La página de aprobación quedó más ligera.** Se quitó el botón de sonidos (era
  ruido para el cliente) y la animación de entrada es más ágil.

### Nuevo
- **El asistente ahora abre facturas y ventas de Odoo por dentro.** Pídele "el detalle
  de la factura F00167" y te da el desglose completo: productos con cantidades y
  precios, saldo pendiente, y el **timbrado** (folio fiscal y si está vigente ante el
  SAT). Con las ventas ("detalle de la S00247") además te dice por producto cuánto se
  pidió, cuánto se ha entregado y cuánto se ha facturado.

## 2026-08-11

### Nuevo
- **El asistente ahora también consulta la facturación (Odoo).** Puedes preguntarle
  a Claude cosas como "¿quién nos debe y desde cuándo?", "¿cómo cerró julio?" o
  "resumen de facturación por cliente" y responde con los datos reales de Odoo:
  cartera vencida con días de atraso, totales por periodo y desglose por cliente.
  También conoce las ventas y los clientes: "resumen de ventas de julio",
  "el expediente completo de Andritz" (contacto, RFC, cuánto ha comprado, qué
  debe y desde cuándo). También el almacén de Odoo ("¿cuántas puntas de cobre
  hay?"), el directorio del equipo y la flotilla (vehículos, conductor asignado
  y su bitácora de servicios). Es solo lectura — el asistente no puede
  modificar nada en Odoo — y los datos de nómina quedan fuera por diseño.

## 2026-08-09

### Nuevo
- **Vista guiada en Planificar compra.** La pantalla más densa del sistema ya tiene su
  botón **"Vista guiada"**: recorre los cuatro números del resumen, los umbrales que
  mueven la recomendación, cómo leer cada grupo (mayoreo / mixto / menudeo y el dinero
  que queda parado), la compra local y por qué los Excel salen de lo guardado.

## 2026-08-08

### Mejorado
- **Columnas ajustables también en Cotizaciones y Órdenes.** El arrastre del borde
  del encabezado —que ya estaba en Base de datos, Inventario, Catálogo URREA y
  Proveedores— llega a las **cuatro pantallas que faltaban**: la lista de
  cotizaciones, el detalle de una cotización, la lista de órdenes y el detalle de
  una orden. Funciona igual: arrastras para ensanchar, cada tabla recuerda tus
  anchos y doble click en el borde regresa la columna a su tamaño original.
- **Los botones de acción ya no se pierden al ensanchar.** En esas mismas cuatro
  pantallas la última columna queda **fija a la derecha**, así que editar, eliminar
  o insertar separador siguen a la vista aunque muevas la tabla de lado.

## 2026-08-04

### Nuevo
- **Vistas guiadas en el sistema.** Aparece un botón **"Vista guiada"** en tres
  pantallas clave que recorre los bloques y explica qué hace cada uno. Son totalmente
  opcionales — solo arrancan si tocas el botón:
  - **Inicio**: presenta el menú lateral sección por sección (el flujo principal,
    los catálogos, inventario, recursos) y el panel de métricas — ideal para
    alguien que entra al sistema por primera vez.
  - **Planificar corte**: de dónde salen las piezas, qué significa la necesidad por
    diámetro, en qué momento aparece el dibujo del acomodo y qué guarda el sistema.
  - **Página de aprobación** (la que ve el cliente): el resumen, los filtros, cómo
    aprobar producto por producto y la diferencia entre guardar avance y enviar.

## 2026-07-31

### Mejorado
- **El asistente de IA ahora se conecta con tu propia cuenta.** Antes la conexión de
  Claude con el sistema usaba una clave compartida del equipo; ahora cada quien la
  autoriza **iniciando sesión con su usuario de DYMMSA** en una pantalla de
  autorización, igual que cuando conectas una app con tu cuenta de Google. Con esto ya
  se puede usar el asistente también **desde el celular y claude.ai**, el acceso se
  puede **revocar** en cualquier momento, y el asistente ve exactamente lo mismo que tú
  ves en el sistema — ni más ni menos.

### Nuevo
- **Planificar corte: el nuevo módulo para los productos DYMMSA que se mandan a hacer.**
  En las órdenes con piezas DYMMSA (tubos y placas de cobre) aparece el botón
  **"Planificar corte"**. Lo que antes se calculaba a mano ahora lo hace el sistema:
  - **Antes de hablar con el proveedor** te dice cuánto material necesitas por medida
    ("pide 1.28 m de tubo de Ø30"), ya con el **margen de corte** incluido (configurable,
    el clásico 1–2 cm por partición).
  - **Cuando el proveedor te dice qué tiene** ("barras de 6 m"), capturas esa medida y el
    sistema te **dibuja cómo partir cada barra**: las piezas, los cortes y cuánto sobra.
    Puedes mover piezas de una barra a otra si en el taller conviene distinto — si algo
    ya no cabe, te lo marca en rojo con los milímetros exactos.
  - **Con las placas** capturas el ancho de la tira que ofrece el proveedor y te dice
    cuánto largo pedir, con el acomodo dibujado y el **% de aprovechamiento**.
  - Las medidas que captures del proveedor **se recuerdan** y se sugieren la próxima vez.
  - La lista se pre-llena con las piezas DYMMSA de la orden, guarda **lo que pidió el
    cliente originalmente** junto a la medida usada, y todo se puede **imprimir** para
    llevarlo al taller o exportar a **Excel** para pedirle al proveedor.

## 2026-07-29 (II)

### Nuevo
- **Filtrar por marca en Inventario.** Junto al buscador hay un selector de **marca** que te
  dice, en cada opción, **cuántos tienen stock de cuántos** (ej. "URREA (57/171)") para que no
  entres a ciegas. También hay una opción **"Sin marca"** para los productos cuyo ETM no la
  tiene registrada — son ~40 y varios tienen existencias, así que no se esconden. La tabla
  ahora incluye una columna **Marca** (se puede ocultar desde "Columnas").
- **Filtrar por marca en Planificar compra.** Un selector arriba a la derecha te deja revisar
  la compra marca por marca. Es solo para ver: **los Excel y los totales siguen cubriendo la
  orden completa**, para que nunca descargues un pedido a medias.

### Mejorado
- **Inventario abre mostrando solo lo que tienes.** La página arranca en la nueva tarjeta
  **"Con stock"** (de ~271 productos, unos 83 tienen existencias) en vez de listar todo el
  histórico. Para ver los que están en cero, un click en **"Total"** o **"Sin stock"**.

## 2026-07-29

### Nuevo
- **Resumen de dinero en Planificar compra.** Arriba de la página ahora ves cuatro
  números para entender la compra de un vistazo: **cuánto dinero se queda parado**
  (y en cuántos productos), **cuánto te ahorras** al mandar los restos a menudeo,
  **cuántos paquetes** van a URREA y **cuántas piezas** a compra local. Se actualiza
  al instante conforme cambias las decisiones, sin necesidad de guardar.
- **Los dos Excel se descargan desde Planificar compra.** El **Pedido URREA (mayoreo)**
  y la **Compra local (menudeo)** ahora están juntos en la página donde tomas las
  decisiones. Si tenías cambios sin guardar, el botón los **guarda y descarga en un
  solo paso**, para que el archivo siempre coincida con la orden.

### Mejorado
- **Más detalle de precios por producto.** En cada producto ahora se ve el **precio
  unitario** y el **precio del paquete completo**, además del dinero del excedente —
  que se llama **"Queda parado"** (ámbar) si decides redondear, o **"Ahorras"** (verde)
  si mandas el resto a menudeo.
- **Se distingue de un vistazo qué es mayoreo y qué menudeo:** cada producto se tiñe
  con un color suave según la decisión (verde mayoreo, azul mixto, naranja menudeo,
  ámbar los que faltan por decidir).
- **Al cambiar los umbrales te dice qué pasó.** El botón muestra "Recalculando…"
  mientras se rehace el plan y al terminar te avisa **cuántos productos cambiaron de
  recomendación**, en vez de dejarte comparar a mano.
- **La página de Planificar compra ya no arranca en blanco:** mientras carga muestra
  la silueta del contenido en vez de una rueda girando.
- El botón de **Pedido URREA salió del detalle de la orden** (ahí se queda el Formato
  de Entrega, que es el documento del cliente).

## 2026-07-28

### Nuevo
- **Columnas ajustables como en Excel.** En las tablas de Base de datos, Inventario,
  Catálogo URREA y Proveedores puedes **arrastrar el borde de cada encabezado** para
  hacer la columna más ancha o más angosta — útil cuando una descripción no se
  alcanza a leer completa. Cada tabla recuerda tus anchos en tu navegador. Doble
  click en el borde regresa la columna a su ancho original.
- **Marcar "se vende / no se vende" de un solo click.** En Base de datos, la columna
  **Venta** ahora trae los botones ✓ y ✗ directamente en cada fila, igual que cuando
  el cliente aprueba productos. Ya no hay que abrir el producto para cambiarlo, y
  volver a hacer click en el botón activo lo regresa a "sin definir".

### Mejorado
- **Editar y eliminar a un solo click.** En las cuatro tablas los botones salieron del
  menú de tres puntitos: ahora están siempre visibles en la fila. Además el botón de
  editar **por fin se ve como un lápiz** — antes mostraba un engrane y parecía
  "ajustes". La columna de acciones queda **fija a la derecha**, así que sigue a la
  vista aunque muevas la tabla de lado.

## 2026-07-22

### Mejorado
- **El cotizador y las órdenes abren más rápido.** Las librerías que leen y generan
  archivos de Excel (unas pesadas) ya no se descargan al abrir esas pantallas: ahora
  se cargan solo en el momento en que subes o descargas un Excel. La primera carga de
  esas páginas baja alrededor de **130–250 KB**, así que se sienten más ágiles al entrar.

## 2026-07-17

### Nuevo
- **Tema y sonido en la página de aprobación.** El enlace que ve tu cliente ahora tiene
  en el header un botón para **cambiar entre modo claro y oscuro** y otro para **activar
  o silenciar los sonidos** de click (los mismos del sistema; su elección se recuerda en
  su navegador). Si su equipo está configurado para reducir animaciones, los sonidos
  arrancan apagados.

### Mejorado
- **El cotizador ya no se traba con cotizaciones grandes.** Al editar cotizaciones
  de cientos o miles de productos, escribir el nombre, abrir el popup o desplazarte
  por la lista se sentía lento. Ahora responde fluido: la tabla solo dibuja las
  filas que ves en pantalla y dejó de repintarse entera con cada tecleo. En listas
  de **más de 300 productos**, el reordenar por arrastre se cambia por **flechas
  ↑↓** en cada fila (arrastrar se mantiene en listas más chicas) — con un aviso en
  la tabla. Tu borrador también se guarda de forma más eficiente mientras trabajas.

### Corregido
- **Ya puedes agregar a la cotización productos que ya existen en el catálogo.** Antes, al
  capturar un ETM conocido en el popup de "Agregar producto", aparecía "Este ETM ya existe
  en el catálogo" y no te dejaba continuar — justo con los productos que más se agregan.
  Ahora, al escribir un ETM que el sistema ya conoce, el popup **precarga automáticamente
  sus datos** (descripciones, código, marca, precio y si lo vendemos) y tú solo ajustas la
  cantidad o lo que haga falta. También puedes agregar un ETM que **ya está en la misma
  cotización** (útil cuando una cotización junta varios proyectos que repiten productos):
  el popup te lo avisa con una nota, pero ya no te lo impide.

## 2026-07-16 (IV)

### Mejorado
- **Página de aprobación del cliente, renovada.** La pantalla que ve tu cliente para aprobar la
  cotización tiene un nuevo diseño más claro y elegante (se adapta al modo claro u oscuro de su
  dispositivo). Los botones de **Guardar avance** y **Enviar aprobación** ahora viven en una barra
  flotante **siempre visible** al hacer scroll, con un indicador de progreso (cuántos productos van
  aprobados y el total). Al abrir el enlace, un breve intro con el logo da la bienvenida (solo la
  primera vez).

### Nuevo
- **Filtros en la aprobación.** En cotizaciones grandes, el cliente puede **filtrar por marca** y
  **por proyecto** (las secciones de la cotización) para revisar por partes. El botón "Aprobar
  todos" es inteligente: cuando hay un filtro puesto, aprueba **solo lo que está viendo** y te lo
  dice (ej. "Aprobar 8 visibles").

## 2026-07-16 (III)

### Nuevo
- **Módulo de Proveedores.** Registra a tus proveedores de menudeo con su contacto (teléfono,
  WhatsApp, correo, dirección y notas) y las **marcas que maneja cada uno** como etiquetas.
  El WhatsApp es un enlace directo: un click y se abre el chat. Puedes buscar, filtrar por
  marca y elegir columnas como en las demás tablas. Las marcas viven en su propio catálogo
  (llega pre-cargado con las marcas que ya conoce el sistema): créalas al vuelo desde el
  formulario del proveedor o adminístralas con el botón **"Marcas"** — renombrar se refleja
  en todos los proveedores, y una marca asignada no se puede eliminar hasta desasignarla.
  Es la base para que pronto el sistema te sugiera a quién comprarle lo que va por menudeo.

## 2026-07-16 (II)

### Nuevo
- **Elige qué columnas ver en cada tabla.** Todas las tablas principales (cotizaciones,
  órdenes, sus productos, el cotizador, el planificador de compra, los catálogos, el
  inventario y las tareas) tienen ahora un botón **"Columnas"** para ocultar las que no
  necesitas en ese momento — útil en pantallas medianas o cuando solo estás revisando
  precios o cantidades. Tu selección **se recuerda en tu navegador** por tabla, y con
  "Restablecer columnas" vuelves a verlas todas. Las columnas clave (el identificador del
  producto y las acciones) siempre quedan visibles para no perder el hilo.

## 2026-07-16

### Nuevo
- **Recepción con excedente.** Ahora puedes registrar que llegaron **más piezas de las
  pedidas** (por ejemplo, pediste 2 y URREA mandó el paquete de 10): el excedente **entra
  automáticamente al inventario de tienda** y en la fila verás "+8 a tienda". El cobro al
  cliente no cambia — solo paga lo que ordenó; las piezas extra son stock tuyo.
- **Resumen antes de confirmar la recepción.** Al dar "Confirmar Recepción" aparece una
  ventana con lo que capturaste (pedido vs recibido y cuántas piezas entran al inventario),
  con las cantidades inusuales marcadas — para atrapar un dedazo (100 en vez de 10) antes
  de que toque el inventario.

### Corregido
- **El inventario ya no se duplica** al corregir una recepción ni al cancelar una orden que
  ya había recibido mercancía: confirmar dos veces con el mismo número no vuelve a sumar, y
  corregir a la baja resta lo que sobró de más.

## 2026-07-15

### Nuevo
- **Planificar compra: mayoreo vs menudeo.** Dentro de cada orden hay un nuevo botón
  **"Planificar compra"** que te ayuda a decidir qué pedir directo a URREA (por paquetes) y qué
  comprar a menudeo con proveedores locales. El sistema junta los productos repetidos, calcula
  cuántos paquetes completos necesitas según el STD del catálogo y te dice cuánto dinero quedaría
  "parado" en piezas sobrantes si redondeas al paquete. Con eso te **recomienda** por producto:
  mayoreo, mixto (paquetes a URREA + el resto a menudeo) o menudeo — y tú siempre tienes la
  última palabra. Tus decisiones se guardan por orden, y si después cambias cantidades el sistema
  te avisa que quedaron desactualizadas. Los umbrales de la recomendación ($100 de dinero parado,
  80% del paquete) se pueden ajustar ahí mismo.
- **Lista de compra local.** Desde el planificador puedes descargar un Excel con todo lo que va a
  menudeo: los restos que decidiste no redondear más los productos que no están en el catálogo
  URREA — listo para ir con los proveedores.

### Mejorado
- **El pedido URREA ahora sale del planificador.** El Excel de pedido incluye cualquier producto
  del catálogo URREA (también SURTEK, FOY y demás líneas — antes solo marca "URREA") y las
  cantidades van en múltiplos exactos de paquete. Si aún no has planificado la compra, el botón te
  lleva al planificador; si tus decisiones quedaron viejas, te avisa antes de generar.

## 2026-07-14

### Corregido
- **Guardar cotización ahora te dice qué falta.** Antes, si no habías puesto el nombre de la
  cotización o del cliente, el botón simplemente no respondía y no era claro por qué. Ahora el
  botón siempre está activo: al guardar, si falta algún dato te aparece un aviso claro (nombre de
  la cotización, nombre del cliente, o "agrega al menos un producto"), el campo faltante se
  **resalta en rojo** y te lleva directo a él. El resaltado desaparece en cuanto lo llenas.

### Nuevo
- **Sonidos sutiles al hacer click** en botones y enlaces del sistema — un toque de
  respuesta al usarlo. Se pueden **silenciar** con el nuevo botón de audífonos junto a los de
  tema y modo discreto (abajo en el menú lateral); tu elección se recuerda. Si tu equipo está
  configurado para reducir animaciones, arrancan apagados. La página de aprobación que ve tu
  cliente no tiene sonidos.

### Mejorado
- **Nueva pantalla de inicio de sesión**, con una imagen más formal y de empresa: a un costado, la
  marca DYMMSA sobre una fotografía de herramienta profesional (con un acercamiento muy lento que
  le da vida); al otro, el formulario en una tarjeta limpia. En celular se adapta y muestra el
  logo arriba. De paso se corrigieron los acentos del texto ("Correo electrónico", "Contraseña",
  "Iniciar sesión") y el navegador ahora puede autocompletar tu correo y contraseña.

## 2026-07-10

### Nuevo
- Ahora puedes **conectar Claude (el asistente de IA) con el sistema**: pregúntale en lenguaje
  natural cosas como "¿qué cotizaciones esperan aprobación?", "¿tenemos stock del 6954 y en qué
  gaveta está?" o "resume las órdenes pendientes con URREA", y consulta los datos reales de la
  plataforma al momento. Por ahora el asistente **solo puede consultar** (no modifica nada).
  La conexión requiere una clave que administra el equipo.

## 2026-07-09

### Nuevo
- Nuevo módulo **Tareas**: crea tareas con nombre, descripción (puedes **adjuntar imágenes**) y
  **prioridad** (Baja / Media / Alta / Máxima), coméntalas y llévalas de abiertas a cerradas. Las
  cerradas quedan como **histórico**. Si una tarea resultó ser un **falso reporte**, puedes
  **descartarla** (queda marcada como "Descartada", distinta de una completada, y se puede reabrir).
  Todo vive en un tablero compartido sin salir de la app. En
  **Novedades**, cuando una entrada menciona una tarea como `#12`, se vuelve un enlace directo a esa
  tarea.

### Mejorado
- La **fecha en que el cliente aprobó** una cotización ahora se muestra en su detalle **sin importar
  la fase** en la que esté (incluidas las convertidas a orden o reabiertas para retrabajar). Antes
  solo aparecía mientras la cotización estaba en estado "Aprobada" y se perdía al cambiarla de estado.

## 2026-07-08

### Nuevo
- Cada producto ahora puede tener una **Descripción DYMMSA**, además de la que manda el cliente
  en su Excel (que a veces viene pobre o incorrecta). Para productos **URREA**, se toma
  automáticamente la **descripción oficial del catálogo URREA** usando el código del producto —
  así puedes comparar de un vistazo si lo que pide el cliente coincide con lo que vas a cotizar.
  Para productos de otras marcas, tú escribes la descripción (la celda aparece vacía para
  llenarla desde el editor). El cliente también ve ambas descripciones al revisar su cotización
  en el enlace de aprobación.

## 2026-07-07

### Nuevo
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
