import io
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.db import VALID_DENOMINATIONS
from app.schemas.cash import CashInferenceResponse
from app.settings import settings

# Cap decoded image pixels to protect against decompression bombs (12 MP)
_MAX_IMAGE_PIXELS = 12_000_000
Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS

# Characteristic HSV hue centers (0..180 OpenCV-style scale mapped to 0..1) and saturation profiles
# for Nigerian Naira denominations. Used as a zero-shot prior before user webcam enrollment.
_NAIRA_PRIORS: dict[int, dict[str, float]] = {
    1000: {"hue": 0.74, "sat": 0.35, "val": 0.55},  # Purple / indigo-blue
    500: {"hue": 0.58, "sat": 0.42, "val": 0.62},   # Blue / cyan
    200: {"hue": 0.28, "sat": 0.38, "val": 0.65},   # Emerald green / yellow-green
    100: {"hue": 0.85, "sat": 0.28, "val": 0.58},   # Mauve / tan-purple
    50: {"hue": 0.52, "sat": 0.36, "val": 0.64},    # Teal / sky-blue
    20: {"hue": 0.35, "sat": 0.48, "val": 0.60},    # Leaf green
    10: {"hue": 0.97, "sat": 0.45, "val": 0.62},    # Crimson / red-brown
    5: {"hue": 0.88, "sat": 0.32, "val": 0.66},     # Rose / light purple
}


def _load_enrolled() -> dict[str, dict[str, list[list[float]]]]:
    path = Path(settings.enrolled_prototypes_path)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_enrolled(data: dict[str, dict[str, list[list[float]]]]) -> None:
    path = Path(settings.enrolled_prototypes_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def get_enrollment_counts(user_id: str) -> dict[int, int]:
    enrolled = _load_enrolled()
    user_samples = enrolled.get(user_id, {})
    return {denom: len(user_samples.get(str(denom), [])) for denom in VALID_DENOMINATIONS}


def extract_note_features(image_bytes: bytes) -> tuple[np.ndarray, dict[str, Any]]:
    """Decode image pixels safely, assess quality, and extract HSV + spatial features."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if (img.width * img.height) > _MAX_IMAGE_PIXELS:
            raise ValueError("IMAGE_DIMENSIONS_TOO_LARGE")
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ValueError("INVALID_IMAGE_BYTES") from exc

    # Resize for consistent, fast CPU feature extraction
    img_resized = img.resize((160, 120), Image.Resampling.BILINEAR)
    arr = np.asarray(img_resized, dtype=np.float32) / 255.0

    # Center-crop 70% to focus on the banknote and reduce background clutter
    h, w, _ = arr.shape
    y0, y1 = int(h * 0.15), int(h * 0.85)
    x0, x1 = int(w * 0.15), int(w * 0.85)
    center = arr[y0:y1, x0:x1]

    # Luminance & edge-detail quality metrics
    luma = 0.299 * center[:, :, 0] + 0.587 * center[:, :, 1] + 0.114 * center[:, :, 2]
    mean_luma = float(np.mean(luma) * 255.0)
    dx = np.abs(np.diff(luma, axis=1))
    dy = np.abs(np.diff(luma, axis=0))
    edge_score = float((np.mean(dx) + np.mean(dy)) * 255.0)

    warnings: list[str] = []
    accepted = True
    if mean_luma < 18.0:
        accepted = False
        warnings.append("TOO_DARK")
    elif mean_luma > 246.0:
        accepted = False
        warnings.append("OVEREXPOSED")
    if edge_score < 1.5:
        accepted = False
        warnings.append("LOW_DETAIL_OR_BLURRY")

    # Convert center crop to HSV via Pillow for fast, exact HSV channels
    hsv_img = img_resized.crop((x0, y0, x1, y1)).convert("HSV")
    hsv = np.asarray(hsv_img, dtype=np.float32) / 255.0
    hue = hsv[:, :, 0].ravel()
    sat = hsv[:, :, 1].ravel()
    val = hsv[:, :, 2].ravel()

    # Weight hue histogram by saturation so neutral gray/white background has minimal influence
    hue_hist, _ = np.histogram(hue, bins=18, range=(0.0, 1.0), weights=sat + 0.05)
    sat_hist, _ = np.histogram(sat, bins=8, range=(0.0, 1.0))
    val_hist, _ = np.histogram(val, bins=8, range=(0.0, 1.0))

    # 2x2 spatial mean RGB normalized
    mid_y, mid_x = center.shape[0] // 2, center.shape[1] // 2
    quads = [
        center[:mid_y, :mid_x].mean(axis=(0, 1)),
        center[:mid_y, mid_x:].mean(axis=(0, 1)),
        center[mid_y:, :mid_x].mean(axis=(0, 1)),
        center[mid_y:, mid_x:].mean(axis=(0, 1)),
    ]
    spatial = np.concatenate(quads)

    def _norm(v: np.ndarray) -> np.ndarray:
        s = float(np.linalg.norm(v))
        return v / s if s > 1e-8 else v

    feat = np.concatenate([_norm(hue_hist), _norm(sat_hist), _norm(val_hist), _norm(spatial)])
    feat = _norm(feat)

    # Dominant hue/sat/val among saturated pixels for zero-shot prior matching
    sat_mask = sat > 0.15
    if np.any(sat_mask):
        dom_hue = float(np.median(hue[sat_mask]))
        dom_sat = float(np.mean(sat[sat_mask]))
        dom_val = float(np.mean(val[sat_mask]))
    else:
        dom_hue = float(np.median(hue))
        dom_sat = float(np.mean(sat))
        dom_val = float(np.mean(val))

    meta = {
        "accepted": accepted,
        "warnings": warnings,
        "mean_luma": round(mean_luma, 1),
        "edge_score": round(edge_score, 2),
        "dom_hue": dom_hue,
        "dom_sat": dom_sat,
        "dom_val": dom_val,
    }
    return feat, meta


def enroll_note_sample(image_bytes: bytes, denomination_ngn: int, user_id: str) -> dict[str, Any]:
    """Enroll a Naira note image into a user-isolated offline reference bank."""
    if denomination_ngn not in VALID_DENOMINATIONS:
        raise ValueError("Invalid Naira denomination.")
    feat, meta = extract_note_features(image_bytes)
    if not meta["accepted"]:
        raise ValueError(f"Image rejected for enrollment: {', '.join(meta['warnings'])}")

    enrolled = _load_enrolled()
    user_samples = enrolled.setdefault(user_id, {})
    key = str(denomination_ngn)
    samples = user_samples.get(key, [])
    samples.append([round(float(x), 6) for x in feat.tolist()])
    # Keep up to 25 most recent samples per denomination per user
    user_samples[key] = samples[-25:]
    _save_enrolled(enrolled)

    return {
        "denomination_ngn": denomination_ngn,
        "sample_count": len(user_samples[key]),
        "quality": meta,
    }


def _prior_score(dom_hue: float, dom_sat: float, dom_val: float, denom: int) -> float:
    prior = _NAIRA_PRIORS[denom]
    # Circular hue distance on [0, 1)
    dh = abs(dom_hue - prior["hue"])
    dh = min(dh, 1.0 - dh)
    ds = abs(dom_sat - prior["sat"])
    dv = abs(dom_val - prior["val"])
    dist = (2.2 * dh) + (0.8 * ds) + (0.5 * dv)
    return max(0.0, 1.0 - dist)


def classify_banknote_offline(
    image_bytes: bytes,
    user_id: str | None = None,
) -> CashInferenceResponse:
    """100% offline pixel-based Naira denomination classifier using local HSV/spatial features."""
    try:
        feat, meta = extract_note_features(image_bytes)
    except ValueError:
        return CashInferenceResponse(
            inference_id=str(uuid4()),
            prediction={"denomination_ngn": 0, "confidence": 0.0},
            image_quality={"accepted": False, "warnings": ["INVALID_IMAGE_FILE"]},
            decision={"requires_user_confirmation": True, "confidence_band": "abstain"},
            model={"name": "local-naira-cv", "version": "0.1.0-offline"},
        )

    if not meta["accepted"]:
        return CashInferenceResponse(
            inference_id=str(uuid4()),
            prediction={"denomination_ngn": 0, "confidence": 0.0},
            image_quality={"accepted": False, "warnings": meta["warnings"]},
            decision={"requires_user_confirmation": True, "confidence_band": "abstain"},
            model={"name": "local-naira-cv", "version": "0.1.0-offline"},
        )

    all_enrolled = _load_enrolled()
    enrolled = all_enrolled.get(user_id, {}) if user_id else {}
    scores: dict[int, float] = {}
    has_enrolled = any(len(v) > 0 for v in enrolled.values())

    for denom in VALID_DENOMINATIONS:
        prior = _prior_score(meta["dom_hue"], meta["dom_sat"], meta["dom_val"], denom)
        samples = enrolled.get(str(denom), [])
        if samples:
            mat = np.asarray(samples, dtype=np.float32)
            sims = mat @ feat
            top_k = np.sort(sims)[-min(3, len(sims)):]
            enrolled_sim = float(np.mean(top_k))
            scores[denom] = (0.85 * enrolled_sim) + (0.15 * prior)
        else:
            scores[denom] = prior * (0.45 if has_enrolled else 0.72)

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_denom, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = max(0.0, best_score - second_score)

    confidence = round(min(0.98, max(0.25, (0.75 * best_score) + (0.8 * margin))), 2)
    warnings = list(meta["warnings"])
    if not enrolled.get(str(best_denom)):
        warnings.append("COLOR_PRIOR_ONLY_ENROLL_SAMPLES_FOR_HIGHER_ACCURACY")

    return CashInferenceResponse(
        inference_id=str(uuid4()),
        prediction={"denomination_ngn": best_denom, "confidence": confidence},
        image_quality={"accepted": True, "warnings": warnings},
        decision={"requires_user_confirmation": True, "confidence_band": "experimental"},
        model={"name": "local-naira-cv", "version": "0.1.0-offline"},
    )
