"""WhisperX transcription + word alignment service."""

from __future__ import annotations

import gc
import logging
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional

import whisperx
from huggingface_hub import snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError

from backend.engine.hardware import detect_hardware
from backend.models.schemas import (
    ComputeType,
    DeviceType,
    JobStatus,
    ModelSize,
    ProgressUpdate,
    RealignResponse,
    Segment,
    TranscribeRequest,
    TranscriptionResult,
    WordSegment,
)

logger = logging.getLogger(__name__)

# Speaker-diarization model (gated on HuggingFace — the user's HF token must have
# accepted its conditions at https://huggingface.co/pyannote/speaker-diarization-community-1).
# This is whisperx 3.8.6's default; we pin it explicitly so a library default change
# can't silently swap the model.
DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"

# WhisperX does not provide defaults for every language. Keep CapForge's
# additions in one place so transcription and edited-caption realignment use
# exactly the same model selection.
ALIGNMENT_MODELS: dict[str, tuple[str, str]] = {
    # (repo_id, pinned revision) — verified 2026-07-19; upstream has been
    # unchanged since 2021-11-04. The pin is security-critical because this
    # repository currently distributes pickle weights rather than safetensors.
    "lt": (
        "m3hrdadfi/wav2vec2-large-xlsr-lithuanian",
        "d5b27b07dceb75975ccb840370181ff02edc4c90",
    ),
}

# whisperx.load_audio() always resamples to 16 kHz, so sample count / this is
# the audio duration in seconds (used for the [perf] realtime factor).
AUDIO_SAMPLE_RATE = 16_000

# CTranslate2's CPU thread count. whisperx 3.8.6 defaults to 4; using every core
# measured +32% throughput on an M4 CPU.
DEFAULT_CPU_THREADS = 4

# Callback type for progress reporting
ProgressCallback = Optional[Callable[[ProgressUpdate], Any]]


class ModelConfig(NamedTuple):
    """The resolved (model, device, compute type) triple plus the probe it came
    from. Produced by one helper so warm() and transcribe() can never disagree."""

    model_size: str
    device: str
    compute_type: str
    hardware: Any


@contextmanager
def _timed(step: str, timings: dict[str, float], job: str = "transcribe"):
    """Time one pipeline step, record it, and emit a greppable [perf] line."""
    started = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        timings[step] = elapsed_ms
        logger.info("[perf] job=%s step=%s ms=%d", job, step, round(elapsed_ms))


class TranscriptionCancelled(Exception):
    """Raised when a transcription job is cancelled."""


class Transcriber:
    """High-level transcription service wrapping WhisperX."""

    def __init__(self) -> None:
        self._model = None
        self._model_size: Optional[str] = None
        self._device: Optional[str] = None
        self._compute_type: Optional[str] = None
        self._cancelled = False
        # Guards model loads/unloads: a warm-on-drop may be in flight when the
        # user hits Start. Reentrant because _load_model calls unload_model.
        self._load_lock = threading.RLock()
        # Alignment model cached per language for realign_segments — cheap to
        # keep resident vs. reloading on every word-timing edit.
        self._align_model = None
        self._align_metadata: Optional[dict] = None
        self._align_lang: Optional[str] = None

    def cancel(self) -> None:
        """Signal the running transcription to stop."""
        self._cancelled = True

    def _check_cancelled(self) -> None:
        if self._cancelled:
            raise TranscriptionCancelled("Transcription cancelled by user")

    def warm(
        self,
        model: Optional[ModelSize] = None,
        on_progress: ProgressCallback = None,
    ) -> dict:
        """Pre-load the Whisper model so the first Start doesn't pay for it.

        Resolves model/device/compute exactly like transcribe() does, and takes
        the same load lock — a Start racing a warm simply waits for the load and
        then finds the model already resident.
        """
        cfg = self._resolve_model_config(model)
        started = time.perf_counter()
        with self._load_lock:
            self._device = cfg.device
            self._compute_type = cfg.compute_type
            self._load_model(cfg.model_size, cfg.device, cfg.compute_type, on_progress)
        loaded_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "[perf] job=warm model=%s device=%s load_ms=%d",
            cfg.model_size, cfg.device, loaded_ms,
        )
        return {"model": cfg.model_size, "device": cfg.device, "loaded_ms": loaded_ms}

    def transcribe(
        self,
        request: TranscribeRequest,
        on_progress: ProgressCallback = None,
    ) -> TranscriptionResult:
        """Run the full transcription pipeline: transcribe → align → (diarize)."""
        self._cancelled = False
        audio_path = request.audio_path
        if not Path(audio_path).is_file():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # An explicit request.model wins over the hardware recommendation; device and
        # compute type still come from the hardware, so picking a small model on a
        # CUDA box keeps the fast path.
        cfg = self._resolve_model_config(request.model)
        print(
            f"[capforge] model={cfg.model_size} "
            f"({'explicit' if request.model else 'auto'}) device={cfg.device} "
            f"compute_type={cfg.compute_type}",
            flush=True,
        )

        self._device = cfg.device
        self._compute_type = cfg.compute_type
        timings: dict[str, float] = {}
        job_start = time.perf_counter()

        # --- Step 1: Load model ---
        self._report(on_progress, JobStatus.LOADING_MODEL, 5, "Loading WhisperX model…")
        with _timed("load_model", timings), self._load_lock:
            self._load_model(cfg.model_size, cfg.device, cfg.compute_type, on_progress)

        # --- Step 2: Transcribe ---
        self._check_cancelled()
        self._report(on_progress, JobStatus.TRANSCRIBING, 15, "Transcribing audio…")
        audio = whisperx.load_audio(audio_path)
        transcribe_kwargs: dict[str, Any] = {
            "batch_size": self._pick_batch_size(cfg.hardware.vram_mb)
        }
        if request.language:
            transcribe_kwargs["language"] = request.language

        with _timed("transcribe", timings):
            result = self._model.transcribe(audio, **transcribe_kwargs)
        detected_language = result.get("language", request.language)
        self._report(on_progress, JobStatus.TRANSCRIBING, 50, f"Audio transcribed — detected language: {detected_language}")

        # --- Step 3: Align ---
        self._check_cancelled()
        with _timed("align", timings):
            result, alignment_degraded = self._align_words(
                result, audio, detected_language, cfg.device, on_progress
            )

        # --- Step 4: Diarize (optional) ---
        self._check_cancelled()
        with _timed("diarize", timings):
            result = self._diarize(result, audio, request, cfg.device, on_progress)

        # --- Build result ---
        self._report(on_progress, JobStatus.DONE, 95, "Building result…")
        transcription = self._build_result(
            result,
            detected_language,
            audio_path,
            alignment_degraded=alignment_degraded,
        )
        self._log_job_perf(cfg, audio, transcription, timings, job_start)
        self._report(on_progress, JobStatus.DONE, 100, "Done")
        return transcription

    def _align_words(
        self,
        result: dict,
        audio: Any,
        detected_language: Optional[str],
        device: str,
        on_progress: ProgressCallback,
    ) -> tuple[dict, bool]:
        """Step 3: forced alignment, degrading to approximate word timings.

        Uses the per-language cache, so the alignment model stays resident
        across jobs exactly like the transcription model (unload_model frees it).
        """
        self._report(on_progress, JobStatus.ALIGNING, 55, "Loading alignment model…")
        try:
            self._load_align_model(detected_language, device, on_progress)
            self._report(on_progress, JobStatus.ALIGNING, 60, "Aligning words…")
            aligned = whisperx.align(
                result["segments"], self._align_model, self._align_metadata, audio, device,
                return_char_alignments=False,
            )
            self._report(on_progress, JobStatus.ALIGNING, 75, "Word alignment complete")
            return aligned, False
        except Exception as exc:
            warning = (
                f"Forced alignment unavailable for language {detected_language!r}: "
                f"{exc}. Preserving the transcription with approximate word timings."
            )
            logger.warning(warning, exc_info=True)
            self._report(on_progress, JobStatus.ALIGNING, 75, f"Warning: {warning}")
            return self._add_approximate_word_timings(result), True

    def _diarize(
        self,
        result: dict,
        audio: Any,
        request: TranscribeRequest,
        device: str,
        on_progress: ProgressCallback,
    ) -> dict:
        """Step 4: optional speaker diarization (unchanged behaviour)."""
        if not (request.enable_diarization and request.hf_token):
            self._report(on_progress, JobStatus.ALIGNING, 90, "Skipping diarization")
            return result

        self._report(on_progress, JobStatus.DIARIZING, 78, "Running speaker diarization…")
        from whisperx.diarize import DiarizationPipeline
        # whisperx 3.8.6 renamed `use_auth_token` -> `token`.
        diarize_model = DiarizationPipeline(
            model_name=DIARIZATION_MODEL,
            token=request.hf_token,
            device=device,
        )
        diarize_segments = diarize_model(audio)
        result = whisperx.assign_word_speakers(diarize_segments, result)
        del diarize_model
        gc.collect()
        self._try_cuda_empty_cache()
        self._report(on_progress, JobStatus.DIARIZING, 90, "Diarization complete")
        return result

    def unload_model(self) -> None:
        """Free the loaded models (transcription + cached alignment) from memory."""
        with self._load_lock:
            self._unload_model_locked()

    def _unload_model_locked(self) -> None:
        freed = False
        if self._model is not None:
            del self._model
            self._model = None
            self._model_size = None
            freed = True
        if self._align_model is not None:
            del self._align_model
            self._align_model = None
            self._align_metadata = None
            self._align_lang = None
            freed = True
        if freed:
            gc.collect()
            self._try_cuda_empty_cache()

    def realign_segments(
        self, segments: list[Segment], audio_path: str, language: str
    ) -> RealignResponse:
        """Re-run WhisperX forced alignment on edited segments.

        Used after the user edits a segment's text so every word gets a real
        timestamp instead of one inherited from its neighbor. Returns new
        Segment objects (1:1 with the input) plus whether approximate timings
        had to be used, and never touches the stored transcription result.
        """
        if not Path(audio_path).is_file():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        device = self._device or detect_hardware().recommended_device.value
        try:
            self._load_align_model(language, device)
        except Exception as exc:
            logger.warning(
                "Forced alignment unavailable for language %r during caption "
                "realignment: %s. Returning approximate word timings.",
                language,
                exc,
                exc_info=True,
            )
            return RealignResponse(
                segments=[self._approximate_segment_words(seg) for seg in segments],
                alignment_degraded=True,
            )

        # Only an unavailable alignment model is recoverable. Audio decoding
        # and alignment errors are real failures and must reach the endpoint's
        # 500 handler instead of being disguised as successful approximate data.
        audio = whisperx.load_audio(audio_path)
        aligned_segments: list[Segment] = []
        alignment_degraded = False
        for segment in segments:
            aligned, segment_degraded = self._realign_one(segment, audio, device)
            aligned_segments.append(aligned)
            alignment_degraded = alignment_degraded or segment_degraded
        return RealignResponse(
            segments=aligned_segments,
            alignment_degraded=alignment_degraded,
        )

    def _realign_one(
        self, seg: Segment, audio: Any, device: str
    ) -> tuple[Segment, bool]:
        text = seg.text.strip()
        if not text or seg.end <= seg.start:
            return seg, False

        result = whisperx.align(
            [{"start": seg.start, "end": seg.end, "text": text}],
            self._align_model, self._align_metadata, audio, device,
            return_char_alignments=False,
        )
        # align() may split one segment into sentence-level subsegments —
        # merge the words back so the caller keeps a 1:1 segment mapping.
        raw_words: list[dict] = []
        for sub in result.get("segments", []):
            raw_words.extend(sub.get("words", []))
        alignment_degraded = not raw_words or any(
            word.get("start") is None or word.get("end") is None
            for word in raw_words
        )
        if not raw_words:
            # Alignment failed outright (e.g. no dictionary characters) —
            # distribute the words evenly across the original window.
            raw_words = [{"word": w} for w in text.split()]

        words = self._fill_word_timings(raw_words, seg.start, seg.end)
        return (
            Segment(
                start=words[0].start if words else seg.start,
                end=words[-1].end if words else seg.end,
                text=seg.text,
                words=words,
                speaker=seg.speaker,
            ),
            alignment_degraded,
        )

    # --- Private helpers ---

    @staticmethod
    def _resolve_model_config(model: Optional[ModelSize]) -> ModelConfig:
        """Resolve model/device/compute from the hardware probe.

        The single source of truth for both warm() and transcribe(): an explicit
        model wins, device and compute type always come from the hardware.
        """
        hw = detect_hardware()
        return ModelConfig(
            model_size=(model or hw.recommended_model).value,
            device=hw.recommended_device.value,
            compute_type=hw.recommended_compute_type.value,
            hardware=hw,
        )

    @classmethod
    def _log_job_perf(
        cls,
        cfg: ModelConfig,
        audio: Any,
        transcription: TranscriptionResult,
        timings: dict[str, float],
        job_start: float,
    ) -> None:
        """Emit the one-line [perf] summary for a completed transcription."""
        total_ms = (time.perf_counter() - job_start) * 1000
        audio_s = cls._audio_seconds(audio, transcription)
        parts = [
            "[perf] job=transcribe",
            f"model={cfg.model_size}",
            f"device={cfg.device}",
            f"compute={cfg.compute_type}",
        ]
        if audio_s is not None:
            parts.append(f"audio_s={audio_s:.1f}")
        parts += [
            f"load_ms={round(timings.get('load_model', 0.0))}",
            f"transcribe_ms={round(timings.get('transcribe', 0.0))}",
            f"align_ms={round(timings.get('align', 0.0))}",
            f"diarize_ms={round(timings.get('diarize', 0.0))}",
            f"total_ms={round(total_ms)}",
        ]
        if audio_s is not None and total_ms > 0:
            parts.append(f"rtf={audio_s / (total_ms / 1000):.2f}")
        logger.info(" ".join(parts))

    @staticmethod
    def _audio_seconds(
        audio: Any, transcription: TranscriptionResult
    ) -> Optional[float]:
        """Audio duration for the realtime factor.

        whisperx.load_audio returns a 16 kHz mono array, so the sample count is
        authoritative; anything else falls back to the last segment's end.
        """
        samples: Optional[int] = None
        if not isinstance(audio, (str, bytes, bytearray)):
            shape = getattr(audio, "shape", None)
            if shape:
                samples = int(shape[-1])
            else:
                try:
                    samples = len(audio)
                except TypeError:
                    samples = None
        if samples:
            return samples / AUDIO_SAMPLE_RATE
        if transcription.segments:
            return float(transcription.segments[-1].end)
        return None

    def _load_model(
        self, model_size: str, device: str, compute_type: str,
        on_progress: ProgressCallback = None,
    ) -> None:
        if self._model is not None and self._model_size == model_size:
            return  # Already loaded
        self.unload_model()
        model_dir = os.environ.get("CAPFORGE_MODEL_DIR")
        kwargs: dict[str, Any] = {
            "compute_type": compute_type,
            # CTranslate2 worker threads. whisperx defaults to 4 regardless of
            # the machine; every core measured +32% throughput on an M4 CPU.
            "threads": os.cpu_count() or DEFAULT_CPU_THREADS,
        }
        if model_dir:
            kwargs["download_root"] = model_dir

        # Patch tqdm to forward download progress over the WebSocket.
        # huggingface_hub uses tqdm to report file download bytes; we intercept
        # tqdm.update() calls and translate them into ProgressUpdate events.
        # The patch is applied only for the duration of this call.
        if on_progress:
            try:
                import tqdm as tqdm_module

                _cb = on_progress
                _original_tqdm = tqdm_module.tqdm

                class _ProgressTqdm(_original_tqdm):  # type: ignore[misc]
                    def __init__(self, *args, **kwargs):
                        super().__init__(*args, **kwargs)
                        self._reported_pct = -1

                    def update(self, n=1):
                        super().update(n)
                        if self.total and self.total > 0:
                            pct = min(int(self.n / self.total * 100), 99)
                            if pct != self._reported_pct:
                                self._reported_pct = pct
                                desc = self.desc or "file"
                                mb_done = self.n / 1_048_576
                                mb_total = self.total / 1_048_576
                                _cb(ProgressUpdate(
                                    status=JobStatus.LOADING_MODEL,
                                    progress=5 + pct * 0.09,  # map 0–100% → 5–14%
                                    message=f"Downloading model: {desc} {mb_done:.1f}/{mb_total:.1f} MB",
                                ))

                tqdm_module.tqdm = _ProgressTqdm
                try:
                    self._model = whisperx.load_model(model_size, device, **kwargs)
                finally:
                    tqdm_module.tqdm = _original_tqdm
            except Exception:
                # If patching fails for any reason, just load normally
                self._model = whisperx.load_model(model_size, device, **kwargs)
        else:
            self._model = whisperx.load_model(model_size, device, **kwargs)

        self._model_size = model_size

    def _load_align_model(
        self,
        language: Optional[str],
        device: str,
        on_progress: ProgressCallback = None,
    ) -> None:
        """Load (and keep resident) the alignment model for one language.

        Shared by transcribe() and realign_segments(): the model survives a job
        so back-to-back transcriptions in the same language load it once.
        """
        normalized_language = language.lower() if language else language
        if self._align_model is not None and self._align_lang == normalized_language:
            return
        if self._align_model is not None:
            del self._align_model
            self._align_model = None
            self._align_metadata = None
            self._align_lang = None
            gc.collect()
            self._try_cuda_empty_cache()
        model_a, metadata = self._load_alignment_model(
            normalized_language, device, on_progress
        )
        self._align_model = model_a
        self._align_metadata = metadata
        self._align_lang = normalized_language

    @classmethod
    def _load_alignment_model(
        cls,
        language: Optional[str],
        device: str,
        on_progress: ProgressCallback = None,
    ) -> tuple[Any, dict]:
        """Load CapForge's configured aligner or defer to WhisperX's default."""
        normalized_language = language.lower() if language else language
        kwargs: dict[str, Any] = {
            "language_code": normalized_language,
            "device": device,
        }
        model_config = ALIGNMENT_MODELS.get(normalized_language or "")
        if model_config:
            repo_id, revision = model_config
            try:
                model_path = snapshot_download(
                    repo_id,
                    revision=revision,
                    local_files_only=True,
                )
            except LocalEntryNotFoundError:
                cls._report(
                    on_progress,
                    JobStatus.ALIGNING,
                    55,
                    "Downloading Lithuanian alignment model from Hugging Face "
                    "(one-time, ~1.2 GB)…",
                )
                model_path = snapshot_download(repo_id, revision=revision)
            kwargs["model_name"] = model_path
        return whisperx.load_align_model(**kwargs)

    @classmethod
    def _add_approximate_word_timings(cls, raw: dict) -> dict:
        """Copy a Whisper result and add evenly distributed word timings."""
        result = dict(raw)
        result["segments"] = []
        for raw_segment in raw.get("segments", []):
            segment = dict(raw_segment)
            start = float(segment.get("start", 0.0))
            end = float(segment.get("end", start))
            words = cls._fill_word_timings(
                [{"word": word} for word in segment.get("text", "").split()],
                start,
                end,
            )
            segment["words"] = [word.model_dump(exclude_none=True) for word in words]
            result["segments"].append(segment)
        return result

    @classmethod
    def _approximate_segment_words(cls, seg: Segment) -> Segment:
        """Return an edited segment with evenly distributed word timings."""
        text = seg.text.strip()
        if not text or seg.end <= seg.start:
            return seg
        words = cls._fill_word_timings(
            [{"word": word} for word in text.split()], seg.start, seg.end
        )
        return Segment(
            start=seg.start,
            end=seg.end,
            text=seg.text,
            words=words,
            speaker=seg.speaker,
        )

    @staticmethod
    def _fill_word_timings(
        raw_words: list[dict], seg_start: float, seg_end: float
    ) -> list[WordSegment]:
        """Convert whisperx word dicts to WordSegments, interpolating timings
        for words the aligner couldn't place (e.g. digits — absent from the
        phoneme dictionary). Runs of untimed words share their surrounding
        gap evenly."""
        n = len(raw_words)
        starts: list[Optional[float]] = [w.get("start") for w in raw_words]
        ends: list[Optional[float]] = [w.get("end") for w in raw_words]

        i = 0
        while i < n:
            if starts[i] is not None and ends[i] is not None:
                i += 1
                continue
            run_start = i
            while i < n and (starts[i] is None or ends[i] is None):
                i += 1
            prev_end = ends[run_start - 1] if run_start > 0 else seg_start
            next_start = starts[i] if i < n else seg_end
            run_len = i - run_start
            if next_start <= prev_end:
                # Degenerate gap — give each word a minimal audible duration.
                next_start = prev_end + 0.04 * run_len
            step = (next_start - prev_end) / run_len
            for k in range(run_start, i):
                starts[k] = prev_end + step * (k - run_start)
                ends[k] = prev_end + step * (k - run_start + 1)

        return [
            WordSegment(
                word=w.get("word", ""),
                start=float(starts[idx]),
                end=float(ends[idx]),
                score=w.get("score"),
                speaker=w.get("speaker"),
            )
            for idx, w in enumerate(raw_words)
        ]

    @staticmethod
    def _pick_batch_size(vram_mb: Optional[int]) -> int:
        if vram_mb is None:
            return 8
        if vram_mb >= 10_000:
            return 32
        if vram_mb >= 6_000:
            return 16
        return 8

    @staticmethod
    def _build_result(
        raw: dict,
        language: Optional[str],
        audio_path: str,
        alignment_degraded: bool = False,
    ) -> TranscriptionResult:
        segments: list[Segment] = []
        for seg in raw.get("segments", []):
            words: list[WordSegment] = []
            for w in seg.get("words", []):
                if "start" in w and "end" in w and "word" in w:
                    words.append(WordSegment(
                        word=w["word"],
                        start=w["start"],
                        end=w["end"],
                        score=w.get("score"),
                        speaker=w.get("speaker"),
                    ))
            segments.append(Segment(
                start=seg.get("start", 0.0),
                end=seg.get("end", 0.0),
                text=seg.get("text", ""),
                words=words,
                speaker=seg.get("speaker"),
            ))

        # Probe actual media duration so renders cover the full file
        media_duration: Optional[float] = None
        try:
            import shutil
            import subprocess
            ffprobe = shutil.which("ffprobe")
            if ffprobe:
                out = subprocess.run(
                    [ffprobe, "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
                    capture_output=True, text=True, timeout=10,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if out.returncode == 0 and out.stdout.strip():
                    media_duration = float(out.stdout.strip())
        except Exception:
            pass

        return TranscriptionResult(
            segments=segments,
            language=language,
            audio_path=audio_path,
            duration=media_duration,
            alignment_degraded=alignment_degraded,
        )

    @staticmethod
    def _report(
        cb: ProgressCallback, status: JobStatus, progress: float, message: str
    ) -> None:
        if cb:
            cb(ProgressUpdate(status=status, progress=progress, message=message))
        logger.info("[%s %.0f%%] %s", status.value, progress, message)

    @staticmethod
    def _try_cuda_empty_cache() -> None:
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
