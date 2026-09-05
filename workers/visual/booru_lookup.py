#!/usr/bin/env python3
"""Read-only Danbooru lookup using file hashes and public source IDs.

Never uploads images or writes the archive. Source-post matches remain candidates:
one X/Pixiv post can contain multiple images or edited versions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler


def source_identity(url):
    parsed = urlparse(url)
    if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password:
        return None
    host = (parsed.hostname or '').lower()
    if host in {'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'}:
        match = re.search(r'/status/(\d+)(?:/|$)', parsed.path)
        return ('twitter', match[1]) if match else None
    if host in {'pixiv.net', 'www.pixiv.net'}:
        match = re.search(r'/artworks/(\d+)(?:/|$)', parsed.path)
        legacy = parse_qs(parsed.query).get('illust_id', [''])[0]
        value = match[1] if match else legacy
        return ('pixiv', value) if value.isdigit() else None
    if host == 'danbooru.donmai.us':
        match = re.fullmatch(r'/posts/(\d+)(?:\.json)?/?', parsed.path)
        return ('danbooru', match[1]) if match else None
    return None


def source_query(identity):
    if not identity:
        return None
    kind, value = identity
    return {'twitter': f'source:*/status/{value}*', 'pixiv': f'pixiv:{value}', 'danbooru': f'id:{value}'}[kind]


def classify(posts, md5, identity):
    exact = [p for p in posts if p.get('md5') == md5]
    if exact:
        return 'md5_match', exact
    candidates = [p for p in posts if identity and (
        source_identity(p.get('source', '')) == identity or
        (identity[0] == 'pixiv' and str(p.get('pixiv_id')) == identity[1]) or
        (identity[0] == 'danbooru' and str(p.get('id')) == identity[1]))]
    return ('source_candidate', candidates) if candidates else ('no_match', [])


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output; preserve prior lookups.')
    sources = {r['file']: r.get('sourceUrl', '') for r in json.loads(args.sources.read_text())}
    report = {'provider': 'danbooru', 'startedAt': time.time(), 'images': [], 'requests': 0}
    cache = {}
    last_request = 0
    opener = build_opener(NoRedirect)

    def fetch(query):
        nonlocal last_request
        if query in cache:
            return cache[query]
        time.sleep(max(0, 1 - (time.monotonic() - last_request)))
        last_request = time.monotonic()
        params = {'tags': query, 'limit': 20, 'only': 'id,source,md5,pixiv_id,updated_at,tag_string_general,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,image_width,image_height,preview_file_url'}
        url = 'https://danbooru.donmai.us/posts.json?' + urlencode(params)
        request = Request(url, headers={'User-Agent': 'OurchivalMetadataPilot/0.1'})
        report['requests'] += 1
        with opener.open(request, timeout=30) as response:
            body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError('Metadata response exceeded bound')
        posts = json.loads(body)
        if not isinstance(posts, list):
            raise ValueError('Unexpected metadata response')
        cache[query] = posts
        return posts

    for row in json.loads(args.images.read_text()):
        path = args.images.parent / row['file']
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError('Sample bytes changed')
        md5 = hashlib.md5(data).hexdigest()
        identity = source_identity(sources.get(row['file'], ''))
        queries = ['md5:' + md5]
        query = source_query(identity)
        if query:
            queries.append(query)
        item = {'file': row['file'], 'inputSha256': row['sha256'], 'md5': md5, 'publicSource': sources.get(row['file']), 'lookups': []}
        try:
            for query in queries:
                posts = fetch(query)
                state, matches = classify(posts, md5, identity)
                item['lookups'].append({'query': query, 'candidates': posts, 'possiblyTruncated': len(posts) == 20})
                item.update(state=state, matches=matches)
                if state == 'md5_match':
                    break
        except HTTPError as error:
            item.update(state='lookup_error', httpStatus=error.code)
            report['images'].append(item)
            args.output.write_text(json.dumps(report, indent=2))
            # Stop on denial/rate limiting rather than bypassing or hammering.
            if error.code in {401, 403, 429}:
                raise SystemExit(f'Provider returned HTTP {error.code}; saved partial receipt and stopped.')
        else:
            item['retrievedAt'] = time.time()
            report['images'].append(item)
        args.output.write_text(json.dumps(report, indent=2))
        print(row['file'], item['state'], len(item.get('matches', [])), flush=True)


if __name__ == '__main__':
    main()
