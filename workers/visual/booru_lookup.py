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
    exact = [p for p in posts if md5 and p.get('md5') == md5]
    if exact:
        return 'md5_match', exact
    candidates = [p for p in posts if identity and (
        source_identity(p.get('source', '')) == identity or
        (identity[0] == 'pixiv' and str(p.get('pixiv_id')) == identity[1]) or
        (identity[0] == 'danbooru' and str(p.get('id')) == identity[1]))]
    return ('source_candidate', candidates) if candidates else ('no_match', [])


def artist_identity(url):
    """Normalize public profile URLs, never infer identity from display names."""
    parsed = urlparse(url)
    if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password:
        return None
    host = (parsed.hostname or '').lower()
    if host in {'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'}:
        name = parsed.path.strip('/')
        if re.fullmatch(r'[A-Za-z0-9_]{1,15}', name) and name.lower() not in {'home', 'explore', 'search', 'settings', 'i', 'intent'}:
            return ('twitter', name.lower())
    if host in {'pixiv.net', 'www.pixiv.net'}:
        match = re.fullmatch(r'/(?:en/)?users/(\d+)/?', parsed.path)
        if match:
            return ('pixiv', match[1])
    return None


def source_identities(record):
    urls = [record.get('sourceUrl', ''), *record.get('sourceUrls', [])]
    return list(dict.fromkeys(identity for url in urls if (identity := source_identity(url))))


def author_profiles(record):
    urls = [record.get('authorUrl', ''), *record.get('authorUrls', [])]
    for source in [record.get('sourceUrl', ''), *record.get('sourceUrls', [])]:
        identity = source_identity(source)
        if identity and identity[0] == 'twitter':
            name = urlparse(source).path.strip('/').split('/')[0]
            urls.append('https://x.com/' + name)
    return list(dict.fromkeys(url for url in urls if artist_identity(url)))


def resolve_image(md5, identities, artist_urls, fetch_posts, fetch_artists, lookups=None):
    """Resolve one asset. Only exact bytes yield transferable community tags.

    Network functions are injected for deterministic tests and shared request caching.
    Candidate discovery is intentionally bounded; no match does not mean absent.
    """
    if md5 is not None and not re.fullmatch(r'[0-9a-f]{32}', md5):
        raise ValueError('Expected a complete image MD5')
    posts = {}
    lookups = [] if lookups is None else lookups
    artists = {}
    profiles = set()
    valid_artist_urls = [url for url in dict.fromkeys(artist_urls) if artist_identity(url)]

    def lookup(query, route):
        try:
            result = fetch_posts(query)
        except Exception as error:
            lookups.append({'query': query, 'route': route, 'error': type(error).__name__, 'httpStatus': getattr(error, 'code', None), 'possiblyTruncated': False})
            raise
        lookups.append({'query': query, 'route': route, 'candidates': result, 'possiblyTruncated': len(result) >= 20})
        posts.update((post['id'], post) for post in result if post.get('id'))

    def exact():
        return classify(list(posts.values()), md5, None)[1]

    if md5:
        lookup('md5:' + md5, 'image_hash')
    for identity in identities[:4]:
        if exact():
            break
        lookup(source_query(identity), identity[0] + '_post')

    if not exact():
        for url in valid_artist_urls[:2]:
            identity = artist_identity(url)
            if not identity:
                continue
            try:
                records = fetch_artists(url)
            except Exception as error:
                lookups.append({'artistUrl': url, 'route': 'artist_profile', 'error': type(error).__name__, 'httpStatus': getattr(error, 'code', None), 'possiblyTruncated': False})
                raise
            lookups.append({'artistUrl': url, 'route': 'artist_profile', 'candidates': records, 'possiblyTruncated': len(records) >= 10})
            for artist in records:
                urls = [entry.get('url', '') for entry in artist.get('urls', [])]
                if artist.get('is_deleted') or identity not in [artist_identity(u) for u in urls]:
                    continue
                name = artist.get('name', '')
                if not re.fullmatch(r"[\w().'-]+", name) or len(artists) >= 2:
                    continue
                if artist.get('id') in artists:
                    continue
                artists[artist['id']] = artist
                profiles.update(u for u in urls if artist_identity(u))
                lookup(name, 'artist_candidate')
                if exact():
                    break
            if exact():
                break

    matches = exact()
    state = 'md5_match' if matches else 'no_match'
    if not matches:
        matched = {}
        for identity in identities:
            _, candidates = classify(list(posts.values()), md5, identity)
            matched.update((p['id'], p) for p in candidates)
        matches = list(matched.values())
        if matches:
            state = 'source_candidate'
        elif artists and posts:
            state, matches = 'artist_candidate', list(posts.values())

    mirrors = set()
    community = []
    if state == 'md5_match':
        for post in matches:
            if source_identity(post.get('source', '')):
                mirrors.add(post['source'])
            if post.get('pixiv_id'):
                mirrors.add(f"https://www.pixiv.net/artworks/{post['pixiv_id']}")
            community.append({'provider': 'danbooru', 'postId': post['id'], 'postUrl': f"https://danbooru.donmai.us/posts/{post['id']}",
                              'evidence': 'exact_md5', 'md5': md5, 'updatedAt': post.get('updated_at'),
                              'tags': {category: post.get('tag_string_' + category, '').split() for category in ['general', 'artist', 'character', 'copyright', 'meta']}})
    return {'state': state, 'matches': matches, 'lookups': lookups, 'artistProfiles': sorted(profiles),
            'verifiedMirrorSources': sorted(mirrors), 'communityTags': community,
            'sourceQueriesOmitted': max(0, len(identities) - 4), 'artistProfilesOmitted': max(0, len(valid_artist_urls) - 2),
            'coverage': 'bounded_lookup', 'possiblyTruncated': any(row['possiblyTruncated'] for row in lookups)}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--resume', action='store_true', help='Resume the same manifests; preserve prior errors and retry unfinished images.')
    args = parser.parse_args()
    if args.output.exists() and not args.resume:
        parser.error('Choose a new output; preserve prior lookups.')
    image_rows = json.loads(args.images.read_text())
    source_rows = json.loads(args.sources.read_text())
    fingerprint = hashlib.sha256(json.dumps([image_rows, source_rows], sort_keys=True).encode()).hexdigest()
    sources = {r['file']: r for r in source_rows}
    report = {'provider': 'danbooru', 'startedAt': time.time(), 'images': [], 'requests': 0, 'manifestSha256': fingerprint, 'resolverVersion': 2}
    if args.resume:
        if not args.output.exists():
            parser.error('No receipt to resume.')
        report = json.loads(args.output.read_text())
        if report.get('manifestSha256') != fingerprint or report.get('resolverVersion') != 2:
            parser.error('The receipt does not match these manifests or resolver version.')
        errors = [item for item in report['images'] if item['state'] == 'lookup_error']
        report.setdefault('previousErrors', []).extend(errors)
        report['images'] = [item for item in report['images'] if item['state'] != 'lookup_error']
    completed = {item['file'] for item in report['images']}

    def save_report():
        report['summary'] = {
            'expectedImages': len(image_rows), 'observedImages': len(report['images']),
            **{state: sum(item['state'] == state for item in report['images']) for state in ['md5_match', 'source_candidate', 'artist_candidate', 'no_match', 'lookup_error']},
        }
        pending = args.output.with_name(args.output.name + '.tmp')
        pending.write_text(json.dumps(report, indent=2))
        pending.replace(args.output)
    cache = {}
    last_request = 0
    opener = build_opener(NoRedirect)

    def fetch(query, artist=False):
        nonlocal last_request
        cache_key = ('artist' if artist else 'post', query)
        if cache_key in cache:
            return cache[cache_key]
        time.sleep(max(0, 1 - (time.monotonic() - last_request)))
        last_request = time.monotonic()
        params = {'tags': query, 'limit': 20, 'only': 'id,source,md5,pixiv_id,updated_at,tag_string_general,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta,image_width,image_height,preview_file_url'}
        if artist:
            params = {'search[url_matches]': query, 'limit': 10, 'only': 'id,name,is_deleted,urls[url]'}
        url = 'https://danbooru.donmai.us/' + ('artists.json?' if artist else 'posts.json?') + urlencode(params)
        request = Request(url, headers={'User-Agent': 'OurchivalMetadataPilot/0.1'})
        report['requests'] += 1
        with opener.open(request, timeout=30) as response:
            body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError('Metadata response exceeded bound')
        posts = json.loads(body)
        if not isinstance(posts, list):
            raise ValueError('Unexpected metadata response')
        cache[cache_key] = posts
        return posts

    for row in image_rows:
        path = args.images.parent / row['file']
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError('Sample bytes changed')
        if row['file'] in completed:
            continue
        md5 = hashlib.md5(data).hexdigest()
        source = sources.get(row['file'], {})
        identities = source_identities(source)
        artist_urls = author_profiles(source)
        item = {'file': row['file'], 'inputSha256': row['sha256'], 'md5': md5, 'publicSource': source.get('sourceUrl'), 'sourceIdentities': identities, 'lookups': [],
                **{key: row[key] for key in ['referenceId', 'assetId', 'sourceIndex', 'sourceCount'] if key in row}}
        try:
            item.update(resolve_image(md5, identities, artist_urls, fetch, lambda url: fetch(url, artist=True), item['lookups']))
        except HTTPError as error:
            item.update(state='lookup_error', httpStatus=error.code)
            error.close()
            report['images'].append(item)
            save_report()
            # Stop on denial/rate limiting rather than bypassing or hammering.
            if error.code in {401, 403, 429}:
                raise SystemExit(f'Provider returned HTTP {error.code}; saved partial receipt and stopped.')
        except Exception as error:
            item.update(state='lookup_error', error=type(error).__name__)
            report['images'].append(item)
        else:
            item['retrievedAt'] = time.time()
            report['images'].append(item)
        save_report()
        print(row['file'], item['state'], len(item.get('matches', [])), flush=True)
    report['passFinishedAt'] = time.time()
    save_report()


if __name__ == '__main__':
    main()
