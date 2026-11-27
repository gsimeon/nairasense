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
    assert data["reported_status"] == "Successful"
    assert data["extracted_fields"]["transaction_direction"] == "Credit"
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
        assert data["extracted_fields"]["transaction_direction"] == expected["transaction_direction"], case["name"]
        assert data["sender_label"] == expected["sender_label"], case["name"]
        assert data["recipient_label"] == expected["recipient_label"], case["name"]
        assert data["transaction_date"] == expected["transaction_date"], case["name"]
        assert data["reference"] == expected["reference"], case["name"]
        assert data["extracted_fields"]["multiple_amounts_detected"] is expected["multiple_amounts_detected"], case["name"]
        assert data["extracted_fields"]["ambiguous_status_detected"] is expected["ambiguous_status_detected"], case["name"]


def test_direction_does_not_override_outcome() -> None:
    cases = [
        ("Your account has been debited NGN 5,000. Transaction successful.", "Debit", "Successful"),
        ("Your account has been credited NGN 10,000. Transaction successful.", "Credit", "Successful"),
        ("Failed debit of NGN 2,500.", "Debit", "Failed"),
        ("Debit of NGN 3,000 was reversed.", "Debit", "Reversed"),
        ("Debit NGN 1,000 successful, later reversed.", "Debit", "Ambiguous (Review Required)"),
        ("Transaction was not successful. NGN 5,000.", None, "Failed"),
        ("Debit of NGN 2,000 was unsuccessful.", "Debit", "Failed"),
        ("Reversal request pending for NGN 3,500.", None, "Ambiguous (Review Required)"),
        ("Debit NGN 4,000 successful, but refund pending.", "Debit", "Ambiguous (Review Required)"),
        ("The transaction was not reversed. NGN 5,000.", None, None),
        ("Debit NGN 5,000 failed; not reversed.", "Debit", "Failed"),
        ("Reversal failed for NGN 2,500.", None, "Ambiguous (Review Required)"),
        ("Refund pending for NGN 1,200.", None, "Pending"),
        ("Refund completed for NGN 1,500.", None, "Successful"),
        ("Reversal not successful for NGN 2,000.", None, "Ambiguous (Review Required)"),
        ("Debit NGN 5,000 successful, but reversal pending.", "Debit", "Ambiguous (Review Required)"),
        ("Transaction failed for NGN 3,200, but account was debited.", "Debit", "Failed"),
    ]
    for raw_text, expected_direction, expected_outcome in cases:
        res = client.post(
            "/api/v1/transactions/extract",
            json={"raw_text": raw_text, "source_type": "notification"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["extracted_fields"]["transaction_direction"] == expected_direction, raw_text
        assert body["reported_status"] == expected_outcome, raw_text


def test_ambiguous_date_and_amount_context_labels() -> None:
    amb = client.post(
        "/api/v1/transactions/extract",
        json={"raw_text": "Debit NGN 5,000.00. Date: 03/04/2026. Successful.", "source_type": "notification"},
    )
    assert amb.status_code == 200
    assert amb.json()["extracted_fields"]["ambiguous_date_detected"] is True

    unamb = client.post(
        "/api/v1/transactions/extract",
        json={
            "raw_text": "Debit NGN 5,000.00. Fee: NGN 50.00. Avail Bal: NGN 25,000.00. Date: 26/11/2026.",
            "source_type": "notification",
        },
    )
    assert unamb.status_code == 200
    fields = unamb.json()["extracted_fields"]
    assert fields["ambiguous_date_detected"] is False
    assert fields["amount_contexts"] == {
        "5000.00": "Amount",
        "50.00": "Fee",
        "25000.00": "Available Balance",
    }

    bal_only = client.post(
        "/api/v1/transactions/extract",
        json={"raw_text": "Available Balance: NGN 25,000.00.", "source_type": "notification"},
    )
    assert bal_only.status_code == 200
    assert bal_only.json()["amount_kobo"] is None
    bal_fields = bal_only.json()["extracted_fields"]
    assert bal_fields["amount_requires_confirmation"] is True
    assert bal_fields["labeled_amounts"] == [
        {"id": "cand-1", "amount_ngn": "25000.00", "context": "Available Balance"}
    ]

    repeated = client.post(
        "/api/v1/transactions/extract",
        json={"raw_text": "Debit NGN 500.00. Fee: NGN 500.00.", "source_type": "notification"},
    )
    assert repeated.status_code == 200
    assert repeated.json()["amount_kobo"] is None
    rep_fields = repeated.json()["extracted_fields"]
    assert rep_fields["multiple_amounts_detected"] is True
    assert rep_fields["amount_requires_confirmation"] is True
    assert rep_fields["labeled_amounts"] == [
        {"id": "cand-1", "amount_ngn": "500.00", "context": "Amount"},
        {"id": "cand-2", "amount_ngn": "500.00", "context": "Fee"},
    ]


def test_ambiguous_date_requires_confirmation_on_create() -> None:
    reg = client.post(
        "/api/v1/auth/register",
        json={"username": "amb_date_tester", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    bad_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 500000,
            "currency": "NGN",
            "transaction_date": "03/04/2026",
            "source_type": "notification",
            "extracted_fields": {"ambiguous_date_detected": True},
            "user_confirmed": True,
        },
    )
    assert bad_res.status_code == 422

    ok_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 500000,
            "currency": "NGN",
            "transaction_date": "03/04/2026",
            "source_type": "notification",
            "extracted_fields": {"ambiguous_date_detected": True, "date_confirmed_by_user": True},
            "user_confirmed": True,
        },
    )
    assert ok_res.status_code == 201
    assert ok_res.json()["extracted_fields"]["amount_entry_mode"] == "manual"

    # Impossible calendar date rejected server-side
    invalid_date_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 500000,
            "currency": "NGN",
            "transaction_date": "31/02/2026",
            "source_type": "notification",
            "user_confirmed": True,
        },
    )
    assert invalid_date_res.status_code == 422

    # Candidate ID/amount mismatch rejected server-side
    mismatch_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 500000,
            "currency": "NGN",
            "source_type": "notification",
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Fee"}],
                "selected_candidate_id": "cand-1",
                "selected_candidate_context": "Fee",
            },
            "user_confirmed": True,
        },
    )
    assert mismatch_res.status_code == 422

    # Fabricated candidate ID rejected server-side
    fabricated_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 50000,
            "currency": "NGN",
            "source_type": "notification",
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Fee"}],
                "selected_candidate_id": "cand-999",
            },
            "user_confirmed": True,
        },
    )
    assert fabricated_res.status_code == 422

    # Candidate context mismatch rejected server-side
    ctx_mismatch_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 50000,
            "currency": "NGN",
            "source_type": "notification",
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Fee"}],
                "selected_candidate_id": "cand-1",
                "selected_candidate_context": "Amount",
            },
            "user_confirmed": True,
        },
    )
    assert ctx_mismatch_res.status_code == 422

    # Unknown amount and unknown date remain valid
    unknown_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={"amount_kobo": None, "transaction_date": None, "source_type": "notification"},
    )
    assert unknown_res.status_code == 201
    assert unknown_res.json()["extracted_fields"]["amount_entry_mode"] == "unknown"

    # Candidate selection without context is rejected
    no_ctx_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 50000,
            "currency": "NGN",
            "source_type": "notification",
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Fee"}],
                "selected_candidate_id": "cand-1",
            },
            "user_confirmed": True,
        },
    )
    assert no_ctx_res.status_code == 422

    # PATCH validation: create a valid candidate-selected record then test update paths
    valid_cand_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 50000,
            "currency": "NGN",
            "transaction_date": "26/11/2026",
            "source_type": "notification",
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Fee"}],
                "selected_candidate_id": "cand-1",
                "selected_candidate_context": "Fee",
            },
            "user_confirmed": True,
        },
    )
    assert valid_cand_res.status_code == 201
    tx_id = valid_cand_res.json()["id"]

    # PATCH with invalid calendar date is rejected
    patch_bad_date = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"transaction_date": "31/02/2026"},
    )
    assert patch_bad_date.status_code == 422

    # PATCH with ambiguous date without re-confirmation is rejected when user_confirmed=True
    patch_amb_date = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"transaction_date": "03/04/2026"},
    )
    assert patch_amb_date.status_code == 422

    # PATCH with mismatched candidate metadata is rejected
    patch_bad_cand = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={
            "amount_kobo": 99900,
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Fee"}],
                "selected_candidate_id": "cand-1",
                "selected_candidate_context": "Fee",
            },
        },
    )
    assert patch_bad_cand.status_code == 422

    # PATCH updating amount_kobo manually clears stale candidate link and records manual mode
    patch_manual_amt = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"amount_kobo": 75000},
    )
    assert patch_manual_amt.status_code == 200
    assert patch_manual_amt.json()["extracted_fields"]["selected_candidate_id"] is None
    assert patch_manual_amt.json()["extracted_fields"]["amount_entry_mode"] == "manual"


def test_transaction_partial_updates() -> None:
    reg = client.post(
        "/api/v1/auth/register",
        json={"username": "partial_upd_tester", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    create_res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={
            "amount_kobo": 50000,
            "currency": "NGN",
            "transaction_date": "03/04/2026",
            "source_type": "notification",
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "500.00", "context": "Amount"}],
                "selected_candidate_id": "cand-1",
                "selected_candidate_context": "Amount",
                "ambiguous_date_detected": True,
                "date_confirmed_by_user": True,
            },
            "user_confirmed": True,
        },
    )
    assert create_res.status_code == 201
    tx_id = create_res.json()["id"]

    # 1. Change date (ambiguous -> unambiguous) and amount together
    both_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"amount_kobo": 88000, "transaction_date": "26/11/2026"},
    )
    assert both_res.status_code == 200
    assert both_res.json()["amount_kobo"] == 88000
    assert both_res.json()["transaction_date"] == "26/11/2026"
    assert both_res.json()["extracted_fields"]["amount_entry_mode"] == "manual"
    assert both_res.json()["extracted_fields"]["selected_candidate_id"] is None
    assert both_res.json()["extracted_fields"]["ambiguous_date_detected"] is False
    assert both_res.json()["extracted_fields"]["date_confirmed_by_user"] is False

    # 1b. Change date (unambiguous -> ambiguous) without confirmation is rejected (422)
    unamb_to_amb = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"transaction_date": "04/03/2026"},
    )
    assert unamb_to_amb.status_code == 422

    # 1c. Change date and extracted_fields together in the same request (confirmed ambiguous date)
    date_and_fields = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={
            "transaction_date": "04/03/2026",
            "extracted_fields": {
                "ambiguous_date_detected": True,
                "date_confirmed_by_user": True,
            },
        },
    )
    assert date_and_fields.status_code == 200
    assert date_and_fields.json()["transaction_date"] == "04/03/2026"
    assert date_and_fields.json()["extracted_fields"]["ambiguous_date_detected"] is True
    assert date_and_fields.json()["extracted_fields"]["date_confirmed_by_user"] is True
    assert date_and_fields.json()["extracted_fields"]["amount_entry_mode"] == "manual"

    # 2. Change extracted_fields without changing amount_kobo (valid candidate match succeeds)
    fields_only_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={
            "extracted_fields": {
                "labeled_amounts": [{"id": "cand-1", "amount_ngn": "880.00", "context": "Amount"}],
                "selected_candidate_id": "cand-1",
                "selected_candidate_context": "Amount",
                "ambiguous_date_detected": True,
                "date_confirmed_by_user": True,
            }
        },
    )
    assert fields_only_res.status_code == 200
    assert fields_only_res.json()["extracted_fields"]["amount_entry_mode"] == "candidate_selected"

    # 3. Clear date to null -> server derives ambiguous_date_detected=False
    clear_date_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"transaction_date": None},
    )
    assert clear_date_res.status_code == 200
    assert clear_date_res.json()["transaction_date"] is None
    assert clear_date_res.json()["extracted_fields"]["ambiguous_date_detected"] is False

    # 3b. Restore date to ambiguous without confirmation -> server derives ambiguity and rejects (422)
    restore_amb_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={
            "transaction_date": "03/04/2026",
            "extracted_fields": {"ambiguous_date_detected": False},
        },
    )
    assert restore_amb_res.status_code == 422

    # 3c. Clear selected candidate via extracted_fields -> amount_entry_mode becomes manual
    # and orphaned selected_candidate_context is cleared
    clear_cand_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={
            "extracted_fields": {
                "selected_candidate_id": None,
                "selected_candidate_context": "Fee",
            }
        },
    )
    assert clear_cand_res.status_code == 200
    assert clear_cand_res.json()["extracted_fields"]["amount_entry_mode"] == "manual"
    assert clear_cand_res.json()["extracted_fields"]["selected_candidate_context"] is None
    assert clear_cand_res.json()["extracted_fields"]["last_confirmed_at"] is not None

    # 3d. Cross-user PATCH attempt is rejected (404)
    other_reg = client.post(
        "/api/v1/auth/register",
        json={"username": "partial_upd_intruder", "password": "password123"},
    )
    other_headers = {"Authorization": f"Bearer {other_reg.json()['access_token']}"}
    intruder_patch = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=other_headers,
        json={"amount_kobo": 100},
    )
    assert intruder_patch.status_code == 404

    # 4. Change previously confirmed record back to unconfirmed (even with an ambiguous date)
    unconfirm_res = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"transaction_date": "03/04/2026", "user_confirmed": False},
    )
    assert unconfirm_res.status_code == 200
    assert unconfirm_res.json()["user_confirmed"] is False
    assert unconfirm_res.json()["transaction_date"] == "03/04/2026"


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
        json={"reported_status": "Reversed", "amount_kobo": 550000, "user_confirmed": True},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["amount_kobo"] == 550000
    assert patch_res.json()["reported_status"] == "Reversed"
    assert patch_res.json()["user_confirmed"] is True

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

    # Keyset cursor pagination
    last = p1.json()[-1]
    cp2 = client.get(
        f"/api/v1/transactions?limit=3&cursor_created_at={last['created_at']}&cursor_id={last['id']}",
        headers=headers,
    )
    assert cp2.status_code == 200
    assert len(cp2.json()) == 2
    assert {t["id"] for t in p1.json()} | {t["id"] for t in cp2.json()} == {
        t["id"] for t in p1.json()
    } | {t["id"] for t in p2.json()}


def test_transaction_user_confirmed_defaults_false() -> None:
    reg = client.post(
        "/api/v1/auth/register",
        json={"username": "tx_confirm_default", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    res = client.post(
        "/api/v1/transactions",
        headers=headers,
        json={"amount_kobo": 150000, "currency": "NGN", "source_type": "pasted_text"},
    )
    assert res.status_code == 201
    assert res.json()["user_confirmed"] is False

    # Explicit confirmation via PATCH
    tx_id = res.json()["id"]
    patched = client.patch(
        f"/api/v1/transactions/{tx_id}",
        headers=headers,
        json={"user_confirmed": True},
    )
    assert patched.status_code == 200
    assert patched.json()["user_confirmed"] is True
