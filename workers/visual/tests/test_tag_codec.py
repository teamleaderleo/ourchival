import struct
import unittest
from tag_codec import encode, decode


class TagCodecTests(unittest.TestCase):
    def test_round_trip_boundaries_and_full_precision(self):
        entries = [(0xffffffff, .35000000000000003), (1, 0), (2, 1)]
        self.assertEqual(decode(encode(entries)), sorted(entries))
        self.assertEqual(len(encode(entries)), 44)
        self.assertEqual(decode(encode([])), [])

    def test_rejects_ambiguous_or_invalid_values(self):
        for entries in [[(1, .5), (1, .4)], [(0, .5)], [(2**32, .5)], [(True, .5)],
                        [(1, float('nan'))], [(1, 1.1)], [(1, True)]]:
            with self.assertRaises(ValueError):
                encode(entries)

    def test_rejects_unknown_versions_truncation_and_unsorted_data(self):
        valid = encode([(1, .3), (2, .4)])
        for payload in [valid[:-1], valid+b'x', b'OTG\x02'+valid[4:],
                        valid[:8]+valid[20:]+valid[8:20], b'OTG\x01'+struct.pack('>I', 5000)]:
            with self.assertRaises(ValueError):
                decode(payload)
