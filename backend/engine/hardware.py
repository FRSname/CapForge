"""Hardware auto-detection: GPU, VRAM, and recommended settings."""

from backend.models.schemas import ComputeType, DeviceType, ModelSize, SystemInfo


def detect_hardware() -> SystemInfo:
    """Detect available hardware and recommend WhisperX settings."""
    info = SystemInfo()

    try:
        import torch

        if torch.cuda.is_available():
            info.has_cuda = True
            info.gpu_name = torch.cuda.get_device_name(0)
            vram_bytes = torch.cuda.get_device_properties(0).total_mem
            info.vram_mb = vram_bytes // (1024 * 1024)
            info.recommended_device = DeviceType.CUDA

            # Pick compute type and model based on VRAM
            vram = info.vram_mb
            if vram >= 10_000:  # 10 GB+
                info.recommended_model = ModelSize.LARGE_V3
                info.recommended_compute_type = ComputeType.FLOAT16
            elif vram >= 6_000:  # 6-10 GB
                info.recommended_model = ModelSize.LARGE
                info.recommended_compute_type = ComputeType.FLOAT16
            elif vram >= 4_000:  # 4-6 GB
                info.recommended_model = ModelSize.MEDIUM
                info.recommended_compute_type = ComputeType.INT8
            elif vram >= 2_000:  # 2-4 GB
                info.recommended_model = ModelSize.SMALL
                info.recommended_compute_type = ComputeType.INT8
            else:
                info.recommended_model = ModelSize.BASE
                info.recommended_compute_type = ComputeType.INT8
        else:
            _configure_cpu(info)
    except ImportError:
        _configure_cpu(info)

    return info


def _configure_cpu(info: SystemInfo) -> None:
    """Set CPU-only recommendations."""
    info.has_cuda = False
    info.recommended_device = DeviceType.CPU
    info.recommended_compute_type = ComputeType.FLOAT32
    info.recommended_model = ModelSize.BASE
