const { exec, spawn } = require("child_process");
const { shell } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    ps.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ps.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `PowerShell exited with code ${code}`));
      }
    });

    ps.on("error", (error) => {
      reject(error);
    });
  });
}

async function searchApplications(query) {
  const escapedQuery = query.replace(/'/g, "''").replace(/`/g, "``");

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$results = @()

# Search Start Menu shortcuts (most reliable - same as Windows Search)
$startMenuPaths = @(
    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
    "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs"
)

foreach ($menuPath in $startMenuPaths) {
    if (Test-Path $menuPath) {
        Get-ChildItem -Path $menuPath -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -like "*${escapedQuery}*" } |
            ForEach-Object {
                $results += [PSCustomObject]@{
                    name = $_.BaseName
                    path = $_.FullName
                    type = "shortcut"
                }
            }
    }
}

# Check App Paths registry
try {
    $appPaths = Get-ChildItem "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths" -ErrorAction SilentlyContinue
    foreach ($app in $appPaths) {
        $appName = $app.PSChildName -replace '\\.exe$', ''
        if ($appName -like "*${escapedQuery}*") {
            $exePath = (Get-ItemProperty $app.PSPath -ErrorAction SilentlyContinue).'(default)'
            if ($exePath -and (Test-Path $exePath -ErrorAction SilentlyContinue)) {
                $results += [PSCustomObject]@{
                    name = $appName
                    path = $exePath
                    type = "exe"
                }
            }
        }
    }
} catch {}

$unique = $results | Sort-Object { $_.name.ToLower() } -Unique | Select-Object -First 20
if ($unique.Count -eq 0) {
    Write-Output "[]"
} elseif ($unique.Count -eq 1) {
    Write-Output ("[" + ($unique | ConvertTo-Json -Compress) + "]")
} else {
    Write-Output ($unique | ConvertTo-Json -Compress)
}
`;

  try {
    const output = await runPowerShell(psScript);
    const results = output ? JSON.parse(output) : [];
    return Array.isArray(results) ? results : results ? [results] : [];
  } catch (error) {
    return [];
  }
}

async function launchApplication(appName) {
  const apps = await searchApplications(appName);

  if (apps.length > 0) {
    const app = apps[0];
    return new Promise((resolve, reject) => {
      shell.openPath(app.path).then((error) => {
        if (error) {
          reject(`Could not launch "${appName}".`);
        } else {
          resolve(`Launched ${app.name}.`);
        }
      });
    });
  }

  const escapedName = appName.replace(/'/g, "''");
  const psScript = `
$ErrorActionPreference = 'Stop'
try {
    Start-Process '${escapedName}'
    exit 0
} catch {
    exit 1
}
`;

  try {
    await runPowerShell(psScript);
    return `Launched ${appName}.`;
  } catch (error) {
    throw `Could not launch "${appName}".`;
  }
}

function openFile(filePath) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(os.homedir(), filePath);
    shell.openPath(fullPath).then((err) => {
      if (err) {
        reject(`Could not open file: ${filePath}`);
      } else {
        resolve(`Opened ${filePath}.`);
      }
    });
  });
}

async function searchFolders(query) {
  const escapedQuery = query.replace(/'/g, "''").replace(/`/g, "``");

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$query = "${escapedQuery}"

try {
    $connection = New-Object -ComObject ADODB.Connection
    $recordset = New-Object -ComObject ADODB.Recordset
    
    $connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    $sql = "SELECT TOP 20 System.ItemPathDisplay FROM SystemIndex WHERE SCOPE='file:\\$env:USERPROFILE' AND System.FileName LIKE '%$query%' AND System.ItemType = 'Directory'"
    $recordset.Open($sql, $connection)
    
    $results = @()
    while (-not $recordset.EOF) {
        $path = $recordset.Fields.Item("System.ItemPathDisplay").Value
        if ($path) {
            $homePath = $env:USERPROFILE
            if ($path.StartsWith($homePath)) {
                $relativePath = $path.Substring($homePath.Length + 1)
                $results += $relativePath
            } else {
                $results += $path
            }
        }
        $recordset.MoveNext()
    }
    
    $recordset.Close()
    $connection.Close()
    
    if ($results.Count -eq 0) {
        Write-Output "[]"
    } elseif ($results.Count -eq 1) {
        Write-Output ('[' + ($results | ConvertTo-Json -Compress) + ']')
    } else {
        Write-Output ($results | ConvertTo-Json -Compress)
    }
} catch {
    $results = @()
    $searchPaths = @(
        "$env:USERPROFILE\\Desktop",
        "$env:USERPROFILE\\Documents",
        "$env:USERPROFILE\\Downloads"
    )
    
    foreach ($searchPath in $searchPaths) {
        if (Test-Path $searchPath) {
            Get-ChildItem -Path $searchPath -Filter "*$query*" -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
                Select-Object -First 20 |
                ForEach-Object {
                    $homePath = $env:USERPROFILE
                    if ($_.FullName.StartsWith($homePath)) {
                        $results += $_.FullName.Substring($homePath.Length + 1)
                    } else {
                        $results += $_.FullName
                    }
                }
        }
    }
    
    $unique = $results | Select-Object -Unique -First 20
    if ($unique.Count -eq 0) {
        Write-Output "[]"
    } elseif ($unique.Count -eq 1) {
        Write-Output ('[' + ($unique | ConvertTo-Json -Compress) + ']')
    } else {
        Write-Output ($unique | ConvertTo-Json -Compress)
    }
}
`;

  try {
    const output = await runPowerShell(psScript);
    return output || "[]";
  } catch (error) {
    return "[]";
  }
}

async function searchFiles(query) {
  const escapedQuery = query.replace(/'/g, "''").replace(/`/g, "``");

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$query = "${escapedQuery}"

try {
    $connection = New-Object -ComObject ADODB.Connection
    $recordset = New-Object -ComObject ADODB.Recordset
    
    $connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    
    $sql = "SELECT TOP 20 System.ItemPathDisplay FROM SystemIndex WHERE SCOPE='file:\$env:USERPROFILE' AND System.FileName LIKE '%$query%' AND System.ItemType <> 'Directory'"
    
    $recordset.Open($sql, $connection)
    
    $results = @()
    while (-not $recordset.EOF) {
        $path = $recordset.Fields.Item("System.ItemPathDisplay").Value
        if ($path) {
            $homePath = $env:USERPROFILE
            if ($path.StartsWith($homePath)) {
                $relativePath = $path.Substring($homePath.Length + 1)
                $results += $relativePath
            } else {
                $results += $path
            }
        }
        $recordset.MoveNext()
    }
    
    $recordset.Close()
    $connection.Close()
    
    if ($results.Count -eq 0) {
        Write-Output "[]"
    } elseif ($results.Count -eq 1) {
        Write-Output ('[' + ($results | ConvertTo-Json -Compress) + ']')
    } else {
        Write-Output ($results | ConvertTo-Json -Compress)
    }
} catch {
    $results = @()
    $searchPaths = @(
        "$env:USERPROFILE\\Desktop",
        "$env:USERPROFILE\\Documents",
        "$env:USERPROFILE\\Downloads"
    )
    
    foreach ($searchPath in $searchPaths) {
        if (Test-Path $searchPath) {
            Get-ChildItem -Path $searchPath -Filter "*$query*" -File -Recurse -Depth 3 -ErrorAction SilentlyContinue |
                Select-Object -First 20 |
                ForEach-Object {
                    $homePath = $env:USERPROFILE
                    if ($_.FullName.StartsWith($homePath)) {
                        $results += $_.FullName.Substring($homePath.Length + 1)
                    } else {
                        $results += $_.FullName
                    }
                }
        }
    }
    
    $unique = $results | Select-Object -Unique -First 20
    if ($unique.Count -eq 0) {
        Write-Output "[]"
    } elseif ($unique.Count -eq 1) {
        Write-Output ('[' + ($unique | ConvertTo-Json -Compress) + ']')
    } else {
        Write-Output ($unique | ConvertTo-Json -Compress)
    }
}
`;

  try {
    const output = await runPowerShell(psScript);
    return output || "[]";
  } catch (error) {
    return "[]";
  }
}

module.exports = {
  launchApplication,
  searchApplications,
  openFile,
  searchFiles,
  searchFolders,
};