import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import vault_backup as backup


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def snapshot(self, name, files, title):
        path = self.root / name
        with zipfile.ZipFile(path, "w") as z:
            z.writestr("references/documents.jsonl", json.dumps({"title": title}))
            z.writestr("_storage/documents.jsonl", "metadata")
            for name, content in files.items():
                z.writestr("_storage/" + name, content)
        return path

    def test_export_cleanup_preserves_recent_files_live_storage_and_backup_parts(self):
        exports = self.root / ".convex/local/default/convex_local_storage/exports"
        exports.mkdir(parents=True)
        now = 100000
        for name, age in [("old.blob", 40000), ("keep1.blob", 30000), ("keep2.blob", 25000)]:
            path = exports / name
            path.write_bytes(b"snapshot")
            os.utime(path, (now - age, now - age))
        image = exports.parent / "files" / "image.blob"
        image.parent.mkdir()
        image.write_bytes(b"original")
        part = self.root / "backup.zip"
        part.write_bytes(b"incremental backup")
        (exports / "linked.blob").symlink_to(part)
        with patch.object(backup, "ROOT", self.root.resolve()), patch.object(backup.time, "time", return_value=now):
            backup.prune_local_exports()
            self.assertFalse((exports / "old.blob").exists())
            self.assertTrue((exports / "keep1.blob").exists())
            recent = exports / "recent.blob"
            recent.write_bytes(b"recent")
            os.utime(recent, (now - 60, now - 60))
            backup.prune_local_exports()
        self.assertTrue(recent.exists())
        self.assertTrue((exports / "keep2.blob").exists())
        self.assertEqual(image.read_bytes(), b"original")
        self.assertEqual(part.read_bytes(), b"incremental backup")
        self.assertTrue((exports / "linked.blob").is_symlink())

    def test_incremental_restore_preserves_all_files_and_latest_metadata(self):
        a = self.snapshot("a.zip", {"one.png": b"one"}, "before")
        first = self.root / "first.zip"
        storage, _ = backup.pack(a, first, {})
        previous = {"storage": storage, "parts": [{"sha256": backup.digest(first), "id": "first"}]}
        b = self.snapshot("b.zip", {"one.png": b"one", "two.jpg": b"two"}, "after")
        second = self.root / "second.zip"
        _, manifest = backup.pack(b, second, previous)
        self.assertEqual(manifest["newStorageFiles"], 1)
        with zipfile.ZipFile(second) as z:
            self.assertNotIn("_storage/one.png", z.namelist())
        restored = self.root / "restored.zip"
        backup.assemble([first, second], restored)
        with zipfile.ZipFile(restored) as z:
            self.assertEqual(z.read("_storage/one.png"), b"one")
            self.assertEqual(z.read("_storage/two.jpg"), b"two")
            self.assertEqual(json.loads(z.read("references/documents.jsonl"))["title"], "after")
            self.assertNotIn(backup.MANIFEST, z.namelist())
        with self.assertRaises(ValueError):
            backup.assemble([first, second], restored)
        with self.assertRaises(ValueError):
            backup.assemble([second], self.root / "missing.zip")
        first.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            backup.assemble([first, second], self.root / "corrupt.zip")

    def test_upload_reconciles_completed_object_without_uploading_again(self):
        path = self.root / "part.zip"
        path.write_bytes(b"payload")
        metadata = {"id": "file", "name": path.name, "size": "7", "md5Checksum": backup.digest(path, "md5")}
        with patch.object(backup, "drive_access", return_value=("fixture-token", "folder")), patch.object(backup, "request", side_effect=[
            (200, {}, json.dumps({"files": [metadata]}).encode()),
            (200, {}, json.dumps(metadata).encode()),
        ]) as request:
            result = backup.upload(path, {})
        self.assertEqual(result["id"], "file")
        self.assertEqual(request.call_count, 2)

    def test_restore_opens_each_backup_part_once_for_file_copying(self):
        source = self.snapshot("many.zip", {f"{i}.png": b"image" for i in range(100)}, "many")
        part = self.root / "part.zip"
        backup.pack(source, part, {})
        with patch.object(backup.zipfile, "ZipFile", wraps=zipfile.ZipFile) as opened:
            backup.assemble([part], self.root / "restored.zip")
        self.assertLessEqual(opened.call_count, 4)

    def test_upload_resumes_from_server_acknowledged_offset(self):
        path = self.root / "part.zip"
        path.write_bytes(b"payload")
        metadata = {"id": "file", "name": path.name, "size": "7", "md5Checksum": backup.digest(path, "md5")}
        pending = {"uploadUri": "https://www.googleapis.com/upload/fixture"}
        with patch.object(backup, "drive_access", return_value=("fixture-token", "folder")), patch.object(backup, "request", side_effect=[
            (200, {}, b'{"files":[]}'), (308, {"Range": "bytes=0-2"}, b""),
            (200, {}, json.dumps(metadata).encode()), (200, {}, json.dumps(metadata).encode()),
        ]) as request:
            backup.upload(path, pending)
        self.assertEqual(request.call_args_list[2].args[1], b"load")
        self.assertEqual(request.call_args_list[2].args[2]["Content-Range"], "bytes 3-6/7")

    def test_expired_session_is_cleared_for_the_next_bounded_retry(self):
        path = self.root / "part.zip"
        path.write_bytes(b"payload")
        pending = {"uploadUri": "https://www.googleapis.com/upload/fixture"}
        with patch.object(backup, "STATE", self.root), patch.object(backup, "drive_access", return_value=("fixture-token", "folder")), patch.object(backup, "request", side_effect=[
            (200, {}, b'{"files":[]}'), RuntimeError("Drive HTTP 404"),
        ]):
            with self.assertRaises(RuntimeError):
                backup.upload(path, pending)
        self.assertNotIn("uploadUri", pending)


if __name__ == "__main__":
    unittest.main()
