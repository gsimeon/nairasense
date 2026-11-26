from pathlib import Path

import pytest

from app.settings import settings


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = tmp_path / "test_nairasense.db"
    proto_file = tmp_path / "test_prototypes.json"
    monkeypatch.setattr(settings, "database_path", str(db_file))
    monkeypatch.setattr(settings, "enrolled_prototypes_path", str(proto_file))
