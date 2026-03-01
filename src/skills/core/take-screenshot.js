/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: take-screenshot
 *  Capture screen, save to Pictures/Screenshots, copy to clipboard.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { HOME_DIR, runPowerShell, logger } = require('./_shared');

module.exports = {
    schema: z.object({}),
    name: 'takeScreenshot',
    description: 'Take a screenshot, save to Pictures and copy to clipboard',
    tags: ['screen', 'screenshot', 'capture'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'take a screenshot', action: '[action: takeScreenshot]' },

        { user: 'capture my screen', action: '[action: takeScreenshot]' },

    ],


    async handler() {
        const picturesDir = path.join(HOME_DIR, 'Pictures', 'Screenshots');

        try {
            if (!fs.existsSync(picturesDir)) {
                fs.mkdirSync(picturesDir, { recursive: true });
            }
        } catch (err) {
            logger.error(`[screenshot] Failed to create directory ${picturesDir}: ${err?.message ?? String(err)}`);
            return JSON.stringify({ error: `Failed to create screenshot directory: ${err?.message ?? String(err)}` });
        }

        const screenshotPath = path.join(picturesDir, `screenshot_${Date.now()}.png`);

        // Delay 300ms so voice overlay isn't captured
        await new Promise(r => setTimeout(r, 300));

        const psScript = `
param($SafePath)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$left   = [System.Windows.Forms.SystemInformation]::VirtualScreen.Left
$top    = [System.Windows.Forms.SystemInformation]::VirtualScreen.Top
$width  = [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
$height = [System.Windows.Forms.SystemInformation]::VirtualScreen.Height

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($width, $height)))

$bitmap.Save($SafePath, [System.Drawing.Imaging.ImageFormat]::Png)

# Copy to clipboard via STA thread (Clipboard requires STA)
# Clone the bitmap so the thread owns a separate copy and we can safely
# dispose the original after saving without racing the clipboard write.
$clipSuccess = $false
try {
    $bitmapClone = $bitmap.Clone()
    $thread = New-Object System.Threading.Thread([System.Threading.ThreadStart]{
        try {
            [System.Windows.Forms.Clipboard]::SetImage($bitmapClone)
            $script:clipSuccess = $true
            $bitmapClone.Dispose()
        } catch {
            $script:clipSuccess = $false
            try { $bitmapClone.Dispose() } catch { }
        }
    })
    $thread.SetApartmentState([System.Threading.ApartmentState]::STA)
    $thread.Start()
    $joined = $thread.Join(5000)
    if (-not $joined) { $clipSuccess = $false }
} catch {
    $clipSuccess = $false
}

# The original bitmap and graphics can be disposed immediately since
# the thread works on a clone ($bitmapClone) that it disposes itself.
$graphics.Dispose()
$bitmap.Dispose()

@{ success = $true; path = $SafePath; clipboard = $clipSuccess } | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, [screenshotPath], 15000);
        } catch (e) {
            return JSON.stringify({ error: e?.message ?? String(e) });
        }
    },
};
