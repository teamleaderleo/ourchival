"""Experimental reference-oriented view of predictions; preserves the raw result.

These groups describe visible details, not why the owner saved an image.
Unknown tags remain in the raw output. This is not a content/display filter.
"""

import json
from pathlib import Path

_VOCABULARY = json.loads((Path(__file__).resolve().parents[2] / 'packages/shared/src/reference-facets.json').read_text())
GROUPS = _VOCABULARY['groups']
TAG_GROUPS = _VOCABULARY['tagGroups']


def reference_facets(tags, threshold=.35, limit=8):
    if not 0 <= threshold <= 1 or limit < 1:
        raise ValueError("Invalid facet threshold or limit")
    grouped = {group: [] for group in GROUPS}
    by_name = {}
    for tag in tags:
        name = tag['name']
        if tag.get('category') != 'general' or tag['confidence'] <= threshold or name not in TAG_GROUPS:
            continue
        if name not in by_name or tag['confidence'] > by_name[name]['confidence']:
            by_name[name] = dict(tag)
    for tag in sorted(by_name.values(), key=lambda t: (-t['confidence'], t['name'])):
        group = grouped[TAG_GROUPS[tag['name']]]
        if len(group) < limit:
            group.append(tag)
    return {group: tags for group, tags in grouped.items() if tags}


def community_reference_facets(names, limit=8):
    """Group attributed community terms without inventing confidence scores."""
    if limit < 1:
        raise ValueError('Invalid group limit')
    groups = {group: [] for group in GROUPS}
    for name in sorted(set(names)):
        if name in TAG_GROUPS and len(groups[TAG_GROUPS[name]]) < limit:
            groups[TAG_GROUPS[name]].append(name)
    return {group: terms for group, terms in groups.items() if terms}
