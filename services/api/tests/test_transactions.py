import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_extract_transaction_parses_naira_alert() -> None:
    res = client.post(
        "/api/v1/transactions/extract",
        json={
            "raw_text": (
                "Credit Alert! Amt: NGN 12,500.00. From: ADAOBI OKAFOR. "
                "To: CHIDI ENTERPRISE. Ref: TXN-994812. Date: 2026-11-26 14:22:00. Successful."
            ),
            "source_type": "notification",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["amount_kobo"] == 1250000
    assert data["reference"] == "TXN-994812"
    assert data["sender_label"] == "ADAOBI OKAFOR"
    assert data["recipient_label"] == "CHIDI ENTERPRISE"
    assert data["reported_status"] == "Credit"
    assert data["transaction_date"] == "2026-11-26 14:22:00"
    assert data["requires_user_confirmation"] is True


def test_extract_transaction_flags_multiple_amounts() -> None:
    res = client.post(
        "/api/v1/transactions/extract",
        json={
            "raw_text": "Debit NGN 5,000.00. Fee: NGN 50.00. Avail Bal: NGN 25,000.00. Successful.",
            "source_type": "notification",
        },
    )
    assert res.status_code == 200
    fields = res.json()["extracted_fields"]
    assert fields["multiple_amounts_detected"] is True
    assert fields["candidate_amounts_ngn"] == ["5000.00", "50.00", "25000.00"]


def test_nigerian_bank_message_fixtures() -> None:
    fixtures_path = Path(__file__).parent / "fixtures" / "transaction_messages" / "nigerian_alerts.json"
    cases = json.loads(fixtures_path.read_text(encoding="utf-8"))
    for case in cases:
        res = client.post(
            "/api/v1/transactions/extract",
            json={"raw_text": case["raw_text"], "source_type": case["source_type"]},
        )
        assert res.status_code == 200, case["name"]
        data = res.json()
        expected = case["expected"]
        assert data["amount_kobo"] == expected["amount_kobo"], case["name"]
        assert data["reported_status"] == expected["reported_status"], case["name"]
        assert data["reference"] == expected["reference"], case["name"]
        assert data["extracted_fields"]["multiple_amounts_detected"] is expected["multiple_amounts_detected"], case["name"]


def test_transaction_crud_lifecycle() -> None:
    reg = client.post(
        "/api/v1/auth/register",
        json={"username": "tx_tester", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    create_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 500000,
            "currency": "NGN",
            "reference": "REF-100",
            "sender_label": "Tunde",
            "recipient_label": "Ngozi",
            "reported_status": "Successful",
            "source_type": "pasted_text",
            "user_confirmed": True,
        },
    )
    assert create_res.status_code == 201
    tx_id = create_res.json()["id"]

    list_res = client.get("/api/v1/transactions", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"reported_status": "Verified by user", "amount_kobo": 550000},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["amount_kobo"] == 550000
    assert patch_res.json()["reported_status"] == "Verified by user"

    del_res = client.delete(f"/api/v1/transactions/{tx_id}", headers=headers)
    assert del_res.status_code == 204
    assert client.get("/api/v1/transactions", headers=headers).json() == []


def test_transactions_pagination() -> None:
    reg = client.post(
        "/api/v1/auth/register",
        json={"username": "tx_page_tester", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    for i in range(5):
        res = client.post(
            "/api/v1/transactions",
            headers=headers,
            json={"amount_kobo": (i + 1) * 1000, "currency": "NGN", "source_type": "pasted_text"},
        )
        assert res.status_code == 201

    p1 = client.get("/api/v1/transactions?limit=3&offset=0", headers=headers)
    assert p1.status_code == 200
    assert len(p1.json()) == 3
    assert p1.headers["x-total-count"] == "5"
    assert p1.headers["x-has-more"] == "true"

    p2 = client.get("/api/v1/transactions?limit=3&offset=3", headers=headers)
    assert p2.status_code == 200
    assert len(p2.json()) == 2
    assert p2.headers["x-has-more"] == "false"
