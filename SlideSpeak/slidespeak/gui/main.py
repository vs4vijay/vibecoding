import flet as ft
import sys


def main(page: ft.Page, pptx_path: str = None):
    """Main entry point for the SlideSpeak Flet application."""
    # Configure page
    page.title = "SlideSpeak"
    page.window_width = 1280
    page.window_height = 800
    page.theme_mode = ft.ThemeMode.LIGHT
    
    if pptx_path:
        # Open editor directly with file
        from slidespeak.gui.pages.editor import EditorPage
        editor = EditorPage(page, pptx_path)
        editor.show()
    else:
        # Show home page
        from slidespeak.gui.pages.home import HomePage
        home = HomePage(page)
        home.show()


def start_gui(pptx_path: str = None):
    """Entry point for CLI - starts the Flet application."""
    ft.app(target=lambda page: main(page, pptx_path))


if __name__ == "__main__":
    # Accept optional file path argument
    pptx_path = sys.argv[1] if len(sys.argv) > 1 else None
    start_gui(pptx_path)
