const map = L.map("map").setView([52.3676, 4.9041], 13);

const layers = {
  OpenStreetMap: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  OpenMapTiles: L.tileLayer("https://tiles.openfreemap.org/styles/liberty/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  Topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "&copy; OpenTopoMap contributors",
  }),
};

layers.OpenMapTiles.addTo(map);
L.control.layers(layers).addTo(map);

const routeLayer = L.geoJSON(null, { style: { color: "#2563eb", weight: 5 } }).addTo(map);
const routePins = L.layerGroup().addTo(map);
const shopLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) =>
    L.circleMarker(latlng, { radius: 6, color: "#0f172a", fillColor: "#f97316", fillOpacity: 0.9, weight: 1 }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties || {};
    const addr = [p.address, p.housenumber].filter(Boolean).join(" ");
    layer.bindPopup(`<strong>${p.name || "Winkel"}</strong><br/>Type: ${p.shop || "Onbekend"}${addr ? `<br/>${addr}` : ""}`);
  },
}).addTo(map);

let routeStart = null;
let routeEnd = null;

const sidebar = document.getElementById("sidebar");
const toggleSidebar = document.getElementById("toggleSidebar");
const expandSidebar = document.getElementById("expandSidebar");
const clearRoute = document.getElementById("clearRoute");
const loadShops = document.getElementById("loadShops");
const clearShops = document.getElementById("clearShops");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

toggleSidebar.addEventListener("click", () => {
  sidebar.classList.add("-translate-x-full");
  expandSidebar.classList.remove("hidden");
});

expandSidebar.addEventListener("click", () => {
  sidebar.classList.remove("-translate-x-full");
  expandSidebar.classList.add("hidden");
});

clearRoute.addEventListener("click", () => {
  routeStart = null;
  routeEnd = null;
  routeLayer.clearLayers();
  routePins.clearLayers();
});

loadShops.addEventListener("click", async () => {
  const b = map.getBounds();
  const params = new URLSearchParams({
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
  });

  const res = await fetch(`/api/shops?${params.toString()}`);
  if (!res.ok) return;
  const data = await res.json();
  shopLayer.clearLayers();
  shopLayer.addData(data);
});

clearShops.addEventListener("click", () => shopLayer.clearLayers());

map.on("click", async (e) => {
  if (!routeStart) {
    routeStart = e.latlng;
    routePins.addLayer(L.marker(routeStart).bindPopup("Startpunt").openPopup());
    return;
  }
  routeEnd = e.latlng;
  routePins.addLayer(L.marker(routeEnd).bindPopup("Eindpunt").openPopup());

  const params = new URLSearchParams({
    start: `${routeStart.lat},${routeStart.lng}`,
    end: `${routeEnd.lat},${routeEnd.lng}`,
  });
  const res = await fetch(`/api/route?${params.toString()}`);
  if (!res.ok) return;
  const data = await res.json();
  const route = data.routes?.[0]?.geometry;
  if (!route) return;

  routeLayer.clearLayers();
  routeLayer.addData({ type: "Feature", geometry: route, properties: {} });
  map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
});

let searchTimeout = null;
searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  if (searchTimeout) clearTimeout(searchTimeout);
  if (q.length < 2) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }

  searchTimeout = setTimeout(async () => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      searchResults.classList.remove("hidden");
      searchResults.innerHTML = `<div class="p-2 text-sm text-slate-500">Geen resultaten</div>`;
      return;
    }

    searchResults.classList.remove("hidden");
    searchResults.innerHTML = "";
    items.forEach((item) => {
      const row = document.createElement("button");
      row.className = "block w-full rounded p-2 text-left text-sm hover:bg-slate-100";
      row.textContent = item.display_name;
      row.addEventListener("click", () => {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        const marker = L.marker([lat, lon]).addTo(map);
        marker.bindPopup(item.display_name).openPopup();
        map.setView([lat, lon], 15);
        searchResults.classList.add("hidden");
        searchInput.blur();
      });
      searchResults.appendChild(row);
    });
  }, 300);
});
