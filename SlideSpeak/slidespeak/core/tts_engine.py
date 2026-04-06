"""TTS Engine - Coqui TTS wrapper for SlideSpeak.

Provides text-to-speech functionality using Coqui TTS.
"""

import os
import warnings
from typing import Optional

# Try to import Coqui TTS, but make it optional
try:
    from TTS.api import TTS
    TTS_AVAILABLE = True
except ImportError:
    TTS_AVAILABLE = False
    TTS = None


class TTSEngine:
    """Text-to-Speech engine using Coqui TTS.
    
    Supports multiple models and languages. Default uses VITS model
    for English synthesis.
    """
    
    DEFAULT_MODEL = "tts_models/en/ljspeech/vits"
    
    COMMON_LANGUAGES = [
        "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl",
        "cs", "ar", "zh", "ja", "hu", "ko"
    ]
    
    def __init__(self, output_dir: str = "temp_audio", model_name: str = None, gpu: bool = False):
        """Initialize TTS Engine."""
        if not TTS_AVAILABLE:
            warnings.warn("Coqui TTS not available. Install with: pip install coqui-tts torch")
            self.tts = None
            self.model_name = None
            self.output_dir = output_dir
            os.makedirs(output_dir, exist_ok=True)
            return
        
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        
        self.model_name = model_name or self.DEFAULT_MODEL
        self.gpu = gpu
        
        # Initialize Coqui TTS
        try:
            self.tts = TTS(model_name=self.model_name, gpu=self.gpu)
        except Exception as e:
            warnings.warn(f"Failed to initialize TTS: {e}")
            self.tts = None
    
    def list_voices(self) -> list:
        """Return list of available voices/models."""
        if not TTS_AVAILABLE or self.tts is None:
            return self.COMMON_LANGUAGES
        try:
            return self.tts.list_models()
        except:
            return self.COMMON_LANGUAGES
    
    def generate_audio(
        self, 
        text: str, 
        voice: str = "en", 
        rate: float = 1.0,
        pitch: float = 0.0,
        output_path: Optional[str] = None
    ) -> Optional[str]:
        """Generate audio file from text.
        
        Args:
            text: Text to convert to speech
            voice: Voice/model to use (e.g., 'en')
            rate: Speed multiplier (0.5 - 2.0)
            pitch: Pitch adjustment (-12 to +12 semitones)
            output_path: Output file path (auto-generated if None)
            
        Returns:
            Path to generated audio file
        """
        if not TTS_AVAILABLE or self.tts is None:
            warnings.warn("TTS not available. Cannot generate audio.")
            return None
            
        if not text.strip():
            return None
            
        if output_path is None:
            output_path = os.path.join(self.output_dir, f"tts_{abs(hash(text))}.wav")
        
        try:
            self.tts.tts_to_file(
                text=text,
                file_path=output_path,
                voice=voice if voice else None
            )
            return output_path
        except Exception as e:
            warnings.warn(f"Failed to generate audio: {e}")
            return None
    
    def __repr__(self) -> str:
        return f"TTSEngine(model='{self.model_name}', output_dir='{self.output_dir}')"
