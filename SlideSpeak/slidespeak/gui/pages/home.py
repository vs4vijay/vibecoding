import flet as ft

class HomePage:
    def __init__(self, page: ft.Page):
        self.page = page
        
    def show(self):
        self.page.clean()
        self.page.add(
            ft.Column([
                ft.Text("SlideSpeak", size=40, weight=ft.FontWeight.BOLD),
                ft.Text("Convert PowerPoint to Video", size=20),
                ft.ElevatedButton("Open PowerPoint", on_click=self._open_file),
            ], alignment=ft.MainAxisAlignment.CENTER, spacing=20)
        )
        self.page.update()
    
    async def _open_file(self, e):
        # FilePicker used as service class in newer Flet versions
        file_picker = ft.FilePicker()
        files = await file_picker.pick_files(allowed_extensions=["pptx", "ppt"])
        if files:
            pptx_path = files[0].path
            # Navigate to editor with this file
            from slidespeak.gui.pages.editor import EditorPage
            editor = EditorPage(self.page, pptx_path)
            editor.show()
