const { z } = require("zod");
const { shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { HOME_DIR } = require("./_shared");

module.exports = {
  schema: z.object({
    filePath: z.string().describe("Path of the file to open (relative to home directory or absolute)"),
  }),
  name: "openFile",
  description: "Open a file using the system default application. Use when the user says 'open', 'show', or 'launch' a specific file. Accepts relative paths (resolved from home directory) or absolute paths.",
  tags: ["file", "open"],

  returnType: "action",
  marker: "announce",
  ui: null,

  examples: [
    {
      user: "open my  <file name> from Documents",
      action: "[action: openFile, filePath: Documents/ <file name>]",
    },

    {
      user: "open the notes file on Desktop",
      action: "[action: openFile, filePath: Desktop/notes.txt]",
    },
  ],

  async handler(params) {
    let filePath = params.filePath;
    if (!filePath || typeof filePath !== "string") {
      return "No file path provided.";
    }

    try {
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(path.join(HOME_DIR, filePath));
      const normalizedPath = path.normalize(resolvedPath);
      const isWin = process.platform === "win32";

      let isMatch = false;
      let openPath = normalizedPath; // default to normalizedPath; updated to realPath on success
      try {
        const realPath = fs.realpathSync(normalizedPath);
        const realHome = fs.realpathSync(HOME_DIR);
        if (isWin) {
          isMatch =
            realPath.toLowerCase() === realHome.toLowerCase() ||
            realPath
              .toLowerCase()
              .startsWith(realHome.toLowerCase() + path.sep);
        } else {
          isMatch =
            realPath === realHome || realPath.startsWith(realHome + path.sep);
        }
        openPath = realPath; // use resolved realPath to open (closes TOCTOU gap)
      } catch (e) {
        const normalizedHome = path.normalize(HOME_DIR);
        const homePrefix = path.normalize(HOME_DIR + path.sep);
        if (isWin) {
          isMatch =
            normalizedPath.toLowerCase() === normalizedHome.toLowerCase() ||
            normalizedPath.toLowerCase().startsWith(homePrefix.toLowerCase());
        } else {
          isMatch =
            normalizedPath === normalizedHome ||
            normalizedPath.startsWith(homePrefix);
        }
      }

      if (!isMatch) {
        return "Access denied: path outside home directory.";
      }

      const result = await shell.openPath(openPath);
      if (result) {
        return `Error opening file: ${result}`;
      }
      return `Opened ${filePath}`;
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};
