import base64
import json
import urllib.error
import urllib.request
from typing import Any
from uuid import uuid4

from app.db import VALID_DENOMINATIONS
from app.schemas.cash import CashInferenceResponse
from app.services.local_vision import classify_banknote_offline
from app.settings import settings


def _confidence_band(confidence: float, accepted: bool) -> str:
    if not accepted:
        return "abstain"
    if confidence >= 0.85:
        return "high"
    if confidence >= 0.60:
        return "medium"
    return "low"


def _mock_response() -> CashInferenceResponse:
    return CashInferenceResponse(
        inference_id=str(uuid4()),
        prediction={"denomination_ngn": 500, "confidence": 0.50},
        image_quality={"accepted": True, "warnings": ["MOCK_INFERENCE_NO_IMAGE_ANALYSIS"]},
        decision={"requires_user_confirmation": True, "confidence_band": "unvalidated"},
        model={"name": "mock-naira-classifier", "version": "0.0.0-mock"},
    )


def _call_gemini_vision(image_bytes: bytes, content_type: str) -> dict[str, Any]:
    api_key = settings.gemini_api_key
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.gemini_model}:generateContent?key={api_key}"
    )
    prompt = (
        "You are an assistive Nigerian Naira banknote denomination reader for blind and low-vision users. "
        "Inspect the image and identify the single Nigerian Naira banknote denomination. "
        "Valid denominations are ONLY: 5, 10, 20, 50, 100, 200, 500, 1000. "
        "Never claim counterfeit authenticity. If the image is too blurry, too dark, obstructed, "
        "or does not clearly show a Nigerian Naira note, set accepted=false and denomination_ngn=null. "
        "Return ONLY valid JSON matching this schema: "
        '{"denomination_ngn": number|null, "confidence": number (0..1), '
        '"accepted": boolean, "warnings": string[]}.'
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": content_type,
                            "data": base64.b64encode(image_bytes).decode("ascii"),
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    text = body["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def parse_vision_payload(raw: dict[str, Any], model_name: str, model_version: str) -> CashInferenceResponse:
    denom = raw.get("denomination_ngn")
    confidence = float(raw.get("confidence") or 0.0)
    confidence = max(0.0, min(1.0, confidence))
    warnings = [str(w) for w in (raw.get("warnings") or [])]
    accepted = bool(raw.get("accepted", False))

    if denom not in VALID_DENOMINATIONS:
        accepted = False
        denom_int = 0
        if "UNCERTAIN_OR_NO_NAIRA_NOTE" not in warnings:
            warnings.append("UNCERTAIN_OR_NO_NAIRA_NOTE")
    else:
        denom_int = int(denom)

    return CashInferenceResponse(
        inference_id=str(uuid4()),
        prediction={"denomination_ngn": denom_int, "confidence": confidence},
        image_quality={"accepted": accepted, "warnings": warnings},
        decision={
            "requires_user_confirmation": True,
            "confidence_band": _confidence_band(confidence, accepted),
        },
        model={"name": model_name, "version": model_version},
    )


def classify_banknote(image_bytes: bytes, content_type: str) -> CashInferenceResponse:
    provider = settings.vision_provider.lower()
    if provider == "mock":
        return _mock_response()

    if provider == "gemini" and settings.gemini_api_key:
        try:
            raw = _call_gemini_vision(image_bytes, content_type)
            return parse_vision_payload(raw, model_name=settings.gemini_model, model_version="gemini-vision-v1")
        except (urllib.error.URLError, KeyError, IndexError, ValueError, json.JSONDecodeError, RuntimeError):
            pass

    # Default: 100% offline local pixel-based classifier (no API key required)
    return classify_banknote_offline(image_bytes)
