"""Logging utilities with timestamp and run counter."""
import time
from datetime import datetime

from rich.console import Console
from rich.logging import RichHandler

console = Console()


def get_timestamp() -> str:
    """Return current timestamp in HH:MM:SS format."""
    return datetime.now().strftime("%H:%M:%S")


def log_info(message: str, run: int | None = None):
    """Log info message with timestamp and optional run counter."""
    run_str = f"[{run}] " if run else ""
    console.print(f"[cyan]{get_timestamp()}[/cyan] {run_str}{message}")


def log_success(message: str, run: int | None = None):
    """Log success message with timestamp and optional run counter."""
    run_str = f"[{run}] " if run else ""
    console.print(f"[cyan]{get_timestamp()}[/cyan] [green]{run_str}{message}[/green]")


def log_warning(message: str, run: int | None = None):
    """Log warning message with timestamp and optional run counter."""
    run_str = f"[{run}] " if run else ""
    console.print(f"[cyan]{get_timestamp()}[/cyan] [yellow]{run_str}{message}[/yellow]")


def log_error(message: str, run: int | None = None):
    """Log error message with timestamp and optional run counter."""
    run_str = f"[{run}] " if run else ""
    console.print(f"[cyan]{get_timestamp()}[/cyan] [red]{run_str}{message}[/red]", err=True)


def log_section(title: str, run: int | None = None):
    """Log a section header."""
    run_str = f"[{run}] " if run else ""
    console.print(f"\n[bold]{run_str}{title}[/bold]")
    console.print("-" * 40)


class Timer:
    """Simple timer context manager."""

    def __init__(self, message: str):
        self.message = message
        self.start_time = None

    def __enter__(self):
        console.print(f"[cyan]{get_timestamp()}[/cyan] {self.message}...", end=" ")
        self.start_time = time.time()
        return self

    def __exit__(self, *args):
        elapsed = time.time() - self.start_time
        console.print(f"[green]done[/green] ({elapsed:.1f}s)")


class RunCounter:
    """Incrementing run counter."""

    def __init__(self):
        self._count = 0

    def increment(self) -> int:
        self._count += 1
        return self._count

    @property
    def current(self) -> int:
        return self._count


run_counter = RunCounter()


def get_next_run() -> int:
    """Get the next run number."""
    return run_counter.increment()


def reset_run_counter():
    """Reset the run counter to 0."""
    run_counter._count = 0