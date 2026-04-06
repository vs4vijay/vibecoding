import flet as ft
from typing import Optional


class PreviewComponent(ft.Container):
    def __init__(self, on_navigate=None):
        super().__init__()
        self.on_navigate = on_navigate
        self.current_slide_index = 0
        self.current_image = None
        self.current_audio_path = None
        
        # Large slide preview area
        self.slide_display = ft.Container(
            width=640,
            height=360,
            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
            content=ft.Text("No slide loaded", size=20),
            border_radius=8,
            alignment=ft.Alignment(0, 0),
        )
        
        # Navigation buttons
        self.nav_buttons = ft.Row([
            ft.IconButton(ft.icons.Icons.ARROW_BACK, on_click=self._prev_slide),
            ft.IconButton(ft.icons.Icons.ARROW_FORWARD, on_click=self._next_slide),
        ], alignment=ft.MainAxisAlignment.CENTER)
        
        # Audio preview button
        self.audio_button = ft.ElevatedButton(
            "Play Audio",
            icon=ft.icons.Icons.PLAY_ARROW,
            on_click=self._play_audio,
        )
        
        self.content = ft.Column([
            self.slide_display,
            self.nav_buttons,
            self.audio_button,
        ], spacing=10, alignment=ft.MainAxisAlignment.CENTER)
        
        self.width = 680
        self.padding = 10
        
    def load_slide(self, index: int, image, audio_path: Optional[str]):
        """Load a slide for preview."""
        self.current_slide_index = index
        self.current_image = image
        self.current_audio_path = audio_path
        
        if image:
            # Display the image - for now show placeholder
            self.slide_display.content = ft.Text(f"Slide {index + 1}", size=30)
        else:
            self.slide_display.content = ft.Text(f"Slide {index + 1}", size=30)
        
        # Enable/disable audio button
        self.audio_button.disabled = not audio_path
        
        if self.page:
            self.page.update()
    
    def _prev_slide(self, e):
        if self.on_navigate:
            self.on_navigate('prev')
    
    def _next_slide(self, e):
        if self.on_navigate:
            self.on_navigate('next')
    
    def _play_audio(self, e):
        # TODO: Play audio using native player or Flet audio
        pass
