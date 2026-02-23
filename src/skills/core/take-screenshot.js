/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: take-screenshot
 *  Take a screenshot and save to Pictures folder.
 * ═══════════════════════════════════════════════════════════════
 */

const path = require('path');
const { HOME_DIR, runPowerShell } = require('./_shared');

module.exports = {
    name: 'takeScreenshot',
    description: 'Take a screenshot saved to Pictures folder',
    tags: ['screen', 'screenshot', 'capture'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    async handler() {
        const screenshotPath = path.join(HOME_DIR, 'Pictures', `screenshot_${Date.now()}.png`);
        const psScript = `
param($SafePath)
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bitmap.Save($SafePath)
$graphics.Dispose()
$bitmap.Dispose()
@{ success = $true; path = $SafePath } | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, [screenshotPath], 10000);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
