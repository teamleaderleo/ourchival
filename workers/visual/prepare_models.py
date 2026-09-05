#!/usr/bin/env python3
"""Explicit online setup: download model artifacts only and write a pinned local config."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re


def sha(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def file_spec(path: Path):
    return {"path": str(path.resolve()), "sha256": sha(path)}


def main():
    from huggingface_hub import HfApi, snapshot_download
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("models.local.json"))
    parser.add_argument("--model-root", type=Path, default=Path(__file__).resolve().parents[2] / ".models")
    parser.add_argument("--with-embeddings", action="store_true")
    parser.add_argument("--wd-revision")
    parser.add_argument("--siglip-revision")
    parser.add_argument("--provider", choices=["CPUExecutionProvider", "CUDAExecutionProvider", "CoreMLExecutionProvider"], default="CPUExecutionProvider")
    for part in ("det", "cls", "rec", "keys"):
        parser.add_argument(f"--ocr-{part}", type=Path)
    parser.add_argument("--ocr-id")
    parser.add_argument("--ocr-revision")
    args = parser.parse_args()
    args.model_root = args.model_root.expanduser().resolve()
    args.output = args.output.expanduser().resolve()
    if args.output.exists():
        raise SystemExit("Output already exists. Choose a new filename to preserve the previous model recipe.")
    config = {"version": 1}
    api = HfApi()
    for key, repo, requested in [
        ("wd", "SmilingWolf/wd-convnext-tagger-v3", args.wd_revision),
        ("siglip", "google/siglip2-base-patch16-256", args.siglip_revision),
    ]:
        if key == "siglip" and not args.with_embeddings:
            continue
        revision = api.model_info(repo, revision=requested).sha
        if not revision or not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise RuntimeError("Could not resolve an immutable model revision.")
        directory = args.model_root / key / revision
        snapshot_download(repo_id=repo, revision=revision, local_dir=directory,
                          allow_patterns=["model.onnx", "selected_tags.csv", "README.md", "LICENSE*"] if key == "wd" else ["*.json", "*.safetensors", "*.model", "*.txt", "README.md", "LICENSE*"])
        common = {"id": repo, "revision": revision}
        if key == "wd":
            config[key] = {**common, "model": file_spec(directory / "model.onnx"), "labels": file_spec(directory / "selected_tags.csv"),
                           "general_threshold": .35, "character_threshold": .85, "providers": [args.provider, "CPUExecutionProvider"]}
        else:
            files = {str(p.relative_to(directory)): sha(p) for p in sorted(directory.rglob("*"))
                     if p.is_file() and not p.name.startswith(".") and ".cache" not in p.parts}
            config[key] = {**common, "directory": str(directory), "files": files, "device": "auto"}
    ocr_files = {name: getattr(args, f"ocr_{name}") for name in ("det", "cls", "rec", "keys")}
    if any(ocr_files.values()):
        if not all(ocr_files.values()) or not args.ocr_id or not args.ocr_revision:
            raise SystemExit("OCR requires det, cls, rec and keys files plus their source model ID and revision.")
        config["ocr"] = {"id": args.ocr_id, "revision": args.ocr_revision, "threshold": .6,
                         **{name: file_spec(path.expanduser()) for name, path in ocr_files.items()}}
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(config, output, indent=2)
        output.write("\n")
    args.output.chmod(0o600)
    print(f"Pinned local model configuration written to {args.output}")


if __name__ == "__main__":
    main()
