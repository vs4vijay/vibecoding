import flet as ft
from typing import Callable

class TimelineComponent(ft.Container):
    def __init__(self, on_select: Callable[[int], None] = None):
        super().__init__()
        self.on_select_callback = on_select
        self.slides = []
        self.height = 80
        self.padding = 10
        
        # Horizontal scroll for timeline
        self.timeline_row = ft.Row(
            controls=[],
            scroll=ft.ScrollMode.AUTO,
            spacing=4,
        )
        
        self.content = ft.Column([
            ft.Text("Timeline", size=12, weight=ft.FontWeight.BOLD),
            self.timeline_row,
        ], spacing=2)
    
    def load_slides(self, slides_data: list, durations: list = None):
        """Load slides into timeline.
        
        Args:
            slides_data: List of slide info dicts
            durations: Optional list of durations per slide
        """
        self.slides = slides_data
        self.timeline_row.controls = []
        
        for i, slide in enumerate(slides_data):
            duration = durations[i] if durations and i < len(durations) else 5.0
            
            # Create timeline block (width proportional to duration)
            block_width = max(40, duration * 20)  # 20px per second, min 40px
            
            block = ft.Container(
                width=block_width,
                height=40,
                bgcolor=ft.Colors.PRIMARY_CONTAINER,
                border_radius=4,
                content=ft.Text(f"S{i+1}", size=10),
                on_click=lambda e, idx=i: self._select_slide(idx),
                tooltip=f"Slide {i+1}: {duration}s",
            )
            self.timeline_row.controls.append(block)
        
        if self.page:
            self.page.update()
    
    def _select_slide(self, index: int):
        if self.on_select_callback:
            self.on_select_callback(index)
    
    def get_total_duration(self) -> float:
        """Calculate total duration of all slides."""
        return sum(slide.get('duration', 5.0) for slide in self.slides)
