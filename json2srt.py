import json
import tkinter as tk
from tkinter import filedialog

def json_to_srt(json_file, srt_file):
    # Načtení JSON dat
    with open(json_file, "r", encoding="utf-8") as file:
        data = json.load(file)
    
    # Inicializace proměnných
    segments = data.get("segments", [])
    srt_lines = []
    index = 1
    
    # Iterace přes segmenty
    for segment in segments:
        words = segment.get("words", [])
        for word in words:
            # Ověření, že klíče existují
            if "start" in word and "end" in word and "word" in word:
                start_time = word["start"]
                end_time = word["end"]
                text = word["word"]
                
                # Formátování časů a textu do SRT formátu
                srt_lines.append(f"{index}")
                srt_lines.append(f"{format_time(start_time)} --> {format_time(end_time)}")
                srt_lines.append(text)
                srt_lines.append("")  # Prázdná řádka mezi bloky
                index += 1
            else:
                # Logování chybějících dat
                print(f"Chybějící klíče ve slově: {word}")
    
    # Zapsání do SRT souboru
    with open(srt_file, "w", encoding="utf-8") as file:
        file.write("\n".join(srt_lines))

def format_time(seconds):
    # Konverze času z sekund na SRT formát (hh:mm:ss,ms)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    millis = int((secs - int(secs)) * 1000)
    return f"{hours:02}:{minutes:02}:{int(secs):02},{millis:03}"

def select_json_file():
    # Zobrazení dialogového okna pro výběr souboru
    root = tk.Tk()
    root.withdraw()  # Skryje hlavní okno tkinter
    file_path = filedialog.askopenfilename(
        title="Vyberte JSON soubor",
        filetypes=[("JSON soubory", "*.json"), ("Všechny soubory", "*.*")]
    )
    return file_path

# Hlavní část programu
if __name__ == "__main__":
    json_file = select_json_file()
    if json_file:
        srt_file = json_file.replace(".json", ".srt")  # Pojmenuje SRT soubor na základě JSON souboru
        json_to_srt(json_file, srt_file)
        print(f"SRT soubor byl úspěšně vytvořen: {srt_file}")
    else:
        print("Nebyl vybrán žádný soubor.")
