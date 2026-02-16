const { spawn } = require("child_process");
const { shell, clipboard } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const logger = require('./logger');
const registry = require('./task-registry');
const orchestrator = require('./task-orchestrator');

const HOME_DIR = os.homedir();

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff", ".heic"
]);

const CODE_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".py", ".html", ".css", ".json", ".xml",
  ".java", ".cpp", ".c", ".h", ".cs", ".php", ".rb", ".go", ".rs", ".swift",
  ".vue", ".svelte", ".md", ".yaml", ".yml", ".sh", ".bat", ".ps1", ".sql"
]);

const DOCUMENT_EXTENSIONS = new Set([
  ".doc", ".docx", ".pdf", ".txt", ".rtf", ".xls", ".xlsx", ".ppt", ".pptx", ".odt"
]);

const POWERSHELL_TIMEOUT_MS = 20000;

const psSession = require('./powershell-session');


async function runPowerShell(script, timeoutMs = POWERSHELL_TIMEOUT_MS) {
  return psSession.execute(script, timeoutMs);
}


function getCurrentTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return JSON.stringify({ time: timeStr, date: dateStr, full: `${timeStr} on ${dateStr}` });
}



const SAFE_PS_PATTERNS = [
  /^Get-CimInstance/i,
  /^Get-Process/i,
  /^Get-Service/i,
  /^Get-ChildItem/i,
  /^Get-Content/i,
  /^Get-Date/i,
  /^Get-Location/i,

  /^\$env:/i,
  /^\[math\]::/i,
];


const DANGEROUS_PS_PATTERNS = [

  /-enc/i, /-encodedcommand/i, /-e\s/i,

  /webclient/i, /net\./i, /downloadstring/i, /downloadfile/i,
  /invoke-webrequest/i, /iwr\s/i, /curl/i, /wget/i,

  /invoke-expression/i, /iex\s/i, /invoke-command/i, /icm\s/i,
  /scriptblock/i, /\[scriptblock\]/i, /::create/i,

  /reflection/i, /\[type\]/i, /gettype/i, /assembly/i,

  /&\s*\$/i, /&\s*\(/i, /&\s*['"]/, /\+\s*['"].*['"]\s*\+/i,

  /remove-/i, /delete-/i, /set-/i, /new-/i, /stop-/i, /start-/i,
  /clear-/i, /install-/i, /uninstall-/i, /update-/i, /add-/i,
  /format-/i, /mount-/i, /dismount-/i, /restart-/i, /shutdown/i,
  /rm\s/i, /del\s/i, /-file\s/i, /-command\s/i,
  /powershell/i, /pwsh/i, /cmd\.exe/i, /cmd\s/i,
];



async function runSafePowerShell(script) {
  if (!script || typeof script !== 'string') {
    return JSON.stringify({ error: "No script provided" });
  }

  const trimmedScript = script.trim();


  for (const pattern of DANGEROUS_PS_PATTERNS) {
    if (pattern.test(trimmedScript)) {
      return JSON.stringify({ error: "Command contains blocked pattern" });
    }
  }


  const isAllowed = SAFE_PS_PATTERNS.some(pattern => pattern.test(trimmedScript));
  if (!isAllowed) {
    return JSON.stringify({ error: "Command not in allowlist" });
  }

  try {
    const result = await runPowerShell(script, 10000);
    return result;
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}


async function listRunningApps() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$systemApps = @('TextInputHost','ApplicationFrameHost','SystemSettings','ShellExperienceHost','SearchUI','SearchApp','StartMenuExperienceHost','LockApp','Windows.WARP.JITService','svchost','csrss','smss','wininit','services','lsass','winlogon','dwm','taskhostw','sihost','ctfmon','RuntimeBroker','backgroundTaskHost','SecurityHealthSystray','SecurityHealthService','dllhost','conhost','fontdrvhost','WmiPrvSE','spoolsv','dasHost','MsMpEng','NisSrv','SgrmBroker','TabTip','TabTip32','UserOOBEBroker','WidgetService','Widgets')
Get-Process | Where-Object {
  $_.MainWindowTitle -ne '' -and
  $systemApps -notcontains $_.ProcessName
} | Select-Object -Property ProcessName, Id, MainWindowTitle, @{Name='MemoryMB';Expression={[math]::round($_.WorkingSet64/1MB,1)}} |
Sort-Object ProcessName -Unique |
ConvertTo-Json -Compress
`;
  try {
    const output = await runPowerShell(psScript);
    if (output && output !== 'null') {
      const parsed = JSON.parse(output);
      const apps = Array.isArray(parsed) ? parsed : [parsed];
      return JSON.stringify(apps.map(a => ({
        name: a.ProcessName,
        title: a.MainWindowTitle,
        pid: a.Id,
        memoryMB: a.MemoryMB
      })));
    }
  } catch (e) {
    logger.error(`listRunningApps error: ${e.message}`);
  }
  return JSON.stringify([]);
}


async function closeApp(appName) {
  if (!appName || typeof appName !== 'string') {
    return JSON.stringify({ error: 'No app name provided' });
  }

  const safeAppName = escapePowerShellQuery(appName);
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$procs = Get-Process | Where-Object {
  ($_.ProcessName -like '*${safeAppName}*' -or $_.MainWindowTitle -like '*${safeAppName}*') -and
  $_.MainWindowTitle -ne ''
}
if ($procs) {
  $closed = @()
  foreach ($p in $procs) {
    $name = $p.ProcessName
    try {
      $p.CloseMainWindow() | Out-Null
      $closed += $name
    } catch {
      try { Stop-Process -Id $p.Id -Force } catch {}
      $closed += $name
    }
  }
  @{ success = $true; closed = ($closed | Select-Object -Unique) } | ConvertTo-Json -Compress
} else {
  @{ success = $false; error = "No running app found matching '${safeAppName}'" } | ConvertTo-Json -Compress
}
`;

  try {
    const output = await runPowerShell(psScript);
    return output || JSON.stringify({ success: false, error: 'No output' });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}


async function closeAllApps() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$systemApps = @('explorer','TextInputHost','ApplicationFrameHost','SystemSettings','ShellExperienceHost','SearchUI','SearchApp','StartMenuExperienceHost','LockApp','svchost','csrss','smss','wininit','services','lsass','winlogon','dwm','taskhostw','sihost','ctfmon','RuntimeBroker','backgroundTaskHost','SecurityHealthSystray','SecurityHealthService','dllhost','conhost','fontdrvhost','WmiPrvSE','spoolsv','dasHost','MsMpEng','NisSrv','SgrmBroker','TabTip','TabTip32','UserOOBEBroker','WidgetService','Widgets','Venesa','electron')
$procs = Get-Process | Where-Object {
  $_.MainWindowTitle -ne '' -and
  $systemApps -notcontains $_.ProcessName
}
$closed = @()
foreach ($p in $procs) {
  try {
    $p.CloseMainWindow() | Out-Null
    $closed += $p.ProcessName
  } catch {
    try { Stop-Process -Id $p.Id -Force } catch {}
    $closed += $p.ProcessName
  }
}
@{ success = $true; closed = ($closed | Select-Object -Unique); count = $closed.Count } | ConvertTo-Json -Compress
`;

  try {
    const output = await runPowerShell(psScript);
    return output || JSON.stringify({ success: true, closed: [], count: 0 });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}


function getRelativePath(fullPath) {
  if (fullPath.startsWith(HOME_DIR)) {
    return fullPath.substring(HOME_DIR.length + 1);
  }
  return fullPath;
}

function escapePowerShellQuery(query) {
  return query
    .replace(/'/g, "''")
    .replace(/`/g, "``")
    .replace(/\$/g, "`$")
    .replace(/\*/g, "`*")
    .replace(/\?/g, "`?")
    .replace(/\[/g, "`[")
    .replace(/\]/g, "`]");
}

async function searchApplications(query) {
  const escapedQuery = escapePowerShellQuery(query);
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$searchTerm = '${escapedQuery}'
$results = @()
$startMenuPaths = @(
    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
    "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs"
)

foreach ($menuPath in $startMenuPaths) {
    if (Test-Path $menuPath) {
        Get-ChildItem -Path $menuPath -Filter "*.lnk" -Recurse -File |
            Where-Object { $_.BaseName -like "*$searchTerm*" } |
            Select-Object -First 10 |
            ForEach-Object {
                $results += @{ name = $_.BaseName; path = $_.FullName; type = "shortcut" }
            }
    }
}
$results | ConvertTo-Json -Compress
`;

  try {
    const output = await runPowerShell(psScript);
    if (output && output !== "null") {
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch (e) { }
  return [];
}


async function searchFilesAndFolders(query, maxResults = 20) {
  const folders = [];
  const files = [];

  const lowerQuery = query.toLowerCase();
  const searchDirs = [
    path.join(HOME_DIR, 'Desktop'),
    path.join(HOME_DIR, 'Documents'),
    path.join(HOME_DIR, 'Downloads'),
    path.join(HOME_DIR, 'Pictures'),
    path.join(HOME_DIR, 'Music'),
    path.join(HOME_DIR, 'Videos'),
    path.join(HOME_DIR, 'OneDrive', 'Desktop'),
    path.join(HOME_DIR, 'OneDrive', 'Documents')
  ];

  let foundCount = 0;

  const searchDir = async (dir, depth) => {
    if (foundCount >= maxResults || depth > 2) return;
    try {
      if (!fs.existsSync(dir)) return;

      const contents = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const dirent of contents) {
        if (foundCount >= maxResults) break;

        const fullPath = path.join(dir, dirent.name);
        const name = dirent.name;

        if (name.startsWith('.') || name.startsWith('$')) continue;

        if (name.toLowerCase().includes(lowerQuery)) {
          if (dirent.isDirectory()) {
            folders.push(getRelativePath(fullPath));
          } else {
            files.push(getRelativePath(fullPath));
          }
          foundCount++;
        }

        if (dirent.isDirectory()) {
          await searchDir(fullPath, depth + 1);
        }
      }
    } catch (e) {
      logger.debug(`Directory traversal error: ${e.message}`);
    }
  };

  try {
    for (const dir of searchDirs) {
      await searchDir(dir, 0);
    }
  } catch (e) {
    logger.error(`File search error: ${e.message}`);
  }

  return { files, folders };
}

async function performSearch(query) {
  if (!query) return JSON.stringify({ notFound: true });
  const [apps, { files, folders }] = await Promise.all([
    searchApplications(query),
    searchFilesAndFolders(query)
  ]);
  if (!apps.length && !files.length && !folders.length) return JSON.stringify({ notFound: true });
  return JSON.stringify({ apps, files, folders });
}

async function launchApplication(appName) {
  try {
    const apps = await searchApplications(appName);

    if (apps.length > 0) {
      const result = await shell.openPath(apps[0].path);
      if (result) {
        return `Error launching ${appName}: ${result}`;
      }
      return `Launching ${apps[0].name}`;
    }

    const { exec } = require("child_process");
    return new Promise((resolve) => {
      exec(`start "" "${appName.replace(/"/g, '\\"')}"`, { windowsHide: true }, (error) => {
        if (error) {
          resolve(`Could not find or launch ${appName}`);
        } else {
          resolve(`Launching ${appName}`);
        }
      });
    });
  } catch (e) {
    return `Error launching ${appName}: ${e.message}`;
  }
}

function openFile(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(path.join(HOME_DIR, filePath));
      const canonicalHome = path.resolve(HOME_DIR);

      const normalizedPath = path.normalize(resolvedPath).toLowerCase();
      const normalizedHome = path.normalize(canonicalHome).toLowerCase();
      const homePrefix = path.normalize(canonicalHome + path.sep).toLowerCase();

      let isAllowed = false;

      if (!isAllowed && normalizedPath !== normalizedHome && !normalizedPath.startsWith(homePrefix)) {
        reject(new Error(`Access denied: path escapes home directory`));
        return;
      }

      shell.openPath(resolvedPath)
        .then(result => {
          if (result) {
            reject(new Error(result));
          } else {
            resolve(`Opened ${filePath}`);
          }
        })
        .catch(reject);
    } catch (e) {
      reject(new Error(`Invalid path: ${e.message}`));
    }
  });
}

async function getSystemInfo() {
  const psScript = `
    $os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime,Caption
    $cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Property PercentProcessorTime | Where-Object { $_.Name -eq '_Total' }
    $battery = Get-CimInstance Win32_Battery -Property EstimatedChargeRemaining -ErrorAction SilentlyContinue
    @{
        cpu = "$($cpu.PercentProcessorTime)%"
        ramUsed = [math]::round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
        ramTotal = [math]::round($os.TotalVisibleMemorySize / 1MB, 1)
        battery = if ($battery) { "$($battery.EstimatedChargeRemaining)%" } else { "N/A" }
        uptime = "$([math]::round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)) hours"
    } | ConvertTo-Json -Compress
  `;
  try {
    return await runPowerShell(psScript);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeSystemControl(params) {
  const command = params.command;
  const value = parseInt(params.value || params.level || 0);


  const getScript = () => {
    switch (command) {
      case 'volumeUp':
        return "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]175)";
      case 'volumeDown':
        return "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]174)";
      case 'volumeMute':
        return "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)";
      case 'setVolume':
        const clampedVolume = Math.max(0, Math.min(100, value));
        const volumeSteps = Math.round(clampedVolume / 2);
        return `
          $w = New-Object -ComObject WScript.Shell
          # Reset to 0 first (50 down presses)
          for($i=0;$i-lt 50;$i++) { $w.SendKeys([char]174) }
          # Set to target (each up press is 2%)
          for($i=0;$i-lt ${volumeSteps};$i++) { $w.SendKeys([char]175) }
        `;
      case 'setBrightness':
        const clampedBrightness = Math.max(0, Math.min(100, value));
        return `
          Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = ${clampedBrightness} }
        `;
      case 'brightnessUp':
        return `
          $b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness
          Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [math]::Min(100, $b + 10) }
        `;
      case 'brightnessDown':
        return `
          $b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness
          Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [math]::Max(0, $b - 10) }
        `;
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
    return `Done: ${command}` + (value ? ` (${value})` : '');
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);

async function openUrl(url) {
  if (!url) return "No URL";

  let fullUrl;
  try {

    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      fullUrl = 'https://' + url;
    } else {
      fullUrl = url;
    }

    const parsedUrl = new URL(fullUrl);

    if (!ALLOWED_URL_SCHEMES.has(parsedUrl.protocol)) {
      return `Error: URL scheme '${parsedUrl.protocol}' is not allowed. Only http and https are permitted.`;
    }

    await shell.openExternal(fullUrl);
    return `Opened ${url}`;
  } catch (e) {
    return `Error opening URL: ${e.message}`;
  }
}

async function googleSearch(query) {
  if (!query || typeof query !== 'string') return "No search query provided";
  const encoded = encodeURIComponent(query.trim());
  const url = `https://www.google.com/search?q=${encoded}`;
  try {
    await shell.openExternal(url);
    return `Searching Google for: ${query}`;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

async function youtubeSearch(query) {
  if (!query || typeof query !== 'string') return "No search query provided";
  const encoded = encodeURIComponent(query.trim());
  const url = `https://www.youtube.com/results?search_query=${encoded}`;
  try {
    await shell.openExternal(url);
    return `Searching YouTube for: ${query}`;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

async function getWeather(location) {
  const loc = location || '';
  const encoded = encodeURIComponent(`weather ${loc}`.trim());
  const url = `https://www.google.com/search?q=${encoded}`;
  try {
    await shell.openExternal(url);
    return `Checking weather${loc ? ' for ' + loc : ''}`;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

async function setReminder(params) {
  const message = params.message || params.text || 'Reminder';
  const delayStr = params.delay || params.time || '5';
  const delaySec = parseInt(delayStr, 10);
  if (isNaN(delaySec) || delaySec < 1 || delaySec > 3600) {
    return "Invalid delay. Use 1-3600 seconds.";
  }
  const timeoutMs = delaySec * 1000;
  setTimeout(() => {
    try {
      const { Notification } = require('electron');
      new Notification({ title: 'Venesa Reminder', body: message }).show();
    } catch (e) {
      logger.error(`Reminder notification failed: ${e.message}`);
    }
  }, timeoutMs);
  return `Reminder set: "${message}" in ${delaySec} seconds.`;
}

function calculate(expression) {
  if (!expression || typeof expression !== 'string') return "No expression provided";
  const sanitized = expression.replace(/[^0-9+\-*/.()%^ ]/g, '');
  if (!sanitized.trim()) return "Invalid expression";
  try {
    const prepared = sanitized
      .replace(/\^/g, '**')
      .replace(/(\d+(?:\.\d+)?)%(?!\d)/g, '($1/100)');
    const result = safeEvaluate(prepared);
    if (result === null || !isFinite(result)) {
      return JSON.stringify({ expression, error: "Could not compute" });
    }
    return JSON.stringify({ expression, result: String(result) });
  } catch (e) {
    return JSON.stringify({ expression, error: "Could not compute" });
  }
}

function safeEvaluate(expr) {
  let pos = 0;
  const str = expr.replace(/\s+/g, '');

  function parseExpr() {
    let left = parseTerm();
    while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
      const op = str[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parsePower();
    while (pos < str.length && (str[pos] === '*' || str[pos] === '/' || str[pos] === '%')) {
      const op = str[pos++];
      const right = parsePower();
      if (op === '*') left = left * right;
      else if (op === '/') { if (right === 0) throw new Error('Division by zero'); left = left / right; }
      else left = left % right;
    }
    return left;
  }

  function parsePower() {
    let base = parseUnary();
    if (pos < str.length - 1 && str[pos] === '*' && str[pos + 1] === '*') {
      pos += 2;
      const exp = parsePower();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary() {
    if (str[pos] === '-') { pos++; return -parseAtom(); }
    if (str[pos] === '+') { pos++; return parseAtom(); }
    return parseAtom();
  }

  function parseAtom() {
    if (str[pos] === '(') {
      pos++;
      const val = parseExpr();
      if (str[pos] !== ')') throw new Error(`Expected ')' at position ${pos}`);
      pos++;
      return val;
    }
    const start = pos;
    while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) {
      pos++;
    }
    if (pos === start) throw new Error('Unexpected token');
    return parseFloat(str.substring(start, pos));
  }

  const result = parseExpr();
  if (pos < str.length) throw new Error('Unexpected trailing characters');
  return result;
}

async function getNetworkInfo() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name, InterfaceDescription, Status, LinkSpeed
$ipConfig = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object IPAddress, InterfaceAlias
@{
    adapters = $adapters
    ip = $ipConfig
} | ConvertTo-Json -Compress -Depth 3
`;
  try {
    return await runPowerShell(psScript, 10000);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function getDiskInfo() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
Select-Object DeviceID,
  @{N='SizeGB';E={[math]::round($_.Size/1GB,1)}},
  @{N='FreeGB';E={[math]::round($_.FreeSpace/1GB,1)}},
  @{N='UsedPercent';E={[math]::round((($_.Size-$_.FreeSpace)/$_.Size)*100,1)}} |
ConvertTo-Json -Compress
`;
  try {
    return await runPowerShell(psScript, 10000);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function getInstalledApps() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-CimInstance Win32_Product | Select-Object Name, Version, Vendor | Sort-Object Name | Select-Object -First 30 | ConvertTo-Json -Compress
`;
  try {
    return await runPowerShell(psScript, 15000);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function takeScreenshot() {
  const screenshotPath = path.join(HOME_DIR, 'Pictures', `screenshot_${Date.now()}.png`);
  const safePath = screenshotPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bitmap.Save('${safePath}')
$graphics.Dispose()
$bitmap.Dispose()
@{ success = $true; path = '${safePath}' } | ConvertTo-Json -Compress
`;
  try {
    return await runPowerShell(psScript, 10000);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

// ===== REGISTER ALL TASKS WITH REGISTRY =====

function registerAllTasks() {
  registry.register('launchApplication', (p) => launchApplication(p.appName), {
    description: 'Launch a Windows application by name',
    params: ['appName'],
    tags: ['app', 'launch', 'open'],
    marker: 'announce',
  });

  registry.register('openFile', (p) => openFile(p.filePath), {
    description: 'Open a file from the user home directory',
    params: ['filePath'],
    tags: ['file', 'open'],
    marker: 'announce',
  });

  registry.register('searchFiles', (p) => performSearch(p.query), {
    description: 'Search for files, folders, and apps on the system',
    params: ['query'],
    tags: ['search', 'file', 'find'],
    marker: 'announce',
  });

  registry.register('listen', () => "Listening", {
    description: 'Continue listening for voice input',
    params: [],
    tags: ['voice', 'listen'],
    marker: 'silently',
  });

  registry.register('systemControl', (p) => executeSystemControl(p), {
    description: 'Control system settings (volume, brightness, wifi, bluetooth, power)',
    params: ['command', 'value'],
    tags: ['system', 'control', 'volume', 'brightness'],
    marker: 'announce',
  });

  registry.register('openUrl', (p) => openUrl(p.url), {
    description: 'Open a URL in the default browser',
    params: ['url'],
    tags: ['web', 'url', 'browser'],
    marker: 'announce',
  });

  registry.register('googleSearch', (p) => googleSearch(p.query), {
    description: 'Search Google for a query and open results in browser',
    params: ['query'],
    tags: ['web', 'search', 'google'],
    marker: 'announce',
  });

  registry.register('youtubeSearch', (p) => youtubeSearch(p.query), {
    description: 'Search YouTube and open results in browser',
    params: ['query'],
    tags: ['web', 'youtube', 'video'],
    marker: 'announce',
  });

  registry.register('getWeather', (p) => getWeather(p.location), {
    description: 'Look up weather for a location via Google',
    params: ['location'],
    tags: ['web', 'weather'],
    marker: 'announce',
  });

  registry.register('getSystemInfo', () => getSystemInfo(), {
    description: 'Get CPU, RAM, battery, and uptime info',
    params: [],
    tags: ['system', 'info', 'monitor'],
    marker: 'silently',
  });

  registry.register('getTime', () => getCurrentTime(), {
    description: 'Get current date and time',
    params: [],
    tags: ['time', 'date'],
    marker: 'silently',
  });

  registry.register('runPowerShell', (p) => runSafePowerShell(p.script), {
    description: 'Run a safe read-only PowerShell command',
    params: ['script'],
    tags: ['system', 'powershell', 'advanced'],
    marker: 'silently',
  });

  registry.register('getClipboard', () => {
    try {
      return clipboard.readText() || "(clipboard is empty)";
    } catch (e) {
      return "Failed to read clipboard.";
    }
  }, {
    description: 'Read text from the clipboard',
    params: [],
    tags: ['clipboard', 'read'],
    marker: 'silently',
  });

  registry.register('setClipboard', (p) => {
    if (!p.text || typeof p.text !== 'string' || !p.text.trim()) {
      return "No text to copy.";
    }
    try {
      clipboard.writeText(p.text);
      return "Copied to clipboard.";
    } catch (e) {
      return "Failed to write to clipboard.";
    }
  }, {
    description: 'Set clipboard text content',
    params: ['text'],
    tags: ['clipboard', 'write', 'copy'],
    marker: 'silently',
  });

  registry.register('listProcesses', () =>
    runPowerShell('Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 -Property Id, ProcessName, CPU, WorkingSet | ConvertTo-Json -Compress'), {
    description: 'List top 10 CPU-heavy processes',
    params: [],
    tags: ['system', 'processes'],
    marker: 'silently',
  });

  registry.register('listRunningApps', () => listRunningApps(), {
    description: 'List running visible applications',
    params: [],
    tags: ['app', 'list', 'running'],
    marker: 'announce',
  });

  registry.register('closeApp', (p) => closeApp(p.appName), {
    description: 'Close a specific application by name',
    params: ['appName'],
    tags: ['app', 'close', 'kill'],
    marker: 'announce',
  });

  registry.register('closeAllApps', () => closeAllApps(), {
    description: 'Close all non-system applications',
    params: [],
    tags: ['app', 'close', 'all'],
    marker: 'confirm',
  });

  registry.register('setReminder', (p) => setReminder(p), {
    description: 'Set a timed reminder notification',
    params: ['message', 'delay'],
    tags: ['reminder', 'timer', 'notification'],
    marker: 'announce',
  });

  registry.register('calculate', (p) => calculate(p.expression), {
    description: 'Evaluate a math expression',
    params: ['expression'],
    tags: ['math', 'calculate'],
    marker: 'silently',
  });

  registry.register('getNetworkInfo', () => getNetworkInfo(), {
    description: 'Get network adapter and IP address info',
    params: [],
    tags: ['system', 'network', 'wifi'],
    marker: 'silently',
  });

  registry.register('getDiskInfo', () => getDiskInfo(), {
    description: 'Get disk usage information',
    params: [],
    tags: ['system', 'disk', 'storage'],
    marker: 'silently',
  });

  registry.register('takeScreenshot', () => takeScreenshot(), {
    description: 'Take a screenshot saved to Pictures folder',
    params: [],
    tags: ['screen', 'screenshot', 'capture'],
    marker: 'announce',
  });

  registry.register('getInstalledApps', () => getInstalledApps(), {
    description: 'List installed applications',
    params: [],
    tags: ['app', 'installed', 'list'],
    marker: 'silently',
  });
}

registerAllTasks();

// ===== UNIFIED RESPONSE PROCESSOR =====

async function processResponse(response) {
  const plan = orchestrator.parseOrchestrationPlan(response);

  if (plan && plan.steps.length > 0) {
    const fallbackExecutor = async (actionName, params) => {
      const task = registry.get(actionName);
      if (task) {
        return await task.handler(params);
      }
      throw new Error(`Unknown action: ${actionName}`);
    };

    const results = await orchestrator.executePlan(plan.steps, { fallbackExecutor });
    return { cleanResponse: plan.cleanResponse, results };
  }

  const actionRegex = /\[action:\s*(\w+)(?:,\s*((?:[^\]]|\[[^\]]*\])+))?\]/gi;
  let match;
  let cleanResponse = response;
  const executionPromises = [];

  while ((match = actionRegex.exec(response)) !== null) {
    cleanResponse = cleanResponse.replace(match[0], "").trim();
    const actionName = match[1].trim();
    const paramsStr = match[2] ? match[2].trim() : "";
    const params = {};

    if (paramsStr) {
      const paramRegex = /(\w+):\s*(.+?)(?=\s*,\s*\w+:|$)/g;
      let pMatch;
      while ((pMatch = paramRegex.exec(paramsStr)) !== null) {
        const key = pMatch[1].trim();
        let val = pMatch[2].trim();

        if (val.endsWith(',')) val = val.slice(0, -1).trim();

        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        params[key] = val;
      }

      if (Object.keys(params).length === 0 && paramsStr.includes(':')) {
        paramsStr.split(',').forEach(pair => {
          const [key, ...valParts] = pair.split(':');
          if (key && valParts.length) {
            let val = valParts.join(':').trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            params[key.trim()] = val;
          }
        });
      }
    }

    executionPromises.push((async () => {
      try {
        let result;

        if (registry.has(actionName)) {
          const execResult = await registry.execute(actionName, params);
          result = execResult.result || execResult.error;
        } else {
          result = `Unknown action: ${actionName}`;
        }

        return { actionName, result };
      } catch (e) {
        return { actionName, error: e.toString() };
      }
    })());
  }
  const results = await Promise.all(executionPromises);
  return { cleanResponse, results };
}

module.exports = {
  launchApplication,
  performSearch,
  openFile,
  processResponse,
  executeSystemControl,
  openUrl,
  googleSearch,
  youtubeSearch,
  getWeather,
  getSystemInfo,
  getCurrentTime,
  listRunningApps,
  closeApp,
  closeAllApps,
  setReminder,
  calculate,
  getNetworkInfo,
  getDiskInfo,
  takeScreenshot,
  getInstalledApps,
  registry,
};
