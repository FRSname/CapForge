"""Hardware auto-detection: GPU, VRAM, and recommended settings."""

from backend.models.schemas import ComputeType, DeviceType, ModelSize, SystemInfo


def detect_hardware() -> SystemInfo:
    """Detect available hardware and recommend WhisperX settings."""
    info = SystemInfo()

    try:
        import torch

        # Log torch build info so the backend log reveals whether cu121 or cpu
        # wheels were actually installed, and why CUDA might be unavailable.
        try:
            print(f"[capforge] torch={torch.__version__} cuda_build={torch.version.cuda} "
                  f"cuda_available={torch.cuda.is_available()}", flush=True)
            if not torch.cuda.is_available():
                # Surface the underlying reason (driver mismatch, missing DLL, etc.)
                try:
                    import torch.cuda as _cu
                    print(f"[capforge] cuda init error: {_cu._check_driver()}", flush=True)
                except Exception as _e:
                    print(f"[capforge] cuda probe failed: {_e!r}", flush=True)
        except Exception:
            pass

        if torch.cuda.is_available():
            info.has_cuda = True
            info.gpu_name = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            # total_memory in newer torch, total_mem in older versions
            vram_bytes = getattr(props, "total_memory", None) or getattr(props, "total_mem", 0)
            info.vram_mb = vram_bytes // (1024 * 1024)
            info.recommended_device = DeviceType.CUDA

            # Pick compute type and model based on VRAM.
            # large-v3-turbo is the default CapForge ships: near-v3 quality at
            # ~4x the speed and half the VRAM. It's the only model pre-downloaded
            # during first-run setup, so every GPU tier that can afford it uses it.
            vram = info.vram_mb
            if vram >= 6_000:  # 6 GB+ → turbo @ fp16
                info.recommended_model = ModelSize.LARGE_V3_TURBO
                info.recommended_compute_type = ComputeType.FLOAT16
            elif vram >= 4_000:  # 4-6 GB → turbo @ int8
                info.recommended_model = ModelSize.LARGE_V3_TURBO
                info.recommended_compute_type = ComputeType.INT8
            elif vram >= 2_000:  # 2-4 GB → small fallback
                info.recommended_model = ModelSize.SMALL
                info.recommended_compute_type = ComputeType.INT8
            else:
                info.recommended_model = ModelSize.BASE
                info.recommended_compute_type = ComputeType.INT8

        elif _mps_available(torch):
            # Apple Silicon MPS — CTranslate2 doesn't support MPS yet, so
            # transcription still runs on CPU, but we surface the chip identity
            # to the UI and select the best CPU-compatible configuration.
            # When faster-whisper adds MPS support, change recommended_device to
            # a new DeviceType.MPS value and update _load_model accordingly.
            info.has_cuda = False
            info.gpu_name = _apple_chip_name()
            info.recommended_device = DeviceType.CPU
            # M-series CPUs are fast enough for int8 turbo in reasonable time
            info.recommended_compute_type = ComputeType.INT8
            info.recommended_model = ModelSize.LARGE_V3_TURBO
            print(f"[capforge] Apple Silicon MPS available — using CPU path for CTranslate2 ({info.gpu_name})", flush=True)
        else:
            _configure_cpu(info)
    except ImportError:
        _configure_cpu(info)

    return info


def _mps_available(torch) -> bool:
    """Return True if Apple MPS backend is available (macOS + Apple Silicon)."""
    try:
        return bool(
            hasattr(torch.backends, "mps")
            and torch.backends.mps.is_available()
            and torch.backends.mps.is_built()
        )
    except Exception:
        return False


def _apple_chip_name() -> str:
    """Best-effort Apple Silicon chip name from sysctl."""
    import subprocess
    try:
        out = subprocess.check_output(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            timeout=2, stderr=subprocess.DEVNULL,
        ).decode().strip()
        return out if out else "Apple Silicon"
    except Exception:
        return "Apple Silicon"


def _configure_cpu(info: SystemInfo) -> None:
    """Set CPU-only recommendations.

    Turbo is slow but usable on CPU for users who want the best quality they
    paid for during setup; they can downgrade in Settings if it's too slow.
    """
    info.has_cuda = False
    info.recommended_device = DeviceType.CPU
    info.recommended_compute_type = ComputeType.INT8
    info.recommended_model = ModelSize.LARGE_V3_TURBO
