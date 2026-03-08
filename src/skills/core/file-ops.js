/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: file-ops
 *  Full filesystem power: create, move, copy, rename, delete,
 *  zip/unzip files and folders.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { HOME_DIR, runPowerShell, logger } = require('./_shared');

const OPERATIONS = ['create', 'move', 'copy', 'rename', 'delete', 'zip', 'unzip', 'info'];

module.exports = {
    schema: z.object({
        operation: z.enum(OPERATIONS).describe('File operation to perform'),
        sourcePath: z.string().describe('Source file/folder path. Supports tokens: {{user.desktop}}, {{user.documents}}, {{user.downloads}}, {{user.home}}'),
        destPath: z.string().optional().describe('Destination path for move/copy/rename. Supports tokens: {{user.desktop}}, {{user.documents}}, {{user.downloads}}, {{user.home}}'),
        content: z.string().optional().describe('Text content for create operation. Use {{clipboard.text}} to write current clipboard content'),
        isFolder: z.boolean().optional().describe('True to create a folder instead of a file'),
    }),
    name: 'fileOps',
    description: 'Create, move, copy, rename, delete, zip/unzip files and folders. Operations: ' + OPERATIONS.join(', ') + '. Path parameters accept tokens: {{user.desktop}}, {{user.documents}}, {{user.downloads}}, {{user.home}}.',
    tags: ['file', 'folder', 'create', 'move', 'copy', 'rename', 'delete', 'zip', 'unzip'],

    returnType: 'hybrid',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'create a folder called Projects on Desktop', action: '[action: fileOps, operation: create, sourcePath: Desktop/Projects, isFolder: true]' },

        { user: 'delete the file test.txt from Downloads', action: '[action: fileOps, operation: delete, sourcePath: Downloads/test.txt, isFolder: false]' },

    ],


    async handler(params) {
        const { operation, sourcePath, destPath, content, isFolder } = params;

        // Resolve paths relative to home
        const resolvePath = (p) => {
            if (!p) return null;
            return path.isAbsolute(p) ? p : path.resolve(path.join(HOME_DIR, p));
        };

        const src = resolvePath(sourcePath);
        const dst = destPath ? resolvePath(destPath) : null;

        // Security: resolve symlinks and ensure path is within home directory
        const resolvedHome = (() => {
            try { return fs.realpathSync(HOME_DIR); } catch { return path.resolve(HOME_DIR); }
        })();

        const isInsideHome = (p) => {
            if (!p) return true;
            let resolved;
            try { resolved = fs.realpathSync(p); } catch { resolved = path.resolve(p); }
            if (process.platform === 'win32') {
                return resolved.toLowerCase().startsWith(resolvedHome.toLowerCase() + path.sep) ||
                    resolved.toLowerCase() === resolvedHome.toLowerCase();
            }
            return resolved.startsWith(resolvedHome + path.sep) || resolved === resolvedHome;
        };

        if (!isInsideHome(src) || !isInsideHome(dst)) {
            return JSON.stringify({ success: false, error: 'Access denied: path outside home directory.' });
        }

        try {
            switch (operation) {
                case 'create': {
                    if (isFolder) {
                        fs.mkdirSync(src, { recursive: true });
                        return JSON.stringify({ success: true, created: src, type: 'folder' });
                    } else {
                        const dir = path.dirname(src);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(src, content || '', 'utf8');
                        return JSON.stringify({ success: true, created: src, type: 'file' });
                    }
                }

                case 'move': {
                    if (!dst) return JSON.stringify({ success: false, error: 'Destination path required.' });
                    const dstDir = path.dirname(dst);
                    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
                    try {
                        fs.renameSync(src, dst);
                    } catch (renameErr) {
                        if (renameErr.code === 'EXDEV') {
                            // Cross-device: copy to temp then rename, then delete src
                            const crypto = require('crypto');
                            const tmpDst = dst + `.tmp-${crypto.randomBytes(4).toString('hex')}`;
                            const srcStat = fs.statSync(src);
                            try {
                                if (srcStat.isDirectory()) {
                                    fs.cpSync(src, tmpDst, { recursive: true });
                                } else {
                                    fs.copyFileSync(src, tmpDst);
                                }
                                fs.renameSync(tmpDst, dst);
                            } catch (copyErr) {
                                // Remove partial temp on failure
                                try { fs.rmSync(tmpDst, { recursive: true, force: true }); } catch { }
                                throw copyErr;
                            }
                            // Only remove source after successful copy+rename
                            try {
                                if (srcStat.isDirectory()) {
                                    fs.rmSync(src, { recursive: true, force: true });
                                } else {
                                    fs.unlinkSync(src);
                                }
                            } catch (rmErr) {
                                logger.warn(`[fileOps] Move: source removal failed: ${rmErr.message}`);
                            }
                        } else {
                            throw renameErr;
                        }
                    }
                    return JSON.stringify({ success: true, moved: { from: src, to: dst } });
                }

                case 'copy': {
                    if (!dst) return JSON.stringify({ success: false, error: 'Destination path required.' });
                    const dstDir2 = path.dirname(dst);
                    if (!fs.existsSync(dstDir2)) fs.mkdirSync(dstDir2, { recursive: true });
                    const stat = fs.statSync(src);
                    if (stat.isDirectory()) {
                        await runPowerShell(
                            `param($S,$D) Copy-Item -Path $S -Destination $D -Recurse -Force`,
                            [src, dst], 30000
                        );
                    } else {
                        fs.copyFileSync(src, dst);
                    }
                    return JSON.stringify({ success: true, copied: { from: src, to: dst } });
                }

                case 'rename': {
                    if (!dst) return JSON.stringify({ success: false, error: 'New name required.' });
                    const finalDst = path.isAbsolute(dst) || dst.includes(path.sep)
                        ? path.resolve(dst) : path.resolve(path.dirname(src), dst);
                    if (!isInsideHome(finalDst)) {
                        return JSON.stringify({ success: false, error: 'Access denied: rename destination outside home directory.' });
                    }
                    fs.renameSync(src, finalDst);
                    return JSON.stringify({ success: true, renamed: { from: src, to: finalDst } });
                }

                case 'delete': {
                    if (!fs.existsSync(src)) {
                        return JSON.stringify({ success: false, error: 'File not found.' });
                    }
                    const isDir = fs.lstatSync(src).isDirectory();
                    if (isDir) {
                        await runPowerShell(
                            `param($Path) Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($Path, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
                            [src], 15000
                        );
                    } else {
                        await runPowerShell(
                            `param($Path) Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Path, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
                            [src], 10000
                        );
                    }
                    return JSON.stringify({ success: true, deleted: src, recycleBin: true });
                }

                case 'zip': {
                    const zipDst = dst || src + '.zip';
                    if (!isInsideHome(zipDst)) {
                        return JSON.stringify({ success: false, error: 'Access denied: zip destination outside home directory.' });
                    }
                    await runPowerShell(
                        `param($S,$D) Compress-Archive -Path $S -DestinationPath $D -Force`,
                        [src, zipDst], 60000
                    );
                    return JSON.stringify({ success: true, zipped: { from: src, to: zipDst } });
                }

                case 'unzip': {
                    const unzipDst = dst || path.join(path.dirname(src), path.basename(src, '.zip'));
                    if (!isInsideHome(unzipDst)) {
                        return JSON.stringify({ success: false, error: 'Access denied: unzip destination outside home directory.' });
                    }
                    await runPowerShell(
                        `param($S,$D) Expand-Archive -Path $S -DestinationPath $D -Force`,
                        [src, unzipDst], 60000
                    );
                    return JSON.stringify({ success: true, unzipped: { from: src, to: unzipDst } });
                }

                case 'info': {
                    if (!fs.existsSync(src)) {
                        return JSON.stringify({ success: false, error: 'File not found.' });
                    }
                    const stat = fs.statSync(src);
                    const sizeKB = (stat.size / 1024).toFixed(1);
                    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
                    return JSON.stringify({
                        success: true,
                        name: path.basename(src),
                        path: src,
                        type: stat.isDirectory() ? 'folder' : path.extname(src) || 'file',
                        size: stat.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`,
                        created: stat.birthtime.toISOString(),
                        modified: stat.mtime.toISOString(),
                    });
                }

                default:
                    return JSON.stringify({ success: false, error: `Unknown operation: ${operation}` });
            }
        } catch (e) {
            logger.error(`[fileOps] ${operation} failed: ${e?.message ?? String(e)}`);
            return JSON.stringify({ success: false, error: e?.message ?? String(e) });
        }
    },
};
