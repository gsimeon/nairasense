import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.settings import settings

client = TestClient(app)


def _auth_headers(username: str = "cash_tester") -> dict[str, str]:
    res = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": "password123"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _make_textured_png(rgb: tuple[int, int, int]) -> bytes:
    arr = np.zeros((120, 160, 3), dtype=np.uint8)
    arr[:, :] = rgb
    # Add deterministic pattern so edge_score passes quality check
    arr[::4, :, :] = np.clip(arr[::4, :, :].astype(np.int16) - 35, 0, 255).astype(np.uint8)
    arr[:, ::6, :] = np.clip(arr[:, ::6, :].astype(np.int16) + 25, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def test_infer_rejects_unsupported_content_type() -> None:
    response = client.post(
        "/api/v1/cash/infer",
        files={"image": ("note.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 415


def test_infer_local_offline_classifier_with_real_image() -> None:
    png_bytes = _make_textured_png((45, 110, 190))
    response = client.post(
        "/api/v1/cash/infer",
        files={"image": ("note.png", png_bytes, "image/png")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["model"]["name"] == "local-naira-cv"
    assert payload["model"]["version"] == "0.1.0-offline"
    assert payload["image_quality"]["accepted"] is True
    assert payload["prediction"]["denomination_ngn"] in (5, 10, 20, 50, 100, 200, 500, 1000)
    assert payload["decision"]["requires_user_confirmation"] is True


def test_enroll_disabled_by_default_and_works_when_enabled(monkeypatch) -> None:
    headers = _auth_headers("enroll_tester")
    naira_1000 = _make_textured_png((115, 75, 155))
    naira_200 = _make_textured_png((75, 155, 70))

    blocked = client.post(
        "/api/v1/cash/enroll",
        headers=headers,
        data={"denomination_ngn": "1000"},
        files={"image": ("1000.png", naira_1000, "image/png")},
    )
    assert blocked.status_code == 403

    monkeypatch.setattr(settings, "allow_reference_enrollment", True)

    r1 = client.post(
        "/api/v1/cash/enroll",
        headers=headers,
        data={"denomination_ngn": "1000"},
        files={"image": ("1000.png", naira_1000, "image/png")},
    )
    assert r1.status_code == 200
    assert r1.json()["sample_count"] == 1

    r2 = client.post(
        "/api/v1/cash/enroll",
        headers=headers,
        data={"denomination_ngn": "200"},
        files={"image": ("200.png", naira_200, "image/png")},
    )
    assert r2.status_code == 200

    counts = client.get("/api/v1/cash/enrollments", headers=headers).json()["counts"]
    assert counts["1000"] == 1
    assert counts["200"] == 1

    infer_res = client.post(
        "/api/v1/cash/infer",
        headers=headers,
        files={"image": ("query_1000.png", naira_1000, "image/png")},
    )
    assert infer_res.status_code == 200
    assert infer_res.json()["prediction"]["denomination_ngn"] == 1000


def test_infer_explicit_mock_mode(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vision_provider", "mock")
    jpeg_bytes = b"\xff\xd8\xff\xe0mock-jpeg"
    response = client.post(
        "/api/v1/cash/infer",
        files={"image": ("note.jpg", jpeg_bytes, "image/jpeg")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["model"]["version"] == "0.0.0-mock"
    assert "MOCK_INFERENCE_NO_IMAGE_ANALYSIS" in payload["image_quality"]["warnings"]


def test_cash_session_lifecycle_and_deterministic_total() -> None:
    headers = _auth_headers("session_tester")
    session_res = client.post("/api/v1/cash/sessions", headers=headers, json={"currency": "NGN"})
    assert session_res.status_code == 201
    session = session_res.json()
    session_id = session["id"]
    assert session["confirmed_total_ngn"] == 0

    # Confirmed entry adds 500
    r1 = client.post(
        f"/api/v1/cash/sessions/{session_id}/entries",
        headers=headers,
        json={
            "predicted_denomination": 500,
            "confirmed_denomination": 500,
            "confidence": 0.5,
            "confirmation_status": "confirmed",
        },
    )
    assert r1.status_code == 201
    entry1_id = r1.json()["id"]

    # Corrected entry adds 1000
    r2 = client.post(
        f"/api/v1/cash/sessions/{session_id}/entries",
        headers=headers,
        json={
            "predicted_denomination": 500,
            "confirmed_denomination": 1000,
            "confidence": 0.5,
            "confirmation_status": "corrected",
        },
    )
    assert r2.status_code == 201

    # Rejected entry does NOT add to total
    r3 = client.post(
        f"/api/v1/cash/sessions/{session_id}/entries",
        headers=headers,
        json={
            "predicted_denomination": 500,
            "confirmed_denomination": None,
            "confidence": 0.5,
            "confirmation_status": "rejected",
        },
    )
    assert r3.status_code == 201

    fetched = client.get(f"/api/v1/cash/sessions/{session_id}", headers=headers)
    assert fetched.status_code == 200
    data = fetched.json()
    assert data["confirmed_total_ngn"] == 1500
    assert data["confirmed_count"] == 2
    assert len(data["entries"]) == 3

    # Delete first entry -> total becomes 1000
    del_res = client.delete(f"/api/v1/cash/entries/{entry1_id}", headers=headers)
    assert del_res.status_code == 204
    fetched_after = client.get(f"/api/v1/cash/sessions/{session_id}", headers=headers).json()
    assert fetched_after["confirmed_total_ngn"] == 1000
    assert fetched_after["confirmed_count"] == 1


def test_cash_entry_rejects_invalid_denomination() -> None:
    headers = _auth_headers("denom_tester")
    session_id = client.post("/api/v1/cash/sessions", headers=headers).json()["id"]
    bad = client.post(
        f"/api/v1/cash/sessions/{session_id}/entries",
        headers=headers,
        json={
            "confirmed_denomination": 750,
            "confirmation_status": "confirmed",
        },
    )
    assert bad.status_code == 422


def test_parse_vision_payload_accepts_valid_and_abstains_on_invalid() -> None:
    from app.services.banknote_classifier import parse_vision_payload

    valid = parse_vision_payload(
        {"denomination_ngn": 1000, "confidence": 0.92, "accepted": True, "warnings": []},
        model_name="gemini-2.5-flash",
        model_version="gemini-vision-v1",
    )
    assert valid.prediction.denomination_ngn == 1000
    assert valid.image_quality.accepted is True
    assert valid.decision.confidence_band == "high"
    assert valid.decision.requires_user_confirmation is True

    uncertain = parse_vision_payload(
        {"denomination_ngn": None, "confidence": 0.2, "accepted": True, "warnings": ["BLURRY"]},
        model_name="gemini-2.5-flash",
        model_version="gemini-vision-v1",
    )
    assert uncertain.image_quality.accepted is False
    assert uncertain.decision.confidence_band == "abstain"
    assert "UNCERTAIN_OR_NO_NAIRA_NOTE" in uncertain.image_quality.warnings
