import csv
import tkinter as tk
from tkinter import filedialog

def tsv_to_srt(tsv_file, srt_file):
    """
    Convert a TSV file to an SRT file.

    :param tsv_file: Path to the input TSV file.
    :param srt_file: Path to the output SRT file.
    """
    with open(tsv_file, "r", encoding="utf-8") as tsv:
        reader = csv.reader(tsv, delimiter="\t")
        srt_lines = []
        index = 1

        for row in reader:
            if len(row) < 3:
                print(f"Skipping invalid row: {row}")
                continue

            try:
                start_time = int(row[0]) / 1000.0  # Convert milliseconds to seconds
                end_time = int(row[1]) / 1000.0  # Convert milliseconds to seconds
                text = row[2]

                srt_lines.append(f"{index}")
                srt_lines.append(f"{format_time(start_time)} --> {format_time(end_time)}")
                srt_lines.append(text)
                srt_lines.append("")  # Empty line between subtitles
                index += 1
            except ValueError:
                print(f"Error processing row: {row}")

    with open(srt_file, "w", encoding="utf-8") as srt:
        srt.write("\n".join(srt_lines))
    print(f"SRT file successfully created: {srt_file}")

def format_time(seconds):
    """
    Convert seconds to SRT time format (hh:mm:ss,ms).

    :param seconds: Time in seconds.
    :return: Time in SRT format.
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

def select_tsv_file():
    """Show a dialog to select a TSV file."""
    root = tk.Tk()
    root.withdraw()  # Hide the root window
    file_path = filedialog.askopenfilename(
        title="Select a TSV File",
        filetypes=[("TSV Files", "*.tsv"), ("All Files", "*.*")]
    )
    return file_path

if __name__ == "__main__":
    tsv_file = select_tsv_file()
    if tsv_file:
        srt_file = tsv_file.replace(".tsv", ".srt")
        tsv_to_srt(tsv_file, srt_file)
    else:
        print("No TSV file selected.")
