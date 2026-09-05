import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from booru_lookup import source_identity, source_query, classify


class BooruLookupTest(unittest.TestCase):
    def test_public_source_normalization(self):
        self.assertEqual(source_identity('https://x.com/artist/status/123/photo/2'), ('twitter', '123'))
        self.assertEqual(source_identity('https://twitter.com/other/status/123?s=20'), ('twitter', '123'))
        self.assertEqual(source_identity('https://www.pixiv.net/en/artworks/456'), ('pixiv', '456'))
        self.assertEqual(source_identity('https://www.pixiv.net/member_illust.php?mode=medium&illust_id=456'), ('pixiv', '456'))
        self.assertIsNone(source_identity('https://x.com.example.org/artist/status/123'))
        self.assertIsNone(source_identity('https://user:secret@x.com/artist/status/123'))

    def test_source_match_does_not_establish_image_identity(self):
        posts = [{'id': 1, 'md5': 'different', 'source': 'https://twitter.com/a/status/123'}]
        self.assertEqual(classify(posts, 'hash', ('twitter', '123'))[0], 'source_candidate')
        self.assertEqual(classify(posts, 'hash', ('twitter', '12'))[0], 'no_match')
        self.assertEqual(classify(posts, 'different', ('twitter', '999'))[0], 'md5_match')

    def test_multiple_images_and_pixiv_page_candidates(self):
        posts = [{'id': 1, 'md5': 'a', 'pixiv_id': 456}, {'id': 2, 'md5': 'b', 'pixiv_id': 456}]
        state, candidates = classify(posts, 'c', ('pixiv', '456'))
        self.assertEqual(state, 'source_candidate')
        self.assertEqual(len(candidates), 2)
        self.assertEqual(source_query(('pixiv', '456')), 'pixiv:456')


if __name__ == '__main__':
    unittest.main()
