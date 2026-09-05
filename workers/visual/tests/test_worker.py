"""Offline regression tests. Real model weights and a live Convex deployment are separate checks."""
from __future__ import annotations
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import sys
import numpy as np
from PIL import Image

SPEC = importlib.util.spec_from_file_location("ourchival_visual_worker", Path(__file__).parents[1] / "worker.py")
w = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(w)


def png(mode="RGB", size=(3, 2), color=(255, 0, 0)):
    output = io.BytesIO()
    Image.new(mode, size, color).save(output, format="PNG")
    return output.getvalue()


def item(name="a"):
    return {"assetId": name, "referenceId": "ref-" + name, "inputStorageId": "stored-" + name,
            "originalContentHash": None, "inputUrl": "https://archive.convex.cloud/api/storage/" + name,
            "title": "Reference " + name, "sourceUrl": "https://example.com/" + name,
            "completedPipeline": None, "expectedRevision": 0}


class ImageTests(unittest.TestCase):
    def test_decode_keeps_input_bytes(self):
        data = png()
        digest = hashlib.sha256(data).hexdigest()
        result = w.decode_image(data)
        self.assertEqual(result.size, (3, 2))
        self.assertEqual(result.mode, "RGB")
        self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
        result.close()

    def test_alpha_composites_on_white(self):
        image = w.decode_image(png("RGBA", (2, 2), (0, 0, 0, 0)))
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_orientation_is_applied_to_working_image(self):
        image = Image.new("RGB", (8, 4))
        exif = image.getexif()
        exif[274] = 6
        output = io.BytesIO()
        image.save(output, format="JPEG", exif=exif)
        self.assertEqual(w.decode_image(output.getvalue()).size, (4, 8))

    def test_empty_and_oversized_rejected(self):
        with self.assertRaises(ValueError):
            w.decode_image(b"")
        with patch.object(w, "MAX_IMAGE_BYTES", 8):
            with self.assertRaises(ValueError):
                w.decode_image(png())

    def test_pixel_limit(self):
        with patch.object(w, "MAX_IMAGE_PIXELS", 2):
            with self.assertRaises(ValueError):
                w.decode_image(png())

    def test_animation_rejected(self):
        output = io.BytesIO()
        Image.new("RGB", (2, 2), "red").save(output, format="GIF", save_all=True,
            append_images=[Image.new("RGB", (2, 2), "blue")], duration=100, loop=0)
        with self.assertRaises(ValueError):
            w.decode_image(output.getvalue())

    def test_wd_exact_bgr_nhwc(self):
        data = w.wd_input(Image.new("RGB", (2, 2), (255, 20, 7)), 2)
        self.assertEqual(data.shape, (1, 2, 2, 3))
        self.assertEqual(data.dtype, np.float32)
        np.testing.assert_array_equal(data[0, 0, 0], [7, 20, 255])
        self.assertTrue(data.flags.c_contiguous)

    def test_wd_white_padding(self):
        data = w.wd_input(Image.new("RGB", (4, 2), "black"), 4)
        np.testing.assert_array_equal(data[0, 0], np.full((4, 3), 255))
        np.testing.assert_array_equal(data[0, 1], np.zeros((4, 3)))

    def test_wd_invalid_size(self):
        with self.assertRaises(ValueError):
            w.wd_input(Image.new("RGB", (1, 1)), 0)


class IntegrityTests(unittest.TestCase):
    def test_digest_order_independent(self):
        self.assertEqual(w.stable_digest({"a": 1, "b": 2}), w.stable_digest({"b": 2, "a": 1}))

    def test_nonfinite_json_rejected(self):
        with self.assertRaises(ValueError):
            w.stable_digest({"x": float("nan")})

    def test_checked_artifact(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.onnx"
            path.write_bytes(b"fixture")
            spec = {"path": "model.onnx", "sha256": hashlib.sha256(b"fixture").hexdigest()}
            self.assertEqual(w.checked_file(spec, Path(folder)), path.resolve())
            path.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                w.checked_file(spec, Path(folder))

    def test_probability_bounds(self):
        for value in [0, 0.5, 1]:
            self.assertEqual(w.checked_probability(value), value)
        for value in [float("nan"), float("inf"), -0.01, 1.01]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                w.checked_probability(value)

    def test_unit_vectors(self):
        np.testing.assert_allclose(w.unit_vector([3, 4]), [.6, .8])
        for vector in [[0, 0], [float("nan")], [[1, 2]], [float("inf")]]:
            with self.subTest(vector=vector), self.assertRaises(ValueError):
                w.unit_vector(vector)

    def test_wd_categories_exclude_artist(self):
        tagger = w.WDTagger.__new__(w.WDTagger)
        tagger.labels = [
            {"name": "general", "category": "9"}, {"name": "blue_hair", "category": "0"},
            {"name": "character_a", "category": "4"}, {"name": "artist_claim", "category": "1"},
            {"name": "weak", "category": "0"},
        ]
        tagger.general, tagger.character, tagger.name, tagger.size = .35, .85, "input", 2
        tagger.session = types.SimpleNamespace(run=lambda *_: [np.array([[.2, .8, .9, .99, .1]])])
        tags, ratings = tagger.run(Image.new("RGB", (2, 2)))
        self.assertEqual([t["name"] for t in tags], ["character_a", "blue_hair"])
        self.assertEqual(ratings, [{"label": "general", "confidence": .2}])

    def test_wd_output_count_validated(self):
        tagger = w.WDTagger.__new__(w.WDTagger)
        tagger.labels, tagger.name, tagger.size = [], "input", 2
        tagger.session = types.SimpleNamespace(run=lambda *_: [np.array([[.8]])])
        with self.assertRaises(ValueError):
            tagger.run(Image.new("RGB", (2, 2)))


class NetworkTests(unittest.TestCase):
    def test_base_origin_restrictions(self):
        self.assertEqual(w.safe_base_url("https://archive.convex.cloud/"), "https://archive.convex.cloud")
        self.assertEqual(w.safe_base_url("http://localhost:3210"), "http://localhost:3210")
        for url in ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x=y", ""]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                w.safe_base_url(url)

    def test_unknown_image_host_rejected_before_io(self):
        client = w.ArchiveClient("https://archive.convex.cloud", "private-owner-token")
        with self.assertRaises(ValueError):
            client.image("https://third-party.invalid/image.jpg")

    def test_asset_requests_omit_owner_key(self):
        requests = []
        def open_request(request, timeout):
            requests.append(request)
            return io.BytesIO(png())
        client = w.ArchiveClient("https://archive.convex.cloud", "private-owner-token")
        client.opener = types.SimpleNamespace(open=open_request)
        client.image("https://archive.convex.cloud/api/storage/example")
        self.assertIsNone(requests[0].data)
        self.assertNotIn("private-owner-token", str(requests[0].header_items()))

    def test_function_request_uses_owner_argument(self):
        requests = []
        def open_request(request, timeout):
            requests.append(request)
            return io.BytesIO(b'{"status":"success","value":{"ready":true}}')
        client = w.ArchiveClient("https://archive.convex.cloud", "private-owner-token")
        client.opener = types.SimpleNamespace(open=open_request)
        self.assertEqual(client.call("query", "archiveSearch:status", {}), {"ready": True})
        body = json.loads(requests[0].data)
        self.assertEqual(body["args"]["accessKey"], "private-owner-token")
        self.assertEqual(requests[0].full_url, "https://archive.convex.cloud/api/query")
        self.assertIsNone(requests[0].get_header("Authorization"))

    def test_redirect_refused(self):
        with self.assertRaises(ValueError):
            w.NoRedirect().redirect_request(None, None, 307, "redirect", {}, "https://other.invalid")

    def test_server_error_is_redacted(self):
        client = w.ArchiveClient("https://archive.convex.cloud", "token")
        client.opener = types.SimpleNamespace(open=lambda *a, **k: io.BytesIO(b'{"status":"error","errorMessage":"private example"}'))
        with self.assertRaises(RuntimeError) as raised:
            client.call("query", "archiveSearch:status", {})
        self.assertNotIn("private example", str(raised.exception))


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = w.Cache(Path(self.temp.name) / "cache.sqlite")

    def tearDown(self):
        self.cache.close()
        self.temp.cleanup()

    def store(self, name, vector, fingerprint="emb-v1", generation="g1"):
        asset = item(name)
        key = self.cache.key(asset, "pipeline")
        self.cache.put(key, {"tags": []}, vector, fingerprint)
        self.cache.observe(asset, key, generation)
        return key

    def test_search_cosine_ranking(self):
        self.store("a", [1, 0])
        self.store("b", [0, 1])
        self.assertEqual(self.cache.search([1, 0], "emb-v1", 1)[0]["assetId"], "a")

    def test_embedding_versions_stay_separate(self):
        self.store("a", [1, 0], "emb-v1")
        self.assertEqual(self.cache.search([1, 0], "emb-v2", 20), [])

    def test_completed_scan_removes_deleted_items(self):
        self.store("old", [1, 0], generation="g0")
        self.store("current", [1, 0], generation="g1")
        self.cache.finish("g1")
        self.assertEqual([h["assetId"] for h in self.cache.search([1, 0], "emb-v1", 20)], ["current"])

    def test_partial_scan_keeps_previous_items(self):
        self.store("old", [1, 0], generation="g0")
        self.store("current", [1, 0], generation="g1")
        self.assertEqual(len(self.cache.search([1, 0], "emb-v1", 20)), 2)

    def test_cache_identity_tracks_input_and_recipe(self):
        asset = item()
        self.assertNotEqual(self.cache.key(asset, "one"), self.cache.key(asset, "two"))
        changed = {**asset, "inputStorageId": "different"}
        self.assertNotEqual(self.cache.key(asset, "one"), self.cache.key(changed, "one"))

    def test_cache_file_permissions(self):
        self.assertEqual((Path(self.temp.name) / "cache.sqlite").stat().st_mode & 0o777, 0o600)

    def test_dimensions_mismatch_skipped(self):
        self.store("a", [1, 0, 0])
        self.assertEqual(self.cache.search([1, 0], "emb-v1", 20), [])

    def test_sync_cached_retries_and_publish_opt_in(self):
        calls = []
        asset = item()
        class Client:
            def call(self, kind, path, args):
                calls.append(kind)
                return {"items": [asset], "skipped": 0, "isDone": True, "continueCursor": ""}
            def image(self, _):
                return png()
        runs = []
        def run(data):
            runs.append(True)
            return {"tags": []}, None
        pipeline = types.SimpleNamespace(fingerprint="pipeline", embedding=None, run=run)
        first = w.sync(Client(), pipeline, self.cache, limit=250, publish=False)
        second = w.sync(Client(), pipeline, self.cache, limit=250, publish=True)
        self.assertEqual(len(runs), 1)
        self.assertEqual(first["processed"], 1)
        self.assertEqual(first["published"], 0)
        self.assertEqual(second["cached"], 1)
        self.assertEqual(second["published"], 1)
        self.assertEqual(calls, ["query", "query", "mutation"])

    def test_cached_only_publishes_exact_cached_pilot_without_downloads(self):
        self.store("a", [1, 0])
        calls = []
        class Client:
            def call(self, kind, path, args):
                calls.append((kind, args))
                return {"items": [item("a"), item("b")], "skipped": 0, "isDone": True, "continueCursor": ""}
            def image(self, _):
                raise AssertionError("cached-only must avoid downloads")
        pipeline = types.SimpleNamespace(fingerprint="pipeline", embedding=None)
        result = w.sync(Client(), pipeline, self.cache, limit=250, publish=True, cached_only=True)
        self.assertEqual(result["processed"], 0)
        self.assertEqual(result["cached"], 1)
        self.assertEqual(result["published"], 1)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(calls[-1][1]["assetId"], "a")

    def test_limit_does_not_invalidate_unprocessed_cache_item(self):
        self.store("b", [1, 0], generation="g0")
        class Client:
            def call(self, *args):
                return {"items": [item("a"), item("b")], "skipped": 0, "isDone": True, "continueCursor": ""}
            def image(self, _):
                return png()
        pipeline = types.SimpleNamespace(fingerprint="new-pipeline", embedding=None, run=lambda _: ({"tags": []}, None))
        result = w.sync(Client(), pipeline, self.cache, limit=1, publish=False)
        self.assertEqual(result["processed"], 1)
        self.assertEqual([h["assetId"] for h in self.cache.search([1, 0], "emb-v1", 20)], ["b"])

    def test_failed_tasks_return_failure_without_private_details(self):
        class Client:
            def call(self, *args):
                return {"items": [item()], "skipped": 0, "isDone": True, "continueCursor": ""}
            def image(self, _):
                raise ValueError("private URL and token")
        pipeline = types.SimpleNamespace(fingerprint="p", embedding=None)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            result = w.sync(Client(), pipeline, self.cache, limit=1, publish=False)
        self.assertEqual(result["failed"], 1)
        self.assertNotIn("private URL", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
