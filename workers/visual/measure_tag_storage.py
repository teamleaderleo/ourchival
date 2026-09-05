"""Measure tag representation bytes from an evaluate_local.py result file.

Only aggregate counts/hashes are emitted. This is payload accounting, not a
Convex billing estimate: document framing, IDs, indexes and recipes are excluded.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

from tag_codec import decode, encode


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def measure(images, model):
    rows = [image[model]["tags"] for image in images]
    keys = sorted({(tag["category"], tag["name"]) for row in rows for tag in row})
    codes = {key: index + 1 for index, key in enumerate(keys)}
    dictionary = [{"code": codes[key], "category": key[0], "name": key[1]}
                  for key in keys]
    payloads = []
    for row in rows:
        entries = [(codes[(tag["category"], tag["name"])], tag["confidence"])
                   for tag in row]
        payload = encode(entries)
        if decode(payload) != sorted(entries):
            raise ValueError("Lossless reconstruction failed")
        payloads.append(payload)
    # Same per-image array boundaries in the readable baseline, with a single
    # shared dictionary in the compact alternative. Include eight-byte headers.
    before = sum(len(json_bytes(row)) for row in rows)
    dictionary_bytes = len(json_bytes(dictionary))
    binary_bytes = sum(map(len, payloads))
    after = dictionary_bytes + binary_bytes
    transport = dictionary_bytes + sum(len(json_bytes({"$bytes":
        base64.b64encode(payload).decode("ascii")})) for payload in payloads)
    return {
        "model": model, "images": len(rows),
        "assertions": sum(map(len, rows)), "unique_terms": len(keys),
        "readable_tag_arrays_utf8_bytes": before,
        "shared_dictionary_utf8_bytes": dictionary_bytes,
        "otg_v1_payload_bytes_including_headers": binary_bytes,
        "compact_total_bytes": after,
        "saved_bytes": before - after,
        "saved_percent": round(100 * (before - after) / before, 2) if before else 0,
        "compact_json_transport_bytes": transport,
        "lossless_round_trip": True,
        "scope": "Tag payloads and shared dictionary only; excludes database "
                 "record overhead, IDs, indexes, model recipes, OCR and captions. "
                 "Not physical disk usage or billed Convex storage."
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--model", default="convnext")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.input.read_bytes()
    result = measure(json.loads(source)["images"], args.model)
    result["input_sha256"] = hashlib.sha256(source).hexdigest()
    result["measurement_version"] = 1
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
