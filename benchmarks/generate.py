"""Generate deterministic JSONL benchmark inputs without holding them in memory."""

import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
parser.add_argument("--mib", type=int, default=100)
parser.add_argument("--payload", type=int, default=1024)
args = parser.parse_args()
if args.mib <= 0 or args.payload < 0:
    parser.error("mib must be positive and payload nonnegative")
args.output.parent.mkdir(parents=True, exist_ok=True)
target = args.mib * 1024 * 1024
written = 0
line = 0
with args.output.open("wb") as stream:
    while written < target:
        record = {
            "id": line,
            "payload": "x" * args.payload,
            "metadata": {"split": "evaluation", "valid": True},
            "scores": [0.1, 0.5, 0.9],
        }
        data = (json.dumps(record, separators=(",", ":")) + "\n").encode()
        stream.write(data)
        written += len(data)
        line += 1
print(json.dumps({"bytes": written, "lines": line, "payload": args.payload}))
