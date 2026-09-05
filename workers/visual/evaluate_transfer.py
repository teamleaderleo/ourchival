#!/usr/bin/env python3
"""Offline exploratory label-transfer evaluation; no catalog writes."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path

from reference_facets import TAG_GROUPS


def eligible(target, donor):
    """Exclude self, duplicate bytes, references and source posts."""
    return not any(target.get(k) and target.get(k) == donor.get(k)
                   for k in ('file', 'sha256', 'referenceId', 'md5', 'source_identity'))


def methods(scores, donors):
    counts = Counter(tag for donor in donors[:3] for tag in donor['labels'])
    prior = Counter(tag for donor in donors for tag in donor['labels'])
    return {
        'wd_035': {t for t, s in scores.items() if s >= .35},
        'nearest': set(donors[0]['labels']) if donors else set(),
        'neighbor_majority': {t for t, n in counts.items() if n >= 2},
        'agreement': {t for t, n in counts.items() if n >= 2 and scores.get(t, 0) >= .15},
        'wd_plus_agreement': {t for t, s in scores.items() if s >= .35}
            | {t for t, n in counts.items() if n >= 2 and scores.get(t, 0) >= .15},
        'prior_top5': {t for t, _ in sorted(prior.items(), key=lambda x: (-x[1], x[0]))[:5]},
    }


def summarize(rows):
    out = {}
    for name in rows[0]['predictions']:
        hit = predicted = observed = 0
        for row in rows:
            truth, tags = set(row['labels']), set(row['predictions'][name])
            hit += len(truth & tags)
            predicted += len(tags)
            observed += len(truth)
        out[name] = dict(matched=hit, predicted=predicted, observed=observed,
                         agreement=hit / predicted if predicted else None,
                         observed_recall=hit / observed if observed else None,
                         unconfirmed=predicted-hit)
    return out


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pilot', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output to preserve previous evidence.')
    from worker import SigLIP, decode_image, sha256_file
    from booru_lookup import source_identity
    import numpy as np
    manifest = json.loads((args.pilot / 'images.json').read_text())
    booru = {r['file']: r for r in json.loads((args.pilot / 'booru-combined.json').read_text())['images']}
    predictions = {r['file']: r for r in json.loads((args.pilot / 'results.json').read_text())['images']}
    config = json.loads(args.config.read_text())
    model = SigLIP(config['siglip'], args.config.parent)
    rows, vectors = [], []
    for entry in manifest:
        path = args.pilot / entry['file']
        if sha256_file(path) != entry['sha256']:
            raise ValueError('Input hash mismatch')
        image = decode_image(path.read_bytes())
        try:
            vectors.append(model.features(image=image))
        finally:
            image.close()
        match = booru[entry['file']]
        labels = set()
        if match['state'] == 'md5_match':
            for post in match['matches']:
                labels.update(post['tag_string_general'].split())
        rows.append({**entry, 'md5': match.get('md5'),
                     'source_identity': source_identity(match.get('publicSource', '')),
                     'matched': match['state'] == 'md5_match',
                     'labels': sorted(labels & TAG_GROUPS.keys())})
    matrix = np.stack(vectors)
    similarities = matrix @ matrix.T
    report = {'model': model.provenance, 'protocol': {
        'k': 3, 'neighbor_support': 2, 'wd_threshold': .35, 'agreement_threshold': .15,
        'vocabulary': sorted(TAG_GROUPS), 'note': 'Exploratory leave-one-out; community annotations are incomplete. No threshold tuning. Existing WD training overlap unknown.'},
        'embeddings': [{'file': r['file'], 'sha256': r['sha256'], 'vector': v.tolist()}
                       for r, v in zip(rows, vectors)], 'evaluation': {}, 'unmatched_suggestions': []}
    for wd in ('convnext', 'eva'):
        evaluated = []
        for i, row in enumerate(rows):
            indexes = [j for j, donor in enumerate(rows) if donor['matched'] and eligible(row, donor)]
            indexes.sort(key=lambda j: (-float(similarities[i, j]), rows[j]['file']))
            donors = [rows[j] for j in indexes]
            scores = {t['name']: t['confidence'] for t in predictions[row['file']][wd]['tags']
                      if t['category'] == 'general' and t['name'] in TAG_GROUPS}
            result = {**row, 'donor_count': len(donors),
                      'neighbors': [{'file': rows[j]['file'], 'cosine': float(similarities[i, j])}
                                    for j in indexes[:3]],
                      'predictions': {k: sorted(v) for k, v in methods(scores, donors).items()}}
            if row['matched']:
                evaluated.append(result)
            elif wd == 'convnext':
                report['unmatched_suggestions'].append(result)
        report['evaluation'][wd] = {'rows': evaluated, 'summary': summarize(evaluated)}
    with args.output.open('x') as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({k: v['summary'] for k, v in report['evaluation'].items()}, indent=2))


if __name__ == '__main__':
    main()
