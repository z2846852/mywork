#!/usr/bin/env python3
"""Inspect the exact bundled TFLite FlatBuffer using Python stdlib only.

This smoke check runs on the SAME SHA256-verified file that is packed into APK.
It catches model swaps and input/output shape assumptions before compilation.
"""
from pathlib import Path
import struct

data = Path("app/src/main/assets/yamnet.tflite").read_bytes()
assert data[4:8] == b"TFL3", "Not a TFLite FlatBuffer"

def u16(pos):
    return struct.unpack_from("<H", data, pos)[0]

def u32(pos):
    return struct.unpack_from("<I", data, pos)[0]

def i32(pos):
    return struct.unpack_from("<i", data, pos)[0]

def field(table, slot):
    vtable = table - i32(table)
    if 4 + slot * 2 + 2 > u16(vtable):
        return None
    offset = u16(vtable + 4 + slot * 2)
    return table + offset if offset else None

def vector(table, slot):
    p = field(table, slot)
    if p is None:
        return [], None
    start = p + u32(p)
    length = u32(start)
    return [start + 4 + 4 * i for i in range(length)], start

def table_vector(table, slot):
    positions, _ = vector(table, slot)
    return [p + u32(p) for p in positions]

def int_vector(table, slot):
    positions, _ = vector(table, slot)
    return [i32(p) for p in positions]

def tensor(subgraph, index):
    tensors = table_vector(subgraph, 0)
    t = tensors[index]
    dtype_field = field(t, 1)
    dtype = data[dtype_field] if dtype_field is not None else 0
    return {
        "index": index,
        "shape": int_vector(t, 0),
        "signature": int_vector(t, 7),
        "type": dtype,  # 0 = FLOAT32
    }

model = u32(0)
subgraphs = table_vector(model, 2)
assert len(subgraphs) == 1, f"Unexpected subgraph count: {len(subgraphs)}"
sg = subgraphs[0]
ins = [tensor(sg, idx) for idx in int_vector(sg, 1)]
outs = [tensor(sg, idx) for idx in int_vector(sg, 2)]
print("YAMNet actual input tensor(s):", ins)
print("YAMNet actual output tensor(s):", outs)
assert len(ins) == len(outs) == 1, "Expected one input/output tensor"
inp, out = ins[0], outs[0]
assert inp["type"] == out["type"] == 0, "Expected float32 input/output"
assert len(inp["shape"]) in (1, 2), "YAMNet input must have 1 or 2 dimensions"
if len(inp["shape"]) == 2:
    assert inp["shape"][0] == 1, "Unsupported model batch dimension"
assert out["shape"] == [1, 521], "Unexpected 521-class output tensor"
print("YAMNet FlatBuffer tensor validation passed")
