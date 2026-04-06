import flet as ft
from slidespeak.gui.components.slide_list import SlideListComponent
from slidespeak.gui.components.preview import PreviewComponent
from slidespeak.gui.components.settings_panel import SettingsPanelComponent
from slidespeak.core.pptx_reader import PowerPointReader
from slidespeak.core.models import Project, SlideSettings
from slidespeak.core.tts_engine import TTSEngine
from slidespeak.core.video_generator import VideoGenerator
import os
import tempfile
import threading


class EditorPage:
    def __init__(self, page: ft.Page, pptx_path: str):
        self.page = page
        self.pptx_path = pptx_path
        self.project = Project(pptx_path=pptx_path)
        self.reader = PowerPointReader(pptx_path)
        self.current_slide_index = 0
        
        # Initialize TTS engine and video generator
        self.tts_engine = TTSEngine(output_dir=os.path.join(tempfile.gettempdir(), "slidespeak_audio"))
        self.video_generator = VideoGenerator(output_dir=os.path.join(tempfile.gettempdir(), "slidespeak_video"))
        
        # Initialize components
        self.slide_list = SlideListComponent(on_select=self._on_slide_selected)
        self.preview = PreviewComponent(on_navigate=self._on_preview_navigate)
        self.settings_panel = SettingsPanelComponent(on_change=self._on_setting_changed)
        
        # Export state
        self.progress_dialog = None
        self.file_picker = None
        

        
        # Load slides from PPTX
        self._load_slides()
        
        # Build layout
        self.page.add(
            ft.Column([
                ft.Container(
                    content=ft.Row([
                        ft.Text("Editor", size=24, weight=ft.FontWeight.BOLD),
                        ft.Text(f"File: {self.pptx_path}", size=14),
                        ft.ElevatedButton(
                            "Export Video",
                            icon=ft.icons.Icons.VIDEO_FILE,
                            on_click=self._on_export_click,
                        ),
                        ft.ElevatedButton("Back to Home", on_click=self._go_back),
                    ], spacing=20),
                    padding=10,
                ),
                ft.Row([
                    # Left panel: Slide list (~200px)
                    ft.Container(
                        content=self.slide_list,
                        width=200,
                        padding=5,
                    ),
                    # Center: Preview (~680px)
                    ft.Container(
                        content=self.preview,
                        width=700,
                        padding=5,
                    ),
                    # Right: Settings panel (~280px)
                    ft.Container(
                        content=self.settings_panel,
                        width=280,
                        padding=5,
                    ),
                ], spacing=10),
            ], spacing=0)
        )
        
        # Select first slide on load
        if self.project.slides:
            self._update_view_for_slide(0)
        
        self.page.update()
        
        # Register keyboard handler
        self.page.on_keyboard_event = self.on_keyboard
    
    def _load_slides(self):
        """Load slides from PPTX file into the project."""
        # Extract slides with notes
        self.project.slides = self.reader.extract_slides_and_notes()
        
        # Try to get thumbnails
        slides_data = []
        try:
            thumbnails = self.reader.get_slide_thumbnails(dpi=100, size=(120, 68))
            for i, slide in enumerate(self.project.slides):
                slides_data.append({
                    'thumbnail': thumbnails[i] if i < len(thumbnails) else None,
                    'notes': slide.notes or ""
                })
        except Exception as e:
            # If thumbnails fail, use placeholder
            print(f"Could not generate thumbnails: {e}")
            for slide in self.project.slides:
                slides_data.append({
                    'thumbnail': None,
                    'notes': slide.notes or ""
                })
        
        self.slide_list.load_slides(slides_data)
    
    def _on_slide_selected(self, index: int):
        """Handle slide selection from the slide list."""
        self.current_slide_index = index
        self._update_view_for_slide(index)
    
    def _update_view_for_slide(self, index: int):
        """Update preview and settings panel for the selected slide."""
        if index >= len(self.project.slides):
            return
        
        self.current_slide_index = index
        
        slide_settings = self.project.slides[index]
        
        # Update preview
        image = None
        try:
            image = self.reader.get_slide_as_image(index, dpi=100)
        except Exception as e:
            print(f"Could not load slide image: {e}")
        
        self.preview.load_slide(index, image, None)
        
        # Update settings panel
        settings_dict = {
            'voice': slide_settings.voice,
            'rate': slide_settings.rate,
            'pitch': slide_settings.pitch,
            'duration': slide_settings.duration,
            'custom_text': slide_settings.custom_text or "",
        }
        self.settings_panel.load_slide_settings(index, settings_dict)
    
    def _on_setting_changed(self, index: int, settings: dict):
        """Handle setting changes from the settings panel."""
        if index >= len(self.project.slides):
            return
        
        # Update the project model
        slide_settings = self.project.slides[index]
        slide_settings.voice = settings.get('voice', 'en')
        slide_settings.rate = settings.get('rate', 1.0)
        slide_settings.pitch = settings.get('pitch', 0.0)
        slide_settings.duration = settings.get('duration', 0.0)
        slide_settings.custom_text = settings.get('custom_text')
    
    def _go_back(self, e):
        from slidespeak.gui.pages.home import HomePage
        home = HomePage(self.page)
        home.show()
    
    def _on_preview_navigate(self, direction: str):
        """Handle navigation from preview component."""
        if direction == 'prev':
            self._prev_slide()
        elif direction == 'next':
            self._next_slide()
    
    def _prev_slide(self):
        """Navigate to previous slide."""
        if self.current_slide_index > 0:
            self.current_slide_index -= 1
            self._update_view_for_slide(self.current_slide_index)
            self.slide_list.select_slide(self.current_slide_index)
    
    def _next_slide(self):
        """Navigate to next slide."""
        if self.current_slide_index < len(self.project.slides) - 1:
            self.current_slide_index += 1
            self._update_view_for_slide(self.current_slide_index)
            self.slide_list.select_slide(self.current_slide_index)
    
    def on_keyboard(self, e: ft.KeyboardEvent):
        """Handle keyboard events for navigation."""
        if e.key == 'Arrow Left':
            self._prev_slide()
        elif e.key == 'Arrow Right':
            self._next_slide()
    
    # Export methods
    async def _on_export_click(self, e):
        """Handle export button click - shows file picker first."""
        if not self.project.slides:
            self._show_error("No slides to export")
            return
        
        # Show save dialog - FilePicker used as service class
        file_picker = ft.FilePicker()
        await file_picker.save_file(
            dialog_title="Save Video As",
            file_name="presentation.mp4",
            allowed_extensions=["mp4"],
        )
        # Store reference for result callback
        self.file_picker = file_picker
        self.file_picker.on_result = self._on_export_path_selected
    
    def _on_export_path_selected(self, e):
        """Handle file path selection from save dialog."""
        if not e.path:
            return
        
        output_path = e.path
        if not output_path.endswith('.mp4'):
            output_path += '.mp4'
        
        # Start export process
        self._start_export(output_path)
    
    def _start_export(self, output_path: str):
        """Start the export process in a background thread."""
        # Show progress dialog
        self.progress_dialog = ft.AlertDialog(
            title=ft.Text("Exporting Video"),
            content=ft.Column([
                ft.Text("Preparing export...", id="export_status"),
                ft.ProgressBar(width=400, value=0, id="export_progress"),
            ], tight=True),
            modal=True,
        )
        self.page.dialog = self.progress_dialog
        self.progress_dialog.open = True
        self.page.update()
        
        # Run export in background thread
        def export_task():
            try:
                # Step 1: Generate audio for all slides
                total_slides = len(self.project.slides)
                for i, slide in enumerate(self.project.slides):
                    # Update progress
                    progress = (i / total_slides) * 0.5  # 50% for audio
                    self._update_export_progress(f"Generating audio for slide {i+1}/{total_slides}...", progress)
                    
                    # Get text to speak
                    text = slide.custom_text or slide.notes
                    if text and text.strip():
                        # Generate TTS audio
                        audio_path = self.tts_engine.generate_audio(
                            text=text,
                            voice=slide.voice,
                            rate=slide.rate,
                            pitch=slide.pitch,
                        )
                        slide.audio_path = audio_path
                
                # Step 2: Export slides to images
                self._update_export_progress("Generating slide images...", 0.6)
                slides_data = []
                temp_dir = self.video_generator.output_dir
                os.makedirs(temp_dir, exist_ok=True)
                
                for i, slide in enumerate(self.project.slides):
                    progress = 0.6 + (i / total_slides) * 0.2  # 60-80%
                    self._update_export_progress(f"Processing slide {i+1}/{total_slides}...", progress)
                    
                    # Get slide as image
                    image_path = os.path.join(temp_dir, f"slide_{i}.png")
                    try:
                        image = self.reader.get_slide_as_image(i, dpi=150)
                        if image:
                            image.save(image_path)
                    except Exception as ex:
                        print(f"Could not export slide {i}: {ex}")
                        continue
                    
                    slides_data.append({
                        "image_path": image_path,
                        "audio_path": slide.audio_path,
                        "duration": slide.duration if slide.duration > 0 else 5.0,
                    })
                
                # Step 3: Create video
                self._update_export_progress("Creating video...", 0.85)
                final_path = self.video_generator.create_video(slides_data, output_path)
                
                # Step 4: Show success
                self._export_complete(final_path)
                
            except Exception as ex:
                self._export_error(str(ex))
        
        threading.Thread(target=export_task, daemon=True).start()
    
    def _update_export_progress(self, status: str, progress: float):
        """Update the progress dialog (called from background thread)."""
        def update():
            if self.progress_dialog:
                status_text = self.progress_dialog.content.controls[0]
                progress_bar = self.progress_dialog.content.controls[1]
                status_text.value = status
                progress_bar.value = progress
                self.page.update()
        
        self.page.run_thread(update)
    
    def _export_complete(self, output_path: str):
        """Handle export completion (called from background thread)."""
        def complete():
            if self.progress_dialog:
                self.progress_dialog.open = False
            
            # Show success message
            self.page.dialog = ft.AlertDialog(
                title=ft.Text("Export Complete"),
                content=ft.Column([
                    ft.Text(f"Video saved to:"),
                    ft.Text(output_path, selectable=True, weight=ft.FontWeight.BOLD),
                ]),
                actions=[
                    ft.TextButton("OK", on_click=self._close_dialog),
                ],
            )
            self.page.dialog.open = True
            self.page.update()
        
        self.page.run_thread(complete)
    
    def _export_error(self, error_msg: str):
        """Handle export error (called from background thread)."""
        def show_error():
            if self.progress_dialog:
                self.progress_dialog.open = False
            
            self._show_error(f"Export failed: {error_msg}")
        
        self.page.run_thread(show_error)
    
    def _show_error(self, message: str):
        """Show an error dialog."""
        self.page.dialog = ft.AlertDialog(
            title=ft.Text("Error"),
            content=ft.Text(message),
            actions=[ft.TextButton("OK", on_click=self._close_dialog)],
        )
        self.page.dialog.open = True
        self.page.update()
    
    def _close_dialog(self, e):
        """Close the current dialog."""
        if self.page.dialog:
            self.page.dialog.open = False
            self.page.update()
