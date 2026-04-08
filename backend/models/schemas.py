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
    LARGE_V3_TURBO = "large-v3-turbo"


class JobStatus(str, Enum):
    IDLE = "idle"
    LOADING_MODEL = "loading_model"
    TRANSCRIBING = "transcribing"
    ALIGNING = "aligning"
    DIARIZING = "diarizing"
    EXPORTING = "exporting"
    RENDERING = "rendering"
    ENCODING = "encoding"
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


# --- Video Render ---

class VideoRenderConfig(BaseModel):
    """Style configuration for subtitle video rendering."""
    font_family: str = Field("Arial", description="Font family name")
    font_size: int = Field(64, ge=12, le=200)
    bold: bool = Field(True, description="Use bold font weight")
    tracking: int = Field(0, ge=-5, le=20, description="Letter spacing in px")
    word_spacing: int = Field(0, ge=-5, le=40, description="Extra word spacing in px")
    stroke_width: int = Field(0, ge=0, le=10, description="Text outline stroke width in px")
    stroke_color: str = Field("#000000", description="Text outline stroke color (hex)")
    text_color: str = Field("#FFFFFF", description="Normal word color (hex)")
    active_word_color: str = Field("#FFD700", description="Highlighted spoken word color (hex)")
    bg_color: str = Field("#D4952A", description="Background shape color (hex)")
    bg_opacity: float = Field(0.9, ge=0.0, le=1.0)
    bg_padding_h: int = Field(40, ge=0, le=200, description="Horizontal padding")
    bg_padding_v: int = Field(16, ge=0, le=100, description="Vertical padding")
    bg_corner_radius: int = Field(16, ge=0, le=100)
    words_per_group: int = Field(3, ge=1, le=10)
    position_y: float = Field(0.82, ge=0.0, le=1.0, description="Vertical position (0=top, 1=bottom)")
    resolution_w: int = Field(1920, ge=640, le=3840)
    resolution_h: int = Field(1080, ge=360, le=3840)
    fps: int = Field(30, ge=15, le=60)
    output_format: str = Field("webm", description="webm, mov, or mp4")
    custom_font_path: Optional[str] = Field(None, description="Absolute path to a custom .ttf/.otf font file")
    render_mode: str = Field("overlay", description="overlay = transparent, baked = subtitles on source video")
    video_bitrate: str = Field("8M", description="Bitrate for MP4 output (e.g. 8M, 15M)")


class CustomGroup(BaseModel):
    """A manually edited subtitle group."""
    text: str
    start: float
    end: float
    words: list[dict] = Field(default_factory=list)


class VideoRenderRequest(BaseModel):
    """Request to render a subtitle overlay video."""
    config: VideoRenderConfig = Field(default_factory=VideoRenderConfig)
    output_dir: str = "output"
    custom_groups: Optional[list[CustomGroup]] = Field(None, description="Manually edited groups; skips auto-grouping when provided")
