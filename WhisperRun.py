import subprocess
import tkinter as tk
from tkinter import filedialog
import sys
import json
import os
import time

def select_audio_file():
    """Show a dialog to select an audio file."""
    root = tk.Tk()
    root.withdraw()  # Hide the root window
    file_path = filedialog.askopenfilename(
        title="Select an Audio File",
        filetypes=[("Audio Files", "*.mp3 *.wav *.m4a"), ("All Files", "*.*")]
    )
    return file_path

def run_whisperx(audio_file):
    """Run WhisperX using the current Python environment."""
    # Get the Python executable for the current environment
    python_executable = sys.executable
    
    # Command to run WhisperX
    command = f'"{python_executable}" -m whisperx "{audio_file}" --model large --output_dir Subs --compute_type float32'
    
    print("Running WhisperX command:", command)
    
    try:
        # Run the command
        subprocess.run(command, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"An error occurred: {e}")

def json_to_srt(json_file, srt_file):
    """Convert JSON file to SRT format."""
    # Load JSON data
    with open(json_file, "r", encoding="utf-8") as file:
        data = json.load(file)
    
    # Initialize variables
    segments = data.get("segments", [])
    srt_lines = []
    index = 1
    
    # Iterate over segments
    for segment in segments:
        words = segment.get("words", [])
        for word in words:
            if "start" in word and "end" in word and "word" in word:
                start_time = word["start"]
                end_time = word["end"]
                text = word["word"]
                
                # Format times and text to SRT format
                srt_lines.append(f"{index}")
                srt_lines.append(f"{format_time(start_time)} --> {format_time(end_time)}")
                srt_lines.append(text)
                srt_lines.append("")  # Empty line between blocks
                index += 1
            else:
                print(f"Missing keys in word: {word}")
    
    # Write to SRT file
    with open(srt_file, "w", encoding="utf-8") as file:
        file.write("\n".join(srt_lines))

def format_time(seconds):
    """Convert seconds to SRT time format (hh:mm:ss,ms)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    millis = int((secs - int(secs)) * 1000)
    return f"{hours:02}:{minutes:02}:{int(secs):02},{millis:03}"

def find_json_file(directory):
    """Look for the JSON file in the output directory."""
    for filename in os.listdir(directory):
        if filename.endswith(".json"):
            return os.path.join(directory, filename)
    return None

if __name__ == "__main__":
    audio_file = select_audio_file()
    if audio_file:
        run_whisperx(audio_file)

        # Wait for WhisperX to finish and ensure the output is ready
        time.sleep(5)

        # Find the generated JSON file in the Subs directory
        json_file = find_json_file("Subs")
        if json_file:
            srt_file = json_file.replace(".json", ".srt")
            json_to_srt(json_file, srt_file)
            print(f"SRT file successfully created: {srt_file}")
        else:
            print("No JSON file found in the 'Subs' folder.")
    else:
        print("No audio file selected.")