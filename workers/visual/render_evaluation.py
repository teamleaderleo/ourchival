#!/usr/bin/env python3
"""Render private local comparison results. Embeds images; do not publish this file."""
import argparse
import base64
import html
import json
import os
from pathlib import Path
from PIL import Image
from reference_facets import reference_facets, community_reference_facets


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--results', type=Path, required=True)
    p.add_argument('--qwen', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--booru', type=Path)
    args = p.parse_args()
    report = json.loads(args.results.read_text())
    captions = {x['file']: x for x in json.loads(args.qwen.read_text())['images']}
    community = {x['file']: x for x in json.loads(args.booru.read_text())['images']} if args.booru else {}
    cards = []
    esc = html.escape
    for row in report['images']:
        image = base64.b64encode((args.results.parent / row['file']).read_bytes()).decode()
        with Image.open(args.results.parent / row['file']) as source:
            mime = Image.MIME.get(source.format, 'image/jpeg')
        parts = [f'<article><h2>{esc(row["file"])}</h2><div class="comparison"><img alt="Archive reference under review" src="data:{mime};base64,{image}"><div>']
        matched = community.get(row['file'])
        if matched:
            parts.append('<h3>Existing Danbooru tags</h3>')
            state = matched['state']
            parts.append('<p>' + {'md5_match': 'Matching file MD5 · community metadata', 'source_candidate': 'Same source post · image identity still needs confirmation', 'no_match': 'No match found by this lookup', 'lookup_error': 'Lookup could not complete'}.get(state, esc(state)) + '</p>')
            for post in matched.get('matches', []):
                post_id = int(post['id'])
                parts.append(f'<p><a href="https://danbooru.donmai.us/posts/{post_id}" target="_blank" rel="noreferrer">Danbooru post {post_id}</a></p>')
                for group, terms in community_reference_facets(post.get('tag_string_general', '').split()).items():
                    parts.append('<p><b>' + esc(group) + ':</b> ' + esc(', '.join(t.replace('_', ' ') for t in terms)) + '</p>')
                parts.append('<details><summary>All community general tags</summary><p>' + esc(post.get('tag_string_general', '').replace('_', ' ')) + '</p></details>')
        for model in ['convnext', 'eva']:
            parts.append(f'<h3>{model} · reference details at 0.35</h3>')
            facets = reference_facets(row[model]['tags'])
            for group, tags in facets.items():
                parts.append('<p><b>' + esc(group) + ':</b> ' + esc(', '.join(t['name'].replace('_', ' ') for t in tags)) + '</p>')
            if not facets:
                parts.append('<p>No reference details passed this threshold.</p>')
            parts.append('<details><summary>Full predicted vocabulary</summary>')
            parts.append(f'<h3>{model} · {row[model]["seconds"]:.2f}s</h3><div class="tags">')
            for tag in row[model]['tags']:
                threshold = 'character' if tag['category'] == 'character' else 'general'
                parts.append(f'<span data-score="{tag["confidence"]}" data-kind="{threshold}">{esc(tag["name"].replace("_", " "))} <small>{tag["confidence"]:.2f}</small></span>')
            parts.append('</div></details>')
        florence = row['florence']
        parts.append('<h3>Florence-2 caption</h3><p>' + esc(florence['<DETAILED_CAPTION>']['result']['<DETAILED_CAPTION>']) + '</p>')
        parts.append('<h3>Qwen3-VL · unverified reference suggestions</h3>')
        suggested = captions[row['file']].get('facets')
        if captions[row['file']].get('format_error'):
            parts.append('<p><b>Rejected by the requested output constraints; shown only for evaluation.</b></p>')
            try:
                candidate = json.loads(captions[row['file']]['caption'].removeprefix('```json').removesuffix('```').strip())
                if isinstance(candidate, dict) and all(isinstance(k, str) and isinstance(v, list) and all(isinstance(s, str) for s in v) for k, v in candidate.items()):
                    suggested = candidate
            except ValueError:
                pass
        if suggested:
            for group, details in suggested.items():
                if details:
                    parts.append('<p><b>' + esc(group.replace('_', ' ')) + ':</b> ' + esc(', '.join(details)) + '</p>')
        else:
            parts.append('<p>' + esc(captions[row['file']]['caption']) + '</p>')
        parts.append('<details><summary>Florence OCR · unverified</summary><p>' + esc(florence['<OCR>']['result']['<OCR>']) + '</p></details></div></div></article>')
        cards.append(''.join(parts))
    query_rows = ''.join('<tr><td>' + esc(q['text']) + '</td><td>' + str(q['ranking'].index(q['relevant'][0]) + 1) + '</td></tr>' for q in report['queries'])
    document = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ourchival · private model comparison</title>
<style>body{max-width:1280px;margin:32px auto;padding:0 24px;background:#10131a;color:#e9edf5;font:16px/1.5 system-ui}h1{font-size:32px}h2{font-size:20px}h3{font-size:16px;margin-bottom:8px}p{max-width:80ch;color:#c4cedc}article{border-top:1px solid #445064;padding:24px 0}.comparison{display:grid;grid-template-columns:minmax(240px,36%) 1fr;gap:28px}img{width:100%;max-height:760px;object-fit:contain;background:#202630;position:sticky;top:110px}.tags{display:flex;flex-wrap:wrap;gap:5px}.tags span{background:#273345;border-radius:5px;padding:3px 7px;font-size:14px}.tags span[hidden]{display:none}small{color:#adbfda}header{position:sticky;top:0;background:#10131af5;padding:12px 0;z-index:2}input{vertical-align:middle}table{border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #445064}@media(max-width:750px){.comparison{grid-template-columns:1fr}img{position:static;max-height:500px}}</style>
<h1>Which metadata helps find the image?</h1><p>Private local trial. Predictions are unverified. No annotations were published. Scores are not calibrated probabilities. Reference groups show a curated view at 0.35, preserving the full vocabulary in disclosures. Adjust the slider to compare thresholds inside those disclosures; character terms retain a 0.85 threshold.</p>
<header><label>General threshold <input id="threshold" type="range" min="0.1" max="0.9" step="0.05" value="0.35"> <output id="value">0.35</output></label></header>'''
    document += ''.join(cards) + f'<h2>Descriptive search · SigLIP</h2><p>{len(report["queries"])} queries written before inference, each with an intended target among {len(report["images"])} candidates. This is a small sanity check, not an archive-scale recall benchmark.</p><table><tr><th>Query</th><th>Target rank</th></tr>' + query_rows + '</table>'
    document += '''<script>const slider=document.getElementById('threshold');function update(){document.getElementById('value').value=Number(slider.value).toFixed(2);document.querySelectorAll('[data-score]').forEach(e=>{e.hidden=Number(e.dataset.score)<=(e.dataset.kind==='character'?.85:Number(slider.value));});}slider.addEventListener('input',update);update();</script>'''
    args.output.write_text(document)


if __name__ == '__main__':
    main()
