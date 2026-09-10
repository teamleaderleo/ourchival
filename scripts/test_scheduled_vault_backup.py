import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("scheduled_backup", Path(__file__).with_name("scheduled-vault-backup.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BackupScheduleTests(unittest.TestCase):
    def test_recent_backup_skips_but_overdue_missing_and_pending_run(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            self.assertTrue(module.backup_due(state, 100000))
            (state / "state.json").write_text(json.dumps({"lastVerifiedAt": 100000}))
            self.assertFalse(module.backup_due(state, 100001))
            self.assertTrue(module.backup_due(state, 100000 + module.INTERVAL))
            (state / "pending.json").write_text("{}")
            self.assertTrue(module.backup_due(state, 100001))

    def test_invalid_and_future_receipts_do_not_suppress_backups(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            for text in ["broken", "{}", '{"lastVerifiedAt": null}', '{"lastVerifiedAt": 999999}']:
                (state / "state.json").write_text(text)
                self.assertTrue(module.backup_due(state, 100000))
