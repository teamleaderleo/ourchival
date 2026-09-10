#!/usr/bin/env python3
"""Cheap login/interval check before the existing durable backup pipeline."""
import json
import math
from pathlib import Path
import subprocess
import sys
import time

INTERVAL = 6 * 60 * 60
ROOT = Path(__file__).resolve().parents[1]

def backup_due(state_dir, now):
    if (state_dir / "pending.json").exists():
        return True
    try:
        last = float(json.loads((state_dir / "state.json").read_text())["lastVerifiedAt"])
        return not math.isfinite(last) or last > now or now - last >= INTERVAL
    except (OSError, ValueError, TypeError, KeyError):
        return True

if __name__ == "__main__":
    if backup_due(ROOT / ".convex/drive-backup", time.time()):
        sys.exit(subprocess.call([sys.executable, str(ROOT / "scripts/vault_backup.py")], cwd=ROOT))
    print("Backup is current; skipped full export.")
