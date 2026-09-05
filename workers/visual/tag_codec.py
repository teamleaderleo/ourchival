"""Versioned sparse tag payload. Dictionary and recipe are shared separately.

Version 1: OTG + version byte, uint32 count, then sorted uint32 code / float64
score pairs, big endian. Scores are lossless; codes are never local list offsets.
This codec is opt-in and does not migrate the live catalog.
"""
import math
import struct

HEADER = b'OTG\x01'
MAX_TAGS = 4096


def encode(entries):
    entries = list(entries)
    if len(entries) > MAX_TAGS:
        raise ValueError('Too many tags')
    seen = set()
    for code, score in entries:
        if type(code) is not int or not 1 <= code <= 0xffffffff or code in seen:
            raise ValueError('Codes must be unique uint32 identifiers greater than zero')
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError('Invalid score')
        seen.add(code)
    return HEADER + struct.pack('>I', len(entries)) + b''.join(
        struct.pack('>Id', code, score) for code, score in sorted(entries))


def decode(payload):
    if len(payload) < 8 or payload[:4] != HEADER:
        raise ValueError('Unknown or truncated tag encoding')
    count, = struct.unpack('>I', payload[4:8])
    if count > MAX_TAGS or len(payload) != 8 + count * 12:
        raise ValueError('Invalid payload length')
    entries = [struct.unpack_from('>Id', payload, 8 + i * 12) for i in range(count)]
    if encode(entries) != payload:
        raise ValueError('Noncanonical payload')
    return entries
