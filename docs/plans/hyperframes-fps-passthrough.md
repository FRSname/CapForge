# Plan: HyperFrames render fps passthrough (25fps → 30fps bug)

**Status:** IMPLEMENTED (2026-06-30) — not yet committed
**Owner:** —
**Created:** 2026-06-30

## Implementation summary

Phase 0 → **Case A** (CLI v0.7.21 honors arbitrary integer fps; 25 verified). Phase 2 skipped. Implemented Phase 1 + 3 + 4:
- `backend/exporters/hyperframes_render.py`: added `_render_fps()` (clamp to CLI's 1-240), `fps: int = 30` param, and `"--fps", str(_render_fps(fps))` into the render `cmd`.
- `backend/main.py:742,765`: both `render_hyperframes_project(...)` call sites pass `fps=config.fps`.
- `backend/exporters/hyperframes_project.py:471`: composition root carries `data-fps="{int(config.fps)}"`.
- `backend/tests/test_hyperframes_render.py`: +4 tests (`_render_fps` passthrough/clamp; cmd includes requested fps; defaults to 30). `backend/tests/test_hyperframes_project.py`: +2 tests (root carries source fps / defaults to config).
- **Verification:** end-to-end via the real edited functions — synth 25fps source → `export_hyperframes_project(fps=25)` emits `data-fps="25"` → `render_hyperframes_project(fps=25)` → ffprobe `r_frame_rate=25/1 avg_frame_rate=25/1 nb_frames=50`. Full backend suite **203 passed / 11 skipped**; opt-in caption parity **11 passed** (no parity regression).

## Problem

A user imports a **25 fps** video into CapForge, opens it in HyperFrames Studio, renders, and the final video is **30 fps**. The classic Pillow export does not have this bug — only the HyperFrames render path does.

**Symptom framing (correct the intuition):** HyperFrames composition duration is expressed in **seconds** (`data-duration`), and caption animation is GSAP time-based, so a wrong render fps does **not** change playback speed or caption sync. The real damage is: (1) the output container reports the wrong frame rate (non-conforming for editing/delivery), and (2) the 25 fps source `<video>` is resampled to 30 fps during DOM capture → duplicated/uneven frames → **motion judder**. The fix is to render at the source's fps so frames align 1:1.

## Root cause (evidence)

fps is detected and forwarded correctly the entire way — **the HyperFrames render call is the only place it is dropped.**

| Stage | File:line | Behavior |
|---|---|---|
| Detect source fps | `backend/main.py` ~323 (`/api/video-info`) | reads `r_frame_rate` → float. ✅ correct |
| Snap in UI | `src/renderer/src/components/studio/StudioPanel.tsx` (`snapFps`, `FPS_PRESETS=[24,25,30,48,50,60]`) | 25 → 25 (exact). ✅ correct |
| Send to backend | `src/renderer/src/lib/render.ts` (`buildRenderBody`) | `fps` included in config for **both** render paths. ✅ correct |
| Schema | `backend/models/schemas.py:151` | `fps: int = Field(30, ge=1, le=120)` — default 30 but overridden by the real value. ✅ |
| Classic Pillow render | `backend/exporters/video_render.py` (multiple) | passes `-r str(config.fps)` to FFmpeg. ✅ honors fps |
| **HyperFrames render** | **`backend/exporters/hyperframes_render.py:89-94`** | `cmd = [*hf, "render", "--quality", quality, "--format", video_format, "--output", str(out)]` — **no `--fps`** ❌ |
| **HyperFrames composition root** | **`backend/exporters/hyperframes_project.py` ~471** | root `<div id="root" … data-duration="{duration}">` — **no `data-fps`** ❌ |
| HyperFrames CLI default | `~/.agents/skills/hyperframes-cli/SKILL.md:107` | `--fps` default = **30** → that is what we get |

Two render call sites pass through `render_hyperframes_project` and both omit fps:
- `backend/main.py:739` — co-author render-to-file
- `backend/main.py:761` — classic scaffold-and-render-to-file

`config` (a `VideoRenderConfig`, so `config.fps` is in scope) is available at both sites.

---

## Phase 0 — Documentation discovery & empirical CLI fps check (DO FIRST)

**Why this phase exists:** the fix depends on one fact we have NOT proven empirically — whether the HyperFrames CLI accepts an **arbitrary** integer fps or only the documented set **{24, 30, 60}**. 25 is not in that set. The implementation branches on the answer.

### Allowed APIs (cited)
- **CLI flag:** `npx hyperframes render --fps <n>` — documented options `24, 30, 60`, default `30`. Source: `/Users/tobbot/.agents/skills/hyperframes-cli/SKILL.md:99,107`. Example: `npx hyperframes render --fps 60 --quality high`.
- **Composition attribute:** `data-fps` on the `data-composition-id="root"` element — documented as an *optional frame-rate hint*; "CLI render flags can override output fps." Source: `/Users/tobbot/.agents/skills/hyperframes-core/references/data-attributes.md` (the `data-fps` / `data-duration` rows). `data-duration` is **seconds**, not frames.
- **CapForge render wrapper:** `render_hyperframes_project(project_dir, output_path, quality, video_format, on_progress)` in `backend/exporters/hyperframes_render.py:73`.

### Task 0.1 — Prove the CLI's fps acceptance empirically
Render any existing tiny composition twice and ffprobe the output frame rate:

```bash
# from a scratch HyperFrames project dir (or generate one via the app)
npx hyperframes render --fps 25 --quality draft --format mp4 --output /tmp/hf_fps25.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,avg_frame_rate \
  -of default=nw=1 /tmp/hf_fps25.mp4
```

Record the outcome into this file under "Phase 0 result":
- **Case A — output is 25 fps and exit 0:** the CLI accepts arbitrary fps → implement Phase 1 only, passing `config.fps` through unchanged.
- **Case B — CLI errors, or output is not 25 (e.g. silently 30/24):** the CLI restricts fps → implement Phase 1 **and** Phase 2 (snap-to-supported helper). Also determine the true supported set (try `--fps 50`, `--fps 48`) and record it.

**Anti-pattern guard:** do not assume Case A. Do not hardcode `25`. Run the probe and write the result here before editing code.

### Task 0.2 — Confirm `config.fps` is populated in co-author mode
Add a temporary log (or read the request flow) to confirm the `VideoRenderConfig` reaching `/api/export-hyperframes` carries the user's fps (25), not the schema default (30), in **both** UI render and co-author render. The frontend sets `settings.fps = snapFps(source)`, so this should hold — confirm, don't assume.

**Phase 0 result (2026-06-30):** **Case A.** Installed CLI is **v0.7.21** (newer than the skill doc's stale 24/30/60 claim). `render --help` states `--fps` *"Accepts integer (24, 25, 30, 50, 60, 120, 240) or ffmpeg-style rational … Range 1-240. (Default: 30)"*. Empirical probe (`/tmp/hf_probe`, 2s composition, `--fps 25`) produced `r_frame_rate=25/1 avg_frame_rate=25/1 duration=2.0 nb_frames=50`. → The CLI honors arbitrary integer fps including 25. **Implement Phase 1 only; skip Phase 2 (no snapping).** A defensive clamp to the CLI's documented 1-240 range is the only mapping needed (`config.fps` is already Pydantic-validated to 1-120, so the clamp is belt-and-suspenders).

---

## Phase 1 — Thread `config.fps` into the HyperFrames CLI render (always)

### Task 1.1 — Add an `fps` parameter to the render wrapper
**File:** `backend/exporters/hyperframes_render.py`

Copy the existing signature and add one typed parameter + one cmd entry. Change `render_hyperframes_project` (line 73) to:

```python
def render_hyperframes_project(
    project_dir: str,
    output_path: str,
    quality: str = "draft",
    video_format: str = "mp4",
    fps: int = 30,
    on_progress: Optional[Callable[[float, str], None]] = None,
) -> str:
```

And the `cmd` list (lines 89-94) to:

```python
    cmd = [
        *hf, "render",
        "--quality", quality,
        "--format", video_format,
        "--fps", str(_hyperframes_fps(fps)),
        "--output", str(out),
    ]
```

Add a module-level helper near the top of the file (after `_FRAME_RE`). In **Case A** make it the identity; in **Case B** make it snap (Phase 2 fills the body):

```python
def _hyperframes_fps(fps: int) -> int:
    """Map a requested fps to one the HyperFrames CLI renders at."""
    return int(fps)  # Case A: CLI accepts arbitrary fps. Case B: see Phase 2.
```

**Anti-pattern guards:**
- Keep `fps` keyword-only-by-convention (pass it as `fps=` at call sites) so the existing positional `on_progress` callers are unaffected.
- Do **not** drop the `--output`/relocate logic — the `_discover_output` fallback at line 134 must stay.
- Do **not** invent flags. Only `--fps` is documented (`SKILL.md:107`).

### Task 1.2 — Pass `config.fps` at both call sites
**File:** `backend/main.py`

At **line 739** (co-author) and **line 761** (classic), add `fps=config.fps`:

```python
            file = render_hyperframes_project(
                project_dir, out_path,
                quality=request.quality, video_format=request.video_format,
                fps=config.fps,
                on_progress=on_progress,
            )
```

(`config` is already in scope at both sites — it is the `VideoRenderConfig` passed to `_scaffold`.)

### Task 1.3 — Add `data-fps` to the composition root (parity hint)
**File:** `backend/exporters/hyperframes_project.py` (root `<div id="root" …>` ~line 471, inside `_build_index_html`)

Add `data-fps="{int(config.fps)}"` to the root div (confirm `config` is in scope in that function — `export_hyperframes_project` already passes it through). This documents the intended fps on the composition itself and keeps Studio's own render aligned even when the CLI flag isn't supplied. The CLI `--fps` flag still wins, so this is belt-and-suspenders, not the primary fix.

**Anti-pattern guard:** `data-duration` stays seconds — do **not** convert it to frames or multiply by fps. Only add the `data-fps` attribute.

---

## Phase 2 — fps reconciliation (ONLY if Phase 0 = Case B)

Skip this phase entirely if Phase 0 proved the CLI accepts arbitrary fps.

### Task 2.1 — Implement snapping in `_hyperframes_fps`
Fill the helper from Task 1.1 to snap to the CLI's true supported set (from Phase 0.1). Example for `{24, 30, 60}`:

```python
_HYPERFRAMES_FPS_SUPPORTED = (24, 30, 60)  # from SKILL.md:107 / Phase 0 probe

def _hyperframes_fps(fps: int) -> int:
    """Snap a requested fps to the nearest HyperFrames-supported value.

    The CLI's --fps only accepts {24, 30, 60}; a 25fps source maps to 24
    (nearest), which avoids the 25→30 upsample judder of the default.
    """
    return min(_HYPERFRAMES_FPS_SUPPORTED, key=lambda f: (abs(f - fps), f))
```

### Task 2.2 — Surface the mismatch to the user
When `_hyperframes_fps(fps) != fps`, log a warning in `render_hyperframes_project` and include a one-line note in the success message / returned payload so the UI can toast it (e.g. "Source is 25 fps; HyperFrames rendered at 24 fps — the engine supports 24/30/60."). Wire it through the existing `on_progress`/return path; do not add a new endpoint.

**Anti-pattern guards:**
- Do not silently snap with no signal — the user reported fps as a defect, so a silent 25→24 is still surprising.
- Do not change `FPS_PRESETS` in the frontend to break the classic Pillow path (which *does* support 25). Reconciliation belongs in the HyperFrames backend path only.

---

## Phase 3 — Tests

### Task 3.1 — Unit test the cmd construction
**File:** `backend/tests/test_hyperframes_render.py` (create if absent; mirror existing test style).

- Assert `render_hyperframes_project(..., fps=25)` builds a `cmd` containing `"--fps"` followed by the expected value. Mock `subprocess.Popen` / `_hyperframes_cmd` so no Node is required (follow the mocking already used in the suite).
- Case A: `--fps` value == `"25"`. Case B: `--fps` value == `"24"` and assert `_hyperframes_fps(25) == 24`, `_hyperframes_fps(30) == 30`, `_hyperframes_fps(60) == 60`.

### Task 3.2 — Guard against regression
Add a test asserting the default-arg behavior is unchanged for existing positional callers (no fps passed → 30), so we don't break `on_progress` ordering.

---

## Phase 4 — Verification

### Task 4.1 — Real end-to-end render
1. Run the backend (`python -m uvicorn backend.main:app --host 127.0.0.1 --port 53421`).
2. In the app, import a **true 25 fps** clip (confirm with `ffprobe -select_streams v:0 -show_entries stream=r_frame_rate <src>`).
3. Render via HyperFrames (both render-to-file **and** co-author render if available).
4. ffprobe the output:
   ```bash
   ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate,r_frame_rate \
     -of default=nw=1 <output>
   ```
   **Expected:** Case A → `25/1`. Case B → `24/1` (nearest supported) with the warning surfaced.

### Task 4.2 — No parity/golden regressions
fps doesn't affect frame *content*, but run the existing suites to be safe:
```bash
.venv-dev/bin/python -m pytest backend/tests/test_render_golden.py backend/tests/test_hyperframes_project.py -q
CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q   # opt-in, needs Node 22 + ffmpeg
```

### Task 4.3 — Grep guards
```bash
grep -n "fps" backend/exporters/hyperframes_render.py   # --fps present in cmd
grep -n "fps=config.fps" backend/main.py                # both call sites (739, 761)
grep -n "data-fps" backend/exporters/hyperframes_project.py
```
Confirm no stray hardcoded `30` was introduced near the HyperFrames render path.

---

## Out of scope / deliberately not changed
- `VideoRenderConfig.fps` default of 30 — fine; the frontend always sends the real fps.
- Classic Pillow path — already correct; do not touch.
- `FPS_PRESETS` in the frontend — leave; the 24/30/60 constraint is HyperFrames-only and handled backend-side.
