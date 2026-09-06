import base64
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from measure_export_tag_storage import measure
from tag_codec import encode


class ExportStorageTests(unittest.TestCase):
    def test_mixed_versions_and_inline_are_counted_without_emitting_private_text(self):
        old = encode([(1, -0.0), (129, .35000000000000003)], 1)
        current = encode([(1, .5)])
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'metadata.zip'
            rows = [{'tagPayload': {'$bytes': base64.b64encode(p).decode()}}
                    for p in [old, current]] + [{'tags': [{'name': 'private-title'}]}]
            with ZipFile(path, 'w') as z:
                z.writestr('visualEnrichments/documents.jsonl', '\n'.join(map(json.dumps, rows)))
            r = measure(path)
        self.assertEqual(r['results'], 3)
        self.assertEqual(r['inlineResults'], 1)
        self.assertEqual(r['versions'], {'1': 1, '2': 1})
        self.assertEqual(r['beforePayloadBytes'], len(old) + len(current))
        self.assertEqual(r['savedBytes'], 5)
        self.assertNotIn('private-title', json.dumps(r))

    def test_invalid_payload_aborts_instead_of_claiming_savings(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'metadata.zip'
            with ZipFile(path, 'w') as z:
                z.writestr('visualEnrichments/documents.jsonl', json.dumps({'tagPayload': {'$bytes': 'broken'}}))
            with self.assertRaises(ValueError):
                measure(path)
