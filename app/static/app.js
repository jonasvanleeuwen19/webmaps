const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true,
}).setView([52.3676, 4.9041], 13);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
L.control.zoom({ position: "topleft" }).addTo(map);

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
  document.body.classList.add("info-open");
}

function closeDetailsPanel() {
  infoPanel.classList.add("translate-x-full");
  document.body.classList.remove("info-open");
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

async function fetchSummaryFromTitle(title) {
  if (!title) return null;
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!response.ok) return null;
  const data = await response.json();
  return {
    title: data.title || title,
    extract: data.extract || null,
    image: data.thumbnail?.source || null,
    page: data.content_urls?.desktop?.page || null,
  };
}

async function fetchWikipediaSummary(place) {
  const tags = place?.tags || {};

  try {
    if (tags.wikipedia) {
      const parts = tags.wikipedia.split(":");
      const title = parts.length > 1 ? parts.slice(1).join(":") : tags.wikipedia;
      return await fetchSummaryFromTitle(title);
    }

    if (tags.wikidata) {
      const wikidataResponse = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${tags.wikidata}.json`);
      if (!wikidataResponse.ok) return null;
      const wikidata = await wikidataResponse.json();
      const entity = wikidata.entities?.[tags.wikidata];
      const title = entity?.sitelinks?.enwiki?.title;
      const summary = await fetchSummaryFromTitle(title);
      const imageClaim = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      const imageFile = typeof imageClaim === "string" ? imageClaim.replace(/ /g, "_") : null;
      if (summary || imageFile) {
        return {
          ...(summary || {}),
          image:
            summary?.image ||
            (imageFile ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFile)}` : null),
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchCommonsPhoto(lat, lng) {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "geosearch",
      ggscoord: `${lat}|${lng}`,
      ggsradius: "800",
      ggslimit: "1",
      prop: "pageimages|info",
      pithumbsize: "900",
      inprop: "url",
      origin: "*",
    });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (!response.ok) return null;
    const payload = await response.json();
    const first = Object.values(payload?.query?.pages || {})[0];
    if (!first) return null;
    return {
      image: first.thumbnail?.source || null,
      page: first.fullurl || null,
      title: first.title ? String(first.title).replace(/^File:/, "") : "Nearby photo",
    };
  } catch {
    return null;
  }
}

async function fetchReverseDetails(lat, lng) {
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lng),
      addressdetails: "1",
      "accept-language": "en",
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
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
      <div id="photoBox" class="hidden rounded border border-slate-700 bg-slate-900 p-3">
        <p class="mb-2 text-xs uppercase tracking-wide text-slate-400">Photo</p>
        <a id="photoLink" class="block" target="_blank" rel="noopener noreferrer">
          <img id="photoImage" alt="Location photo" class="max-h-56 w-full rounded object-cover" />
        </a>
      </div>
      <div id="sourceBox" class="rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400">
        Loading extra location data…
      </div>
    </div>
  `;

  const routeButton = document.getElementById("routeToPlace");
  routeButton?.addEventListener("click", () => routeToSelectedPlace());
  openInfoPanel();

  Promise.all([
    fetchWikipediaSummary(place),
    fetchCommonsPhoto(place.latlng.lat, place.latlng.lng),
    fetchReverseDetails(place.latlng.lat, place.latlng.lng),
  ]).then(([wiki, commons, reverse]) => {
    const box = document.getElementById("descriptionBox");
    if (!box) return;
    box.innerHTML = wiki?.extract ? `<p>${wiki.extract}</p>` : '<p class="text-slate-400">No external description available.</p>';

    const sourceBox = document.getElementById("sourceBox");
    if (sourceBox) {
      const reverseLabel = reverse?.display_name ? `<div><span class="text-slate-500">OSM reverse:</span> ${reverse.display_name}</div>` : "";
      const osmLink = `<a class="text-cyan-400 underline" href="https://www.openstreetmap.org/?mlat=${place.latlng.lat}&mlon=${place.latlng.lng}#map=18/${place.latlng.lat}/${place.latlng.lng}" target="_blank" rel="noopener noreferrer">View on OpenStreetMap</a>`;
      const wikiLink = wiki?.page
        ? `<a class="text-cyan-400 underline" href="${wiki.page}" target="_blank" rel="noopener noreferrer">Wikipedia page</a>`
        : "";
      sourceBox.innerHTML = [reverseLabel, osmLink, wikiLink].filter(Boolean).join("<br/>") || "No extra source links available.";
    }

    const imageUrl = wiki?.image || commons?.image;
    const imageLink = wiki?.page || commons?.page || "#";
    const photoBox = document.getElementById("photoBox");
    const photoImage = document.getElementById("photoImage");
    const photoLink = document.getElementById("photoLink");
    if (photoBox && photoImage && photoLink && imageUrl) {
      photoImage.src = imageUrl;
      photoImage.alt = wiki?.title || commons?.title || "Location photo";
      photoLink.href = imageLink;
      photoBox.classList.remove("hidden");
    }
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
    [out:json][timeout:15];
    (
      node["shop"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      way["shop"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
      relation["shop"](${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()});
    );
    out center tags 150;
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

async function fetchNearestNamedPlace(lat, lng) {
  const query = `
    [out:json][timeout:20];
    (
      nwr(around:120,${lat},${lng})["name"]["shop"];
      nwr(around:120,${lat},${lng})["name"]["tourism"];
      nwr(around:120,${lat},${lng})["name"]["amenity"];
      nwr(around:120,${lat},${lng})["name"]["historic"];
      nwr(around:120,${lat},${lng})["name"]["leisure"];
      nwr(around:120,${lat},${lng})["name"]["man_made"];
    );
    out center tags qt 25;
  `;
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
    if (!response.ok) return null;
    const payload = await response.json();
    const places = (payload.elements || [])
      .map((element) => {
        const center = element.center || {};
        const placeLat = element.lat ?? center.lat;
        const placeLon = element.lon ?? center.lon;
        if (placeLat == null || placeLon == null) return null;
        const tags = element.tags || {};
        return {
          name: tags.name || "Place",
          type: tags.tourism || tags.amenity || tags.shop || tags.historic || tags.leisure || tags.man_made || "place",
          shop: tags.shop || tags.amenity || tags.tourism || "place",
          address: [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
          housenumber: tags["addr:housenumber"] || "",
          tags,
          latlng: { lat: placeLat, lng: placeLon },
          distanceSq: (placeLat - lat) ** 2 + (placeLon - lng) ** 2,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distanceSq - b.distanceSq);
    return places[0] || null;
  } catch {
    return null;
  }
}

function normalizeSearchItem(item, source) {
  if (!item) return null;
  const lat = Number(item.lat ?? item.geometry?.coordinates?.[1]);
  const lon = Number(item.lon ?? item.geometry?.coordinates?.[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const displayName = item.display_name || item.name || item.properties?.name;
  if (!displayName) return null;

  return {
    lat,
    lon,
    source,
    type: item.type || item.osm_value || item.properties?.osm_value || item.properties?.type || "location",
    title: item.name || item.properties?.name || displayName.split(",")[0],
    display_name: displayName,
    tags: item.extratags || {},
  };
}

async function fetchNominatimSearch(query) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "12",
    addressdetails: "1",
    extratags: "1",
    namedetails: "1",
    "accept-language": "en",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!response.ok) return [];
  const payload = await response.json();
  return (Array.isArray(payload) ? payload : []).map((item) => normalizeSearchItem(item, "Nominatim")).filter(Boolean);
}

async function fetchPhotonSearch(query) {
  const params = new URLSearchParams({
    q: query,
    limit: "12",
    lang: "en",
  });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`);
  if (!response.ok) return [];
  const payload = await response.json();
  return (payload.features || [])
    .map((feature) => {
      const properties = feature.properties || {};
      const parts = [properties.name, properties.city, properties.country].filter(Boolean);
      return normalizeSearchItem(
        {
          geometry: feature.geometry,
          name: properties.name,
          display_name: parts.join(", "),
          type: properties.osm_value || properties.type,
          properties,
        },
        "Photon"
      );
    })
    .filter(Boolean);
}

function rankSearchItems(query, items) {
  const fuse = new Fuse(items, {
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true,
    keys: ["title", "display_name", "type"],
  });
  const ranked = fuse.search(query).map((entry) => entry.item);
  const unique = [];
  const seen = new Set();
  for (const item of [...ranked, ...items]) {
    const key = `${item.title}-${item.lat.toFixed(5)}-${item.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 10) break;
  }
  return unique;
}

function showSearchResults(items) {
  searchResults.classList.remove("hidden");
  searchResults.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("button");
    row.className = "block w-full rounded p-2 text-left text-sm hover:bg-slate-800";
    row.innerHTML = `
      <div class="truncate"><i class="fa-solid fa-location-crosshairs mr-2 text-cyan-400"></i>${item.display_name}</div>
      <div class="mt-1 text-xs text-slate-400">${item.type} · ${item.source}</div>
    `;
    row.addEventListener("click", () => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      searchPins.clearLayers();
      const marker = L.marker([lat, lng]).addTo(searchPins);
      marker.bindPopup(item.display_name).openPopup();
      map.setView([lat, lng], 15);

      const place = {
        name: item.title || item.display_name.split(",")[0],
        type: item.type || "location",
        shop: item.type || "location",
        address: item.display_name,
        housenumber: "",
        tags: item.tags || {},
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

map.on("click", async (event) => {
  const nearest = await fetchNearestNamedPlace(event.latlng.lat, event.latlng.lng);
  const place =
    nearest ||
    {
      name: "Dropped pin",
      type: "custom point",
      shop: "destination",
      address: `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`,
      housenumber: "",
      tags: {},
      latlng: { lat: event.latlng.lat, lng: event.latlng.lng },
    };
  searchPins.clearLayers();
  L.marker([place.latlng.lat, place.latlng.lng]).addTo(searchPins).bindPopup(place.name || "Selected place").openPopup();
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
    const variants = [query, query.replace(/[^\p{L}\p{N}\s-]/gu, "").trim()].filter(Boolean);
    const [nominatimA, photonA, nominatimB, photonB] = await Promise.all([
      fetchNominatimSearch(variants[0]),
      fetchPhotonSearch(variants[0]),
      variants[1] && variants[1] !== variants[0] ? fetchNominatimSearch(variants[1]) : Promise.resolve([]),
      variants[1] && variants[1] !== variants[0] ? fetchPhotonSearch(variants[1]) : Promise.resolve([]),
    ]);
    const combined = [...nominatimA, ...photonA, ...nominatimB, ...photonB];
    const items = rankSearchItems(query, combined);
    if (!items.length) {
      searchResults.classList.remove("hidden");
      searchResults.innerHTML = '<div class="p-2 text-sm text-slate-400">No results found</div>';
      return;
    }
    showSearchResults(items);
  }, 250);
});

setInfoPlaceholder("Click on the map, a search result, or a shop marker to view details.");
requestUserLocation({ recenter: true });
