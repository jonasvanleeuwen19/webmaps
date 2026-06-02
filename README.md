# webmaps

Lightweight self-hosted browser maps app built as a static Leaflet frontend, served by FastAPI.
The UI is fully in English and optimized for dark mode.

## Features

- Fully static HTML/CSS/JS frontend (no backend tracking or proxy API routes)
- Full-page interactive map with integrated left control sidebar and right place details sidebar
- Dark-first UI with Font Awesome icons
- Geolocation-first startup for nearby map focus
- Search with Nominatim geocoding
- Route navigation from your current location to a selected destination (OSRM)
- Nearby shop markers in current map view with richer metadata (Overpass + optional Wikipedia summary)
- Bottom-right layer switcher and improved map control placement
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
