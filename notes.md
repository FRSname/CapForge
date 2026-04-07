
Using software called **Whisper** to auto transcribe Czech language audio files.

```
https://github.com/openai/whisper
```

### How to use it

Open PowerShell and start where is your audio file.

```
python -m whisper "name-of-audio-file".mp3 --model large --language Czech
```

In my case there was best output with large model.
**Whisper** than analyze that file and generate **.SRT** file with transcribe.

Unfortunately there is no way to generate word by word time stamp so its not usable for **SUB machine** plugin in **Premiere pro**.

### Word-By-Word conversion

to use .SRT files with **SUB Machine plugin** in **Premiere pro** we need time stamps in our subtitle file for each word as it is said

At this moment i have made python script which converts our .SRT file to word-by-word format but words are separated with equal time stamps so they dont fit to words they say in original file and you need to adjust each word in **Premiere pro** timeline manualy

#### Python script for conversion

```
import re

def split_srt_to_words(input_srt, output_srt):
    with open(input_srt, "r", encoding="utf-8") as file:
        lines = file.readlines()

    pattern = r"(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n(.+)"
    result = []
    index = 1

    for i in range(0, len(lines), 4):  # Process each subtitle block
        match = re.match(pattern, "".join(lines[i:i+4]))
        if match:
            start_time = match.group(2)
            end_time = match.group(3)
            text = match.group(4)

            words = text.split()
            word_duration = (convert_to_ms(end_time) - convert_to_ms(start_time)) / len(words)

            for j, word in enumerate(words):
                word_start = convert_to_ms(start_time) + j * word_duration
                word_end = word_start + word_duration
                result.append(f"{index}\n{convert_to_time(word_start)} --> {convert_to_time(word_end)}\n{word}\n")
                index += 1

    with open(output_srt, "w", encoding="utf-8") as file:
        file.writelines(result)

def convert_to_ms(timestamp):
    parts = re.split("[:,]", timestamp)
    if len(parts) == 4:  # Očekávaný formát hh:mm:ss,ms
        h, m, s = map(int, parts[:3])
        ms = int(parts[3])
        return h * 3600000 + m * 60000 + s * 1000 + ms
    elif len(parts) == 3:  # Možný formát hh:mm:ss (bez milisekund)
        h, m, s = map(int, parts)
        return h * 3600000 + m * 60000 + s * 1000
    else:
        raise ValueError(f"Unexpected timestamp format: {timestamp}")

def convert_to_time(ms):
    h = ms // 3600000
    ms %= 3600000
    m = ms // 60000
    ms %= 60000
    s = ms / 1000
    return f"{int(h):02}:{int(m):02}:{s:06.3f}".replace('.', ',')

# Použití
split_srt_to_words("original.srt", "split_by_word.srt")

```

### How to use script

you need to have in one folder:
 **"split_srt_to_words.py"** - `python script` 
 **"original.srt"**          - `original .SRT file with whole sentences`

Open PowerShell and run: 
``` 
python split_srt_to_words.py
 ```

Script just generated new .SRT file with word-by-word timestamps.




# Version 2.0

## WhisperX

```
https://docs.anaconda.com/miniconda/install/#quick-command-line-install

https://github.com/m-bain/whisperX

https://huggingface.co/fav-kky/wav2vec2-base-cs-de-100k
```

Installation:
1. Create an Folder for Python Environment (must be Python 3.10)
```
# Navigate to your desired directory 
cd path\to\your\project  

# Create a virtual environment named 'whisperx' 
python3.10 -m venv whisperx
```

2. Activate the virtual environment
``` 
.\whisperx\Scripts\Activate
``` 

3. Install CTranslate 2

``` 
pip install ctranslate2 
```

4. Install PyTorch (Must have Cuda and CuDNN installed [Nvidia cuda](https://developer.nvidia.com/cuda-downloads?target_os=Windows&target_arch=x86_64&target_version=11&target_type=exe_local) [cuDNN](https://developer.nvidia.com/cudnn-downloads?target_os=Windows&target_arch=x86_64&target_version=10&target_type=exe_local))
```
# If you have nvidia card and CUDA 11.8 install this:

pip install torch==2.0.0 torchaudio==2.0.0 --index-url https://download.pytorch.org/whl/cu118

# If you dont have GPU and want to run from CPU than this:

pip install torch==2.0.0 torchaudio==2.0.0 --index-url https://download.pytorch.org/whl/cpu
```

5. Install WhisperX
```
pip install whisperx
```

6. Additionally you may need ffmpeg and Rust
```
choco install ffmpeg
```

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```


## How to use it

With this command you gonna start audio transcription, you need to have audio file with your desired voice to be transcribed in the same folder as your WhisperX environment. In my case with Czech language it works well when i selected **Large model** and **Compute Type to Float32** because of my GPU. Output Dir is your directory where transcribed files goes.
```
python -m whisperx "Your_Audio_File.mp3" --model large --output_dir Subs --compute_type float32
```


after transcription there will be files in Subs folder.
we need to convert .json file with word time stamps to .srt
This script will do it for us
### Python for chosing audio file and converting .json to .srt
