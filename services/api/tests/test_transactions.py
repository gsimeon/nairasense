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


def test_transaction_crud_lifecycle() -> None:
    create_res = client.post(
        "/api/v1/transactions",
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

    list_res = client.get("/api/v1/transactions")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    patch_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        json={"reported_status": "Verified by user", "amount_kobo": 550000},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["amount_kobo"] == 550000
    assert patch_res.json()["reported_status"] == "Verified by user"

    del_res = client.delete(f"/api/v1/transactions/{tx_id}")
    assert del_res.status_code == 204
    assert client.get("/api/v1/transactions").json() == []
