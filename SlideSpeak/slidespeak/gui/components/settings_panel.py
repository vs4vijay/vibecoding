import os
import platform
import subprocess
import threading

import flet as ft
from typing import Callable, Optional

from slidespeak.core.tts_engine import TTSEngine
class SettingsPanelComponent(ft.Container):
    def __init__(self, on_change: Callable = None):
        super().__init__()
        self.on_change_callback = on_change
        self.current_slide_index = 0
        self.width = 280
        self.padding = 10
        
        # Initialize TTS engine
        self.tts_engine = TTSEngine()
        self._is_generating = False
        # Voice selection dropdown
        self.voice_dropdown = ft.Dropdown(
            label="Voice",
            options=[
                ft.dropdown.Option("en", "English"),
                ft.dropdown.Option("es", "Spanish"),
                ft.dropdown.Option("fr", "French"),
                ft.dropdown.Option("de", "German"),
            ],
            value="en",
            on_change=self._on_setting_change,
        )
        
        # Rate slider (0.5x - 2.0x)
        self.rate_slider = ft.Slider(
            label="Speed",
            min=0.5,
            max=2.0,
            divisions=15,
            value=1.0,
            on_change=self._on_setting_change,
        )
        
        # Pitch slider (-12 to +12)
        self.pitch_slider = ft.Slider(
            label="Pitch",
            min=-12,
            max=12,
            divisions=24,
            value=0,
            on_change=self._on_setting_change,
        )
        
        # Duration input
        self.duration_input = ft.TextField(
            label="Duration (seconds)",
            value="0",
            keyboard_type=ft.KeyboardType.NUMBER,
            hint_text="0 = auto",
            on_change=self._on_setting_change,
        )
        
        # Custom text override
        self.custom_text = ft.TextField(
            label="Custom Text",
            multiline=True,
            min_lines=3,
            hint_text="Override slide notes",
            on_change=self._on_setting_change,
        )
        
        # Test voice button
        self.test_button = ft.ElevatedButton(
            "Test Voice",
            icon=ft.icons.Icons.PLAY_ARROW,
            on_click=self._test_voice,
        )
        
        self.content = ft.Column([
            ft.Text("Slide Settings", size=18, weight=ft.FontWeight.BOLD),
            ft.Divider(),
            self.voice_dropdown,
            self.rate_slider,
            self.pitch_slider,
            self.duration_input,
            self.custom_text,
            self.test_button,
        ], spacing=10, scroll=ft.ScrollMode.AUTO)
    
    def load_slide_settings(self, index: int, settings: dict):
        """Load settings for a specific slide."""
        self.current_slide_index = index
        
        # Update UI with settings
        if settings.get('voice'):
            self.voice_dropdown.value = settings['voice']
        if settings.get('rate'):
            self.rate_slider.value = settings['rate']
        if settings.get('pitch'):
            self.pitch_slider.value = settings['pitch']
        if settings.get('duration'):
            self.duration_input.value = str(settings['duration'])
        if settings.get('custom_text'):
            self.custom_text.value = settings['custom_text']
            
        if self.page:
            self.page.update()
    
    def get_current_settings(self) -> dict:
        """Get current settings from UI."""
        return {
            'voice': self.voice_dropdown.value,
            'rate': self.rate_slider.value,
            'pitch': self.pitch_slider.value,
            'duration': float(self.duration_input.value or 0),
            'custom_text': self.custom_text.value,
        }
    
    def _on_setting_change(self, e):
        if self.on_change_callback:
            self.on_change_callback(self.current_slide_index, self.get_current_settings())
    
    def _test_voice(self, e):
        """Generate and play TTS audio for testing voice settings."""
        if self._is_generating:
            return
        
        # Get current settings
        settings = self.get_current_settings()
        text = settings.get('custom_text') or "This is a test of the text to speech system."
        voice = settings.get('voice', 'en')
        rate = settings.get('rate', 1.0)
        pitch = settings.get('pitch', 0.0)
        
        # Show loading state
        self._is_generating = True
        self.test_button.disabled = True
        self.test_button.text = "Generating..."
        if self.page:
            self.page.update()
        
        def generate_and_play():
            try:
                # Generate audio
                audio_path = self.tts_engine.generate_audio(
                    text=text,
                    language=voice,
                    rate=rate,
                    pitch=pitch
                )
                
                # Play audio using platform's default player
                if audio_path and os.path.exists(audio_path):
                    if platform.system() == 'Windows':
                        os.startfile(audio_path)
                    elif platform.system() == 'Darwin':
                        subprocess.run(['open', audio_path], check=True)
                    else:
                        subprocess.run(['xdg-open', audio_path], check=True)
            except Exception as ex:
                print(f"TTS generation failed: {ex}")
            finally:
                # Reset button state on main thread
                def reset_button():
                    self._is_generating = False
                    self.test_button.disabled = False
                    self.test_button.text = "Test Voice"
                    if self.page:
                        self.page.update()
                
                if self.page:
                    self.page.run_thread(reset_button)
                else:
                    self._is_generating = False
                    self.test_button.disabled = False
                    self.test_button.text = "Test Voice"
        
        # Run in thread to avoid blocking UI
        threading.Thread(target=generate_and_play, daemon=True).start()
