"""CLI main entry point for SlideSpeak."""
import os
import tempfile
import shutil
from pathlib import Path
from typing import Optional

import click

from slidespeak.core.pptx_reader import PowerPointReader
from slidespeak.core.video_generator import VideoGenerator
from slidespeak.core.models import SlideSettings


class SlideToImage:
    """Export slides as images using core PowerPointReader."""
    
    def __init__(self, pptx_path: str, output_dir: str, dpi: int = 150):
        self.pptx_path = pptx_path
        self.output_dir = output_dir
        self.dpi = dpi
        self.reader = PowerPointReader(pptx_path)
    
    def export_slides(self) -> list[str]:
        """Export all slides as PNG images.
        
        Returns:
            List of paths to exported image files.
        """
        image_paths = []
        
        # Use PowerPointReader to get slide thumbnails
        images = self.reader.get_slide_thumbnails(dpi=self.dpi)
        
        for i, img in enumerate(images):
            output_path = os.path.join(self.output_dir, f"slide_{i:03d}.png")
            img.save(output_path, "PNG")
            image_paths.append(output_path)
            print(f"  Exported slide {i+1}/{len(images)}")
        
        return image_paths


class TextToSpeech:
    """Text-to-speech using gTTS (legacy compatibility)."""
    
    def __init__(self, output_dir: str, lang: str = "en"):
        self.output_dir = output_dir
        self.lang = lang

    def text_to_audio(self, text: str, output_filename: str) -> Optional[str]:
        """Convert text to audio file.
        
        Args:
            text: Text to convert to speech
            output_filename: Output file name
            
        Returns:
            Path to generated audio file, or None if text is empty
        """
        if not text.strip():
            return None
        
        output_path = os.path.join(self.output_dir, output_filename)
        
        # Use gTTS for compatibility with original behavior
        from gtts import gTTS
        tts = gTTS(text=text, lang=self.lang)
        tts.save(output_path)
        
        return output_path


class PPT2Video:
    """Main converter class that orchestrates the conversion process."""
    
    def __init__(
        self,
        pptx_path: str,
        output_path: Optional[str] = None,
        lang: str = "en",
        slide_duration: float = 5.0,
        fps: int = 30,
        dpi: int = 150,
        slide_range: Optional[str] = None
    ):
        self.pptx_path = pptx_path
        self.output_path = output_path
        self.lang = lang
        self.slide_duration = slide_duration
        self.fps = fps
        self.dpi = dpi
        self.slide_range = self._parse_slide_range(slide_range)
        
        # Create temporary directory for intermediate files
        self.temp_dir = tempfile.mkdtemp()
        self.images_dir = os.path.join(self.temp_dir, "images")
        self.audio_dir = os.path.join(self.temp_dir, "audio")
        
        os.makedirs(self.images_dir, exist_ok=True)
        os.makedirs(self.audio_dir, exist_ok=True)
    
    def _parse_slide_range(self, slide_range: Optional[str]) -> Optional[list[int]]:
        """Parse slide range string into list of 0-indexed slide indices."""
        if not slide_range:
            return None
        
        slides = set()
        parts = slide_range.split(",")
        
        for part in parts:
            part = part.strip()
            if "-" in part:
                start, end = part.split("-", 1)
                start = int(start.strip())
                end = int(end.strip())
                slides.update(range(start, end + 1))
            else:
                slides.add(int(part))
        
        # Convert to 0-indexed and return sorted list
        return sorted([s - 1 for s in slides])
    
    def run(self) -> str:
        """Run the conversion process.
        
        Returns:
            Path to the generated video file.
        """
        # Read PowerPoint and extract slides
        click.echo("Reading PowerPoint file...")
        reader = PowerPointReader(self.pptx_path)
        slides_data = reader.extract_slides_and_notes()
        
        click.echo(f"Found {len(slides_data)} slides")
        
        # Filter slides if slide_range is specified
        if self.slide_range is not None:
            total_slides = len(slides_data)
            valid_slides = [s for s in self.slide_range if 0 <= s < total_slides]
            if not valid_slides:
                raise ValueError(f"No valid slides in range. Presentation has {total_slides} slides.")
            slides_data = [slides_data[i] for i in valid_slides]
            click.echo(f"Processing {len(slides_data)} slides: {sorted(valid_slides)}")
        
        # Convert slides to images
        click.echo("Exporting slides to images...")
        slide_exporter = SlideToImage(self.pptx_path, self.images_dir, self.dpi)
        slide_images = slide_exporter.export_slides()
        
        # Filter slide_images if slide_range is specified
        if self.slide_range is not None:
            slide_images = [slide_images[i] for i in self.slide_range if i < len(slide_images)]
        
        # Generate audio for each slide using gTTS (for compatibility)
        click.echo("Generating voiceover audio...")
        tts = TextToSpeech(self.audio_dir, self.lang)
        audio_files = []
        
        for i, slide_data in enumerate(slides_data):
            notes = slide_data.notes
            if notes:
                # Determine output format based on TTS engine
                audio_path = tts.text_to_audio(notes, f"slide_{i:03d}.mp3")
                audio_files.append(audio_path)
            else:
                audio_files.append(None)
        
        # Create video using core VideoGenerator
        click.echo("Creating video...")
        video_generator = VideoGenerator(
            self.temp_dir,
            fps=self.fps,
            slide_duration=self.slide_duration
        )
        
        output_path = self.output_path or os.path.join(
            os.path.dirname(self.pptx_path),
            os.path.splitext(os.path.basename(self.pptx_path))[0] + ".mp4"
        )
        
        video_generator.create_video_from_slides_and_audio(
            slide_images,
            audio_files,
            output_path
        )
        
        # Cleanup temp files
        shutil.rmtree(self.temp_dir)
        
        click.echo(f"Video saved to: {output_path}")
        return output_path


@click.command()
@click.argument("pptx_file", type=click.Path(exists=True))
@click.option("-o", "--output", "output_path", type=click.Path(), help="Output video file path")
@click.option("-l", "--lang", default="en", help="Language for text-to-speech (e.g., en, es, fr)")
@click.option("-d", "--duration", default=5.0, type=float, help="Minimum duration per slide in seconds")
@click.option("--fps", default=30, type=int, help="Frames per second for output video")
@click.option("--dpi", default=150, type=int, help="DPI for slide images")
@click.option("--slides", default=None, help="Slide range to process (e.g., '1', '1,2,3', '1-5')")
@click.option("--play", is_flag=True, help="Play the generated video after creation")
def cli(
    pptx_file: str,
    output_path: Optional[str],
    lang: str,
    duration: float,
    fps: int,
    dpi: int,
    slides: Optional[str],
    play: bool
):
    """Convert a PowerPoint presentation to video with voiceover."""
    converter = PPT2Video(
        pptx_path=pptx_file,
        output_path=output_path,
        lang=lang,
        slide_duration=duration,
        fps=fps,
        dpi=dpi,
        slide_range=slides
    )
    result = converter.run()
    
    if play and result:
        import subprocess
        import platform
        system = platform.system()
        if system == "Windows":
            subprocess.run(["start", "", result], shell=True)
        elif system == "Darwin":
            subprocess.run(["open", result])
        else:
            subprocess.run(["xdg-open", result])


def main():
    """Main entry point for the CLI."""
    cli()
