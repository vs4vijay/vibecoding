"""Video generation module for SlideSpeak.

This module provides functionality to create videos from images and audio using FFmpeg.
"""
import os
from typing import Optional


class VideoGenerator:
    """Creates videos from slide images and audio files using FFmpeg.
    
    This class handles the creation of presentation videos by combining
    slide images with corresponding audio tracks.
    """
    
    def __init__(self, output_dir: str, fps: int = 30, slide_duration: float = 5.0):
        """Initialize the VideoGenerator.
        
        Args:
            output_dir: Directory for temporary files and output
            fps: Frames per second for the output video
            slide_duration: Default duration for each slide (in seconds)
        """
        self.output_dir = output_dir
        self.fps = fps
        self.slide_duration = slide_duration
    
    def create_video(
        self, 
        slides_data: list[dict], 
        output_path: str
    ) -> str:
        """Create a video from slide data.
        
        Args:
            slides_data: List of dicts with keys:
                - image_path: str - Path to the slide image
                - audio_path: Optional[str] - Path to the audio file (optional)
                - duration: float - Duration for this slide in seconds
            output_path: Path where the output video will be saved
            
        Returns:
            Path to the created video file
        """
        import subprocess
        
        temp_dir = self.output_dir
        
        # Build list of input files with durations
        inputs = []
        for slide in slides_data:
            image_path = slide.get("image_path")
            audio_path = slide.get("audio_path")
            duration = slide.get("duration", self.slide_duration)
            
            if not image_path or not os.path.exists(image_path):
                continue
            
            # Override duration if audio is longer
            if audio_path and os.path.exists(audio_path):
                from moviepy import AudioFileClip
                audio_clip = AudioFileClip(audio_path)
                duration = max(duration, audio_clip.duration)
                audio_clip.close()
            
            inputs.append((image_path, audio_path, duration))
        
        # Create video from each image with its duration
        parts = []
        for img_path, audio_file, duration in inputs:
            part_file = os.path.join(temp_dir, f"part_{len(parts)}.mp4")
            cmd = [
                'ffmpeg', '-y',
                '-loop', '1',
                '-i', img_path,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-t', str(duration),
                '-vf', f"scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                '-pix_fmt', 'yuv420p',
                '-r', str(self.fps),
                '-fps_mode', 'cfr',
                part_file
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"FFmpeg part error: {result.stderr[:500]}")
                continue
            parts.append((part_file, audio_file))
        
        # Concatenate all parts
        if len(parts) == 1:
            final_video = parts[0][0]
        else:
            # Write concat list
            concat_file = os.path.join(temp_dir, "concat.txt")
            with open(concat_file, 'w') as f:
                for p, _ in parts:
                    f.write(f"file '{p}'\n")
            
            final_video = os.path.join(temp_dir, "video_concat.mp4")
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-c', 'copy',
                final_video
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"FFmpeg concat error: {result.stderr[:500]}")
                final_video = parts[0][0]
        
        # Check if we have any audio
        audio_files = [a for _, a in parts if a]
        has_audio = bool(audio_files)
        
        if has_audio:
            # Combine all audio files into one
            audio_concat = os.path.join(temp_dir, "audio_concat.txt")
            with open(audio_concat, 'w') as f:
                for a in audio_files:
                    f.write(f"file '{a}'\n")
            
            combined_audio = os.path.join(temp_dir, "combined_audio.m4a")
            
            cmd_audio = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', audio_concat,
                '-c:a', 'aac',
                '-b:a', '192k',
                combined_audio
            ]
            result = subprocess.run(cmd_audio, capture_output=True, text=True)
            
            # Now combine video and audio
            cmd_final = [
                'ffmpeg', '-y',
                '-i', final_video,
                '-i', combined_audio,
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-shortest',
                output_path
            ]
            result = subprocess.run(cmd_final, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"FFmpeg final error: {result.stderr[:500]}")
                # Fall back to just video
                import shutil
                shutil.copy(final_video, output_path)
        else:
            # Just copy video
            import shutil
            shutil.copy(final_video, output_path)
        
        return output_path
    
    def create_video_from_slides_and_audio(
        self, 
        slide_images: list[str], 
        audio_files: list[Optional[str]], 
        output_path: str
    ) -> str:
        """Create video from slide images and audio files.
        
        This is the legacy method for backward compatibility.
        
        Args:
            slide_images: List of paths to slide images
            audio_files: List of audio file paths (can contain None)
            output_path: Path where the output video will be saved
            
        Returns:
            Path to the created video file
        """
        slides_data = []
        for i, image_path in enumerate(slide_images):
            audio_path = audio_files[i] if i < len(audio_files) else None
            slides_data.append({
                "image_path": image_path,
                "audio_path": audio_path,
                "duration": self.slide_duration
            })
        
        return self.create_video(slides_data, output_path)
