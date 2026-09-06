import sys
import unittest
import hashlib
import io
import json
import tempfile
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from booru_lookup import source_identity, source_query, classify, source_identities, artist_identity, author_profiles, resolve_image, main


class BooruLookupTest(unittest.TestCase):
    def test_profile_fallback_uses_post_url_not_display_name(self):
        self.assertEqual(author_profiles({'sourceUrl': 'https://x.com/Artist/status/123'}), ['https://x.com/Artist'])
        self.assertEqual(author_profiles({'sourceUrl': 'https://x.com/i/web/status/123'}), [])
        self.assertEqual(author_profiles({'sourceUrl': 'https://www.pixiv.net/artworks/123'}), [])

    def test_resume_after_rate_limit_preserves_receipts_without_replaying_finished_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = []
            for i in range(2):
                data = bytes([i])
                (root / str(i)).write_bytes(data)
                images.append({'file': str(i), 'sha256': hashlib.sha256(data).hexdigest()})
            (root / 'images.json').write_text(json.dumps(images))
            (root / 'sources.json').write_text('[]')
            output = root / 'receipt.json'
            argv = ['booru_lookup', '--images', str(root / 'images.json'), '--sources', str(root / 'sources.json'), '--output', str(output)]
            calls = []
            class Opener:
                def open(self, request, **kwargs):
                    calls.append(request.full_url)
                    if len(calls) == 2:
                        raise HTTPError(request.full_url, 429, 'Rate limited', {}, None)
                    md5 = parse_qs(urlparse(request.full_url).query)['tags'][0][4:]
                    return io.BytesIO(json.dumps([{'id': len(calls), 'md5': md5}]).encode())
            with patch('booru_lookup.build_opener', return_value=Opener()), patch('booru_lookup.time.sleep'), patch('sys.stdout', new_callable=io.StringIO):
                with patch.object(sys, 'argv', argv), self.assertRaises(SystemExit):
                    main()
                self.assertEqual(len(json.loads(output.read_text())['images']), 2)
                with patch.object(sys, 'argv', [*argv, '--resume']):
                    main()
            receipt = json.loads(output.read_text())
            self.assertEqual(receipt['summary']['md5_match'], 2)
            self.assertEqual(len(receipt['previousErrors']), 1)
            self.assertEqual(len(calls), 3)

    def test_mirrored_pixiv_source_confirms_only_the_matching_image(self):
        md5 = 'a' * 32
        identities = source_identities({'sourceUrl': 'https://x.com/artist/status/123', 'sourceUrls': ['https://www.pixiv.net/artworks/456', 'https://twitter.com/artist/status/123']})
        queries = []
        def posts(query):
            queries.append(query)
            return [{'id': 1, 'md5': md5, 'pixiv_id': 456, 'source': 'https://www.pixiv.net/artworks/456', 'tag_string_general': 'blue_hair looking_back'}] if query == 'pixiv:456' else []
        result = resolve_image(md5, identities, [], posts, lambda _: [])
        self.assertEqual(len(identities), 2)
        self.assertEqual(result['state'], 'md5_match')
        self.assertEqual(result['communityTags'][0]['tags']['general'], ['blue_hair', 'looking_back'])
        self.assertEqual(result['verifiedMirrorSources'], ['https://www.pixiv.net/artworks/456'])
        self.assertIn('pixiv:456', queries)

    def test_artist_profiles_discover_candidates_without_transferring_tags(self):
        md5 = 'a' * 32
        queries = []
        def posts(query):
            queries.append(query)
            return [{'id': 2, 'md5': 'b' * 32, 'pixiv_id': 789, 'tag_string_general': 'red_hair'}] if query == 'artist_name' else []
        artists = lambda _: [{'id': 8, 'name': 'artist_name', 'urls': [{'url': 'https://twitter.com/Artist'}, {'url': 'https://www.pixiv.net/users/12'}]}]
        result = resolve_image(md5, [('twitter', '123')], ['https://x.com/artist'], posts, artists)
        self.assertEqual(result['state'], 'artist_candidate')
        self.assertEqual(result['communityTags'], [])
        self.assertEqual(result['verifiedMirrorSources'], [])
        self.assertEqual(len(result['artistProfiles']), 2)
        self.assertIn('artist_name', queries)

    def test_profile_name_alone_is_not_identity_and_old_candidates_survive(self):
        queries = []
        def posts(query):
            queries.append(query)
            return [{'id': 3, 'source': 'https://x.com/a/status/123', 'md5': 'b' * 32}] if query == 'source:*/status/123*' else []
        result = resolve_image('a' * 32, [('twitter', '123'), ('pixiv', '456')], ['https://x.com/artist'], posts,
                               lambda _: [{'id': 1, 'name': 'artist', 'urls': [{'url': 'https://x.com/someone_else'}]}])
        self.assertEqual(result['state'], 'source_candidate')
        self.assertEqual(result['communityTags'], [])
        self.assertNotIn('artist', queries)
        self.assertIsNone(artist_identity('https://x.com.example.org/artist'))
        self.assertIsNone(artist_identity('https://x.com/artist/status/123'))
        self.assertEqual(classify([{'id': 1}], None, None), ('no_match', []))

    def test_errors_keep_partial_evidence_for_receipts(self):
        trace = []
        def fail(query):
            if query.startswith('md5:'):
                return []
            raise TimeoutError()
        with self.assertRaises(TimeoutError):
            resolve_image('a' * 32, [('pixiv', '456')], [], fail, lambda _: [], trace)
        self.assertEqual(len(trace), 2)
        self.assertEqual(trace[-1]['error'], 'TimeoutError')

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
