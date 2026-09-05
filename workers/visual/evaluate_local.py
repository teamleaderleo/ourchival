#!/usr/bin/env python3
"""Offline comparison on a private image manifest. Never publishes annotations."""
import argparse
import json
import time
import os
import platform
import importlib.metadata
from pathlib import Path

from worker import WDTagger, SigLIP, decode_image, sha256_file, stable_digest


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--queries', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--eva', type=Path, required=True)
    parser.add_argument('--florence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output; preserve previous runs.')
    rows = json.loads(args.images.read_text())
    queries = json.loads(args.queries.read_text())
    config = json.loads(args.config.read_text())
    report = {'images': [], 'queries': queries, 'models': {}, 'timings': {},
              'runtime': {'python': platform.python_version(), **{name: importlib.metadata.version(name)
                          for name in ['torch', 'transformers', 'onnxruntime', 'pillow', 'numpy']}}}
    images = []
    for row in rows:
        path = args.images.parent / row['file']
        if sha256_file(path) != row['sha256']:
            raise ValueError('Input changed since sample selection')
        images.append(decode_image(path.read_bytes()))
        report['images'].append({'file': row['file'], 'sha256': row['sha256']})

    def checkpoint():
        args.output.write_text(json.dumps(report, indent=2))

    eva = json.loads(args.eva.read_text())
    directory = Path(eva['directory'])
    eva.update(model={'path': str(directory / 'model.onnx'), 'sha256': sha256_file(directory / 'model.onnx')},
               labels={'path': str(directory / 'selected_tags.csv'), 'sha256': sha256_file(directory / 'selected_tags.csv')})
    for name, spec in [('convnext', config['wd']), ('eva', eva)]:
        start = time.perf_counter()
        model = WDTagger({**spec, 'general_threshold': .01}, args.config.parent)
        report['models'][name] = model.provenance
        report['timings'][name + '_load'] = time.perf_counter() - start
        for item, image in zip(report['images'], images):
            start = time.perf_counter()
            tags, _ = model.run(image)
            item[name] = {'tags': tags, 'seconds': time.perf_counter() - start}
        checkpoint()
        print(name, 'complete', flush=True)
        del model

    start = time.perf_counter()
    model = SigLIP(config['siglip'], args.config.parent)
    report['models']['siglip'] = model.provenance
    report['timings']['siglip_load'] = time.perf_counter() - start
    vectors = []
    for item, image in zip(report['images'], images):
        start = time.perf_counter()
        vectors.append(model.features(image=image))
        item['siglip_seconds'] = time.perf_counter() - start
    for query in queries:
        start = time.perf_counter()
        vector = model.features(text=query['text'])
        scores = [float(vector @ other) for other in vectors]
        query['ranking'] = [rows[i]['file'] for i in sorted(range(len(rows)), key=lambda i: -scores[i])]
        query['scores'] = scores
        query['seconds'] = time.perf_counter() - start
    checkpoint()
    print('siglip complete', flush=True)
    del model

    import torch
    from transformers import AutoProcessor, Florence2ForConditionalGeneration
    spec = json.loads(args.florence.read_text())
    directory = Path(spec['directory'])
    manifest = {str(p.relative_to(directory)): sha256_file(p) for p in directory.rglob('*')
                if p.is_file() and '.cache' not in p.parts}
    report['models']['florence'] = {**spec, 'manifest_digest': stable_digest(manifest), 'files': manifest}
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    report['florence_device'] = device
    start = time.perf_counter()
    processor = AutoProcessor.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
    model = Florence2ForConditionalGeneration.from_pretrained(directory, local_files_only=True,
                trust_remote_code=False, use_safetensors=True).to(device).eval()
    report['timings']['florence_load'] = time.perf_counter() - start
    for item, image in zip(report['images'], images):
        item['florence'] = {}
        for task in ['<DETAILED_CAPTION>', '<OCR>']:
            start = time.perf_counter()
            inputs = processor(text=task, images=image, return_tensors='pt').to(device)
            with torch.inference_mode():
                ids = model.generate(**inputs, max_new_tokens=256, num_beams=3, do_sample=False)
            text = processor.batch_decode(ids, skip_special_tokens=False)[0]
            result = processor.post_process_generation(text, task=task, image_size=image.size)
            item['florence'][task] = {'result': result, 'seconds': time.perf_counter() - start}
        checkpoint()
        print('caption/OCR', item['file'], 'complete', flush=True)
    for image in images:
        image.close()


if __name__ == '__main__':
    main()
