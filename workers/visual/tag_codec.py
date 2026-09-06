"""Lossless scored tags, shared with convex/lib/tagCodec.ts.

OTG v1: uint32 count followed by uint32 code / float64 score pairs, big endian.
OTG v2: same header/count, unsigned LEB128 positive code deltas / float64 scores.
The catalog uses the smaller encoding; readers retain support for both versions.
Codes refer to a shared dictionary, never local list offsets or bit positions.
"""
import math
import struct

MAX_TAGS = 4096


def encode(entries, version=None):
    entries = list(entries)
    if len(entries) > MAX_TAGS:
        raise ValueError('Too many tags')
    if version not in (None, 1, 2):
        raise ValueError('Unknown tag encoding')
    seen = set()
    for code, score in entries:
        if type(code) is not int or not 1 <= code <= 0xffffffff or code in seen:
            raise ValueError('Codes must be unique uint32 identifiers greater than zero')
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError('Invalid score')
        seen.add(code)
    entries.sort()
    variable = bytearray()
    previous = 0
    for code, score in entries:
        delta = code - previous
        while delta >= 128:
            variable.append((delta & 127) | 128)
            delta >>= 7
        variable.append(delta)
        variable.extend(struct.pack('>d', score))
        previous = code
    version = version or (2 if len(variable) < len(entries) * 12 else 1)
    body = bytes(variable) if version == 2 else b''.join(
        struct.pack('>Id', code, score) for code, score in entries)
    return b'OTG' + bytes([version]) + struct.pack('>I', len(entries)) + body


def decode(payload):
    if len(payload) < 8 or payload[:3] != b'OTG' or payload[3] not in (1, 2):
        raise ValueError('Unknown or truncated tag encoding')
    version = payload[3]
    count, = struct.unpack('>I', payload[4:8])
    if count > MAX_TAGS or (version == 1 and len(payload) != 8 + count * 12):
        raise ValueError('Invalid payload length')
    entries = []
    offset = 8
    previous = 0
    for _ in range(count):
        if version == 1:
            code, = struct.unpack_from('>I', payload, offset)
            offset += 4
        else:
            delta = 0
            for n in range(5):
                if offset >= len(payload):
                    raise ValueError('Truncated tag delta')
                byte = payload[offset]
                offset += 1
                delta += (byte & 127) << (n * 7)
                if not byte & 128:
                    if (n and byte == 0) or not 1 <= delta <= 0xffffffff:
                        raise ValueError('Noncanonical tag delta')
                    break
            else:
                raise ValueError('Oversized tag delta')
            code = previous + delta
        if offset + 8 > len(payload):
            raise ValueError('Truncated tag score')
        score, = struct.unpack_from('>d', payload, offset)
        offset += 8
        if code <= previous:
            raise ValueError('Noncanonical tag order')
        entries.append((code, score))
        previous = code
    if offset != len(payload) or encode(entries, version=version) != payload:
        raise ValueError('Noncanonical payload')
    return entries
