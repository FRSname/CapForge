"""WhisperX transcription + word alignment service."""

from __future__ import annotations

import gc
import logging
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
        self._load_model(model_size, device, compute_type)

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
        """Free the loaded model from memory."""
        if self._model is not None:
            del self._model
            self._model = None
            self._model_size = None
            gc.collect()
            self._try_cuda_empty_cache()

    # --- Private helpers ---

    def _load_model(self, model_size: str, device: str, compute_type: str) -> None:
        if self._model is not None and self._model_size == model_size:
            return  # Already loaded
        self.unload_model()
        self._model = whisperx.load_model(model_size, device, compute_type=compute_type)
        self._model_size = model_size

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
        return TranscriptionResult(
            segments=segments,
            language=language,
            audio_path=audio_path,
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
