# webmaps

Lightweight self-hosted browser maps app built with FastAPI + Leaflet.

## Features

- Full-page interactive map with clean UI
- Collapsible sidebar
- Top-right search bar (Nominatim geocoding)
- Route navigation between two points (OSRM)
- Nearby shop markers for current map view (Overpass / OpenStreetMap)
- Toggleable map styles (including OpenMapTiles-compatible style source)
- Single-container deployment with Docker

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000

## Docker

```bash
docker build -t webmaps .
docker run --rm -p 8000:8000 webmaps
```

Open http://localhost:8000
