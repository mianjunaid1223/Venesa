const { exec, spawn } = require("child_process");
const { shell } = require("electron");
const os = require("os");
const path = require("path");

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

/**
 * Unified search for Apps, Files, and Folders
 */
async function performSearch(query) {
  // Escape single quotes, backticks, dollar signs, and double quotes for PowerShell
  const escapedQuery = query
    .replace(/'/g, "''")
    .replace(/`/g, "``")
    .replace(/\$/g, "`$")
    .replace(/"/g, "`\"");

  // Unified PowerShell script to search Apps, Files, and Folders in one go
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$query = "${escapedQuery}"

$resultObj = @{
    apps = @()
    files = @()
    folders = @()
}

# --- 1. APPLICATIONS ---
$startMenuPaths = @(
    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
    "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs"
)

foreach ($menuPath in $startMenuPaths) {
    if (Test-Path $menuPath) {
        Get-ChildItem -Path $menuPath -Filter "*$query*.lnk" -Recurse -File |
            Select-Object -First 10 |
            ForEach-Object {
                $resultObj.apps += @{
                    name = $_.BaseName
                    path = $_.FullName
                    type = "shortcut"
                }
            }
    }
}

# --- 2. FILES & FOLDERS (Windows Search Index) ---
try {
    $connection = New-Object -ComObject ADODB.Connection
    $recordset = New-Object -ComObject ADODB.Recordset
    $connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    
    # Query for Files AND Folders in one pass
    $sql = "SELECT TOP 30 System.ItemPathDisplay, System.ItemType FROM SystemIndex " +
           "WHERE SCOPE='file:\\$env:USERPROFILE' " +
           "AND System.FileName LIKE '%$query%' " +
           "ORDER BY System.DateModified DESC"
           
    $recordset.Open($sql, $connection)
    
    $homePath = $env:USERPROFILE
    
    while (-not $recordset.EOF) {
        $path = $recordset.Fields.Item("System.ItemPathDisplay").Value
        $type = $recordset.Fields.Item("System.ItemType").Value
        
        if ($path) {
            $displayPath = $path
            if ($path.StartsWith($homePath)) {
                $displayPath = $path.Substring($homePath.Length + 1)
            }
            
            if ($type -eq 'Directory') {
                if ($resultObj.folders.Count -lt 10) {
                    $resultObj.folders += $displayPath
                }
            } else {
                if ($resultObj.files.Count -lt 10) {
                    $resultObj.files += $displayPath
                }
            }
        }
        $recordset.MoveNext()
    }
    
    $recordset.Close()
    $connection.Close()
} catch {
    # Fallback to simple directory search if Indexer fails
    $searchRoot = "$env:USERPROFILE\\Documents"
    if (Test-Path $searchRoot) {
        Get-ChildItem -Path $searchRoot -Filter "*$query*" -Recurse -Depth 2 | Select-Object -First 20 | ForEach-Object {
             $homePath = $env:USERPROFILE
             $relPath = if ($_.FullName.StartsWith($homePath)) { $_.FullName.Substring($homePath.Length + 1) } else { $_.FullName }
             
             if ($_.PSIsContainer) {
                 $resultObj.folders += $relPath
             } else {
                 $resultObj.files += $relPath
             }
        }
    }
}

Write-Output ($resultObj | ConvertTo-Json -Depth 3 -Compress)
`;

  try {
    const output = await runPowerShell(psScript);
    if (!output) return JSON.stringify({ notFound: true, query });
    return output;
  } catch (error) {
    console.error("Search error:", error);
    // Return sanitized error to avoid leaking sensitive info
    return JSON.stringify({ notFound: true, query, error: "internal_error" });
  }
}

async function launchApplication(appName) {
  try {
    const { exec } = require('child_process');
    // Use 'start' command on Windows to launch apps vaguely matching name if detailed path unknown
    // But ideally we use the path found from search. 
    // For direct voice command "Open Notepad", this simple start is effective.
    exec(`start "" "${appName}"`);
    return `Launching ${appName}`;
  } catch (e) {
    return `Failed to launch ${appName}`;
  }
}

function openFile(filePath) {
  return new Promise((resolve, reject) => {
    const baseDir = os.homedir();
    let fullPath = filePath;
    if (!path.isAbsolute(filePath)) {
      fullPath = path.join(baseDir, filePath);
    }

    // Resolve to absolute path and check for path traversal
    const resolvedPath = path.resolve(fullPath);
    const normalizedBase = path.resolve(baseDir) + path.sep;

    // Ensure resolved path is within allowed base directory
    if (!resolvedPath.startsWith(normalizedBase) && resolvedPath !== path.resolve(baseDir)) {
      reject(`Security error: Path escapes allowed directory`);
      return;
    }

    shell.openPath(resolvedPath).then((err) => {
      if (err) {
        reject(`Could not open file: ${filePath}`);
      } else {
        resolve(`Opened ${filePath}.`);
      }
    });
  });
}

/**
 * Processes a response string, extracts actions, executes them, and returns a clean response + execution results.
 * @param {string} response - The raw response from the LLM.
 * @returns {Promise<{ cleanResponse: string, results: Array<{actionName: string, result: any, error: any}> }>}
 */
async function processResponse(response) {
  const actionRegex = /\[action:\s*(\w+)(?:,\s*|\s*,\s*)([^\]]+)\]/gi;
  let match;
  let cleanResponse = response;
  const executionPromises = [];

  // Extract all actions
  console.log('[TaskService] Processing response for actions:', response);
  while ((match = actionRegex.exec(response)) !== null) {
    cleanResponse = cleanResponse.replace(match[0], "").trim();

    const actionName = match[1].trim();
    console.log('[TaskService] Found action:', actionName);
    const paramsStr = match[2].trim();
    const params = {};

    // Quote-aware tokenizer to handle commas inside quoted values
    const paramPairs = [];
    let currentPair = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < paramsStr.length; i++) {
      const char = paramsStr[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        currentPair += char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = null;
        currentPair += char;
      } else if (!inQuotes && char === ',') {
        if (currentPair.trim()) {
          paramPairs.push(currentPair.trim());
        }
        currentPair = '';
      } else {
        currentPair += char;
      }
    }
    // Push final pair
    if (currentPair.trim()) {
      paramPairs.push(currentPair.trim());
    }

    paramPairs.forEach((pair) => {
      const colonIdx = pair.indexOf(":");
      if (colonIdx > 0) {
        const key = pair.substring(0, colonIdx).trim();
        let value = pair.substring(colonIdx + 1).trim();
        // Strip quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        params[key] = value;
      }
    });

    // Execute action
    executionPromises.push(
      (async () => {
        try {
          let result;
          if (actionName === "launchApplication") {
            result = await launchApplication(params.appName);
          } else if (actionName === "openFile") {
            result = await openFile(params.filePath);
          } else if (actionName === "searchFiles") {
            result = await performSearch(params.query);
          } else if (actionName === "listen") {
            result = "Listening mode requested.";
          }
          return { actionName, result, error: null };
        } catch (error) {
          return { actionName, result: null, error: error.toString() };
        }
      })()
    );
  }

  const results = await Promise.all(executionPromises);
  return { cleanResponse, results };
}

module.exports = {
  launchApplication,
  performSearch,
  openFile,
  processResponse,
};