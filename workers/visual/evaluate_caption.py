#!/usr/bin/env python3
"""Offline Qwen caption comparison; private outputs only, no catalog writes."""
import argparse
import json
import time
import os
import platform
import importlib.metadata
from pathlib import Path
from worker import decode_image, sha256_file, stable_digest


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--task', choices=['caption', 'reference'], default='caption')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output to preserve previous results.')
    import torch
    from transformers import AutoProcessor, Qwen3VLForConditionalGeneration
    spec = json.loads(args.model.read_text())
    directory = Path(spec['directory'])
    manifest = {str(p.relative_to(directory)): sha256_file(p) for p in directory.rglob('*')
                if p.is_file() and '.cache' not in p.parts}
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    dtype = torch.float16 if device == 'mps' else torch.float32
    prompt = ('Describe visible details useful for finding this image later: subjects, hair and clothing colors, '
              'pose, objects, setting, composition and lighting. Use at most two concise sentences. '
              'Do not guess character names, artists, brands, ages, identities, emotions or story. '
              'Omit details that are not clearly visible.')
    if args.task == 'reference':
        prompt = ('Describe this image as an artist reference. Return only a JSON object with these keys: '
                  'pose, viewpoint, framing, lighting, clothing_details, expression, composition. '
                  'Each value must be an array of zero to two short, concrete visible details, each under seven words. '
                  'Use empty arrays for unclear or absent details. Focus on gesture, camera angle, depth, '
                  'fabric construction, light and arrangement. Do not guess names, artists, ages, identities, '
                  'story, personality, materials, or why someone saved it. Do not equate mood with visible expression.')
    result = {'model': spec, 'files': manifest, 'manifest_digest': stable_digest(manifest),
              'device': device, 'dtype': str(dtype), 'prompt': prompt, 'task': args.task, 'images': [],
              'runtime': {'python': platform.python_version(), **{name: importlib.metadata.version(name)
                          for name in ['torch', 'transformers', 'torchvision', 'pillow']}}}
    start = time.perf_counter()
    processor = AutoProcessor.from_pretrained(directory, local_files_only=True, trust_remote_code=False,
                                               min_pixels=256*28*28, max_pixels=512*28*28)
    model = Qwen3VLForConditionalGeneration.from_pretrained(directory, local_files_only=True,
                trust_remote_code=False, use_safetensors=True, dtype=dtype).to(device).eval()
    result['load_seconds'] = time.perf_counter() - start
    for row in json.loads(args.images.read_text()):
        path = args.images.parent / row['file']
        if sha256_file(path) != row['sha256']:
            raise ValueError('Sample bytes changed')
        image = decode_image(path.read_bytes())
        start = time.perf_counter()
        messages = [{'role': 'user', 'content': [{'type': 'image', 'image': image}, {'type': 'text', 'text': prompt}]}]
        inputs = processor.apply_chat_template(messages, tokenize=True, add_generation_prompt=True,
                                                return_dict=True, return_tensors='pt').to(device)
        with torch.inference_mode():
            output = model.generate(**inputs, max_new_tokens=256 if args.task == 'reference' else 160, do_sample=False)
        text = processor.batch_decode(output[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0]
        item = {'file': row['file'], 'sha256': row['sha256'], 'caption': text,
                'seconds': time.perf_counter() - start}
        if args.task == 'reference':
            try:
                facets = json.loads(text.removeprefix('```json').removeprefix('```').removesuffix('```').strip())
                keys = {'pose', 'viewpoint', 'framing', 'lighting', 'clothing_details', 'expression', 'composition'}
                valid = isinstance(facets, dict) and set(facets) == keys and all(
                    isinstance(v, list) and len(v) <= 2 and all(isinstance(s, str) and len(s.split()) < 7 for s in v)
                    for v in facets.values())
                if valid:
                    item['facets'] = facets
                else:
                    item['format_error'] = 'Output did not meet the requested structure'
            except (ValueError, TypeError):
                item['format_error'] = 'Output was not valid JSON'
        result['images'].append(item)
        args.output.write_text(json.dumps(result, indent=2))
        image.close()
        print(row['file'], 'complete', flush=True)


if __name__ == '__main__':
    main()
