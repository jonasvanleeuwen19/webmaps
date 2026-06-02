from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "WebMaps" in response.text
    assert "lang=\"en\"" in response.text


def test_api_search_removed_for_static_site():
    response = client.get("/api/search", params={"q": "amsterdam"})
    assert response.status_code == 404


def test_api_route_removed_for_static_site():
    response = client.get("/api/route", params={"start": "52.3,4.9", "end": "52.31,4.91"})
    assert response.status_code == 404


def test_api_shops_removed_for_static_site():
    response = client.get("/api/shops", params={"south": 52.3, "west": 4.8, "north": 52.4, "east": 5.0})
    assert response.status_code == 404
