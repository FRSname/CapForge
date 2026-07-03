"""WhisperX transcription + word alignment service."""

from __future__ import annotations

import gc
import logging
import os
from pathlib import Path
from typing import Any, Callable, Optional

import whisperx

from backend.engine.hardware import detect_hardware
from backend.models.schemas import (
    ComputeType,
    DeviceType,
    JobStatus,
    ModelSize,
    ProgressUpdate,
    Segment,
    TranscribeRequest,
    TranscriptionResult,
    WordSegment,
)

logger = logging.getLogger(__name__)

# Callback type for progress reporting
ProgressCallback = Optional[Callable[[ProgressUpdate], Any]]


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

        hw = detect_hardware()
        device = hw.recommended_device.value
        compute_type = hw.recommended_compute_type.value
        model_size = hw.recommended_model.value

        self._device = device
        self._compute_type = compute_type

        # --- Step 1: Load model ---
        self._report(on_progress, JobStatus.LOADING_MODEL, 5, "Loading WhisperX model…")
        self._load_model(model_size, device, compute_type, on_progress)

        # --- Step 2: Transcribe ---
        self._check_cancelled()
        self._report(on_progress, JobStatus.TRANSCRIBING, 15, "Transcribing audio…")
        audio = whisperx.load_audio(audio_path)
        transcribe_kwargs: dict[str, Any] = {"batch_size": self._pick_batch_size(hw.vram_mb)}
        if request.language:
            transcribe_kwargs["language"] = request.language

        result = self._model.transcribe(audio, **transcribe_kwargs)
        detected_language = result.get("language", request.language)
        self._report(on_progress, JobStatus.TRANSCRIBING, 50, f"Audio transcribed — detected language: {detected_language}")

        # --- Step 3: Align ---
        self._check_cancelled()
        self._report(on_progress, JobStatus.ALIGNING, 55, "Loading alignment model…")
        model_a, metadata = whisperx.load_align_model(
            language_code=detected_language, device=device
        )
        self._report(on_progress, JobStatus.ALIGNING, 60, "Aligning words…")
        result = whisperx.align(
            result["segments"], model_a, metadata, audio, device,
            return_char_alignments=False,
        )
        self._report(on_progress, JobStatus.ALIGNING, 75, "Word alignment complete")

        # Free alignment model
        del model_a
        gc.collect()
        self._try_cuda_empty_cache()

        # --- Step 4: Diarize (optional) ---
        self._check_cancelled()
        if request.enable_diarization and request.hf_token:
            self._report(on_progress, JobStatus.DIARIZING, 78, "Running speaker diarization…")
            from whisperx.diarize import DiarizationPipeline
            diarize_model = DiarizationPipeline(
                use_auth_token=request.hf_token, device=device
            )
            diarize_segments = diarize_model(audio)
            result = whisperx.assign_word_speakers(diarize_segments, result)
            del diarize_model
            gc.collect()
            self._try_cuda_empty_cache()
            self._report(on_progress, JobStatus.DIARIZING, 90, "Diarization complete")
        else:
            self._report(on_progress, JobStatus.ALIGNING, 90, "Skipping diarization")

        # --- Build result ---
        self._report(on_progress, JobStatus.DONE, 95, "Building result…")
        transcription = self._build_result(result, detected_language, audio_path)
        self._report(on_progress, JobStatus.DONE, 100, "Done")
        return transcription

    def unload_model(self) -> None:
        """Free the loaded models (transcription + cached alignment) from memory."""
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
    ) -> list[Segment]:
        """Re-run WhisperX forced alignment on edited segments.

        Used after the user edits a segment's text so every word gets a real
        timestamp instead of one inherited from its neighbor. Returns new
        Segment objects (1:1 with the input) and never touches the stored
        transcription result.
        """
        if not Path(audio_path).is_file():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        device = self._device or detect_hardware().recommended_device.value
        self._load_align_model(language, device)
        audio = whisperx.load_audio(audio_path)
        return [self._realign_one(seg, audio, device) for seg in segments]

    def _realign_one(self, seg: Segment, audio: Any, device: str) -> Segment:
        text = seg.text.strip()
        if not text or seg.end <= seg.start:
            return seg

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
        if not raw_words:
            # Alignment failed outright (e.g. no dictionary characters) —
            # distribute the words evenly across the original window.
            raw_words = [{"word": w} for w in text.split()]

        words = self._fill_word_timings(raw_words, seg.start, seg.end)
        return Segment(
            start=words[0].start if words else seg.start,
            end=words[-1].end if words else seg.end,
            text=seg.text,
            words=words,
            speaker=seg.speaker,
        )

    # --- Private helpers ---

    def _load_model(
        self, model_size: str, device: str, compute_type: str,
        on_progress: ProgressCallback = None,
    ) -> None:
        if self._model is not None and self._model_size == model_size:
            return  # Already loaded
        self.unload_model()
        model_dir = os.environ.get("CAPFORGE_MODEL_DIR")
        kwargs: dict[str, Any] = {"compute_type": compute_type}
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

    def _load_align_model(self, language: str, device: str) -> None:
        if self._align_model is not None and self._align_lang == language:
            return
        if self._align_model is not None:
            del self._align_model
            self._align_model = None
            self._align_metadata = None
            self._align_lang = None
            gc.collect()
            self._try_cuda_empty_cache()
        model_a, metadata = whisperx.load_align_model(
            language_code=language, device=device
        )
        self._align_model = model_a
        self._align_metadata = metadata
        self._align_lang = language

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
        raw: dict, language: Optional[str], audio_path: str
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
