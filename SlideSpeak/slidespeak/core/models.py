from dataclasses import dataclass, field
from typing import Optional

@dataclass
class SlideSettings:
    slide_index: int
    voice: str = "en"  # Coqui TTS voice
    rate: float = 1.0  # 0.5 - 2.0
    pitch: float = 0.0  # -12 to +12
    duration: float = 0.0  # 0 = auto based on audio length
    custom_text: Optional[str] = None  # Override notes
    notes: str = ""  # Original notes from PPT

@dataclass
class GlobalSettings:
    output_path: str = "output.mp4"
    fps: int = 30
    dpi: int = 150
    default_voice: str = "en"
    default_rate: float = 1.0
    default_pitch: float = 0.0

@dataclass
class Project:
    pptx_path: str
    slides: list[SlideSettings] = field(default_factory=list)
    global_settings: GlobalSettings = field(default_factory=GlobalSettings)
