/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: system-control
 *  Control system settings (volume, brightness, wifi, power).
 * ═══════════════════════════════════════════════════════════════
 */

const { runPowerShell } = require('./_shared');

module.exports = {
    name: 'systemControl',
    description: 'Control system settings (volume, brightness, wifi, bluetooth, power)',
    tags: ['system', 'control', 'volume', 'brightness'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const command = params.command;
        const levelRaw = params.value ?? params.level;
        const value = parseInt(levelRaw ?? 0, 10);

        const getScript = () => {
            switch (command) {
                case 'volumeUp':
                    return "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]175)";
                case 'volumeDown':
                    return "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]174)";
                case 'volumeMute':
                    return "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)";
                case 'setVolume': {
                    const cv = Math.max(0, Math.min(100, value));
                    const steps = Math.round(cv / 2);
                    return `
$w = New-Object -ComObject WScript.Shell
for($i=0;$i-lt 50;$i++) { $w.SendKeys([char]174) }
for($i=0;$i-lt ${steps};$i++) { $w.SendKeys([char]175) }
`;
                }
                case 'setBrightness': {
                    const cb = Math.max(0, Math.min(100, value));
                    return `Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = ${cb} }`;
                }
                case 'brightnessUp':
                    return `$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness; Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [math]::Min(100, $b + 10) }`;
                case 'brightnessDown':
                    return `$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness; Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [math]::Max(0, $b - 10) }`;
                case 'wifiToggle':
                    return "$a = Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless' } | Select-Object -First 1; if ($a.Status -eq 'Up') { Disable-NetAdapter -Name $a.Name -Confirm:$false } else { Enable-NetAdapter -Name $a.Name -Confirm:$false }";
                case 'bluetoothToggle':
                    return "$b = Get-PnpDevice | Where-Object { $_.Class -eq 'Bluetooth' -and $_.FriendlyName -match 'Bluetooth' } | Select-Object -First 1; if ($b.Status -eq 'OK') { Disable-PnpDevice -InstanceId $b.InstanceId -Confirm:$false } else { Enable-PnpDevice -InstanceId $b.InstanceId -Confirm:$false }";
                case 'shutdown':
                    return 'shutdown /s /t 15';
                case 'restart':
                    return 'shutdown /r /t 15';
                case 'sleep':
                    return 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0';
                case 'lock':
                    return 'rundll32.exe user32.dll,LockWorkStation';
                case 'emptyTrash':
                    return 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue';
                case 'openSettings':
                    return 'start ms-settings:';
                default:
                    return null;
            }
        };

        const script = getScript();
        if (!script) return `Unknown command: ${command}`;

        try {
            await runPowerShell(script);
            return `Done: ${command}` + ((levelRaw != null && levelRaw !== '') ? ` (${value})` : '');
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
