#!/usr/bin/env python3
"""Local visual enrichment and semantic retrieval for Ourchival.

Inference reads explicitly configured, hash-verified local models. Network use is
limited to the configured archive API and owned image downloads. Images remain in
memory; the private SQLite cache contains annotations and optional embeddings.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, HTTPRedirectHandler, build_opener
import warnings

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
PIPELINE_VERSION = "ourchival-visual-v1"


def stable_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_file(spec: dict[str, Any], root: Path) -> Path:
    path = (root / spec["path"]).expanduser().resolve()
    expected = spec["sha256"]
    if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("A local model artifact requires its SHA-256 digest.")
    if not path.is_file() or sha256_file(path) != expected:
        raise ValueError("A local model artifact is missing or its digest differs.")
    return path


def decode_image(data: bytes):
    from PIL import Image, ImageOps
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image size exceeds the worker limit.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("Decoded image exceeds the pixel limit.")
            if getattr(source, "is_animated", False):
                raise ValueError("Animation requires a separate frame-aware pipeline.")
            oriented = ImageOps.exif_transpose(source).convert("RGBA")
            background = Image.new("RGBA", oriented.size, "white")
            return Image.alpha_composite(background, oriented).convert("RGB")


def wd_input(image, size: int):
    """WD's published NHWC float32, white-padded, BGR 0..255 recipe."""
    import numpy as np
    from PIL import Image
    if size <= 0 or size > 2048:
        raise ValueError("Unsupported tagger resolution.")
    side = max(image.size)
    canvas = Image.new("RGB", (side, side), "white")
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    canvas = canvas.resize((size, size), Image.Resampling.BICUBIC)
    return np.ascontiguousarray(np.asarray(canvas, dtype=np.float32)[None, :, :, ::-1])


def checked_probability(value: Any) -> float:
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Model produced an invalid confidence.")
    return value


class WDTagger:
    def __init__(self, spec: dict[str, Any], root: Path):
        import onnxruntime as ort
        model = checked_file(spec["model"], root)
        labels = checked_file(spec["labels"], root)
        with labels.open(encoding="utf-8", newline="") as source:
            self.labels = list(csv.DictReader(source))
        if not self.labels or not {"name", "category"} <= self.labels[0].keys():
            raise ValueError("Invalid WD label table.")
        self.general = checked_probability(spec.get("general_threshold", 0.35))
        self.character = checked_probability(spec.get("character_threshold", 0.85))
        requested = spec.get("providers", ["CPUExecutionProvider"])
        providers = list(dict.fromkeys(p for p in requested if p in ort.get_available_providers()))
        if "CPUExecutionProvider" not in providers:
            providers.append("CPUExecutionProvider")
        self.session = ort.InferenceSession(str(model), providers=providers)
        inp = self.session.get_inputs()[0]
        dims = inp.shape
        if len(dims) != 4 or dims[3] != 3 or not isinstance(dims[1], int) or dims[1] != dims[2]:
            raise ValueError("Expected a square NHWC WD ONNX model.")
        self.name, self.size = inp.name, dims[1]
        self.provenance = {"id": spec["id"], "revision": spec["revision"],
                           "sha256": stable_digest([spec["model"]["sha256"], spec["labels"]["sha256"]]), "task": "tags_and_ratings"}
        self.runtime = {"onnxruntime": ort.__version__, "providers": self.session.get_providers(), "preprocess": "wd-nhwc-bgr-white-bicubic-v1"}

    def run(self, image) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        output = self.session.run(None, {self.name: wd_input(image, self.size)})[0][0]
        if len(output) != len(self.labels):
            raise ValueError("Model output and label table differ in length.")
        tags, ratings = [], []
        for label, raw in zip(self.labels, output):
            confidence = checked_probability(raw)
            category = int(label["category"])
            if category == 9:
                ratings.append({"label": label["name"], "confidence": confidence})
            elif category in (0, 4) and confidence > (self.general if category == 0 else self.character):
                if len(label["name"]) > 120:
                    continue
                tags.append({"name": label["name"], "category": "general" if category == 0 else "character", "confidence": confidence})
        return sorted(tags, key=lambda item: (-item["confidence"], item["name"]))[:128], ratings[:12]


class LocalOCR:
    def __init__(self, spec: dict[str, Any], root: Path):
        from rapidocr import RapidOCR
        files = {name: checked_file(spec[name], root) for name in ("det", "cls", "rec", "keys")}
        self.engine = RapidOCR(params={
            "Det.model_path": str(files["det"]), "Cls.model_path": str(files["cls"]),
            "Rec.model_path": str(files["rec"]), "Rec.rec_keys_path": str(files["keys"]),
            "Det.engine_type": "onnxruntime", "Cls.engine_type": "onnxruntime", "Rec.engine_type": "onnxruntime",
        })
        self.threshold = checked_probability(spec.get("threshold", 0.6))
        self.provenance = {"id": spec["id"], "revision": spec["revision"],
                           "sha256": stable_digest([spec[k]["sha256"] for k in ("det", "cls", "rec", "keys")]), "task": "ocr"}
        self.runtime = {"rapidocr": importlib.metadata.version("rapidocr")}

    def run(self, image) -> str:
        import numpy as np
        output = self.engine(np.ascontiguousarray(np.asarray(image)[:, :, ::-1]))
        if output.txts is None:
            return ""
        return "\n".join(text for text, score in zip(output.txts, output.scores)
                         if checked_probability(score) >= self.threshold)[:16_000]


class SigLIP:
    def __init__(self, spec: dict[str, Any], root: Path):
        import torch
        from transformers import AutoModel, AutoProcessor
        directory = (root / spec["directory"]).expanduser().resolve()
        manifest = spec["files"]
        if not manifest or "config.json" not in manifest or not any(name.endswith(".safetensors") for name in manifest):
            raise ValueError("SigLIP requires a complete local safetensors snapshot manifest.")
        for name, digest in manifest.items():
            if Path(name).is_absolute() or ".." in Path(name).parts:
                raise ValueError("Invalid snapshot manifest path.")
            checked_file({"path": name, "sha256": digest}, directory)
        # Fail if untracked model/config/tokenizer files could influence loading.
        loaded_names = {str(p.relative_to(directory)) for p in directory.rglob("*") if p.is_file() and not p.name.startswith(".") and ".cache" not in p.parts}
        if loaded_names - set(manifest):
            raise ValueError("Every local snapshot file must be listed in the model manifest.")
        device = spec.get("device", "auto")
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        if device not in {"cpu", "cuda", "mps"}:
            raise ValueError("Unsupported embedding device.")
        self.torch, self.device = torch, device
        self.processor = AutoProcessor.from_pretrained(str(directory), local_files_only=True, trust_remote_code=False)
        self.model = AutoModel.from_pretrained(str(directory), local_files_only=True, trust_remote_code=False, use_safetensors=True).to(device=device, dtype=torch.float32).eval()
        self.provenance = {"id": spec["id"], "revision": spec["revision"], "sha256": stable_digest(manifest), "task": "embedding"}
        self.runtime = {"torch": torch.__version__, "transformers": importlib.metadata.version("transformers"), "device": device, "precision": "float32"}
        self.fingerprint = stable_digest([self.provenance, self.runtime, "siglip-text64-lowercase-normalized-v1"])

    def features(self, *, image=None, text: str | None = None):
        if (image is None) == (text is None):
            raise ValueError("Provide exactly one image or text input.")
        args = {"images": image} if image is not None else {"text": [text.lower()], "padding": "max_length", "max_length": 64, "truncation": True}
        inputs = self.processor(**args, return_tensors="pt").to(self.device)
        with self.torch.inference_mode():
            output = self.model.get_image_features(**inputs) if image is not None else self.model.get_text_features(**inputs)
            features = output.pooler_output if hasattr(output, "pooler_output") else output
            vector = features[0].detach().float().cpu().numpy()
        return unit_vector(vector)


def unit_vector(vector):
    import numpy as np
    array = np.asarray(vector, dtype=np.float32)
    if array.ndim != 1 or not 1 <= array.size <= 8192 or not np.isfinite(array).all():
        raise ValueError("Invalid embedding.")
    norm = float(np.linalg.norm(array))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise ValueError("Zero embedding.")
    return np.asarray(array / norm, dtype="<f4")


class Pipeline:
    def __init__(self, config: Path):
        spec = json.loads(config.read_text(encoding="utf-8"))
        if spec.get("version") != 1:
            raise ValueError("Unsupported worker configuration version.")
        root = config.parent
        self.wd = WDTagger(spec["wd"], root) if spec.get("wd") else None
        self.ocr = LocalOCR(spec["ocr"], root) if spec.get("ocr") else None
        self.embedding = SigLIP(spec["siglip"], root) if spec.get("siglip") else None
        stages = [stage for stage in (self.wd, self.ocr, self.embedding) if stage]
        if not stages:
            raise ValueError("Configure at least one local enrichment model.")
        self.models = [stage.provenance for stage in stages]
        # Paths differ between Linux and macOS; model bytes and runtime recipes identify results.
        settings = {"general": (spec.get("wd") or {}).get("general_threshold", .35),
                    "character": (spec.get("wd") or {}).get("character_threshold", .85),
                    "ocr": (spec.get("ocr") or {}).get("threshold", .6)}
        image_runtime = {"pillow": importlib.metadata.version("pillow"), "numpy": importlib.metadata.version("numpy"),
                         "decode": "exif-orient-alpha-on-white-rgb-v1"}
        self.fingerprint = stable_digest([PIPELINE_VERSION, self.models, [s.runtime for s in stages], settings, image_runtime])

    def run(self, data: bytes):
        image = decode_image(data)
        try:
            tags, ratings = self.wd.run(image) if self.wd else ([], [])
            result = {"inputSha256": hashlib.sha256(data).hexdigest(), "pipelineFingerprint": self.fingerprint,
                      "models": self.models, "tags": tags, "ratings": ratings}
            if self.ocr:
                result["ocrText"] = self.ocr.run(image)
            vector = self.embedding.features(image=image) if self.embedding else None
            return result, vector
        finally:
            image.close()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Archive function requests contain credentials. Never forward them to a redirect target.
        raise ValueError("Archive request redirected; configure its final deployment URL.")


def safe_base_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("Use a plain deployment origin.")
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if not parsed.hostname or (parsed.scheme != "https" and not (local and parsed.scheme == "http")):
        raise ValueError("Archive requests require HTTPS, or an explicit localhost development origin.")
    return url.rstrip("/")


class ArchiveClient:
    def __init__(self, url: str, key: str, extra_asset_hosts: list[str] | None = None):
        self.url = safe_base_url(url)
        if not key.strip():
            raise ValueError("Set OURCHIVAL_ACCESS_KEY using an owner session or recovery credential.")
        self.key = key
        self.hosts = {urlparse(self.url).hostname, *(extra_asset_hosts or [])}
        self.opener = build_opener(NoRedirect())

    def call(self, kind: str, path: str, args: dict[str, Any]):
        if kind not in {"query", "mutation"}:
            raise ValueError("Unsupported function kind.")
        body = json.dumps({"path": path, "args": {**args, "accessKey": self.key}, "format": "json"}, allow_nan=False).encode()
        request = Request(self.url + "/api/" + kind, data=body, headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=60) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise ValueError("Archive response exceeds the limit.")
        result = json.loads(data)
        if result.get("status") != "success":
            # Server log lines and arbitrary error bodies may contain private data.
            raise RuntimeError("Archive function failed; inspect private server logs.")
        return result["value"]

    def image(self, url: str) -> bytes:
        parsed = urlparse(url)
        base = urlparse(self.url)
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"} and parsed.netloc == base.netloc
        if parsed.username or parsed.password or parsed.fragment or parsed.hostname not in self.hosts:
            raise ValueError("Image host is outside the configured owned-storage allowlist.")
        if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
            raise ValueError("Image request requires HTTPS.")
        with self.opener.open(Request(url), timeout=60) as response:
            data = response.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("Image response exceeds the limit.")
        return data


class Cache:
    def __init__(self, path: Path):
        path = path.expanduser()
        if path.suffix != ".sqlite":
            raise ValueError("Use a dedicated .sqlite cache file.")
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path)
        os.chmod(path, 0o600)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS results (
          cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, vector BLOB, embedding_fingerprint TEXT
        );
        CREATE TABLE IF NOT EXISTS items (
          asset_id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, title TEXT NOT NULL,
          source_url TEXT NOT NULL, cache_key TEXT, active INTEGER NOT NULL DEFAULT 1, seen TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)

    @staticmethod
    def key(item: dict[str, Any], fingerprint: str) -> str:
        return stable_digest([item["assetId"], item["inputStorageId"], item.get("originalContentHash"), fingerprint])

    def get(self, key: str):
        row = self.db.execute("SELECT payload, vector, embedding_fingerprint FROM results WHERE cache_key=?", (key,)).fetchone()
        return (json.loads(row[0]), row[1], row[2]) if row else None

    def put(self, key: str, payload: dict[str, Any], vector, embedding_fingerprint: str | None):
        blob = unit_vector(vector).tobytes() if vector is not None else None
        self.db.execute("INSERT OR REPLACE INTO results VALUES (?,?,?,?)", (key, json.dumps(payload, ensure_ascii=False, allow_nan=False), blob, embedding_fingerprint))
        self.db.commit()

    def observe(self, item: dict[str, Any], key: str, generation: str):
        self.db.execute("INSERT OR REPLACE INTO items VALUES (?,?,?,?,?,1,?)", (item["assetId"], item["referenceId"], item["title"], item["sourceUrl"], key, generation))
        self.db.commit()

    def finish(self, generation: str):
        self.db.execute("UPDATE items SET active=0 WHERE seen<>?", (generation,))
        self.db.execute("INSERT OR REPLACE INTO metadata VALUES ('completed_sync',?)", (str(time.time()),))
        self.db.commit()

    def search(self, vector, fingerprint: str, limit: int):
        import numpy as np
        query = unit_vector(vector)
        limit = min(100, max(1, limit))
        heap: list[tuple[float, str, str, str, str]] = []
        rows = self.db.execute("""SELECT i.asset_id,i.reference_id,i.title,i.source_url,r.vector
          FROM items i JOIN results r ON i.cache_key=r.cache_key
          WHERE i.active=1 AND r.embedding_fingerprint=? AND r.vector IS NOT NULL""", (fingerprint,))
        for asset_id, reference_id, title, source_url, blob in rows:
            candidate = np.frombuffer(blob, dtype="<f4")
            if candidate.size != query.size or not np.isfinite(candidate).all():
                continue
            hit = (float(np.dot(query, candidate)), asset_id, reference_id, title, source_url)
            if len(heap) < limit:
                heapq.heappush(heap, hit)
            elif hit > heap[0]:
                heapq.heapreplace(heap, hit)
        return [{"score": score, "assetId": asset, "referenceId": reference, "title": title, "sourceUrl": url}
                for score, asset, reference, title, url in sorted(heap, reverse=True)]

    def close(self):
        self.db.close()


def sync(client: ArchiveClient, pipeline: Pipeline, cache: Cache, *, limit: int, publish: bool, cached_only: bool = False) -> dict[str, int]:
    cursor = None
    seen_cursors: set[str] = set()
    generation = str(time.time_ns())
    counts = {"processed": 0, "cached": 0, "published": 0, "skipped": 0, "failed": 0}
    while True:
        page = client.call("query", "visualEnrichment:listAssets", {"paginationOpts": {"numItems": 32, "cursor": cursor}})
        counts["skipped"] += page["skipped"]
        for item in page["items"]:
            key = cache.key(item, pipeline.fingerprint)
            saved = cache.get(key)
            if cached_only and saved is None:
                counts["skipped"] += 1
                continue
            if not saved and limit and counts["processed"] + counts["failed"] >= limit:
                return counts
            cache.observe(item, key, generation)
            try:
                if saved:
                    payload = saved[0]
                    counts["cached"] += 1
                else:
                    payload, vector = pipeline.run(client.image(item["inputUrl"]))
                    cache.put(key, payload, vector, pipeline.embedding.fingerprint if pipeline.embedding else None)
                    counts["processed"] += 1
                if publish and item["completedPipeline"] != pipeline.fingerprint:
                    client.call("mutation", "visualEnrichment:submit", {
                        **payload, "assetId": item["assetId"], "inputStorageId": item["inputStorageId"],
                        "originalContentHash": item["originalContentHash"], "expectedRevision": item["expectedRevision"],
                    })
                    counts["published"] += 1
            except Exception as exc:
                counts["failed"] += 1
                print(f"Asset task failed ({type(exc).__name__}); retry with a refreshed work list.", file=sys.stderr)
        if page["isDone"]:
            if not cached_only:
                cache.finish(generation)
            return counts
        next_cursor = page["continueCursor"]
        if not next_cursor or next_cursor in seen_cursors:
            raise RuntimeError("Archive pagination did not advance.")
        seen_cursors.add(next_cursor)
        cursor = next_cursor


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("check", "sync", "search", "file"):
        p = sub.add_parser(command)
        p.add_argument("--config", type=Path, required=True)
        if command in {"sync", "search"}:
            p.add_argument("--cache", type=Path, required=True)
        if command == "sync":
            p.add_argument("--limit", type=int, default=250, help="New image tasks; 0 processes the full archive.")
            p.add_argument("--publish", action="store_true", help="Write machine tags/OCR to your existing Convex archive.")
            p.add_argument("--cached-only", action="store_true", help="Reuse cached results only; perform no image downloads or inference.")
            p.add_argument("--asset-host", action="append", default=[], help="Additional explicitly owned storage host.")
        if command == "search":
            p.add_argument("--query", required=True)
            p.add_argument("--limit", type=int, default=20)
        if command == "file":
            p.add_argument("--image", type=Path, required=True)
    sub.add_parser("rebuild-search")
    sub.add_parser("status")
    args = parser.parse_args()
    cache = None
    try:
        if args.command in {"rebuild-search", "status"}:
            client = ArchiveClient(os.environ.get("OURCHIVAL_CONVEX_URL", ""), os.environ.get("OURCHIVAL_ACCESS_KEY", ""))
            result = client.call("mutation" if args.command == "rebuild-search" else "query",
                                 "archiveSearch:rebuild" if args.command == "rebuild-search" else "archiveSearch:status", {})
        else:
            pipeline = Pipeline(args.config.expanduser().resolve())
            if args.command == "check":
                result = {"pipelineFingerprint": pipeline.fingerprint, "models": pipeline.models,
                          "runtimes": {name: stage.runtime for name, stage in
                                       (("wd", pipeline.wd), ("ocr", pipeline.ocr), ("embedding", pipeline.embedding)) if stage}}
            elif args.command == "file":
                with args.image.expanduser().open("rb") as source:
                    data = source.read(MAX_IMAGE_BYTES + 1)
                result, vector = pipeline.run(data)
                result["embeddingDimensions"] = int(vector.size) if vector is not None else 0
            else:
                cache = Cache(args.cache)
                if args.command == "search":
                    if not pipeline.embedding:
                        raise ValueError("Semantic search requires a configured local SigLIP model.")
                    result = {"scope": "local cached images", "hits": cache.search(pipeline.embedding.features(text=args.query), pipeline.embedding.fingerprint, args.limit)}
                else:
                    if args.limit < 0:
                        raise ValueError("Limit must be nonnegative.")
                    client = ArchiveClient(os.environ.get("OURCHIVAL_CONVEX_URL", ""), os.environ.get("OURCHIVAL_ACCESS_KEY", ""), args.asset_host)
                    result = sync(client, pipeline, cache, limit=args.limit, publish=args.publish, cached_only=args.cached_only)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 1 if isinstance(result, dict) and result.get("failed", 0) else 0
    except Exception as exc:
        print(f"Worker stopped ({type(exc).__name__}). Check local model files, configuration, credentials and private server logs.", file=sys.stderr)
        return 1
    finally:
        if cache:
            cache.close()


if __name__ == "__main__":
    raise SystemExit(main())
