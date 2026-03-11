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

    const captureScript = `
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
$graphics.Dispose()
$bitmap.Dispose()

try { [System.Windows.Forms.Clipboard]::SetText($SafePath) } catch { }

@{ success = $true; path = $SafePath } | ConvertTo-Json -Compress
`;

    let captureResult;
    try {
      captureResult = await runPowerShell(captureScript, [screenshotPath], 20000);
    } catch (e) {
      return JSON.stringify({ error: e?.message ?? String(e) });
    } finally {
      try { if (voiceWin && !voiceWin.isDestroyed()) voiceWin.setOpacity(1); } catch { }
    }

    // ── Step 2: Open with requested app (fire-and-forget, separate call) ──
    if (openWith) {
      const safeApp = escapeForPowerShell(openWith);
      let openScript;
      if (openWith === 'default') {
        openScript = `param($F); Invoke-Item $F`;
      } else {
        openScript = `param($F); try { Start-Process '${safeApp}' -ArgumentList ([string[]](,$F)) -ErrorAction Stop } catch { Invoke-Item $F }`;
      }
      runPowerShell(openScript, [screenshotPath], 10000).catch(e => {
        logger.warn(`[screenshot] openWith failed: ${e?.message}`);
      });
    }

    return captureResult;
  },
};
