import struct
import unittest
import json
from pathlib import Path
from tag_codec import encode, decode


class TagCodecTests(unittest.TestCase):
    def test_shared_wire_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / 'fixtures/tag-codec.json').read_text())
        for fixture in fixtures:
            entries = [tuple(e) for e in fixture['entries']]
            for version in (1, 2):
                wire = bytes.fromhex(fixture[f'v{version}'])
                self.assertEqual(encode(entries, version), wire)
                self.assertEqual(decode(wire), entries)

    def test_delta_validation_and_adaptive_size(self):
        header = '4f54470200000001'
        score = '3fe0000000000000'
        for delta in ['00', '8100', '808080808000', 'ffffffff10', '80']:
            with self.assertRaises(ValueError):
                decode(bytes.fromhex(header + delta + score))
        for stride in [1, 127, 128, 16383, 16384, 2**20, 2**28]:
            entries = [(stride * (i+1), .35000000000000003) for i in range(min(100, 0xffffffff // stride))]
            packed = encode(entries)
            self.assertLessEqual(len(packed), len(encode(entries, 1)))
            self.assertEqual(decode(packed), entries)
        self.assertEqual(encode([(0xffffffff, .5)])[3], 1)
        self.assertEqual(encode([(1, -0.0)], 2)[-8:], struct.pack('>d', -0.0))

    def test_round_trip_boundaries_and_full_precision(self):
        entries = [(0xffffffff, .35000000000000003), (1, 0), (2, 1)]
        self.assertEqual(decode(encode(entries)), sorted(entries))
        self.assertEqual(len(encode(entries, version=1)), 44)
        self.assertEqual(len(encode(entries)), 39)
        self.assertEqual(decode(encode([])), [])

    def test_rejects_ambiguous_or_invalid_values(self):
        for entries in [[(1, .5), (1, .4)], [(0, .5)], [(2**32, .5)], [(True, .5)],
                        [(1, float('nan'))], [(1, 1.1)], [(1, True)]]:
            with self.assertRaises(ValueError):
                encode(entries)

    def test_rejects_unknown_versions_truncation_and_unsorted_data(self):
        valid = encode([(1, .3), (2, .4)], version=1)
        for payload in [valid[:-1], valid+b'x', b'OTG\x03'+valid[4:],
                        valid[:8]+valid[20:]+valid[8:20], b'OTG\x01'+struct.pack('>I', 5000)]:
            with self.assertRaises(ValueError):
                decode(payload)
