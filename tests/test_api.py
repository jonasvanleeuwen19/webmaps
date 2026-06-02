from fastapi.testclient import TestClient

from app.main import app
import app.main as main_module


client = TestClient(app)


def test_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "WebMaps" in response.text


def test_route_validation():
    response = client.get("/api/route", params={"start": "x,y", "end": "1,2"})
    assert response.status_code == 422


def test_shops_invalid_bbox():
    response = client.get("/api/shops", params={"south": 10, "west": 20, "north": 9, "east": 21})
    assert response.status_code == 400


def test_search_success(monkeypatch):
    async def fake_fetch_json(*args, **kwargs):
        return [{"display_name": "Amsterdam", "lat": "52.37", "lon": "4.89"}]

    monkeypatch.setattr(main_module, "fetch_json", fake_fetch_json)
    response = client.get("/api/search", params={"q": "amsterdam"})
    assert response.status_code == 200
    assert response.json()[0]["display_name"] == "Amsterdam"
