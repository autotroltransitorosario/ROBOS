# Mapa de Artefactos Robados — Rosario (datos en vivo desde Google Sheets)

PWA que muestra sobre un mapa de OpenStreetMap los reportes de robo de
equipamiento de alumbrado público, leyendo la planilla de Google Sheets
**en vivo** (cada vez que se abre la app, y cada 3 minutos mientras queda
abierta, además de un botón "Actualizar" manual).

## Requisito imprescindible: compartir la hoja

La app lee la planilla desde el navegador de cada usuario, sin login. Para
que funcione, la hoja tiene que estar compartida como:

> **Compartir → "Cualquier persona con el enlace" → Lector**

Si no está así compartida, la app va a mostrar el aviso "No se pudo leer
la planilla…" en la esquina inferior derecha del mapa.

## Columna de coordenadas

La app solo dibuja un pin cuando la fila tiene coordenadas cargadas en la
columna **`COORDENADAS`**, en una sola celda, con el formato:

```
lat, lng
```

Ejemplo: `-32.9468, -60.6393`

Las filas sin esa columna completa (o con un valor que no se pueda leer
como dos números) **no se muestran en el mapa**, pero se cuentan en el
indicador "Sin coordenadas" del encabezado, para que el equipo sepa
cuántas direcciones todavía faltan geo-referenciar.

## Configuración (ID de la hoja)

Al principio de `js/app.js` está el bloque `CONFIG`:

```js
const CONFIG = {
  sheetId: '1_xGUEmaW9OEGxTIeBRVtc8Qdkfh_et6QGL0DfEZzBOk',
  gid: '619088428',
  ...
```

Si en algún momento cambian de planilla o de pestaña, solo hay que
actualizar `sheetId` y `gid` (el `gid` es el número que aparece al final
de la URL cuando tenés la pestaña abierta, después de `#gid=`).

También ahí están mapeados los nombres de columna esperados (case
insensitive): `Nro Solicitud`, `Fecha Hora Registro`, `Calle`, `Altura`,
`Equipamiento Robado`, `Cantidad`, `Numero de Denuncia`, `Ubicacion`,
`Coordenadas`. Si cambia el nombre de alguna columna en la planilla, hay
que actualizar ese mapeo.

## Filtro de fecha por rango (desde–hasta)

La franja de fechas debajo del encabezado es scrolleable horizontalmente.
Funciona por toques:

1. Tocás una fecha → queda fijada como **"desde"**.
2. Tocás otra fecha (posterior) → queda fijada como **"hasta"**. El mapa
   muestra únicamente los puntos entre esas dos fechas (inclusive).
3. Tocás cualquier fecha de nuevo → arranca una selección nueva.
4. Botón **"Ver todo el período"** → saca el filtro.

## Estructura

```
index.html        Shell de la app
css/styles.css     Estilos
js/app.js          Lógica: lectura en vivo de Sheets, mapa, filtro por rango
manifest.json      Manifest de la PWA (icono, nombre, colores)
sw.js              Service worker (cachea solo el shell propio, offline)
icons/             Íconos 192x192 y 512x512
```

## Cómo correrlo / desplegarlo

Basta con servir estos archivos estáticos por HTTP(S) — no hace falta
backend propio, ya que los datos se leen directo desde Google:

```bash
python3 -m http.server 8080
# o: npx serve .
```

Para que sea instalable de verdad (y para que el Service Worker
funcione) hace falta HTTPS, salvo en `localhost`. Opciones simples:
GitHub Pages, Netlify o Vercel.

## Cómo funciona la lectura de la planilla (técnico)

La app usa el endpoint público de "Google Visualization" de la hoja:

```
https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:json&gid=<GID>
```

A diferencia del link de exportación CSV normal, este endpoint sí
responde con los encabezados CORS necesarios para poder leerlo desde
JavaScript en cualquier dominio — por eso se usa este y no `/export?format=csv`.
No requiere API key, pero sí que la hoja esté compartida por enlace
(ver arriba).

## Notas sobre calidad de datos

- Se ignoran filas sin `Calle` o sin `Fecha Hora Registro`.
- Se ignoran fechas con años fuera de 2020–2035 (typos evidentes de la
  planilla, ej. `07/07/2027`).
- `Numero de Denuncia` casi siempre trae "OK"/"ok" en vez de un número
  real; se muestra tal cual viene.
- `Ubicacion` a veces es un link (foto) y a veces texto libre; la app
  muestra un link cliqueable solo cuando es una URL válida.
