"""Offline training & evaluation script for NairaSense local banknote classifier.

Usage:
    python ai/train_local_classifier.py --dataset-dir ai/data/images --out services/api/naira_enrolled_prototypes.json

Expected folder structure:
    ai/data/images/
        5/
        10/
        20/
        50/
        100/
        200/
        500/
        1000/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.db import VALID_DENOMINATIONS  # noqa: E402
from app.services.local_vision import extract_note_features  # noqa: E402


def load_dataset(dataset_dir: Path) -> tuple[list[np.ndarray], list[int]]:
    features: list[np.ndarray] = []
    labels: list[int] = []
    for denom in VALID_DENOMINATIONS:
        denom_dir = dataset_dir / str(denom)
        if not denom_dir.exists():
            continue
        for img_path in sorted(denom_dir.iterdir()):
            if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                continue
            try:
                feat, meta = extract_note_features(img_path.read_bytes())
                if meta["accepted"]:
                    features.append(feat)
                    labels.append(denom)
            except ValueError:
                continue
    return features, labels


def evaluate_leave_one_out(features: list[np.ndarray], labels: list[int]) -> dict[str, float]:
    if len(features) < 2:
        return {"accuracy": 0.0, "samples": float(len(features))}

    mat = np.stack(features)
    correct = 0
    for i in range(len(features)):
        sims = mat @ features[i]
        sims[i] = -1.0
        pred_idx = int(np.argmax(sims))
        if labels[pred_idx] == labels[i]:
            correct += 1

    return {"accuracy": round(correct / len(features), 4), "samples": float(len(features))}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train/evaluate NairaSense offline banknote prototypes.")
    parser.add_argument("--dataset-dir", type=Path, default=ROOT / "ai" / "data" / "images")
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "services" / "api" / "naira_enrolled_prototypes.json",
    )
    args = parser.parse_args()

    features, labels = load_dataset(args.dataset_dir)
    metrics = evaluate_leave_one_out(features, labels)
    print(f"Loaded {int(metrics['samples'])} accepted note images. Leave-one-out accuracy: {metrics['accuracy']:.2%}")

    grouped: dict[str, list[list[float]]] = {}
    for feat, label in zip(features, labels):
        grouped.setdefault(str(label), []).append([round(float(x), 6) for x in feat.tolist()])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(grouped), encoding="utf-8")
    print(f"Exported offline prototypes to {args.out}")


if __name__ == "__main__":
    main()
