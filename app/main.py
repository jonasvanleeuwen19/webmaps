from __future__ import annotations

from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI(title="webmaps")
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OSRM_URL = "https://router.project-osrm.org"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_HEADERS = {"User-Agent": "webmaps-fastapi/1.0 (https://github.com/jonasvanleeuwen19/webmaps)"}
COORDINATE_PATTERN = r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$"


async def fetch_json(
    url: str,
    *,
    method: str = "GET",
    params: dict[str, Any] | None = None,
    data: str | None = None,
) -> Any:
    async with httpx.AsyncClient(timeout=20.0, headers=DEFAULT_HEADERS) as client:
        response = await client.request(method=method, url=url, params=params, content=data)
        response.raise_for_status()
        return response.json()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="index.html")


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=8, ge=1, le=20),
) -> Any:
    try:
        return await fetch_json(
            f"{NOMINATIM_URL}/search",
            params={
                "q": q,
                "format": "jsonv2",
                "limit": limit,
                "addressdetails": 1,
            },
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Search upstream error: {exc}") from exc


@app.get("/api/route")
async def route(
    start: str = Query(..., pattern=COORDINATE_PATTERN),
    end: str = Query(..., pattern=COORDINATE_PATTERN),
) -> Any:
    try:
        start_lat, start_lon = [float(x.strip()) for x in start.split(",")]
        end_lat, end_lon = [float(x.strip()) for x in end.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid coordinates") from exc

    path = f"/route/v1/driving/{start_lon},{start_lat};{end_lon},{end_lat}"
    try:
        response = await fetch_json(
            f"{OSRM_URL}{path}",
            params={"overview": "full", "geometries": "geojson", "alternatives": "true", "steps": "true"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Routing upstream error: {exc}") from exc

    if response.get("code") != "Ok" or not response.get("routes"):
        raise HTTPException(status_code=404, detail="No route found")
    return response


@app.get("/api/shops")
async def shops(
    south: float = Query(..., ge=-90, le=90),
    west: float = Query(..., ge=-180, le=180),
    north: float = Query(..., ge=-90, le=90),
    east: float = Query(..., ge=-180, le=180),
) -> Any:
    if south >= north or west >= east:
        raise HTTPException(status_code=400, detail="Invalid bounding box")

    query = (
        "[out:json][timeout:20];"
        f"(node[\"shop\"]({south},{west},{north},{east});"
        f"way[\"shop\"]({south},{west},{north},{east});"
        f"relation[\"shop\"]({south},{west},{north},{east}););"
        "out center 100;"
    )
    try:
        result = await fetch_json(OVERPASS_URL, method="POST", data=query)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Shops upstream error: {exc}") from exc

    features = []
    for element in result.get("elements", []):
        lat = element.get("lat")
        lon = element.get("lon")
        center = element.get("center", {})
        lat = lat if lat is not None else center.get("lat")
        lon = lon if lon is not None else center.get("lon")
        if lat is None or lon is None:
            continue
        tags = element.get("tags", {})
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": element.get("id"),
                    "name": tags.get("name", "Winkel"),
                    "shop": tags.get("shop", "unknown"),
                    "address": tags.get("addr:street"),
                    "housenumber": tags.get("addr:housenumber"),
                },
            }
        )

    return {"type": "FeatureCollection", "features": features}
