import flet as ft


class SlideSpeakApp:
    """Main Flet application class for SlideSpeak."""

    def __init__(self, page: ft.Page):
        self.page = page
        self.project = None
        self.current_page = None

    def navigate_to(self, page_name: str):
        """Navigate to a specific page by name."""
        # Page mapping - can be extended with more pages
        pages = {
            "home": self._show_home,
        }

        if page_name in pages:
            pages[page_name]()

    def _show_home(self):
        """Show the home page."""
        from slidespeak.gui.pages.home import HomePage
        home = HomePage(self.page)
        home.show()
        self.current_page = home
