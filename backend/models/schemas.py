from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# --- Enums ---

class DeviceType(str, Enum):
    CUDA = "cuda"
    CPU = "cpu"


class ComputeType(str, Enum):
    FLOAT32 = "float32"
    FLOAT16 = "float16"
    INT8 = "int8"


class ModelSize(str, Enum):
    TINY = "tiny"
    BASE = "base"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    LARGE_V2 = "large-v2"
    LARGE_V3 = "large-v3"


class JobStatus(str, Enum):
    IDLE = "idle"
    LOADING_MODEL = "loading_model"
    TRANSCRIBING = "transcribing"
    ALIGNING = "aligning"
    DIARIZING = "diarizing"
    EXPORTING = "exporting"
    DONE = "done"
    ERROR = "error"


class ExportFormat(str, Enum):
    SRT_WORD = "srt_word"
    SRT_STANDARD = "srt_standard"
    JSON = "json"
    VTT = "vtt"
    SUBFORGE = "subforge"


# --- System Info ---

class SystemInfo(BaseModel):
    has_cuda: bool = False
    gpu_name: Optional[str] = None
    vram_mb: Optional[int] = None
    recommended_device: DeviceType = DeviceType.CPU
    recommended_compute_type: ComputeType = ComputeType.FLOAT32
    recommended_model: ModelSize = ModelSize.BASE


# --- Transcription ---

class TranscribeRequest(BaseModel):
    audio_path: str
    language: Optional[str] = Field(None, description="ISO language code or None for auto-detect")
    enable_diarization: bool = False
    hf_token: Optional[str] = Field(None, description="HuggingFace token for diarization")
    output_dir: str = "output"
    export_formats: list[ExportFormat] = Field(default_factory=lambda: [ExportFormat.SRT_WORD, ExportFormat.JSON])


class WordSegment(BaseModel):
    word: str
    start: float
    end: float
    score: Optional[float] = None
    speaker: Optional[str] = None


class Segment(BaseModel):
    start: float
    end: float
    text: str
    words: list[WordSegment] = Field(default_factory=list)
    speaker: Optional[str] = None


class TranscriptionResult(BaseModel):
    segments: list[Segment] = Field(default_factory=list)
    language: Optional[str] = None
    audio_path: str = ""
    duration: Optional[float] = None


# --- Progress ---

class ProgressUpdate(BaseModel):
    status: JobStatus
    progress: float = Field(0.0, ge=0.0, le=100.0)
    message: str = ""
    detail: Optional[str] = None


# --- Export ---

class ExportRequest(BaseModel):
    formats: list[ExportFormat]
    output_dir: str = "output"
