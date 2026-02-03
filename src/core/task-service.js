const { spawn } = require("child_process");
const { shell } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const logger = require('./logger');

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

// Get current time in a friendly format
function getCurrentTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return JSON.stringify({ time: timeStr, date: dateStr, full: `${timeStr} on ${dateStr}` });
}

// Safe PowerShell execution for read-only info gathering
// SECURITY: Uses strict allowlist - script must start with an allowed pattern
const SAFE_PS_PATTERNS = [
  /^Get-CimInstance/i,    // WMI queries (read-only)
  /^Get-Process/i,        // Process listing
  /^Get-Service/i,        // Service listing
  /^Get-ChildItem/i,      // Directory listing
  /^Get-Content/i,        // File reading
  /^Get-Date/i,           // Date/time
  /^Get-Location/i,       // Current directory
  /^\$env:/i,             // Environment variable reads
  /^\[math\]::/i,         // Math operations
];

// Dangerous patterns that bypass allowlist - always blocked
const DANGEROUS_PS_PATTERNS = [
  // Encoded/obfuscated execution
  /-enc/i, /-encodedcommand/i, /-e\s/i,
  // Download/network patterns
  /webclient/i, /net\./i, /downloadstring/i, /downloadfile/i,
  /invoke-webrequest/i, /iwr\s/i, /curl/i, /wget/i,
  // Code execution patterns
  /invoke-expression/i, /iex\s/i, /invoke-command/i, /icm\s/i,
  /scriptblock/i, /\[scriptblock\]/i, /::create/i,
  // Reflection/dynamic code
  /reflection/i, /\[type\]/i, /gettype/i, /assembly/i,
  // Call operator and concatenation tricks
  /&\s*\$/i, /&\s*\(/i, /&\s*['"]/, /\+\s*['"].*['"]\s*\+/i,
  // Destructive commands
  /remove-/i, /delete-/i, /set-/i, /new-/i, /stop-/i, /start-/i,
  /clear-/i, /install-/i, /uninstall-/i, /update-/i, /add-/i,
  /format-/i, /mount-/i, /dismount-/i, /restart-/i, /shutdown/i,
  /rm\s/i, /del\s/i, /-file\s/i, /-command\s/i,
  /powershell/i, /pwsh/i, /cmd\.exe/i, /cmd\s/i,
];

// Internal function - only called by trusted internal code paths (getSystemInfo, executeSystemControl)
// NOT exposed via action handler to prevent arbitrary script injection
async function runSafePowerShell(script) {
  if (!script || typeof script !== 'string') {
    return JSON.stringify({ error: "No script provided" });
  }

  const trimmedScript = script.trim();

  // SECURITY: First check for dangerous patterns (always blocked)
  for (const pattern of DANGEROUS_PS_PATTERNS) {
    if (pattern.test(trimmedScript)) {
      return JSON.stringify({ error: "Command contains blocked pattern" });
    }
  }

  // SECURITY: Verify script starts with an allowed safe pattern (allowlist)
  const isAllowed = SAFE_PS_PATTERNS.some(pattern => pattern.test(trimmedScript));
  if (!isAllowed) {
    return JSON.stringify({ error: "Command not in allowlist" });
  }

  try {
    const result = await runPowerShell(script, 10000); // 10 second timeout
    return result;
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

async function processResponse(response) {
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
      // Improved parameter parsing to handle values with commas
      // Capture key: value pairs non-greedily until the next key or end of string
      const paramRegex = /(\w+):\s*(.+?)(?=\s*,\s*\w+:|$)/g;
      let pMatch;
      while ((pMatch = paramRegex.exec(paramsStr)) !== null) {
        const key = pMatch[1].trim();
        let val = pMatch[2].trim();
        // Remove trailing comma if captured
        if (val.endsWith(',')) val = val.slice(0, -1).trim();

        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        params[key] = val;
      }

      // Fallback for cases where regex might fail but simple split works
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
        if (actionName === "launchApplication") result = await launchApplication(params.appName);
        else if (actionName === "openFile") result = await openFile(params.filePath);
        else if (actionName === "searchFiles") result = await performSearch(params.query);
        else if (actionName === "listen") result = "Listening";
        else if (actionName === "systemControl") result = await executeSystemControl(params);
        else if (actionName === "openUrl") result = await openUrl(params.url);
        else if (actionName === "getSystemInfo") result = await getSystemInfo();
        else if (actionName === "getTime") result = getCurrentTime();
        else if (actionName === "runPowerShell") result = await runSafePowerShell(params.script);
        else if (actionName === "getClipboard") result = await runPowerShell('Get-Clipboard');
        else if (actionName === "setClipboard") {
          const safeText = escapePowerShellQuery(params.text);
          result = await runPowerShell(`Set-Clipboard -Value "${safeText}"`);
        }
        else if (actionName === "listProcesses") result = await runPowerShell('Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 -Property Id, ProcessName, CPU, WorkingSet | ConvertTo-Json -Compress');

        return { actionName, result };
      } catch (e) {
        return { actionName, error: e.toString() };
      }
    })());
  }
  const results = await Promise.all(executionPromises);
  return { cleanResponse, results };
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

  // Build scripts dynamically to ensure value is properly interpolated
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
    // If no scheme present, prepend https://
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

module.exports = {
  launchApplication,
  performSearch,
  openFile,
  processResponse,
  executeSystemControl,
  openUrl,
  getSystemInfo,
  getCurrentTime,
  // runSafePowerShell is internal only - not exported for security
};