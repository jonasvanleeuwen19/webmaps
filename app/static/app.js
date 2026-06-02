const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true,
}).setView([52.3676, 4.9041], 13);

const baseLayers = {
  "Dark Matter": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }),
  "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  "Topo": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "&copy; OpenTopoMap contributors",
  }),
};

baseLayers["Dark Matter"].addTo(map);
L.control.zoom({ position: "topleft" }).addTo(map);
L.control.layers(baseLayers, {}, { position: "bottomright", collapsed: true }).addTo(map);

const routeLayer = L.geoJSON(null, { style: { color: "#06b6d4", weight: 5, opacity: 0.95 } }).addTo(map);
const routePins = L.layerGroup().addTo(map);
const searchPins = L.layerGroup().addTo(map);
const shopLayer = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42 });
map.addLayer(shopLayer);

const sidebar = document.getElementById("sidebar");
const toggleSidebar = document.getElementById("toggleSidebar");
const expandSidebar = document.getElementById("expandSidebar");
const clearRoute = document.getElementById("clearRoute");
const loadShops = document.getElementById("loadShops");
const clearShops = document.getElementById("clearShops");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const infoPanel = document.getElementById("infoPanel");
const closeInfoPanel = document.getElementById("closeInfoPanel");
const infoTitle = document.getElementById("infoTitle");
const infoContent = document.getElementById("infoContent");

let searchTimeout = null;
let selectedPlace = null;
let currentLocation = null;

function boolTag(value) {
  if (!value) return "Unknown";
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  return value;
}

function openInfoPanel() {
  infoPanel.classList.remove("translate-x-full");
}

function closeDetailsPanel() {
  infoPanel.classList.add("translate-x-full");
}

function setInfoPlaceholder(message) {
  infoTitle.innerHTML = '<i class="fa-solid fa-circle-info mr-2 text-cyan-400"></i>Place details';
  infoContent.innerHTML = `<p class="text-slate-400">${message}</p>`;
}

async function requestUserLocation({ recenter = false } = {}) {
  if (!navigator.geolocation) return null;
  if (currentLocation && !recenter) return currentLocation;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        if (recenter) {
          map.setView([currentLocation.lat, currentLocation.lng], 14);
        }
        resolve(currentLocation);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function fetchWikipediaSummary(place) {
  const tags = place?.tags || {};

  async function fetchSummary(title) {
    if (!title) return null;
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.extract || null;
  }

  try {
    if (tags.wikipedia) {
      const parts = tags.wikipedia.split(":");
      const title = parts.length > 1 ? parts.slice(1).join(":") : tags.wikipedia;
      return await fetchSummary(title);
    }

    if (tags.wikidata) {
      const wikidataResponse = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${tags.wikidata}.json`);
      if (!wikidataResponse.ok) return null;
      const wikidata = await wikidataResponse.json();
      const entity = wikidata.entities?.[tags.wikidata];
      const title = entity?.sitelinks?.enwiki?.title;
      return await fetchSummary(title);
    }
  } catch {
    return null;
  }

  return null;
}

function formatAddress(place) {
  const parts = [place?.address, place?.housenumber].filter(Boolean);
  return parts.length ? parts.join(" ") : "Unknown";
}

function renderInfo(place) {
  selectedPlace = place;
  const title = place.name || "Selected place";
  infoTitle.innerHTML = `<i class="fa-solid fa-location-dot mr-2 text-cyan-400"></i>${title}`;

  const website = place.tags?.website || place.tags?.["contact:website"];
  const openingHours = place.tags?.opening_hours || "Unknown";
  const wifi = boolTag(place.tags?.internet_access);
  const wheelchair = boolTag(place.tags?.wheelchair);
  const phone = place.tags?.phone || place.tags?.["contact:phone"] || "Unknown";

  infoContent.innerHTML = `
    <div class="space-y-3">
      <button id="routeToPlace" class="route-button"><i class="fa-solid fa-route mr-2"></i>Route to here</button>
      <div class="info-grid text-sm">
        <span class="info-label">Type</span><span class="info-value">${place.shop || place.type || "Place"}</span>
        <span class="info-label">Address</span><span class="info-value">${formatAddress(place)}</span>
        <span class="info-label">Open</span><span class="info-value">${openingHours}</span>
        <span class="info-label">Wi-Fi</span><span class="info-value">${wifi}</span>
        <span class="info-label">Wheelchair</span><span class="info-value">${wheelchair}</span>
        <span class="info-label">Phone</span><span class="info-value">${phone}</span>
        <span class="info-label">Website</span>
        <span class="info-value">${website ? `<a class="text-cyan-400 underline" href="${website}" target="_blank" rel="noopener noreferrer">Open website</a>` : "Unknown"}</span>
      </div>
      <div id="descriptionBox" class="rounded border border-slate-700 bg-slate-900 p-3 text-slate-300">
        <p class="text-slate-400">Loading description…</p>
      </div>
    </div>
  `;

  const routeButton = document.getElementById("routeToPlace");
  routeButton?.addEventListener("click", () => routeToSelectedPlace());
  openInfoPanel();

  fetchWikipediaSummary(place).then((description) => {
    const box = document.getElementById("descriptionBox");
    if (!box) return;
    box.innerHTML = description
      ? `<p>${description}</p>`
      : '<p class="text-slate-400">No external description available.</p>';
  });
}

async function routeToSelectedPlace() {
  if (!selectedPlace?.latlng) return;
  const start = await requestUserLocation();
  if (!start) {
    setInfoPlaceholder("Location access is required for routing from your current position.");
    openInfoPanel();
    return;
  }

  const end = selectedPlace.latlng;
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    alternatives: "false",
    steps: "false",
  });

  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?${params}`;
  const response = await fetch(routeUrl);
  if (!response.ok) return;

  const data = await response.json();
  const route = data.routes?.[0]?.geometry;
  if (!route) return;

  routeLayer.clearLayers();
  routePins.clearLayers();
  routeLayer.addData({ type: "Feature", geometry: route, properties: {} });

  routePins.addLayer(L.marker([start.lat, start.lng]).bindPopup("Your location"));
  routePins.addLayer(L.marker([end.lat, end.lng]).bindPopup(selectedPlace.name || "Destination"));

  const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
  const durationMin = Math.round(data.routes[0].duration / 60);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

  infoContent.insertAdjacentHTML(
    "beforeend",
    `<div class="rounded border border-cyan-800 bg-cyan-950/40 p-3 text-sm text-cyan-100"><i class="fa-solid fa-road mr-2"></i>${distanceKm} km · ${durationMin} min</div>`
  );
}

function normalizeShopElement(element) {
  const tags = element.tags || {};
  const center = element.center || {};
  const lat = element.lat ?? center.lat;
  const lon = element.lon ?? center.lon;
  if (lat == null || lon == null) return null;

  return {
    id: element.id,
    name: tags.name || "Shop",
    shop: tags.shop || "shop",
    address: tags["addr:street"] || "",
    housenumber: tags["addr:housenumber"] || "",
    tags,
    latlng: { lat, lng: lon },
  };
}

async function loadShopsInView() {
  const bounds = map.getBounds();
  const query = `
    [out:json][timeout:25];
    (
      node["shop"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      way["shop"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      relation["shop"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
    );
    out center tags 250;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
  });
  if (!response.ok) return;

  const payload = await response.json();
  shopLayer.clearLayers();

  for (const element of payload.elements || []) {
    const shop = normalizeShopElement(element);
    if (!shop) continue;

    const marker = L.circleMarker([shop.latlng.lat, shop.latlng.lng], {
      radius: 7,
      color: "#06b6d4",
      fillColor: "#0f172a",
      fillOpacity: 0.95,
      weight: 2,
    });

    marker.bindPopup(`<strong>${shop.name}</strong><br/>${shop.shop}`);
    marker.on("click", () => renderInfo(shop));
    shopLayer.addLayer(marker);
  }
}

function showSearchResults(items) {
  searchResults.classList.remove("hidden");
  searchResults.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("button");
    row.className = "block w-full rounded p-2 text-left text-sm hover:bg-slate-800";
    row.innerHTML = `<i class="fa-solid fa-location-crosshairs mr-2 text-cyan-400"></i>${item.display_name}`;
    row.addEventListener("click", () => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      searchPins.clearLayers();
      const marker = L.marker([lat, lng]).addTo(searchPins);
      marker.bindPopup(item.display_name).openPopup();
      map.setView([lat, lng], 15);

      const place = {
        name: item.name || item.display_name.split(",")[0],
        type: item.type || "location",
        shop: item.type || "location",
        address: item.display_name,
        housenumber: "",
        tags: {},
        latlng: { lat, lng },
      };
      renderInfo(place);
      searchResults.classList.add("hidden");
      searchInput.blur();
    });
    searchResults.appendChild(row);
  });
}

toggleSidebar.addEventListener("click", () => {
  sidebar.classList.add("-translate-x-full");
  expandSidebar.classList.remove("hidden");
  document.body.classList.add("left-collapsed");
});

expandSidebar.addEventListener("click", () => {
  sidebar.classList.remove("-translate-x-full");
  expandSidebar.classList.add("hidden");
  document.body.classList.remove("left-collapsed");
});

closeInfoPanel.addEventListener("click", () => closeDetailsPanel());

clearRoute.addEventListener("click", () => {
  routeLayer.clearLayers();
  routePins.clearLayers();
});

loadShops.addEventListener("click", loadShopsInView);
clearShops.addEventListener("click", () => shopLayer.clearLayers());

map.on("click", (event) => {
  const place = {
    name: "Dropped pin",
    type: "custom point",
    shop: "destination",
    address: `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`,
    housenumber: "",
    tags: {},
    latlng: { lat: event.latlng.lat, lng: event.latlng.lng },
  };

  searchPins.clearLayers();
  L.marker([event.latlng.lat, event.latlng.lng]).addTo(searchPins).bindPopup("Dropped pin").openPopup();
  renderInfo(place);
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();
  if (searchTimeout) clearTimeout(searchTimeout);

  if (query.length < 2) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }

  searchTimeout = setTimeout(async () => {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "8",
      addressdetails: "1",
      accept-language: "en",
    });

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!response.ok) return;

    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) {
      searchResults.classList.remove("hidden");
      searchResults.innerHTML = '<div class="p-2 text-sm text-slate-400">No results found</div>';
      return;
    }

    showSearchResults(items);
  }, 300);
});

setInfoPlaceholder("Click on the map, a search result, or a shop marker to view details.");
requestUserLocation({ recenter: true });
