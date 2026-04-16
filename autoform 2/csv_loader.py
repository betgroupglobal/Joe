"""
autoform/csv_loader.py
Loads and validates user-data CSV files.
"""
import csv
import logging
from pathlib import Path
from schema import RECOMMENDED_COLUMNS

log = logging.getLogger(__name__)


def load_csv(path: str) -> list[dict]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"CSV not found: {path}")
    with open(p, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    if not rows:
        raise ValueError("CSV file is empty.")
    present = set(rows[0].keys())
    missing = [c for c in RECOMMENDED_COLUMNS if c not in present]
    if missing:
        log.warning("CSV is missing recommended columns: %s", missing)
    log.info("Loaded %d rows from %s", len(rows), path)
    return rows


def validate_row(row: dict) -> bool:
    if not row.get("email", "").strip():
        log.error("Row missing email: %s", row)
        return False
    return True