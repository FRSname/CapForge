# SubForge Subtitles — Premiere Pro Plugin

A CEP (Common Extensibility Platform) panel for Adobe Premiere Pro that imports subtitles from SubForge's `.subforge` format (or `.srt` files) and places them as MOGRT clips on the timeline with precise word-level timing.

## Prerequisites

- **Adobe Premiere Pro CC 2015+** (tested on 2023/2024)
- **A MOGRT template** with an exposed "Source Text" Essential Graphics property
- A `.subforge` or `.srt` subtitle file (exported from SubForge)

## Installation

### Quick Install (Windows)

1. **Right-click** `install.bat` → **Run as administrator**
2. Restart Premiere Pro
3. Open **Window → Extensions → SubForge Subtitles**

### Manual Install

1. **Enable CEP Debug Mode** (allows unsigned extensions):
   - Open `regedit`
   - Navigate to `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11` (create key if missing)
   - Set string value `PlayerDebugMode` to `1`
   - Repeat for CSXS.9, CSXS.10, CSXS.12 if targeting multiple CC versions

2. **Symlink the plugin folder** to Adobe's extensions directory:
   ```
   mklink /D "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\com.subforge.subtitles" "path\to\premiere-plugin"
   ```
   Or copy the entire `premiere-plugin` folder there and rename it to `com.subforge.subtitles`.

3. **Restart Premiere Pro** and open **Window → Extensions → SubForge Subtitles**.

## Creating MOGRT Templates

The panel works with any `.mogrt` file that has at least one text property exposed in Essential Graphics.

### Using the included AE script

1. Open **After Effects**
2. Run **File → Scripts → Run Script File** and select `mogrt/create-mogrt-templates.jsx`
3. The script creates 4 template compositions:
   - **SubForge — Clean**: White text on semi-transparent dark box
   - **SubForge — Bold Pop**: Impact font with drop shadow, scale-pop animation
   - **SubForge — Karaoke**: Yellow text on dark background
   - **SubForge — Minimal**: Small clean Helvetica text
4. For each composition:
   - Open the **Essential Graphics** panel (Window → Essential Graphics)
   - Select the comp in the "Master" dropdown
   - Drag the **Source Text** property into the Essential Properties area
   - Click **Export Motion Graphics Template** and save as `.mogrt`

### Using your own MOGRTs

Any MOGRT with Essential Graphics properties will work. The panel automatically detects available properties when you load a MOGRT file.

## Usage

### In the Panel

1. **Load subtitle file** — Click "Load .subforge / .srt file" and select your exported file
2. **Select MOGRT** — Click "Select MOGRT file" and pick your template. The panel will briefly place a temp clip to discover its properties, then remove it
3. **Choose text property** — Select which Essential Graphics property to use for the subtitle text
4. **Set display mode**:
   - **Word Groups** (default): 2-3 word chunks with per-group timing
   - **Full Phrases**: Complete subtitle lines
   - **Word by Word**: Individual words (great for karaoke/music videos)
5. **Pick target track** and optional time offset
6. **Create Subtitles** — Places all clips on the timeline

### Clearing

Use the **Clear Track** button to remove all clips from the selected track before re-generating.

## File Structure

```
premiere-plugin/
├── CSXS/
│   └── manifest.xml          # CEP extension configuration
├── html/
│   └── index.html            # Panel UI
├── css/
│   └── styles.css            # Dark theme styling
├── js/
│   ├── CSInterface.js        # Adobe CEP communication library
│   └── main.js               # Panel logic (file parsing, UI, CSInterface calls)
├── jsx/
│   └── main.jsx              # ExtendScript (Premiere Pro API)
├── mogrt/
│   └── create-mogrt-templates.jsx  # After Effects script to generate templates
├── install.bat               # One-click Windows installer
└── README.md                 # This file
```

## Troubleshooting

- **Panel doesn't appear in Extensions menu**: Run `install.bat` as Administrator and restart Premiere
- **"No active sequence"**: Open or create a sequence before using the panel
- **MOGRT fails to import**: Ensure the `.mogrt` file path has no special characters; try moving it to a simple path like `C:\mogrt\`
- **No properties found**: The MOGRT may not have Essential Graphics properties exposed. Open it in After Effects and add Source Text to Essential Properties
- **Debug console**: Open Chrome DevTools at `http://localhost:8088` while Premiere is running with the panel loaded
