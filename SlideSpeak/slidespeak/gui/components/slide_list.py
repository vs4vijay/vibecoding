import flet as ft
from typing import Callable, Optional


class SlideListComponent(ft.Column):
    def __init__(self, on_select: Callable[[int], None] = None):
        super().__init__()
        self.on_select_callback = on_select
        self.slides = []
        self.selected_index = 0
        self.scroll = ft.ScrollMode.AUTO
        
    def load_slides(self, slides_data: list):
        """Load slides into the list.
        
        Args:
            slides_data: List of dicts with 'thumbnail' (PIL Image or path) and 'notes'
        """
        self.slides = slides_data
        self._render()
        
    def _render(self):
        self.controls = []
        for i, slide in enumerate(self.slides):
            is_selected = i == self.selected_index
            self.controls.append(
                ft.Container(
                    content=ft.Column([
                        ft.Text(f"Slide {i+1}", size=12),
                        # Thumbnail placeholder
                        ft.Container(
                            width=120, height=68,
                            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                            content=ft.Text(f"{i+1}", size=20),
                            border_radius=4,
                        ),
                        ft.Text(slide.get('notes', '')[:50], size=10, max_lines=2),
                    ], spacing=2),
                    padding=8,
                    border=ft.border.all(2, ft.Colors.PRIMARY if is_selected else ft.Colors.SURFACE),
                    border_radius=8,
                    on_click=lambda e, idx=i: self._select_slide(idx),
                )
            )
        if self.page:
            self.page.update()
    
    def _select_slide(self, index: int):
        self.selected_index = index
        self._render()
        if self.on_select_callback:
            self.on_select_callback(index)
