from fastapi.testclient import TestClient

from app.main import app
import app.main as app_main_module


client = TestClient(app)


def test_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "WebMaps" in response.text


def test_route_validation():
    response = client.get("/api/route", params={"start": "x,y", "end": "1,2"})
    assert response.status_code == 422
    assert "string_pattern_mismatch" in response.text


def test_shops_invalid_bbox():
    response = client.get("/api/shops", params={"south": 10, "west": 20, "north": 9, "east": 21})
    assert response.status_code == 400


def test_search_success(monkeypatch):
    async def fake_fetch_json(*args, **kwargs):
        return [{"display_name": "Amsterdam", "lat": "52.37", "lon": "4.89"}]

    monkeypatch.setattr(app_main_module, "fetch_json", fake_fetch_json)
    response = client.get("/api/search", params={"q": "amsterdam"})
    assert response.status_code == 200
    assert response.json()[0]["display_name"] == "Amsterdam"


def test_route_success(monkeypatch):
    async def fake_fetch_json(*args, **kwargs):
        return {"code": "Ok", "routes": [{"geometry": {"type": "LineString", "coordinates": [[4.9, 52.3], [4.91, 52.31]]}}]}

    monkeypatch.setattr(app_main_module, "fetch_json", fake_fetch_json)
    response = client.get("/api/route", params={"start": "52.3,4.9", "end": "52.31,4.91"})
    assert response.status_code == 200
    assert response.json()["code"] == "Ok"


def test_shops_success(monkeypatch):
    async def fake_fetch_json(*args, **kwargs):
        return {
            "elements": [
                {
                    "id": 1,
                    "lat": 52.37,
                    "lon": 4.89,
                    "tags": {"name": "Test Shop", "shop": "supermarket"},
                }
            ]
        }

    monkeypatch.setattr(app_main_module, "fetch_json", fake_fetch_json)
    response = client.get("/api/shops", params={"south": 52.3, "west": 4.8, "north": 52.4, "east": 5.0})
    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "FeatureCollection"
    assert payload["features"][0]["properties"]["name"] == "Test Shop"
