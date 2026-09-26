# Mapa de Artefactos Robados — Rosario

PWA que muestra sobre un mapa de OpenStreetMap los reportes de robo de
equipamiento de alumbrado público, con pines rojos, popup de detalle al
hacer click, y un filtro de fecha horizontal y scrolleable ("desde tal
fecha en adelante").

## Estructura

```
index.html        Shell de la app
css/styles.css     Estilos
js/app.js          Lógica: carga de datos, geocodificación, mapa, filtro
data.json          Datos limpios (derivados de la planilla de Google Sheets)
manifest.json      Manifest de la PWA (icono, nombre, colores)
sw.js              Service worker (cachea el shell para uso offline)
icons/             Íconos 192x192 y 512x512
```

## Cómo correrlo localmente

Los navegadores bloquean `fetch()` a `data.json` si abrís el archivo
directamente con doble click (protocolo `file://`). Hay que servirlo por
http, por ejemplo:

```bash
cd pwa
python3 -m http.server 8080
# o: npx serve .
```

Y abrir `http://localhost:8080`.

## Cómo desplegarlo (para que sea instalable de verdad)

Una PWA necesita HTTPS (salvo en `localhost`) para poder instalarse y
para que el Service Worker funcione. Opciones simples y gratuitas:

- **GitHub Pages**: subir esta carpeta a un repo y activar Pages.
- **Netlify / Vercel**: arrastrar la carpeta o conectar el repo.

## Geocodificación de direcciones

La planilla trae **calle y altura, pero no coordenadas**. La app resuelve
cada dirección a lat/lon en el navegador del usuario, usando el servicio
público de geocodificación de OpenStreetMap (Nominatim):

- Se agrupan direcciones repetidas para no pedir lo mismo dos veces.
- Se respeta el límite de uso de Nominatim (máx. ~1 solicitud/segundo),
  por eso la primera carga completa tarda varios minutos con ~500
  direcciones distintas — se ve una barra de progreso mientras tanto,
  y los puntos van apareciendo a medida que se resuelven.
- Los resultados se guardan en `localStorage` del navegador, así que
  **las cargas siguientes son instantáneas** (no se vuelve a geocodificar
  lo ya resuelto).
- Si vas a usar esto en producción con tráfico real o muchas actualizaciones
  de la planilla, conviene migrar a un servicio de geocodificación con
  cuota propia (Nominatim autoalojado, Mapbox, Google Geocoding, etc.) en
  vez del servicio público gratuito.

## Actualizar los datos

`data.json` es una exportación estática de la planilla al momento de
generar esta app. Para actualizarlo:

1. Exportar la hoja de Google Sheets como CSV.
2. Volver a correr el script de limpieza (columnas esperadas: `Nro
   Solicitud`, `Fecha Hora Registro`, `Calle`, `Altura`, `Equipamiento
   Robado`, `Cantidad`, `Numero de Denuncia`, `Ubicacion`).
3. Reemplazar `data.json`.

### Notas sobre la calidad de los datos originales

- Se excluyeron 18 filas sin calle o sin fecha, y 6 filas con fechas
  claramente erróneas en la planilla (`02/02/202`, `07/07/2027`).
- La columna `Numero de Denuncia` casi siempre dice "OK"/"ok" en vez de
  un número real; se muestra tal cual viene.
- `Ubicacion` a veces es un link de Google Drive (foto) y a veces es
  texto libre ("VER IMAGEN..."); la app muestra un link cliqueable solo
  cuando es una URL válida.
