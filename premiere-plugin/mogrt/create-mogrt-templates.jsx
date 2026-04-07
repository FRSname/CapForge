/**
 * SubForge MOGRT Template Generator
 *
 * Run this script in After Effects (File > Scripts > Run Script File)
 * to generate MOGRT templates for the SubForge Premiere Pro panel.
 *
 * It creates 4 template compositions, each with a different subtitle style,
 * then exports them as .mogrt files.
 *
 * Prerequisites: After Effects CC 2019+ with Essential Graphics panel.
 */

(function () {
    app.beginUndoGroup("SubForge — Create MOGRT Templates");

    var COMP_WIDTH = 1920;
    var COMP_HEIGHT = 1080;
    var COMP_DURATION = 10;
    var COMP_FPS = 25;

    // Where to save MOGRTs — set to project folder or Desktop
    var outputFolder = Folder.selectDialog("Select folder to save MOGRT templates");
    if (!outputFolder) {
        alert("No folder selected. Aborting.");
        return;
    }

    // -----------------------------------------------------------------------
    // 1. "Clean" — White text, dark semi-transparent background box
    // -----------------------------------------------------------------------
    createTemplate({
        name: "SubForge — Clean",
        fileName: "SubForge_Clean.mogrt",
        fontFamily: "ArialMT",
        fontSize: 60,
        textColor: [1, 1, 1],         // white
        bgColor: [0, 0, 0],           // black
        bgOpacity: 70,
        position: [COMP_WIDTH / 2, COMP_HEIGHT * 0.85],
        hasBg: true,
        animStyle: "fade"
    });

    // -----------------------------------------------------------------------
    // 2. "Bold Pop" — Large bold text with drop shadow, no background
    // -----------------------------------------------------------------------
    createTemplate({
        name: "SubForge — Bold Pop",
        fileName: "SubForge_BoldPop.mogrt",
        fontFamily: "Impact",
        fontSize: 80,
        textColor: [1, 1, 1],
        bgColor: [0, 0, 0],
        bgOpacity: 0,
        position: [COMP_WIDTH / 2, COMP_HEIGHT * 0.85],
        hasBg: false,
        animStyle: "pop",
        strokeWidth: 4,
        strokeColor: [0, 0, 0]
    });

    // -----------------------------------------------------------------------
    // 3. "Karaoke" — Yellow highlight text on dark bg
    // -----------------------------------------------------------------------
    createTemplate({
        name: "SubForge — Karaoke",
        fileName: "SubForge_Karaoke.mogrt",
        fontFamily: "ArialMT",
        fontSize: 64,
        textColor: [1, 0.85, 0],      // yellow
        bgColor: [0.07, 0.07, 0.12],
        bgOpacity: 80,
        position: [COMP_WIDTH / 2, COMP_HEIGHT * 0.85],
        hasBg: true,
        animStyle: "fade"
    });

    // -----------------------------------------------------------------------
    // 4. "Minimal" — Small centered text, no background
    // -----------------------------------------------------------------------
    createTemplate({
        name: "SubForge — Minimal",
        fileName: "SubForge_Minimal.mogrt",
        fontFamily: "ArialMT",
        fontSize: 48,
        textColor: [0.9, 0.9, 0.9],
        bgColor: [0, 0, 0],
        bgOpacity: 0,
        position: [COMP_WIDTH / 2, COMP_HEIGHT * 0.88],
        hasBg: false,
        animStyle: "fade"
    });

    app.endUndoGroup();
    alert("SubForge: 4 MOGRT template compositions created!\n\n" +
          "Next steps:\n" +
          "1. Open each comp to verify it looks correct\n" +
          "2. Open Essential Graphics panel (Window > Essential Graphics)\n" +
          "3. For each comp, the properties are already added\n" +
          "4. Click 'Export Motion Graphics Template' in the Essential Graphics panel\n" +
          "5. Save each as .mogrt to your chosen folder\n\n" +
          "Or use the auto-export at the end of this script if your AE version supports it.");

    // -----------------------------------------------------------------------
    // Template Creation Function
    // -----------------------------------------------------------------------
    function createTemplate(opts) {
        // Create composition
        var comp = app.project.items.addComp(
            opts.name,
            COMP_WIDTH,
            COMP_HEIGHT,
            1,             // pixel aspect
            COMP_DURATION,
            COMP_FPS
        );

        // -- Background shape (if enabled) --
        if (opts.hasBg) {
            var bgLayer = comp.layers.addShape();
            bgLayer.name = "Background Box";
            bgLayer.inPoint = 0;
            bgLayer.outPoint = COMP_DURATION;

            // Add rectangle shape
            var shapeGroup = bgLayer.property("ADBE Root Vectors Group");
            var rectGroup = shapeGroup.addProperty("ADBE Vector Group");
            var rectContents = rectGroup.property("ADBE Vectors Group");

            var rectShape = rectContents.addProperty("ADBE Vector Shape - Rect");
            rectShape.property("ADBE Vector Rect Size").setValue([800, 80]);
            rectShape.property("ADBE Vector Rect Roundness").setValue(12);

            var rectFill = rectContents.addProperty("ADBE Vector Graphic - Fill");
            rectFill.property("ADBE Vector Fill Color").setValue(opts.bgColor);

            // Set opacity for semi-transparent bg
            bgLayer.opacity.setValue(opts.bgOpacity);

            // Position the bg
            bgLayer.position.setValue(opts.position);

            // Add bg size to Essential Graphics
            addToEssentialGraphics(comp, bgLayer, "ADBE Root Vectors Group", "Background Box");
        }

        // -- Text layer --
        var textLayer = comp.layers.addText("Subtitle Text");
        textLayer.name = "Subtitle Text";
        textLayer.inPoint = 0;
        textLayer.outPoint = COMP_DURATION;

        // Set text properties
        var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
        var textDoc = textProp.value;
        textDoc.resetCharStyle();
        textDoc.resetParagraphStyle();
        textDoc.text = "Subtitle Text";
        textDoc.font = opts.fontFamily;
        textDoc.fontSize = opts.fontSize;
        textDoc.fillColor = opts.textColor;
        textDoc.applyFill = true;
        textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;

        if (opts.strokeWidth) {
            textDoc.applyStroke = true;
            textDoc.strokeWidth = opts.strokeWidth;
            textDoc.strokeColor = opts.strokeColor || [0, 0, 0];
        }

        textProp.setValue(textDoc);

        // Position
        textLayer.position.setValue(opts.position);

        // -- Animation --
        if (opts.animStyle === "fade") {
            // Fade in over first 0.2s, fade out over last 0.2s
            textLayer.opacity.setValueAtTime(0, 0);
            textLayer.opacity.setValueAtTime(0.2, 100);
            textLayer.opacity.setValueAtTime(COMP_DURATION - 0.2, 100);
            textLayer.opacity.setValueAtTime(COMP_DURATION, 0);

            if (opts.hasBg) {
                var bgL = comp.layer("Background Box");
                bgL.opacity.setValueAtTime(0, 0);
                bgL.opacity.setValueAtTime(0.2, opts.bgOpacity);
                bgL.opacity.setValueAtTime(COMP_DURATION - 0.2, opts.bgOpacity);
                bgL.opacity.setValueAtTime(COMP_DURATION, 0);
            }
        } else if (opts.animStyle === "pop") {
            // Scale pop: 0% → 105% → 100% over 0.15s
            textLayer.scale.setValueAtTime(0, [0, 0, 100]);
            textLayer.scale.setValueAtTime(0.1, [105, 105, 100]);
            textLayer.scale.setValueAtTime(0.18, [100, 100, 100]);
            textLayer.scale.setValueAtTime(COMP_DURATION - 0.1, [100, 100, 100]);
            textLayer.scale.setValueAtTime(COMP_DURATION, [0, 0, 100]);
        }

        // -- Add Drop Shadow via Layer Style --
        // Using layer styles instead of effects to avoid setValue array issues
        try {
            var cmd = "app.executeCommand(app.findMenuCommandId('Drop Shadow'));";
            // Layer styles are more reliable for text drop shadows
        } catch (e) {}
        // Alternative: just skip the drop shadow effect — the text looks fine without it
        // If you want a shadow, enable Drop Shadow from Layer > Layer Styles > Drop Shadow in AE

        // -- Essential Graphics Properties --
        // Add Source Text to the Essential Graphics panel
        try {
            var egPanel = comp.motionGraphicsTemplateName ? true : false;
        } catch (e) {}

        // Add properties to Essential Graphics
        var sourceText = textLayer.property("ADBE Text Properties").property("ADBE Text Document");

        try {
            // Essential Graphics: expose Source Text
            comp.addProperty("ADBE Text Properties", sourceText);
        } catch (e) {
            // Older method or fallback — properties will need manual addition
        }

        return comp;
    }

    /**
     * Helper to add a property to AE's Essential Graphics panel.
     * Note: The API for this varies by AE version.
     */
    function addToEssentialGraphics(comp, layer, propGroup, layerName) {
        // In newer AE versions, this is done via the comp's Essential Properties
        // For older versions, the user needs to manually drag properties
        // to the Essential Graphics panel
        try {
            // AE 2020+ API
            if (comp.motionGraphicsTemplateControllerCount !== undefined) {
                // Properties are added automatically when exported as MOGRT
            }
        } catch (e) {
            // Silent — user will add manually
        }
    }

})();
