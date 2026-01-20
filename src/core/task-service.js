const { spawn } = require("child_process");
const { shell } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");

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

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".vscode", "__pycache__", ".cache", "AppData",
  "temp", "tmp", ".npm", ".nuget", "venv", ".env", "dist", "build",
  "Library", "Application Data", ".Trash", "$Recycle.Bin"
]);

const POWERSHELL_TIMEOUT_MS = 10000; // 10 second timeout

function runPowerShell(script, timeoutMs = POWERSHELL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `venesa-search-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
    let isResolved = false;
    let timeoutId = null;

    try {
      fs.writeFileSync(tempFile, script, "utf8");
    } catch (e) {
      reject(new Error(`Failed to write temp script: ${e.message}`));
      return;
    }

    const ps = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tempFile],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
    };

    const done = (fn) => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      fn();
    };

    // Timeout handler
    timeoutId = setTimeout(() => {
      done(() => {
        try { ps.kill('SIGTERM'); } catch (e) { /* ignore */ }
        reject(new Error(`PowerShell timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    ps.stdout.on("data", (data) => (stdout += data.toString()));
    ps.stderr.on("data", (data) => (stderr += data.toString()));

    ps.on("close", (code) => {
      done(() => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `PowerShell exited with code ${code}`));
        }
      });
    });

    ps.on("error", (error) => {
      done(() => reject(error));
    });
  });
}

function classifyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "file";
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

function escapeSqlQuery(query) {
  return query
    .replace(/'/g, "''")
    .replace(/%/g, "[%]")
    .replace(/_/g, "[_]");
}

async function searchFilesAndFolders(query, maxResults = 30) {
  const folders = [];
  const files = [];

  const escapedQuery = escapeSqlQuery(query.replace(/"/g, '""'));
  const escapedPsQuery = escapePowerShellQuery(query);
  const homeEscaped = HOME_DIR.replace(/\\/g, '/');

  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$searchTerm = '${escapedQuery}'
$HOME_ESCAPED = '${homeEscaped}'
$psSearchTerm = '${escapedPsQuery}'

try {
    $connector = New-Object -ComObject ADODB.Connection
    $connector.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    $recordset = New-Object -ComObject ADODB.Recordset
    $sql = "SELECT System.ItemName, System.ItemPathDisplay, System.FileAttributes FROM SystemIndex WHERE SCOPE='file:" + $HOME_ESCAPED + "' AND (System.ItemName LIKE '%" + $searchTerm + "%' OR System.ItemPathDisplay LIKE '%" + $searchTerm + "%')"
    $recordset.Open($sql, $connector)

    $results = @()
    while (!$recordset.EOF -and $results.Count -lt ${maxResults}) {
        $results += @{
            name = $recordset.Fields.Item("System.ItemName").Value
            path = $recordset.Fields.Item("System.ItemPathDisplay").Value
            attr = $recordset.Fields.Item("System.FileAttributes").Value
        }
        $recordset.MoveNext()
    }
    $results | ConvertTo-Json -Compress
} catch {
    # Fast manual fallback with escaped query
    Get-ChildItem -Path '${HOME_DIR}' -ErrorAction SilentlyContinue | 
        Where-Object { $_.Name -like "*$psSearchTerm*" } |
        Select-Object -First ${maxResults} | 
        ForEach-Object { @{ name = $_.Name; path = $_.FullName; isDir = $_.PSIsContainer } } | 
        ConvertTo-Json -Compress
}
`;

  try {
    const output = await runPowerShell(psScript);
    if (output && output !== "null") {
      const parsed = JSON.parse(output);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach(item => {
        const isFolder = item.isDir || (item.attr & 0x10); // 0x10 is Directory attribute
        if (isFolder) folders.push(getRelativePath(item.path));
        else files.push(getRelativePath(item.path));
      });
    }
  } catch (e) { }
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
    // First, search for the application shortcut
    const apps = await searchApplications(appName);

    if (apps.length > 0) {
      // Found a matching app, open its shortcut path
      const result = await shell.openPath(apps[0].path);
      if (result) {
        return `Error launching ${appName}: ${result}`;
      }
      return `Launching ${apps[0].name}`;
    }

    // Fallback: try to run it as a command (for apps like "notepad", "calc")
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
      const resolvedPath = path.resolve(path.join(HOME_DIR, filePath));
      const canonicalHome = path.resolve(HOME_DIR);

      if (!resolvedPath.startsWith(canonicalHome + path.sep) && resolvedPath !== canonicalHome) {
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
  const actionRegex = /\[action:\s*(\w+)(?:,\s*([^\]]+))?\]/gi;
  let match;
  let cleanResponse = response;
  const executionPromises = [];

  while ((match = actionRegex.exec(response)) !== null) {
    cleanResponse = cleanResponse.replace(match[0], "").trim();
    const actionName = match[1].trim();
    const paramsStr = match[2] ? match[2].trim() : "";
    const params = {};

    if (paramsStr) {
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

    executionPromises.push((async () => {
      try {
        let result;
        if (actionName === "launchApplication") result = await launchApplication(params.appName);
        else if (actionName === "openFile") result = await openFile(params.filePath);
        else if (actionName === "searchFiles") result = await performSearch(params.query);
        else if (actionName === "listen") result = "Listening";
        else if (actionName === "systemControl") result = await executeSystemControl(params);
        else if (actionName === "openUrl") result = await openUrl(params.url);
        // runCommand action removed for security - arbitrary command execution is not allowed
        else if (actionName === "getSystemInfo") result = await getSystemInfo();
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
};