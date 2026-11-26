from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register_headers(username: str, password: str = "securepass123") -> dict[str, str]:
    res = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password},
    )
    assert res.status_code == 201
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_unauthenticated_requests_are_rejected() -> None:
    assert client.post("/api/v1/cash/sessions").status_code == 401
    assert client.get("/api/v1/transactions").status_code == 401
    assert client.get("/api/v1/preferences").status_code == 401


def test_spoofed_image_magic_bytes_rejected() -> None:
    res = client.post(
        "/api/v1/cash/infer",
        files={"image": ("evil.jpg", b"<html>not a real jpeg</html>", "image/jpeg")},
    )
    assert res.status_code == 415


def test_cross_user_isolation_cash_and_transactions() -> None:
    headers_a = _register_headers("alice_ng")
    headers_b = _register_headers("bob_ng")

    # Bob creates a cash session and entry
    b_session = client.post("/api/v1/cash/sessions", headers=headers_b).json()["id"]
    b_entry = client.post(
        f"/api/v1/cash/sessions/{b_session}/entries",
        headers=headers_b,
        json={"confirmed_denomination": 500, "confirmation_status": "confirmed"},
    ).json()["id"]

    # Bob creates a transaction
    b_tx = client.post(
        "/api/v1/transactions",
        headers=headers_b,
        json={"amount_kobo": 100000, "currency": "NGN", "source_type": "pasted_text"},
    ).json()["id"]

    # Alice cannot read or modify Bob's cash session or entry
    assert client.get(f"/api/v1/cash/sessions/{b_session}", headers=headers_a).status_code == 404
    assert (
        client.post(
            f"/api/v1/cash/sessions/{b_session}/entries",
            headers=headers_a,
            json={"confirmed_denomination": 1000, "confirmation_status": "confirmed"},
        ).status_code
        == 404
    )
    assert client.delete(f"/api/v1/cash/entries/{b_entry}", headers=headers_a).status_code == 404

    # Alice's transaction list is empty and she cannot patch/delete Bob's transaction
    assert client.get("/api/v1/transactions", headers=headers_a).json() == []
    assert (
        client.patch(
            f"/api/v1/transactions/{b_tx}",
            headers=headers_a,
            json={"reported_status": "Hacked"},
        ).status_code
        == 404
    )
    assert client.delete(f"/api/v1/transactions/{b_tx}", headers=headers_a).status_code == 404
