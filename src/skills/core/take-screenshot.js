const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { HOME_DIR, runPowerShell, escapeForPowerShell, logger } = require('./_shared');

const DEFAULT_SAVE_DIR = path.join(HOME_DIR, 'Pictures', 'Screenshots');

module.exports = {
  schema: z.object({
    savePath: z
      .string()
      .optional()
      .describe(
        "Directory to save the screenshot. Defaults to ~/Pictures/Screenshots. Use {{user.desktop}} for Desktop.",
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Filename for the screenshot (include .png). Defaults to screenshot_<timestamp>.png.",
      ),
    openWith: z
      .string()
      .optional()
      .describe(
        "Executable name to open the file after saving. Use the exact executable name (e.g. code, mspaint, notepad). Use 'default' for the system default app.",
      ),
  }),
  name: "takeScreenshot",
  description:
    "Take a full-screen screenshot. Can save to any path (default: ~/Pictures/Screenshots), use a custom filename, and open the result with any application.",
  tags: ["screen", "screenshot", "capture"],

  returnType: "action",
  marker: "announce",
  ui: null,

  examples: [
    { user: "take a screenshot", action: "[action: takeScreenshot]" },
    {
      user: "capture my screen and save to desktop",
      action: "[action: takeScreenshot, savePath: {{user.desktop}}]",
    },
    {
      user: "take a screenshot and open it in VS Code",
      action:
        "[action: takeScreenshot, savePath: {{user.desktop}}, filename: screenshot.png, openWith: code]",
    },
    {
      user: "screenshot and open with paint",
      action:
        "[action: takeScreenshot, savePath: {{user.desktop}}, openWith: mspaint]",
    },
    {
      user: "take a screenshot and open it with the default app",
      action:
        "[action: takeScreenshot, savePath: {{user.desktop}}, openWith: default]",
    },
  ],

    async handler(params) {
        const saveDir = params && params.savePath ? params.savePath : DEFAULT_SAVE_DIR;

        const filename = params && params.filename ? params.filename : `screenshot_${Date.now()}.png`;

        try {
            if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
        } catch (err) {
            return JSON.stringify({ error: `Failed to create screenshot directory: ${err?.message ?? String(err)}` });
        }

        const screenshotPath = path.join(saveDir, filename);
        const openWith = params && params.openWith ? params.openWith.trim() : null;

        let voiceWin = null;
        try {
            const { BrowserWindow } = require('electron');
            voiceWin = BrowserWindow.getAllWindows().find(
                w => !w.isDestroyed() && w.isVisible() && w.getTitle() === 'Venesa'
            ) || null;
            if (voiceWin) voiceWin.setOpacity(0);
        } catch (e) {
            logger.warn(`[screenshot] Could not hide voice window: ${e?.message}`);
        }

        await new Promise(r => setTimeout(r, 200));

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
try { [System.Windows.Forms.Clipboard]::SetText($SafePath) } catch { }

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
$graphics.Dispose()
$bitmap.Dispose()

@{ success = $true; path = $SafePath; clipboard = $clipSuccess } | ConvertTo-Json -Compress
`;

        let openScript = '';
        if (openWith) {
            const safeApp = escapeForPowerShell(openWith);
            if (openWith === 'default') {
                openScript = `\nInvoke-Item $SafePath`;
            } else if (openWith === 'ms-photos:') {
                openScript = `\n$_photoUri = 'ms-photos:viewer?file=' + [System.Uri]::EscapeDataString('file:///' + $SafePath.Replace('\\', '/'))\nStart-Process $_photoUri`;
            } else {
                openScript = `\nStart-Process '${safeApp}' -ArgumentList ([string[]](,$SafePath))`;
            }
        }

        try {
            return await runPowerShell(psScript + openScript, [screenshotPath], 15000);
        } catch (e) {
            return JSON.stringify({ error: e?.message ?? String(e) });
        } finally {
            try { if (voiceWin && !voiceWin.isDestroyed()) voiceWin.setOpacity(1); } catch {}
        }
    },
};
