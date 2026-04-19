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
    font_size: int = Field(64, ge=1, description="Font size in px")
    bold: bool = Field(True, description="Use bold font weight")
    tracking: float = Field(0, description="Letter spacing in px")
    word_spacing: int = Field(0, description="Extra word spacing in px")
    stroke_width: int = Field(0, ge=0, description="Text outline stroke width in px")
    stroke_color: str = Field("#000000", description="Text outline stroke color (hex)")
    text_color: str = Field("#FFFFFF", description="Normal word color (hex)")
    active_word_color: str = Field("#FFD700", description="Highlighted spoken word color (hex)")
    bg_color: str = Field("#D4952A", description="Background shape color (hex)")
    bg_opacity: float = Field(0.9, ge=0.0, le=1.0)
    bg_padding_h: int = Field(40, ge=0, description="Horizontal padding")
    bg_padding_v: int = Field(16, ge=0, description="Vertical padding")
    bg_corner_radius: int = Field(16, ge=0, description="Corner radius in px")
    bg_width_extra: int = Field(0, description="Extra width added to background box in px (can be negative to shrink)")
    bg_height_extra: int = Field(0, description="Extra height added to background box in px (can be negative to shrink)")
    text_offset_x: int = Field(0, description="Nudge text horizontally within background box in px")
    text_offset_y: int = Field(0, description="Nudge text vertically within background box in px")
    text_align_h: str = Field("center", description="Horizontal text alignment within bg box: left, center, right")
    text_align_v: str = Field("middle", description="Vertical text alignment within bg box: top, middle, bottom")
    words_per_group: int = Field(3, ge=1, description="Words per subtitle group")
    lines: int = Field(1, ge=1, le=10, description="Number of subtitle rows per group")
    line_height: float = Field(1.2, ge=0.5, le=5.0, description="Line height multiplier (1.0 = no gap, 1.2 = 20% gap)")
    position_y: float = Field(0.82, ge=0.0, le=1.0, description="Vertical position (0=top, 1=bottom)")
    position_x: float = Field(0.5, ge=0.0, le=1.0, description="Horizontal position (0=left, 1=right, 0.5=center)")
    resolution_w: int = Field(1920, ge=1, description="Output width in px")
    resolution_h: int = Field(1080, ge=1, description="Output height in px")
    fps: int = Field(30, ge=1, le=120)
    output_format: str = Field("webm", description="webm, mov, or mp4")
    custom_font_path: Optional[str] = Field(None, description="Absolute path to a custom .ttf/.otf font file")
    render_mode: str = Field("overlay", description="overlay = transparent, baked = subtitles on source video")
    video_bitrate: str = Field("8M", description="Bitrate for MP4 output (e.g. 8M, 15M)")
    animation: str = Field("none", description="Group entry animation: none, fade, slide, pop")
    animation_duration: float = Field(0.12, ge=0.0, description="Animation in/out duration in seconds")
    word_transition: str = Field("instant", description="Word highlight style: instant, crossfade, highlight, underline, bounce, scale, karaoke, reveal")
    # Highlight options
    highlight_radius: int = Field(16, ge=0, description="Corner radius of the highlight pill")
    highlight_padding_x: int = Field(6, ge=0, description="Horizontal padding around the highlight box")
    highlight_padding_y: int = Field(6, ge=0, description="Vertical padding around the highlight box")
    highlight_opacity: float = Field(0.85, ge=0.0, le=1.0, description="Opacity of the highlight box")
    highlight_animation: str = Field("jump", description="Highlight box movement: jump or slide")
    # Underline options
    underline_thickness: int = Field(4, ge=1, description="Underline bar thickness in px")
    underline_color: str = Field("", description="Underline color hex; empty = use active_word_color")
    # Bounce options
    bounce_strength: float = Field(0.18, ge=0.0, description="Bounce height as fraction of font size")
    # Scale options
    scale_factor: float = Field(1.25, ge=0.5, description="Scale multiplier for active word")
    # Drop shadow options
    shadow_enabled: bool = Field(False, description="Enable text drop shadow")
    shadow_color: str = Field("#000000", description="Shadow color (hex)")
    shadow_opacity: float = Field(0.8, ge=0.0, le=1.0, description="Shadow opacity")
    shadow_blur: int = Field(8, ge=0, description="Shadow feather/blur radius in px")
    shadow_offset_x: int = Field(3, description="Shadow horizontal offset in px")
    shadow_offset_y: int = Field(3, description="Shadow vertical offset in px")


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
