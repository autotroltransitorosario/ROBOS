/* =========================================================================
   Mapa de Artefactos Robados — Rosario (fuente: Google Sheets en vivo)

   - Lee la planilla editable directamente en el navegador del usuario
     usando el endpoint público "gviz" de Google (pensado justamente para
     que otras páginas consuman una hoja como fuente de datos, por eso
     responde con CORS habilitado a diferencia del export CSV normal).
   - Solo se muestran las filas que tienen coordenadas válidas cargadas
     en la columna COORDENADAS ("lat, lng" en una misma celda).
   - Filtro de fecha horizontal y scrolleable, por RANGO (desde/hasta):
     primer toque fija el "desde", segundo toque fija el "hasta".
   ========================================================================= */

const CONFIG = {
  // -------- Fuente de datos: Google Sheets --------
  sheetId: '1_xGUEmaW9OEGxTIeBRVtc8Qdkfh_et6QGL0DfEZzBOk',
  gid: '619088428',
  autoRefreshMs: 3 * 60 * 1000, // recarga la planilla cada 3 minutos

  // -------- Mapa --------
  mapCenter: [-32.9468, -60.6393],
  mapZoom: 13,

  // Nombres de columnas esperados en la planilla (case-insensitive)
  columns: {
    nro: 'nro solicitud',
    fecha: 'fecha hora registro',
    calle: 'calle',
    altura: 'altura',
    equipamiento: 'equipamiento robado',
    cantidad: 'cantidad',
    denuncia: 'numero de denuncia',
    ubicacion: 'ubicacion',
    coordenadas: 'coordenadas'
  }
};

function sheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:json&gid=${CONFIG.gid}&headers=1&_=${Date.now()}`;
}

const state = {
  records: [],           // filas con coordenadas válidas
  totalRows: 0,          // filas totales leídas de la planilla
  noCoordCount: 0,
  markers: new Map(),    // record.id -> L.Marker
  rangeStart: null,      // fecha ISO
  rangeEnd: null,        // fecha ISO
  map: null,
  markerLayer: null,
  refreshTimer: null
};

// ---------- Utilidades ----------
function formatDateEs(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Acepta "DD/MM/YYYY" o "DD/MM/YYYY HH:MM" (con - o / como separador de fecha)
function parseFechaFlexible(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (!m) return null;
  let [, d, mo, y, h, mi] = m;
  d = parseInt(d, 10); mo = parseInt(mo, 10); y = parseInt(y, 10);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y < 2020 || y > 2035) return null; // filtra typos evidentes de años
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const display = h !== undefined
    ? `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y} ${h.padStart(2,'0')}:${mi}`
    : `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;
  return { iso, display };
}

// Acepta "lat, lng" con separador decimal '.' o ',' (coma o punto),
// separados por coma, punto y coma o espacio, y tolera texto extra
// alrededor (ej. "Lat: -32,9468 Lng: -60,6393").
function parseCoordenadas(raw) {
  if (!raw) return null;
  const matches = String(raw).match(/-?\d{1,3}(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) return null;
  const toNum = (s) => parseFloat(s.replace(',', '.'));
  const lat = toNum(matches[0]);
  const lon = toNum(matches[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

function cellText(row, idx) {
  if (idx === -1) return '';
  const cell = row.c[idx];
  if (!cell) return '';
  // Preferimos el valor "formateado" (lo que se ve en la celda). Es clave
  // para columnas de fecha/hora reales: si Sheets guarda la celda como
  // tipo Fecha (no texto), el valor interno (.v) llega como
  // "Date(2025,9,30,19,58,0)" en vez del texto visible "30/10/2025 19:58",
  // que sí está en .f.
  if (cell.f !== undefined && cell.f !== null && cell.f !== '') return String(cell.f).trim();
  if (cell.v === null || cell.v === undefined) return '';
  return String(cell.v).trim();
}

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Mapa ----------
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView(CONFIG.mapCenter, CONFIG.mapZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> colaboradores',
    maxZoom: 19
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
}

function redIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="pin-dot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 14],
    popupAnchor: [0, -14]
  });
}

function popupHtml(rec) {
  const rows = [];
  rows.push(['Fecha', rec.fecha_display || '—']);
  if (rec.equipamiento) rows.push(['Equipamiento', rec.equipamiento]);
  if (rec.cantidad) rows.push(['Cantidad', rec.cantidad]);
  if (rec.denuncia) rows.push(['Denuncia', rec.denuncia]);
  if (rec.nro_solicitud) rows.push(['Solicitud', rec.nro_solicitud]);
  if (rec.ubicacion) {
    const isLink = /^https?:\/\//i.test(rec.ubicacion);
    rows.push(['Evidencia', isLink
      ? `<a href="${rec.ubicacion}" target="_blank" rel="noopener">Ver foto/registro</a>`
      : rec.ubicacion]);
  }
  const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  return `<div class="popup-card"><p class="addr">${rec.direccion}</p><dl>${dl}</dl></div>`;
}

function rebuildMarkers() {
  state.markerLayer.clearLayers();
  state.markers.clear();
  state.records.forEach((rec) => {
    const marker = L.marker([rec.lat, rec.lon], { icon: redIcon() });
    marker.bindPopup(popupHtml(rec));
    marker.recFechaIso = rec.fecha_iso;
    state.markers.set(rec.id, marker);
  });
  applyFilter();
  if (state.records.length) {
    const bounds = L.latLngBounds(state.records.map((r) => [r.lat, r.lon]));
    state.map.fitBounds(bounds.pad(0.15));
  }
}

function passesFilter(fechaIso) {
  if (state.rangeStart && fechaIso < state.rangeStart) return false;
  if (state.rangeEnd && fechaIso > state.rangeEnd) return false;
  return true;
}

function applyFilter() {
  state.markerLayer.clearLayers();
  let visible = 0;
  state.markers.forEach((marker) => {
    if (passesFilter(marker.recFechaIso)) {
      marker.addTo(state.markerLayer);
      visible++;
    }
  });
  document.getElementById('stat-visible').textContent = visible;
}

// ---------- Filtro de rango de fechas (scrolleable) ----------
function buildDateFilter(uniqueDates, countsByDate) {
  const scroll = document.getElementById('date-scroll');
  scroll.innerHTML = '';
  uniqueDates.forEach((iso) => {
    const chip = document.createElement('button');
    chip.className = 'date-chip';
    chip.dataset.date = iso;
    chip.innerHTML = `${formatDateEs(iso)}<span class="n">${countsByDate[iso]}</span>`;
    chip.addEventListener('click', () => onChipClick(iso));
    scroll.appendChild(chip);
  });
}

function onChipClick(iso) {
  if (!state.rangeStart || (state.rangeStart && state.rangeEnd)) {
    // arranca una selección nueva
    state.rangeStart = iso;
    state.rangeEnd = null;
  } else if (iso < state.rangeStart) {
    // tocaron una fecha anterior al "desde": se convierte en el nuevo "desde"
    state.rangeStart = iso;
  } else {
    state.rangeEnd = iso;
  }
  refreshRangeUI();
  applyFilter();
}

function refreshRangeUI() {
  const label = document.getElementById('filter-range-label');
  if (state.rangeStart && state.rangeEnd) {
    label.textContent = `${formatDateEs(state.rangeStart)} → ${formatDateEs(state.rangeEnd)}`;
  } else if (state.rangeStart) {
    label.textContent = `desde ${formatDateEs(state.rangeStart)} (elegí el "hasta")`;
  } else {
    label.textContent = 'todo el período';
  }

  document.querySelectorAll('.date-chip').forEach((chip) => {
    const d = chip.dataset.date;
    const isStart = d === state.rangeStart;
    const isEnd = d === state.rangeEnd;
    const inRange = state.rangeStart && state.rangeEnd && d > state.rangeStart && d < state.rangeEnd;
    chip.classList.toggle('active', isStart || isEnd);
    chip.classList.toggle('in-range', !!inRange);
  });
}

function resetFilter() {
  state.rangeStart = null;
  state.rangeEnd = null;
  refreshRangeUI();
  applyFilter();
}

// ---------- Carga de datos desde Google Sheets ----------
function setStatus(text, kind) {
  const el = document.getElementById('data-status');
  el.textContent = text;
  el.className = 'data-status' + (kind ? ' ' + kind : '');
}

async function fetchSheet() {
  const res = await fetch(sheetUrl());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error('Respuesta inesperada de Google Sheets');
  const json = JSON.parse(match[1]);
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'error desconocido';
    throw new Error(msg);
  }
  return json.table;
}

function colIndex(labels, wanted) {
  return labels.findIndex((l) => (l || '').trim().toLowerCase() === wanted);
}

function processTable(table) {
  const labels = table.cols.map((c) => c.label);
  const idx = {};
  Object.entries(CONFIG.columns).forEach(([key, wanted]) => {
    idx[key] = colIndex(labels, wanted);
  });

  const missing = Object.entries(CONFIG.columns)
    .filter(([key]) => idx[key] === -1)
    .map(([, wanted]) => wanted);

  const records = [];
  let totalRows = 0;
  let emptyCoordCell = 0;
  let unparsableCoordSamples = [];
  let unparsableDateSamples = [];

  (table.rows || []).forEach((row) => {
    if (!row.c) return;
    const calle = cellText(row, idx.calle);
    const fechaRaw = cellText(row, idx.fecha);
    if (!calle || !fechaRaw) return; // fila sin datos mínimos, se ignora
    totalRows++;

    const coordRaw = cellText(row, idx.coordenadas);
    const coords = parseCoordenadas(coordRaw);
    if (!coords) {
      if (!coordRaw) {
        emptyCoordCell++;
      } else if (unparsableCoordSamples.length < 5) {
        unparsableCoordSamples.push(coordRaw);
      }
      return; // solo mostramos puntos con coordenadas
    }

    const fecha = parseFechaFlexible(fechaRaw);
    if (!fecha) {
      if (unparsableDateSamples.length < 5) unparsableDateSamples.push(fechaRaw);
      return;
    }

    const altura = cellText(row, idx.altura);
    const direccion = altura ? `${calle} ${altura}` : calle;

    records.push({
      id: records.length,
      nro_solicitud: cellText(row, idx.nro),
      fecha_iso: fecha.iso,
      fecha_display: fecha.display,
      calle, altura, direccion,
      equipamiento: cellText(row, idx.equipamiento),
      cantidad: cellText(row, idx.cantidad),
      denuncia: cellText(row, idx.denuncia),
      ubicacion: cellText(row, idx.ubicacion),
      lat: coords.lat,
      lon: coords.lon
    });
  });

  const noCoord = totalRows - records.length;
  return {
    records, totalRows, noCoord, missing, labels,
    emptyCoordCell, unparsableCoordSamples, unparsableDateSamples
  };
}

async function loadData(isManualRefresh) {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  setStatus(isManualRefresh ? 'Releyendo planilla…' : 'Cargando planilla…');

  try {
    const table = await fetchSheet();
    const { records, totalRows, noCoord, missing, labels, emptyCoordCell, unparsableCoordSamples, unparsableDateSamples } = processTable(table);

    state.records = records;
    state.totalRows = totalRows;
    state.noCoordCount = noCoord;

    document.getElementById('stat-total').textContent = records.length;
    document.getElementById('stat-nocoord').textContent = noCoord;

    const countsByDate = {};
    records.forEach((r) => { countsByDate[r.fecha_iso] = (countsByDate[r.fecha_iso] || 0) + 1; });
    const uniqueDates = Object.keys(countsByDate).sort();
    if (uniqueDates.length) {
      document.getElementById('stat-range').textContent =
        `${formatDateEs(uniqueDates[0])} – ${formatDateEs(uniqueDates[uniqueDates.length - 1])}`;
    } else {
      document.getElementById('stat-range').textContent = '—';
    }

    buildDateFilter(uniqueDates, countsByDate);
    refreshRangeUI();
    rebuildMarkers();

    const now = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    if (missing.length) {
      console.warn('Columnas no encontradas:', missing, '— encabezados reales:', labels);
      setStatus(`Faltan columnas: ${missing.join(', ')}. Encabezados leídos: ${labels.filter(Boolean).join(' | ')}`, 'error');
    } else if (records.length === 0 && totalRows > 0 && emptyCoordCell === totalRows) {
      setStatus(`${totalRows} filas leídas, pero la columna Coordenadas está vacía en todas. Cargá al menos una para probar.`, 'error');
    } else if (records.length === 0 && totalRows > 0 && unparsableDateSamples.length > 0) {
      console.warn('Fechas que no se pudieron interpretar:', unparsableDateSamples);
      setStatus(`${totalRows} filas · ${emptyCoordCell} sin coordenadas. Las que sí tienen coordenadas fallan por FECHA. Ejemplo: "${unparsableDateSamples[0]}"`, 'error');
    } else if (records.length === 0 && totalRows > 0) {
      console.warn('Coordenadas que no se pudieron interpretar:', unparsableCoordSamples);
      setStatus(`${totalRows} filas · ${emptyCoordCell} sin coordenadas. Las que tienen algo cargado no se pudieron interpretar. Ejemplo: "${unparsableCoordSamples[0] || ''}"`, 'error');
    } else if (totalRows === 0) {
      setStatus('La planilla respondió, pero no se leyó ninguna fila con Calle y Fecha. Revisá el gid/pestaña.', 'error');
    } else {
      let extra = '';
      if (unparsableDateSamples.length) extra = ` · ${unparsableDateSamples.length}+ con fecha no reconocida`;
      setStatus(`Actualizado ${now} · ${totalRows} filas · ${records.length} con coordenadas · ${emptyCoordCell} sin coordenadas${extra}`, 'ok');
    }
  } catch (err) {
    console.error(err);
    setStatus('No se pudo leer la planilla. Verificá que esté compartida como "Cualquiera con el enlace".', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Inicio ----------
function main() {
  initMap();
  document.getElementById('btn-reset').addEventListener('click', resetFilter);
  document.getElementById('btn-refresh').addEventListener('click', () => loadData(true));

  loadData(false);

  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => loadData(false), CONFIG.autoRefreshMs);
}

main();
