"""Regenerate golden frames for test_render_golden.py.

Usage (from the repo root):

    .venv-dev/bin/python -m backend.tests.gen_golden            # write to backend/tests/golden/
    .venv-dev/bin/python -m backend.tests.gen_golden /tmp/out   # write elsewhere (determinism checks)

Always review the regenerated PNGs visually before committing — they define
what "correct" rendering looks like.
"""

import sys
from pathlib import Path

from backend.tests.test_render_golden import GOLDEN_DIR, SCENARIOS, render_scenario


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else GOLDEN_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in sorted(SCENARIOS):
        path = out_dir / f"{name}.png"
        render_scenario(name).save(path)
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
