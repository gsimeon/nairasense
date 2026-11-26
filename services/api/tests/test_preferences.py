from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_preferences_defaults_and_update() -> None:
    reg = client.post(
        "/api/v1/auth/register",
        json={"username": "prefs_tester", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    get_res = client.get("/api/v1/preferences", headers=headers)
    assert get_res.status_code == 200
    defaults = get_res.json()
    assert defaults["text_size"] == "large"
    assert defaults["high_contrast"] is False
    assert defaults["speech_enabled"] is True
    assert defaults["speech_rate"] == 1.0

    put_res = client.put(
        "/api/v1/preferences",
        headers=headers,
        json={
            "text_size": "extra_large",
            "high_contrast": True,
            "speech_enabled": True,
            "speech_rate": 1.25,
        },
    )
    assert put_res.status_code == 200
    updated = put_res.json()
    assert updated["text_size"] == "extra_large"
    assert updated["high_contrast"] is True
    assert updated["speech_rate"] == 1.25

    get_again = client.get("/api/v1/preferences", headers=headers).json()
    assert get_again["text_size"] == "extra_large"
    assert get_again["high_contrast"] is True
