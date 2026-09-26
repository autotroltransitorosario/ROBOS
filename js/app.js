/* =========================================================================
   Mapa de Artefactos Robados — Rosario
   - Carga data.json (reportes ya limpiados desde la planilla)
   - Geocodifica direcciones con Nominatim (OpenStreetMap) en el navegador,
     con cache en localStorage para no repetir búsquedas entre sesiones
   - Dibuja pines rojos sobre un mapa OSM (Leaflet)
   - Filtro de fecha horizontal y scrolleable: al elegir una fecha se
     muestran todos los puntos desde esa fecha en adelante
   ========================================================================= */

const CONFIG = {
  city: 'Rosario',
  mapCenter: [-32.9468, -60.6393],
  mapZoom: 13,
  nominatimUrl: 'https://nominatim.openstreetmap.org/search',
  geocodeDelayMs: 1100, // Nominatim: máx. ~1 solicitud por segundo
  cacheKey: 'geocodeCacheV1'
};

const state = {
  records: [],          // todos los registros del CSV
  byQuery: new Map(),   // geo_query -> [records]
  coords: new Map(),    // geo_query -> {lat, lon} | null (si falló)
  markers: new Map(),   // record.id -> L.Marker
  fixedDate: null,      // fecha ISO fija del filtro, o null = todas
  map: null,
  markerLayer: null
};

// ---------- Utilidades ----------
function loadCache() {
  try {
    const raw = localStorage.getItem(CONFIG.cacheKey);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveCache(cache) {
  try {
    localStorage.setItem(CONFIG.cacheKey, JSON.stringify(cache));
  } catch (e) {
    /* localStorage lleno o no disponible: seguimos sin persistir */
  }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function formatDateEs(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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

function addMarkerForRecord(rec, latlng) {
  const marker = L.marker(latlng, { icon: redIcon() });
  marker.bindPopup(popupHtml(rec));
  marker.recFechaIso = rec.fecha_iso;
  state.markers.set(rec.id, marker);
  if (passesFilter(rec)) marker.addTo(state.markerLayer);
  updateStats();
}

function passesFilter(rec) {
  if (!state.fixedDate) return true;
  return rec.fecha_iso >= state.fixedDate;
}

function applyFilter() {
  state.markerLayer.clearLayers();
  state.markers.forEach((marker) => {
    if (passesFilter({ fecha_iso: marker.recFechaIso })) {
      marker.addTo(state.markerLayer);
    }
  });
  updateStats();
}

function updateStats() {
  document.getElementById('stat-total').textContent = state.records.length;
  let visible = 0;
  state.markers.forEach((m) => { if (state.markerLayer.hasLayer(m)) visible++; });
  document.getElementById('stat-visible').textContent = visible;
}

// ---------- Filtro de fecha (scrolleable) ----------
function buildDateFilter(uniqueDates, countsByDate) {
  const scroll = document.getElementById('date-scroll');
  scroll.innerHTML = '';

  uniqueDates.forEach((iso) => {
    const chip = document.createElement('button');
    chip.className = 'date-chip';
    chip.dataset.date = iso;
    chip.innerHTML = `${formatDateEs(iso)}<span class="n">${countsByDate[iso]}</span>`;
    chip.addEventListener('click', () => setFixedDate(iso));
    scroll.appendChild(chip);
  });
}

function setFixedDate(iso) {
  state.fixedDate = iso;
  document.getElementById('filter-date-label').textContent = formatDateEs(iso);
  document.querySelectorAll('.date-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.date === iso);
    chip.classList.toggle('before', chip.dataset.date < iso);
  });
  applyFilter();
  // centra el chip elegido en el scroll
  const activeChip = document.querySelector('.date-chip.active');
  if (activeChip) activeChip.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
}

function resetFilter() {
  state.fixedDate = null;
  document.getElementById('filter-date-label').textContent = 'todas las fechas';
  document.querySelectorAll('.date-chip').forEach((chip) => {
    chip.classList.remove('active', 'before');
  });
  applyFilter();
}

// ---------- Geocodificación (Nominatim, client-side, con cache) ----------
async function geocodeOne(query) {
  const url = `${CONFIG.nominatimUrl}?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json[0]) {
      return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function runGeocodingQueue() {
  const cache = loadCache();
  const queries = Array.from(state.byQuery.keys());
  const pending = queries.filter((q) => !(q in cache));

  const progressEl = document.getElementById('geo-progress');
  const countEl = document.getElementById('geo-count');
  const barEl = document.getElementById('geo-bar');
  const totalToProcess = pending.length;
  let done = 0;

  // Primero, volcar al mapa todo lo que ya estaba en cache (instantáneo)
  queries.forEach((q) => {
    if (q in cache && cache[q]) {
      placeRecordsForQuery(q, cache[q]);
    }
  });
  updateStats();

  if (totalToProcess === 0) {
    progressEl.classList.add('done');
    return;
  }

  countEl.textContent = `0 / ${totalToProcess}`;

  for (const query of pending) {
    const coords = await geocodeOne(query);
    cache[query] = coords; // null si no se encontró, para no reintentar siempre
    if (coords) placeRecordsForQuery(query, coords);

    done++;
    countEl.textContent = `${done} / ${totalToProcess}`;
    barEl.style.width = `${Math.round((done / totalToProcess) * 100)}%`;

    if (done % 15 === 0) saveCache(cache); // guardado incremental
    await sleep(CONFIG.geocodeDelayMs);
  }

  saveCache(cache);
  progressEl.classList.add('done');
}

function placeRecordsForQuery(query, coords) {
  const recs = state.byQuery.get(query) || [];
  recs.forEach((rec) => addMarkerForRecord(rec, [coords.lat, coords.lon]));
}

// ---------- Carga de datos e inicio ----------
async function main() {
  initMap();
  document.getElementById('btn-reset').addEventListener('click', resetFilter);

  const res = await fetch('data.json');
  const records = await res.json();
  state.records = records;

  // Agrupar por dirección de geocodificación (evita pedir lo mismo dos veces)
  records.forEach((rec) => {
    if (!state.byQuery.has(rec.geo_query)) state.byQuery.set(rec.geo_query, []);
    state.byQuery.get(rec.geo_query).push(rec);
  });

  // Fechas únicas, ordenadas, con conteo de reportes por día
  const countsByDate = {};
  records.forEach((rec) => {
    countsByDate[rec.fecha_iso] = (countsByDate[rec.fecha_iso] || 0) + 1;
  });
  const uniqueDates = Object.keys(countsByDate).sort();

  document.getElementById('stat-total').textContent = records.length;
  document.getElementById('stat-visible').textContent = records.length;
  if (uniqueDates.length) {
    document.getElementById('stat-range').textContent =
      `${formatDateEs(uniqueDates[0])} – ${formatDateEs(uniqueDates[uniqueDates.length - 1])}`;
  }

  buildDateFilter(uniqueDates, countsByDate);
  runGeocodingQueue();
}

main();
