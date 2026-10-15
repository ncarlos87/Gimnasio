# Gimnasio

App web personal para seguir mi rutina del gimnasio desde el celular: qué series hice y cuáles faltan, cuánto peso uso en cada vuelta y cómo va subiendo semana a semana.

- Sin cuentas ni servidor: los datos quedan en el propio celular (IndexedDB).
- Instalable en la pantalla de inicio y funciona sin conexión.
- Sitio 100% estático, sin paso de compilación: se publica tal cual en GitHub Pages.

## Publicar en GitHub Pages

1. Creá un repositorio nuevo en GitHub y subí todo el contenido de esta carpeta a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. El workflow `.github/workflows/deploy.yml` publica el sitio en cada push a `main` (también se puede lanzar a mano desde la pestaña **Actions**).
4. Abrí la URL que te muestra Pages (`https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`) en el celular.
5. Agregala a la pantalla de inicio:
   - **Android (Chrome):** menú ⋮ → *Instalar app* o *Agregar a la pantalla principal*.
   - **iPhone (Safari):** botón Compartir → *Agregar a pantalla de inicio*.

Todas las rutas son relativas, así que funciona bajo cualquier ruta base sin configurar nada.

## Cómo se usa

- **Inicio:** el disco grande empieza (o retoma) la sesión de hoy y te muestra los pesos de la última vez.
- **Sesión:** cada bloque tiene sus vueltas. Marcá cada serie con el disco, ajustá el peso con − y + (o escribilo) y, en los ejercicios por tiempo, usá el botón *Reloj*. Tocá el nombre de un ejercicio para ver su ficha.
- **Historial:** gráfico del peso más alto de cada sesión por ejercicio.
- **Rutina:** editá bloques, vueltas y ejercicios. Ahí cargás los tips y las imágenes o GIFs.
- **Ajustes:** paso del peso, exportar e importar respaldo, y restaurar la rutina de ejemplo.

## Imágenes y GIFs

En el editor de cada ejercicio podés pegar un enlace (a una imagen, GIF o video) o subir un archivo desde el celular. Lo subido se guarda en el dispositivo y funciona sin conexión. No hay imágenes incluidas: usá material propio o con licencia que lo permita.

## Respaldo

Los datos viven solo en este navegador. Si se borran los datos del sitio o se cambia de celular, se pierden. Por eso hay **Exportar respaldo** (archivo JSON) e **Importar respaldo** en Ajustes, y la app avisa si pasaron más de 30 días sin exportar.

## Probar en la compu

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

(Hace falta servirlo por HTTP; abrir `index.html` con doble clic no funciona porque usa módulos ES.)

## Estructura

```
index.html            página única
manifest.webmanifest  datos para instalarla
sw.js                 service worker (modo offline)
css/styles.css        estilos
js/app.js             vistas y acciones
js/db.js              IndexedDB y almacenamiento persistente
js/seed.js            modelo de ejercicio/bloque y rutina de ejemplo
js/timer.js           reloj con cuenta regresiva
js/chart.js           gráfico SVG
js/ui.js, js/util.js  hoja inferior, avisos y utilidades
icons/                íconos de la app
```

Si cambiás archivos, subí también el número de `VERSION` en `sw.js` para que los celulares descarguen la versión nueva.
