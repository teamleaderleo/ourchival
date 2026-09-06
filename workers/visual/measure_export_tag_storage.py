"""Audit tag payloads in a private Convex metadata ZIP. Emits aggregate data only."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

from tag_codec import decode, encode


def measure(path):
    before = after = results = assertions = inline = 0
    versions = {}
    with ZipFile(path) as archive:
        with archive.open('visualEnrichments/documents.jsonl') as rows:
            for line in rows:
                row = json.loads(line)
                results += 1
                if row.get('tagPayload') is None:
                    inline += 1
                    continue
                payload = base64.b64decode(row['tagPayload']['$bytes'], validate=True)
                entries = decode(payload)
                packed = encode(entries)
                # Reconstruct the original format byte-for-byte, including -0.
                if encode(decode(packed), payload[3]) != payload:
                    raise ValueError('Lossless reconstruction failed')
                before += len(payload)
                after += len(packed)
                assertions += len(entries)
                version = str(payload[3])
                versions[version] = versions.get(version, 0) + 1
    with Path(path).open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    return {
        'scope': 'Exported binary tag payloads only; excludes shared dictionaries, '
                 'recipes, search projections, database overhead and billed storage',
        'exportSha256': digest, 'results': results, 'inlineResults': inline,
        'assertions': assertions, 'versions': versions,
        'beforePayloadBytes': before, 'projectedAfterPayloadBytes': after,
        'savedBytes': before - after,
        'savedPercent': round(100 * (before - after) / before, 2) if before else 0,
        'losslessRoundTrip': True,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    receipt = measure(args.export)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
