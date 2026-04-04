// main.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const { execSync, execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const archiver = require('archiver');
const yauzl = require('yauzl');
const sodium = require('libsodium-wrappers-sumo');
const { createBatchController, runWithConcurrency } = require('./batchConversion');

const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // GCM auth tag
const XCHACHA_NONCE_LENGTH = 24;
const ENCRYPTION_MAGIC = Buffer.from('TCLK');
const ENCRYPTION_VERSION_V1 = 1;
const ENCRYPTION_VERSION_V2 = 2;
const ENCRYPTION_ALGORITHM_AES_256_GCM = 'aes-256-gcm';
const ENCRYPTION_ALGORITHM_XCHACHA20 = 'xchacha20-poly1305';
const ENCRYPTION_ALGORITHM_ID_AES_256_GCM = 1;
const ENCRYPTION_ALGORITHM_ID_XCHACHA20 = 2;
const ENCRYPTED_FILE_EXTENSION = '.tclock';
const KEY_FILE_EXTENSION = '.tckey';
const SAFEBOX_FILE_EXTENSION = '.tcsafebox';
const SAFEBOX_MAGIC = Buffer.from('TCSB');
const SAFEBOX_VERSION_V1 = 1;
const SAFEBOX_VERSION_V2 = 2;
const SAFEBOX_CURRENT_VERSION = SAFEBOX_VERSION_V2;
const SAFEBOX_SALT_LENGTH = 16;
const SAFEBOX_BLOCK_SIZE = 4 * 1024;
const SAFEBOX_SIZE_LENGTH = 8;
const SAFEBOX_BLOCK_COUNT_LENGTH = 4;
const SAFEBOX_DRIVE_LABEL = 'TransCrypt Pro Safebox';
const DISGUISE_MAGIC = Buffer.from('TCDG');
const DISGUISE_VERSION = 2;
const DISGUISE_KEY_LENGTH = 32;
const DISGUISE_MODE_FILE = 0;
const DISGUISE_MODE_DIRECTORY = 1;
const DISGUISE_TAIL_LENGTH_V1 = 8 + 2 + 1 + 4; // encryptedLen + nameLen + version + magic
const DISGUISE_TAIL_LENGTH = 8 + 2 + 1 + 1 + 4; // encryptedLen + nameLen + modeFlag + version + magic

// Self-decrypt exe container footer format (Windows-only feature)
// [template][encrypted(tclock bytes)][name bytes][encLen(8)][nameLen(2)][version(1)][magic(4)]
const SELF_DECRYPT_EXE_MAGIC = Buffer.from('TCDX'); // container marker
const SELF_DECRYPT_EXE_VERSION = 1;
const SELF_DECRYPT_EXE_TEMPLATE_FILENAME = 'decryptor-template-win32.exe';
const SELF_DECRYPT_EXE_TAIL_LENGTH = 8 + 2 + 1 + 4; // encLen + nameLen + version + magic
const IMAGE_FILE_FILTERS = [
    { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
    { name: '所有文件', extensions: ['*'] }
];
const VIDEO_FILE_FILTERS = [
    { name: '视频文件', extensions: ['mp4', 'avi', 'mkv', 'mov', 'flv', 'webm', 'wmv'] },
    { name: '所有文件', extensions: ['*'] }
];
const AUDIO_FILE_FILTERS = [
    { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'] },
    { name: '所有文件', extensions: ['*'] }
];
const DOCUMENT_FILE_FILTERS = [
    { name: '文档文件', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'odt', 'ods', 'odp', 'csv', 'rtf'] },
    { name: '所有文件', extensions: ['*'] }
];
const ORIGINAL_FORMAT_VALUE = '__original__';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const activeBatchControllers = new Map();
const activeProConversions = new Map();
const proResumeCheckpoints = new Map();
let mainWindow = null;
let pendingLaunchAction = null;
const safeboxSessions = new Map();
const LAUNCH_ACTIONS = {
    ENCRYPT: 'encrypt',
    CONVERT: 'convert',
    DECRYPT: 'decrypt',
    SAFEBOX_OPEN: 'safebox-open'
};

function isEncryptedFilePath(filePath) {
    return typeof filePath === 'string' && filePath.toLowerCase().endsWith(ENCRYPTED_FILE_EXTENSION);
}

function isSafeboxFilePath(filePath) {
    return typeof filePath === 'string' && filePath.toLowerCase().endsWith(SAFEBOX_FILE_EXTENSION);
}

function normalizeArgPath(rawArg) {
    if (typeof rawArg !== 'string') {
        return null;
    }
    const trimmed = rawArg.trim().replace(/^"(.*)"$/, '$1');
    if (!trimmed || trimmed.startsWith('-')) {
        return null;
    }
    const resolvedPath = path.resolve(trimmed);
    if (!fs.existsSync(resolvedPath)) {
        return null;
    }
    return resolvedPath;
}

function extractLaunchActionFromArgs(argv) {
    if (!Array.isArray(argv)) {
        return null;
    }
    let action = null;
    let targetPath = null;
    let encryptedFilePath = null;
    let safeboxFilePath = null;
    for (const rawArg of argv) {
        if (typeof rawArg !== 'string') {
            continue;
        }
        const arg = rawArg.trim();
        if (!arg) {
            continue;
        }
        if (arg.startsWith('--context-action=')) {
            action = arg.slice('--context-action='.length).toLowerCase();
            continue;
        }
        if (arg.startsWith('--context-target=')) {
            const parsedTarget = normalizeArgPath(arg.slice('--context-target='.length));
            if (parsedTarget) {
                targetPath = parsedTarget;
            }
            continue;
        }
        const parsedPath = normalizeArgPath(arg);
        if (!parsedPath) {
            continue;
        }
        if (isEncryptedFilePath(parsedPath)) {
            encryptedFilePath = parsedPath;
        }
        if (isSafeboxFilePath(parsedPath)) {
            safeboxFilePath = parsedPath;
        }
        if (!targetPath) {
            targetPath = parsedPath;
        }
    }
    if (action && targetPath && Object.values(LAUNCH_ACTIONS).includes(action)) {
        return { action, targetPath };
    }
    if (encryptedFilePath) {
        return { action: LAUNCH_ACTIONS.DECRYPT, targetPath: encryptedFilePath };
    }
    if (safeboxFilePath) {
        return { action: LAUNCH_ACTIONS.SAFEBOX_OPEN, targetPath: safeboxFilePath };
    }
    return null;
}

function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();
}

function notifyRendererLaunchAction(payload) {
    if (!payload || !payload.action || !payload.targetPath || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    mainWindow.webContents.send('launch-context-action', payload);
}

function registerWindowsContextMenuCommands(appPath, iconPath) {
    const registerCommand = (registryKey, menuLabel, actionName) => {
        runRegAdd([registryKey, '/ve', '/d', menuLabel, '/f']);
        runRegAdd([registryKey, '/v', 'Icon', '/d', `${escapeRegValue(iconPath)},0`, '/f']);
        const appPathClean = String(appPath).replace(/"/g, '');
        const cmdValue = `"${appPathClean}" --context-action=${actionName} --context-target="%1"`;
        runRegAdd([`${registryKey}\\command`, '/ve', '/d', cmdValue, '/f']);
    };
    registerCommand('HKCU\\Software\\Classes\\*\\shell\\TransCryptPro.Encrypt', '使用 TransCrypt Pro 加密', LAUNCH_ACTIONS.ENCRYPT);
    registerCommand('HKCU\\Software\\Classes\\*\\shell\\TransCryptPro.Convert', '使用 TransCrypt Pro 格式转换', LAUNCH_ACTIONS.CONVERT);
    registerCommand('HKCU\\Software\\Classes\\Directory\\shell\\TransCryptPro.Encrypt', '使用 TransCrypt Pro 加密', LAUNCH_ACTIONS.ENCRYPT);
}

function escapeRegValue(value) {
    return String(value).replace(/"/g, '\\"');
}

function runRegAdd(args) {
    execFileSync('reg', ['add', ...args], { stdio: 'ignore', windowsHide: true });
}

function ensureShellIconFile(sourcePath, targetName) {
    try {
        const iconDir = path.join(app.getPath('userData'), 'file-icons');
        if (!fs.existsSync(iconDir)) {
            fs.mkdirSync(iconDir, { recursive: true });
        }
        const targetPath = path.join(iconDir, targetName);
        fs.copyFileSync(sourcePath, targetPath);
        return targetPath;
    } catch (error) {
        return sourcePath;
    }
}

function registerCustomFileType(extension, progId, description, iconPath, appPath) {
    runRegAdd([`HKCU\\Software\\Classes\\.${extension}`, '/ve', '/d', progId, '/f']);
    runRegAdd([`HKCU\\Software\\Classes\\${progId}`, '/ve', '/d', description, '/f']);
    runRegAdd([`HKCU\\Software\\Classes\\${progId}\\DefaultIcon`, '/ve', '/d', `${escapeRegValue(iconPath)},0`, '/f']);
    const appPathClean = String(appPath).replace(/"/g, '');
    const cmdValue = `"${appPathClean}" "%1"`;
    runRegAdd([`HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, '/ve', '/d', cmdValue, '/f']);
}

function registerWindowsFileAssociations() {
    if (process.platform !== 'win32') {
        return;
    }
    try {
        const appPath = process.execPath;
        const tclockIconSource = path.join(__dirname, 'assets', 'tclock-icon.ico');
        const tckeyIconSource = path.join(__dirname, 'assets', 'tckey-icon.ico');
        const tcsafeboxIconSource = path.join(__dirname, 'assets', 'tcsafebox-icon.ico');
        if (fs.existsSync(tclockIconSource)) {
            const iconPath = ensureShellIconFile(tclockIconSource, 'tclock-icon.ico');
            registerCustomFileType('tclock', 'TransCryptPro.tclock', 'TransCrypt Pro Encrypted File', iconPath, appPath);
        }
        if (fs.existsSync(tckeyIconSource)) {
            const iconPath = ensureShellIconFile(tckeyIconSource, 'tckey-icon.ico');
            registerCustomFileType('tckey', 'TransCryptPro.tckey', 'TransCrypt Pro Key File', iconPath, appPath);
        }
        if (fs.existsSync(tcsafeboxIconSource)) {
            const iconPath = ensureShellIconFile(tcsafeboxIconSource, 'tcsafebox-icon.ico');
            registerCustomFileType(
                'tcsafebox',
                'TransCryptPro.tcsafebox',
                'TransCrypt Pro Safebox Container',
                iconPath,
                appPath
            );
        }
        const appIconSource = path.join(__dirname, 'assets', 'app-icon.ico');
        const contextMenuIconPath = fs.existsSync(appIconSource)
            ? ensureShellIconFile(appIconSource, 'app-icon.ico')
            : appPath;
        registerWindowsContextMenuCommands(appPath, contextMenuIconPath);
    } catch (error) {
    }
}

function getFiltersByCategory(category) {
    if (category === 'images') return IMAGE_FILE_FILTERS;
    if (category === 'videos') return VIDEO_FILE_FILTERS;
    if (category === 'audio') return AUDIO_FILE_FILTERS;
    if (category === 'documents') return DOCUMENT_FILE_FILTERS;
    return undefined;
}

function supportsOriginalFormatSelection(category) {
    return category === 'images' || category === 'videos';
}

function resolveTargetFormatForFile(filePath, targetFormat, category) {
    if (targetFormat !== ORIGINAL_FORMAT_VALUE) {
        return String(targetFormat || '').toLowerCase();
    }
    if (!supportsOriginalFormatSelection(category)) {
        throw new Error('当前分类不支持原格式输出');
    }
    const sourceExt = path.extname(filePath).replace('.', '').toLowerCase();
    if (!sourceExt) {
        throw new Error('无法识别源文件格式');
    }
    return sourceExt;
}

function ensureUniqueOutputPath(desiredPath) {
    if (!fs.existsSync(desiredPath)) {
        return desiredPath;
    }
    const dir = path.dirname(desiredPath);
    const ext = path.extname(desiredPath);
    const baseName = path.basename(desiredPath, ext);
    let index = 1;
    while (true) {
        const candidate = path.join(dir, `${baseName}(${index})${ext}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
        index += 1;
    }
}

// 封装获取二进制文件路径的函数
function getBinaryPath(type) {
    const isWin = process.platform === 'win32';
    const exeName = type + (isWin ? '.exe' : '');
    
    // 1. 优先检查项目根目录下的 bin 文件夹
    let localBinPath = path.join(__dirname, 'bin', exeName);
    if (fs.existsSync(localBinPath)) return localBinPath;

    // 2. 尝试从 node_modules 获取
    try {
        let staticPath;
        if (type === 'ffmpeg') {
            staticPath = require('ffmpeg-static');
        } else if (type === 'ffprobe') {
            staticPath = require('ffprobe-static').path;
        }

        if (staticPath) {
            // 处理 FFmpeg 的情况：staticPath 是字符串（路径）
            // 处理 FFprobe 的情况：staticPath 是字符串（路径）
            let finalPath = staticPath;
            
            // 如果在打包环境中，路径可能指向 asar 内部，需要指向 unpacked 目录
            if (app.isPackaged && finalPath.includes('app.asar')) {
                finalPath = finalPath.replace('app.asar', 'app.asar.unpacked');
            }
            
            if (fs.existsSync(finalPath)) return finalPath;
        }
    } catch (e) {
        console.error(`获取 ${type} 路径失败:`, e);
    }

    return null;
}

const ffmpegPath = getBinaryPath('ffmpeg');
const ffprobePath = getBinaryPath('ffprobe');

async function ensurePngIcon() {
    try {
        const svgPath = path.join(__dirname, 'assets', 'app-icon.svg');
        const pngPath = path.join(__dirname, 'assets', 'app-icon.png');
        if (!fs.existsSync(svgPath)) return;

        let need = true;
        if (fs.existsSync(pngPath)) {
            try {
                const sStat = fs.statSync(svgPath);
                const pStat = fs.statSync(pngPath);
                if (pStat.mtimeMs >= sStat.mtimeMs) need = false;
            } catch (e) {
                need = true;
            }
        }

        if (!need) return;

        const svg = fs.readFileSync(svgPath, 'utf8');
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        const image = nativeImage.createFromDataURL(dataUrl);
        const resized = image.resize({ width: 256, height: 256 });
        const pngBuffer = resized.toPNG();
        fs.writeFileSync(pngPath, pngBuffer);
        console.log('生成 PNG 图标：', pngPath);
    } catch (e) {
        console.log('生成 PNG 图标失败：', e.message);
    }
}

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            devTools: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        if (pendingLaunchAction) {
            notifyRendererLaunchAction(pendingLaunchAction);
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // win.webContents.on('did-finish-load', () => {
    //     // 再次检查 win 对象是否仍然有效
    //     if (!win || win.isDestroyed()) {
    //         console.error('尝试打开DevTools时，窗口对象已失效或销毁。');
    //         return;
    //     }
    //     try {
    //         win.webContents.openDevTools();
    //         console.log('DevTools 已成功打开。');
    //     } catch (err) {
    //         console.error('打开 DevTools 失败:', err.message);
    //     }
    // });
};
// 设置应用图标（如果存在 assets/app-icon.png 或 .svg）
try {
    const iconPath = path.join(__dirname, 'assets', 'app-icon.png');
    if (fs.existsSync(iconPath)) {
        // 重新创建窗口时可使用此图标（Windows/ Linux）
        app.whenReady().then(() => {
            BrowserWindow.getAllWindows().forEach(w => w.setIcon(iconPath));
        });
    } else {
        // 尝试 svg
        const svgPath = path.join(__dirname, 'assets', 'app-icon.svg');
        if (fs.existsSync(svgPath)) {
            app.whenReady().then(() => {
                BrowserWindow.getAllWindows().forEach(w => w.setIcon(svgPath));
            });
        }
    }
} catch (e) {
    console.log('设置应用图标失败:', e.message);
}

if (process.platform !== 'darwin') {
    pendingLaunchAction = extractLaunchActionFromArgs(process.argv);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, commandLine) => {
        const launchAction = extractLaunchActionFromArgs(commandLine);
        if (launchAction) {
            pendingLaunchAction = launchAction;
            notifyRendererLaunchAction(launchAction);
        }
        focusMainWindow();
    });
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (isEncryptedFilePath(filePath)) {
        pendingLaunchAction = {
            action: LAUNCH_ACTIONS.DECRYPT,
            targetPath: path.resolve(filePath)
        };
    } else if (isSafeboxFilePath(filePath)) {
        pendingLaunchAction = {
            action: LAUNCH_ACTIONS.SAFEBOX_OPEN,
            targetPath: path.resolve(filePath)
        };
    } else {
        return;
    }
    if (app.isReady()) {
        notifyRendererLaunchAction(pendingLaunchAction);
        focusMainWindow();
    }
});

app.whenReady().then(() => {
    registerWindowsFileAssociations();
    // 在创建窗口前确保 PNG 图标存在
    ensurePngIcon().then(() => createWindow());
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
    const sessionIds = Array.from(safeboxSessions.keys());
    for (const sessionId of sessionIds) {
        try {
            await flushSafeboxSession(sessionId);
        } catch (error) {
        }
    }
});

// 处理文件选择请求
ipcMain.handle('select-file', async (event, { category }) => {
    try {
        const result = await dialog.showOpenDialog({
            title: '选择要转换的文件',
            properties: ['openFile'],
            filters: getFiltersByCategory(category)
        });
        
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false };
        }
        
        const filePath = result.filePaths[0];
        const fileName = path.basename(filePath);
        
        return { 
            success: true,
            filePath: filePath,
            fileName: fileName
        };
    } catch (error) {
        return { 
            success: false,
            message: `选择文件失败: ${error.message}` 
        };
    }
});

ipcMain.handle('consume-pending-launch-action', async () => {
    const payload = pendingLaunchAction;
    pendingLaunchAction = null;
    return payload || null;
});

ipcMain.handle('select-files', async (event, { category }) => {
    try {
        const result = await dialog.showOpenDialog({
            title: '选择要批量转换的文件',
            properties: ['openFile', 'multiSelections'],
            filters: getFiltersByCategory(category)
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false };
        }
        return {
            success: true,
            filePaths: result.filePaths,
            fileNames: result.filePaths.map(filePath => path.basename(filePath)),
            fileSizes: result.filePaths.map(filePath => {
                try {
                    return fs.statSync(filePath).size;
                } catch (error) {
                    return null;
                }
            })
        };
    } catch (error) {
        return {
            success: false,
            message: `选择文件失败: ${error.message}`
        };
    }
});

// 处理路径选择（文件或文件夹）
ipcMain.handle('select-path', async (event, properties) => {
    try {
        const result = await dialog.showOpenDialog({ properties });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false };
        }
        const filePath = result.filePaths[0];
        const fileName = path.basename(filePath);
        return { success: true, filePath, fileName };
    } catch (error) {
        return { success: false, message: `选择路径失败: ${error.message}` };
    }
});

ipcMain.handle('select-image-files', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: '选择要批量转换的文件',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '所有支持文件', extensions: ['*'] }]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false };
        }
        return {
            success: true,
            filePaths: result.filePaths,
            fileNames: result.filePaths.map(filePath => path.basename(filePath)),
            fileSizes: result.filePaths.map(filePath => {
                try {
                    return fs.statSync(filePath).size;
                } catch (error) {
                    return null;
                }
            })
        };
    } catch (error) {
        return {
            success: false,
            message: `选择图片失败: ${error.message}`
        };
    }
});

ipcMain.handle('select-output-directory', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: '选择输出文件夹',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false };
        }
        return {
            success: true,
            directoryPath: result.filePaths[0]
        };
    } catch (error) {
        return {
            success: false,
            message: `选择输出文件夹失败: ${error.message}`
        };
    }
});

// 处理文件转换请求
ipcMain.handle('convert-file', async (event, { filePath, targetFormat, category, options }) => {
    try {
        const resolvedTargetFormat = resolveTargetFormatForFile(filePath, targetFormat, category);
        const fileName = path.basename(filePath, path.extname(filePath));
        const sourceExt = path.extname(filePath).replace('.', '').toLowerCase();
        const useSanitizedSuffix = targetFormat === ORIGINAL_FORMAT_VALUE || sourceExt === resolvedTargetFormat;
        const newFileName = `${fileName}${useSanitizedSuffix ? '_sanitized' : ''}.${resolvedTargetFormat}`;
        
        // 显示保存文件对话框
        const result = await dialog.showSaveDialog({
            title: '保存转换后的文件',
            defaultPath: path.join(path.dirname(filePath), newFileName),
            filters: [
                { name: resolvedTargetFormat.toUpperCase(), extensions: [resolvedTargetFormat] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (result.canceled) {
            return { success: false, message: '操作已取消' };
        }
        
        const outputPath = result.filePath;
        
        return await runWorkerConversion({
            sender: event.sender,
            filePath,
            outputPath,
            targetFormat: resolvedTargetFormat,
            category,
            options
        });

    } catch (error) {
        return { 
            success: false, 
            message: `转换初始化失败: ${error.message}` 
        };
    }
});

async function handleBatchConvert(event, payload) {
    const { batchId, files, targetFormat, category, options, outputDirectory, concurrency = 3 } = payload || {};
    if (!batchId) {
        return { success: false, message: '缺少批次标识' };
    }
    if (!Array.isArray(files) || files.length === 0) {
        return { success: false, message: '没有可转换的文件' };
    }
    if (!targetFormat) {
        return { success: false, message: '缺少目标格式' };
    }
    if (!category || !['images', 'videos', 'audio', 'documents'].includes(category)) {
        return { success: false, message: '不支持的批量分类' };
    }
    if (!outputDirectory) {
        return { success: false, message: '缺少输出目录' };
    }

    const controller = createBatchController();
    activeBatchControllers.set(batchId, controller);
    const total = files.length;
    let completed = 0;

    try {
        const results = await runWithConcurrency(
            files,
            Math.max(1, Math.min(6, Number(concurrency) || 3)),
            async (filePath) => {
                if (controller.cancelled) {
                    return { success: false, filePath, cancelled: true, message: '已取消' };
                }
                let result;
                let outputPath = null;

                event.sender.send('batch-conversion-progress', {
                    batchId,
                    type: 'file-start',
                    filePath,
                    fileName: path.basename(filePath),
                    completed,
                    total
                });

                try {
                    const resolvedTargetFormat = resolveTargetFormatForFile(filePath, targetFormat, category);
                    const sourceExt = path.extname(filePath).replace('.', '').toLowerCase();
                    const baseName = path.basename(filePath, path.extname(filePath));
                    const useSanitizedSuffix = targetFormat === ORIGINAL_FORMAT_VALUE || sourceExt === resolvedTargetFormat;
                    outputPath = ensureUniqueOutputPath(path.join(outputDirectory, `${baseName}${useSanitizedSuffix ? '_sanitized' : ''}.${resolvedTargetFormat}`));
                    result = await runWorkerConversion({
                        sender: event.sender,
                        filePath,
                        outputPath,
                        targetFormat: resolvedTargetFormat,
                        category,
                        options,
                        controller,
                        batchId
                    });
                } catch (error) {
                    result = {
                        success: false,
                        message: `转换失败: ${error.message}`
                    };
                }

                completed += 1;
                const success = !!result.success;
                event.sender.send('batch-conversion-progress', {
                    batchId,
                    type: 'file-complete',
                    filePath,
                    fileName: path.basename(filePath),
                    outputPath: result.outputPath,
                    success,
                    message: result.message,
                    completed,
                    total,
                    percent: Math.round((completed / total) * 100)
                });

                return {
                    success,
                    filePath,
                    fileName: path.basename(filePath),
                    outputPath: result.outputPath,
                    message: result.message
                };
            },
            () => controller.cancelled
        );

        const successful = results.filter(item => item && item.success);
        const failed = results.filter(item => item && !item.success && !item.cancelled);
        const cancelled = controller.cancelled;

        return {
            success: !cancelled,
            cancelled,
            total,
            completed,
            successful,
            failed
        };
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    } finally {
        activeBatchControllers.delete(batchId);
    }
}

ipcMain.handle('batch-convert-files', async (event, payload) => {
    return await handleBatchConvert(event, payload);
});

ipcMain.handle('batch-convert-images', async (event, payload) => {
    return await handleBatchConvert(event, {
        ...(payload || {}),
        category: payload && payload.category ? payload.category : 'images'
    });
});

ipcMain.handle('cancel-batch-conversion', async (event, { batchId }) => {
    const controller = activeBatchControllers.get(batchId);
    if (!controller) {
        return { success: false, message: '未找到进行中的批次' };
    }

    controller.cancelled = true;
    Array.from(controller.workers).forEach(worker => {
        try {
            worker.terminate();
        } catch (error) {
        }
    });
    controller.workers.clear();
    return { success: true };
});

ipcMain.handle('create-batch-zip', async (event, { filePaths, suggestedName }) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: false, message: '没有可打包的文件' };
    }

    try {
        const result = await dialog.showSaveDialog({
            title: '保存批量转换压缩包',
            defaultPath: path.join(app.getPath('downloads'), `${suggestedName || 'image-batch-converted'}.zip`),
            filters: [{ name: 'ZIP 文件', extensions: ['zip'] }]
        });

        if (result.canceled || !result.filePath) {
            return { success: false, message: '打包已取消' };
        }

        await createZipFromFiles(filePaths, result.filePath);
        return { success: true, zipPath: result.filePath };
    } catch (error) {
        return { success: false, message: `打包失败: ${error.message}` };
    }
});

// 处理拖拽文件请求
ipcMain.handle('handle-dropped-file', async (event, arrayBuffer, fileName) => {
  // 注意：这里假设你已经正确引入了 fs, path, os 模块
  // const fs = require('fs').promises;
  // const path = require('path');
  // const os = require('os');

  const tempDir = path.join(os.tmpdir(), 'FormatTransformerTemp');
  const tempFilePath = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);

  try {
    // 1. 确保临时目录存在（使用 Promise 风格的 mkdir）
    await fsp.mkdir(tempDir, { recursive: true });
    
    // 2. 将 ArrayBuffer 写入文件（使用 Promise 风格的 writeFile）
    await fsp.writeFile(tempFilePath, Buffer.from(arrayBuffer));
    
    // 3. 返回结果
    return {
      filePath: tempFilePath,
      fileName: fileName
    };
  } catch (error) {
    console.error('处理拖拽文件失败，详情:', error);
    // 重新抛出错误，让渲染进程能捕获到
    throw new Error(`保存拖拽文件失败: ${error.message}`);
  }
});
ipcMain.handle('get-image-dimensions', async (event, filePath) => {
    try {
        const img = nativeImage.createFromPath(filePath);
        const size = img.getSize();
        return { width: size.width, height: size.height };
    } catch (e) {
        return null;
    }
});

// *********************************************************************************
// ENCRYPTION / DECRYPTION
// *********************************************************************************



// Helper to derive a key from a file or password
function deriveKeyFromMaterial(keyMaterial) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(keyMaterial, 'a-hardcoded-salt-for-key-derivation', 32, (err, derivedKey) => {
            if (err) reject(err);
            resolve(derivedKey);
        });
    });
}

async function deriveKey(keyPath) {
    const keyMaterial = await fsp.readFile(keyPath);
    return deriveKeyFromMaterial(keyMaterial);
}

function deriveKeyFromPassword(password) {
    return deriveKeyFromMaterial(Buffer.from(password, 'utf8'));
}

function deriveSafeboxKeyFromPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 32, (err, derivedKey) => {
            if (err) reject(err);
            resolve(derivedKey);
        });
    });
}

function deriveSafeboxKeyFromMaterial(keyMaterial, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(keyMaterial, salt, 32, (err, derivedKey) => {
            if (err) reject(err);
            resolve(derivedKey);
        });
    });
}

let sodiumReadyPromise = null;

async function getSodium() {
    if (!sodiumReadyPromise) {
        sodiumReadyPromise = sodium.ready.then(() => sodium);
    }
    return sodiumReadyPromise;
}

function resolveEncryptionAlgorithm(algorithm) {
    return algorithm === ENCRYPTION_ALGORITHM_XCHACHA20
        ? ENCRYPTION_ALGORITHM_XCHACHA20
        : ENCRYPTION_ALGORITHM_AES_256_GCM;
}

function getAlgorithmIdByName(algorithm) {
    return algorithm === ENCRYPTION_ALGORITHM_XCHACHA20
        ? ENCRYPTION_ALGORITHM_ID_XCHACHA20
        : ENCRYPTION_ALGORITHM_ID_AES_256_GCM;
}

function getAlgorithmNameById(algorithmId) {
    if (algorithmId === ENCRYPTION_ALGORITHM_ID_AES_256_GCM) {
        return ENCRYPTION_ALGORITHM_AES_256_GCM;
    }
    if (algorithmId === ENCRYPTION_ALGORITHM_ID_XCHACHA20) {
        return ENCRYPTION_ALGORITHM_XCHACHA20;
    }
    throw new Error(`不支持的加密算法标识: ${algorithmId}`);
}

function getNonceLengthByAlgorithm(algorithm) {
    return algorithm === ENCRYPTION_ALGORITHM_XCHACHA20 ? XCHACHA_NONCE_LENGTH : IV_LENGTH;
}

async function encryptXChaCha20ToBuffer(key, nonce, plainBuffer) {
    const sodiumModule = await getSodium();
    const cipherWithTag = sodiumModule.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plainBuffer,
        null,
        null,
        nonce,
        key
    );
    const combined = Buffer.from(cipherWithTag);
    return {
        encryptedData: combined.subarray(0, combined.length - AUTH_TAG_LENGTH),
        authTag: combined.subarray(combined.length - AUTH_TAG_LENGTH)
    };
}

async function decryptXChaCha20ToBuffer(key, nonce, authTag, encryptedDataBuffer) {
    const sodiumModule = await getSodium();
    const combined = Buffer.concat([encryptedDataBuffer, authTag]);
    const plain = sodiumModule.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        combined,
        null,
        nonce,
        key
    );
    return Buffer.from(plain);
}

function parseEncryptedFileMeta(fileBuffer) {
    const minimumLegacyLength = ENCRYPTION_MAGIC.length + 2 + IV_LENGTH + AUTH_TAG_LENGTH;
    if (fileBuffer.length >= minimumLegacyLength && fileBuffer.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC)) {
        const version = fileBuffer[ENCRYPTION_MAGIC.length];
        if (version === ENCRYPTION_VERSION_V1) {
            const modeFlag = fileBuffer[ENCRYPTION_MAGIC.length + 1];
            const headerOffset = ENCRYPTION_MAGIC.length + 2;
            return {
                version,
                modeFlag,
                algorithm: ENCRYPTION_ALGORITHM_AES_256_GCM,
                nonceLength: IV_LENGTH,
                nonceOffset: headerOffset,
                headerOffset
            };
        }
        if (version === ENCRYPTION_VERSION_V2) {
            const modeFlag = fileBuffer[ENCRYPTION_MAGIC.length + 1];
            const algorithmId = fileBuffer[ENCRYPTION_MAGIC.length + 2];
            const algorithm = getAlgorithmNameById(algorithmId);
            const nonceLength = getNonceLengthByAlgorithm(algorithm);
            const headerOffset = ENCRYPTION_MAGIC.length + 3;
            return {
                version,
                modeFlag,
                algorithm,
                nonceLength,
                nonceOffset: headerOffset,
                headerOffset
            };
        }
        throw new Error(`不支持的加密版本: ${version}`);
    }
    return {
        version: 0,
        modeFlag: null,
        algorithm: ENCRYPTION_ALGORITHM_AES_256_GCM,
        nonceLength: IV_LENGTH,
        nonceOffset: 0,
        headerOffset: 0
    };
}

function decryptAesGcmWithKey(key, iv, authTag, encryptedDataBuffer) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encryptedDataBuffer), decipher.final()]);
}

function decryptAesGcmToBuffer(key, iv, authTag, encryptedDataBuffer) {
    return decryptAesGcmWithKey(key, iv, authTag, encryptedDataBuffer);
}

function isLikelyZipBuffer(buffer) {
    return new Promise((resolve) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err || !zipfile) {
                resolve(false);
                return;
            }
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                try {
                    zipfile.close();
                } catch (error) {
                }
                resolve(value);
            };
            zipfile.once('error', () => done(false));
            zipfile.once('entry', () => done(true));
            zipfile.once('end', () => done(true));
            try {
                zipfile.readEntry();
            } catch (error) {
                done(false);
            }
        });
    });
}

function extractZipBufferToDirectory(zipBuffer, outputPath) {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
            if (err || !zipfile) return reject(err || new Error('无法读取目录数据'));
            zipfile.on('entry', (entry) => {
                const entryPath = path.join(outputPath, entry.fileName);
                if (/\/$/.test(entry.fileName)) {
                    fsp.mkdir(entryPath, { recursive: true }).then(() => zipfile.readEntry()).catch(reject);
                } else {
                    zipfile.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr || !readStream) return reject(streamErr || new Error('无法读取目录项'));
                        const dirName = path.dirname(entryPath);
                        fsp.mkdir(dirName, { recursive: true }).then(() => {
                            const writeStream = fs.createWriteStream(entryPath);
                            readStream.pipe(writeStream)
                                .on('finish', () => zipfile.readEntry())
                                .on('error', reject);
                        }).catch(reject);
                    });
                }
            });
            zipfile.on('end', resolve);
            zipfile.on('error', reject);
            zipfile.readEntry();
        });
    });
}

async function getDirectoryAsBuffer(dirPath, compressionLevel = 9) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: normalizeZipCompressionLevel(compressionLevel, 9) } });
        const buffers = [];

        archive.on('data', (data) => buffers.push(data));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', (err) => reject(err));

        archive.directory(dirPath, false);
        archive.finalize();
    });
}

function normalizeZipCompressionLevel(level, fallback = 5) {
    const parsed = Number.parseInt(level, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    if (parsed < 0) {
        return 0;
    }
    if (parsed > 9) {
        return 9;
    }
    return parsed;
}

function parseSafeboxFile(fileBuffer) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < SAFEBOX_MAGIC.length + 1 + SAFEBOX_SALT_LENGTH) {
        throw new Error('Safebox 文件结构无效');
    }
    const magic = fileBuffer.subarray(0, SAFEBOX_MAGIC.length);
    if (!magic.equals(SAFEBOX_MAGIC)) {
        throw new Error('不是有效的 .tcsafebox 文件');
    }
    const version = fileBuffer.readUInt8(SAFEBOX_MAGIC.length);
    if (version !== SAFEBOX_VERSION_V1 && version !== SAFEBOX_VERSION_V2) {
        throw new Error(`不支持的 Safebox 版本: ${version}`);
    }
    const saltStart = SAFEBOX_MAGIC.length + 1;
    const ivStart = saltStart + SAFEBOX_SALT_LENGTH;
    if (version === SAFEBOX_VERSION_V1) {
        if (fileBuffer.length < SAFEBOX_MAGIC.length + 1 + SAFEBOX_SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
            throw new Error('Safebox 文件结构无效');
        }
        const encryptedStart = ivStart + IV_LENGTH;
        const authTagStart = fileBuffer.length - AUTH_TAG_LENGTH;
        if (authTagStart <= encryptedStart) {
            throw new Error('Safebox 文件内容已损坏');
        }
        return {
            version,
            salt: fileBuffer.subarray(saltStart, ivStart),
            iv: fileBuffer.subarray(ivStart, encryptedStart),
            encryptedData: fileBuffer.subarray(encryptedStart, authTagStart),
            authTag: fileBuffer.subarray(authTagStart)
        };
    }
    const sizeOffset = ivStart + IV_LENGTH;
    const blockCountOffset = sizeOffset + SAFEBOX_SIZE_LENGTH;
    const payloadStart = blockCountOffset + SAFEBOX_BLOCK_COUNT_LENGTH;
    if (fileBuffer.length < payloadStart) {
        throw new Error('Safebox 文件头损坏');
    }
    const plainSizeBig = fileBuffer.readBigUInt64LE(sizeOffset);
    if (plainSizeBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Safebox 内容过大');
    }
    const plainSize = Number(plainSizeBig);
    const blockCount = fileBuffer.readUInt32LE(blockCountOffset);
    const expectedBlockCount = plainSize === 0 ? 0 : Math.ceil(plainSize / SAFEBOX_BLOCK_SIZE);
    if (blockCount !== expectedBlockCount) {
        throw new Error('Safebox 块元数据无效');
    }
    let cursor = payloadStart;
    const blocks = [];
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
        const plainOffset = blockIndex * SAFEBOX_BLOCK_SIZE;
        const plainLength = Math.min(SAFEBOX_BLOCK_SIZE, plainSize - plainOffset);
        const encryptedOffset = cursor;
        const tagOffset = encryptedOffset + plainLength;
        const nextOffset = tagOffset + AUTH_TAG_LENGTH;
        if (nextOffset > fileBuffer.length) {
            throw new Error('Safebox 块数据损坏');
        }
        blocks.push({
            blockIndex,
            plainOffset,
            plainLength,
            encryptedOffset,
            tagOffset,
            encryptedData: fileBuffer.subarray(encryptedOffset, tagOffset),
            authTag: fileBuffer.subarray(tagOffset, nextOffset)
        });
        cursor = nextOffset;
    }
    if (cursor !== fileBuffer.length) {
        throw new Error('Safebox 文件长度与块元数据不匹配');
    }
    return {
        version,
        salt: fileBuffer.subarray(saltStart, ivStart),
        baseIv: fileBuffer.subarray(ivStart, sizeOffset),
        plainSize,
        blockCount,
        blocks
    };
}

function deriveSafeboxBlockIv(baseIv, blockIndex) {
    if (!Buffer.isBuffer(baseIv) || baseIv.length !== IV_LENGTH) {
        throw new Error('Safebox IV 无效');
    }
    const blockIv = Buffer.from(baseIv);
    const suffix = blockIv.readUInt32BE(IV_LENGTH - 4);
    blockIv.writeUInt32BE((suffix + blockIndex) >>> 0, IV_LENGTH - 4);
    return blockIv;
}

function buildSafeboxFileBuffer({ salt, baseIv, plainData, derivedKey }) {
    if (!Buffer.isBuffer(salt) || salt.length !== SAFEBOX_SALT_LENGTH) {
        throw new Error('Safebox salt 无效');
    }
    if (!Buffer.isBuffer(baseIv) || baseIv.length !== IV_LENGTH) {
        throw new Error('Safebox IV 无效');
    }
    if (!Buffer.isBuffer(plainData)) {
        throw new Error('Safebox 明文内容无效');
    }
    if (!Buffer.isBuffer(derivedKey) || derivedKey.length !== 32) {
        throw new Error('Safebox 密钥无效');
    }
    const blockCount = plainData.length === 0 ? 0 : Math.ceil(plainData.length / SAFEBOX_BLOCK_SIZE);
    const payloadParts = [];
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
        const plainOffset = blockIndex * SAFEBOX_BLOCK_SIZE;
        const plainLength = Math.min(SAFEBOX_BLOCK_SIZE, plainData.length - plainOffset);
        const blockData = plainData.subarray(plainOffset, plainOffset + plainLength);
        const blockIv = deriveSafeboxBlockIv(baseIv, blockIndex);
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, blockIv, { authTagLength: AUTH_TAG_LENGTH });
        const encryptedData = Buffer.concat([cipher.update(blockData), cipher.final()]);
        const authTag = cipher.getAuthTag();
        payloadParts.push(encryptedData, authTag);
    }
    const header = Buffer.alloc(
        SAFEBOX_MAGIC.length + 1 + SAFEBOX_SALT_LENGTH + IV_LENGTH + SAFEBOX_SIZE_LENGTH + SAFEBOX_BLOCK_COUNT_LENGTH
    );
    let offset = 0;
    SAFEBOX_MAGIC.copy(header, offset);
    offset += SAFEBOX_MAGIC.length;
    header.writeUInt8(SAFEBOX_CURRENT_VERSION, offset);
    offset += 1;
    salt.copy(header, offset);
    offset += SAFEBOX_SALT_LENGTH;
    baseIv.copy(header, offset);
    offset += IV_LENGTH;
    header.writeBigUInt64LE(BigInt(plainData.length), offset);
    offset += SAFEBOX_SIZE_LENGTH;
    header.writeUInt32LE(blockCount, offset);
    return Buffer.concat([
        header,
        ...payloadParts
    ]);
}

function getFreeWindowsDriveLetter() {
    const letters = 'ZYXWVUTSRQPONMLKJIHGFED';
    for (const letter of letters) {
        if (!fs.existsSync(`${letter}:\\`)) {
            return letter;
        }
    }
    return null;
}

function mountDirectoryToDriveLetter(tempDirPath) {
    if (process.platform !== 'win32') {
        throw new Error('虚拟磁盘挂载目前仅支持 Windows');
    }
    const freeLetter = getFreeWindowsDriveLetter();
    if (!freeLetter) {
        throw new Error('没有可用盘符用于挂载');
    }
    execFileSync('subst', [`${freeLetter}:`, tempDirPath], { stdio: 'ignore', windowsHide: true });
    applyDriveLabelForLetter(freeLetter);
    return freeLetter;
}

function applyDriveLabelForLetter(driveLetter) {
    if (!driveLetter || typeof driveLetter !== 'string') {
        return;
    }
    const normalized = driveLetter.toUpperCase();
    try {
        execFileSync('reg', [
            'add',
            `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\${normalized}\\DefaultLabel`,
            '/ve',
            '/t',
            'REG_SZ',
            '/d',
            SAFEBOX_DRIVE_LABEL,
            '/f'
        ], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
    }
    try {
        execFileSync('reg', [
            'add',
            `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MountPoints2\\##${normalized}#`,
            '/v',
            '_LabelFromReg',
            '/t',
            'REG_SZ',
            '/d',
            SAFEBOX_DRIVE_LABEL,
            '/f'
        ], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
    }
}

function clearDriveLabelForLetter(driveLetter) {
    if (!driveLetter || typeof driveLetter !== 'string') {
        return;
    }
    const normalized = driveLetter.toUpperCase();
    try {
        execFileSync('reg', [
            'delete',
            `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\DriveIcons\\${normalized}`,
            '/f'
        ], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
    }
    try {
        execFileSync('reg', [
            'delete',
            `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MountPoints2\\##${normalized}#`,
            '/f'
        ], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
    }
}

function unmountDriveLetter(driveLetter) {
    if (process.platform !== 'win32') {
        return;
    }
    execFileSync('subst', [`${driveLetter}:`, '/D'], { stdio: 'ignore', windowsHide: true });
    clearDriveLabelForLetter(driveLetter);
}

async function flushSafeboxSession(sessionId) {
    const session = safeboxSessions.get(sessionId);
    if (!session) {
        throw new Error('未找到 Safebox 挂载会话');
    }

    try {
        unmountDriveLetter(session.driveLetter);
    } catch (error) {
    }

    const plainZip = await getDirectoryAsBuffer(session.tempDirPath);
    const canPartialRewrite = session.safeboxVersion === SAFEBOX_VERSION_V2
        && Array.isArray(session.blockEntries)
        && session.blockEntries.length > 0
        && Buffer.isBuffer(session.baseIv)
        && Buffer.isBuffer(session.originalPlainZip)
        && plainZip.length === session.originalPlainZip.length
        && session.blockEntries.length === (plainZip.length === 0 ? 0 : Math.ceil(plainZip.length / SAFEBOX_BLOCK_SIZE));
    if (canPartialRewrite) {
        const changedEntries = [];
        for (const entry of session.blockEntries) {
            const start = entry.plainOffset;
            const end = start + entry.plainLength;
            const oldBlock = session.originalPlainZip.subarray(start, end);
            const newBlock = plainZip.subarray(start, end);
            if (!oldBlock.equals(newBlock)) {
                changedEntries.push(entry);
            }
        }
        if (changedEntries.length > 0) {
            const fileHandle = await fsp.open(session.safeboxPath, 'r+');
            try {
                for (const entry of changedEntries) {
                    const blockData = plainZip.subarray(entry.plainOffset, entry.plainOffset + entry.plainLength);
                    const blockIv = deriveSafeboxBlockIv(session.baseIv, entry.blockIndex);
                    const cipher = crypto.createCipheriv('aes-256-gcm', session.derivedKey, blockIv, { authTagLength: AUTH_TAG_LENGTH });
                    const encryptedData = Buffer.concat([cipher.update(blockData), cipher.final()]);
                    const authTag = cipher.getAuthTag();
                    await fileHandle.write(encryptedData, 0, encryptedData.length, entry.encryptedOffset);
                    await fileHandle.write(authTag, 0, authTag.length, entry.tagOffset);
                }
            } finally {
                await fileHandle.close();
            }
        }
    } else {
        const baseIv = Buffer.isBuffer(session.baseIv) && session.baseIv.length === IV_LENGTH
            ? session.baseIv
            : crypto.randomBytes(IV_LENGTH);
        const finalBuffer = buildSafeboxFileBuffer({
            salt: session.salt,
            baseIv,
            plainData: plainZip,
            derivedKey: session.derivedKey
        });
        const tempOutputPath = `${session.safeboxPath}.tmp`;
        await fsp.writeFile(tempOutputPath, finalBuffer);
        await fsp.rename(tempOutputPath, session.safeboxPath);
    }
    await fsp.rm(session.tempDirPath, { recursive: true, force: true });
    safeboxSessions.delete(sessionId);
}

function getSelfDecryptExeTemplatePath() {
    const local = path.join(__dirname, 'assets', SELF_DECRYPT_EXE_TEMPLATE_FILENAME);
    if (fs.existsSync(local)) return local;
    return null;
}

async function buildSelfDecryptExeFromTemplate({ templatePath, encryptedFilePath, outputExePath, originalName }) {
    const nameBytes = Buffer.from(originalName, 'utf8');
    if (nameBytes.length > 0xffff) {
        throw new Error('文件名过长，无法写入自解密尾部元数据');
    }

    const encStat = await fsp.stat(encryptedFilePath);
    const encLenBig = BigInt(encStat.size);
    if (encLenBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('加密内容过大，超过自解密容器支持范围');
    }

    const tail = Buffer.alloc(SELF_DECRYPT_EXE_TAIL_LENGTH);
    // encLen(8)
    tail.writeBigUInt64LE(encLenBig, 0);
    // nameLen(2)
    tail.writeUInt16LE(nameBytes.length, 8);
    // version(1)
    tail.writeUInt8(SELF_DECRYPT_EXE_VERSION, 10);
    // magic(4)
    SELF_DECRYPT_EXE_MAGIC.copy(tail, 11);

    // 1) copy template
    await fsp.copyFile(templatePath, outputExePath);

    // 2) append encrypted bytes + name + tail
    await new Promise((resolve, reject) => {
        const outStream = fs.createWriteStream(outputExePath, { flags: 'a' });
        const encStream = fs.createReadStream(encryptedFilePath);

        const onError = (err) => {
            try { encStream.destroy(); } catch (e) { }
            try { outStream.destroy(); } catch (e) { }
            reject(err);
        };

        outStream.on('error', onError);
        encStream.on('error', onError);

        outStream.on('finish', resolve);

        encStream.pipe(outStream, { end: false });
        encStream.on('end', () => {
            outStream.write(nameBytes);
            outStream.end(tail);
        });
    });
}

function parseDisguisedContainer(fileBuffer) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < DISGUISE_TAIL_LENGTH_V1) {
        throw new Error('伪装加密文件结构无效');
    }

    const magic = fileBuffer.subarray(fileBuffer.length - 4, fileBuffer.length);
    const version = fileBuffer.readUInt8(fileBuffer.length - 5);

    if (!magic.equals(DISGUISE_MAGIC)) {
        throw new Error('未检测到伪装加密标记');
    }
    let tailOffset;
    let modeFlag = DISGUISE_MODE_FILE;
    let nameLength;
    let encryptedLengthBig;

    if (version === 1) {
        tailOffset = fileBuffer.length - DISGUISE_TAIL_LENGTH_V1;
        encryptedLengthBig = fileBuffer.readBigUInt64LE(tailOffset);
        nameLength = fileBuffer.readUInt16LE(tailOffset + 8);
    } else if (version === DISGUISE_VERSION) {
        tailOffset = fileBuffer.length - DISGUISE_TAIL_LENGTH;
        encryptedLengthBig = fileBuffer.readBigUInt64LE(tailOffset);
        nameLength = fileBuffer.readUInt16LE(tailOffset + 8);
        modeFlag = fileBuffer.readUInt8(tailOffset + 10);
    } else {
        throw new Error(`不支持的伪装加密版本: ${version}`);
    }

    if (nameLength <= 0) throw new Error('伪装加密文件缺少原始文件名');
    if (encryptedLengthBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('伪装加密内容过大');

    const encryptedLength = Number(encryptedLengthBig);
    const cryptoMetaLength = DISGUISE_KEY_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
    const nameStart = tailOffset - nameLength;
    const keyStart = nameStart - cryptoMetaLength;
    const encryptedStart = keyStart - encryptedLength;
    if (encryptedStart < 0 || keyStart < 0 || nameStart < 0) throw new Error('伪装加密文件结构损坏');

    return {
        originalName: fileBuffer.subarray(nameStart, tailOffset).toString('utf8'),
        key: fileBuffer.subarray(keyStart, keyStart + DISGUISE_KEY_LENGTH),
        iv: fileBuffer.subarray(keyStart + DISGUISE_KEY_LENGTH, keyStart + DISGUISE_KEY_LENGTH + IV_LENGTH),
        authTag: fileBuffer.subarray(
            keyStart + DISGUISE_KEY_LENGTH + IV_LENGTH,
            keyStart + DISGUISE_KEY_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
        ),
        encryptedData: fileBuffer.subarray(encryptedStart, keyStart),
        modeFlag
    };
}

ipcMain.handle('encrypt-file', async (event, { filePath, algorithm, keyOption, keyFilePath, password, outputOption, compressionLevel }) => {
    try {
        const resolvedOutputOption = outputOption || 'tclock';
        const resolvedAlgorithm = resolveEncryptionAlgorithm(algorithm);
        const zipCompressionLevel = normalizeZipCompressionLevel(compressionLevel, 5);
        if (resolvedOutputOption === 'exe' && resolvedAlgorithm !== ENCRYPTION_ALGORITHM_AES_256_GCM) {
            throw new Error('自解密 exe 暂不支持 XChaCha20，请选择 AES-256-GCM');
        }

        let key;
        if (resolvedOutputOption === 'exe') {
            if (keyOption !== 'password') {
                throw new Error('自解密 exe 模式仅支持密码');
            }
            if (typeof password !== 'string' || password.length === 0) {
                throw new Error('未提供密码');
            }
            key = await deriveKeyFromPassword(password);
        } else if (keyOption === 'generate') {
            const keyMaterial = crypto.randomBytes(32);
            const result = await dialog.showSaveDialog({
                title: '保存生成的密钥文件',
                defaultPath: path.join(app.getPath('downloads'), `encryption${KEY_FILE_EXTENSION}`),
                filters: [
                    { name: 'TransCrypt 密钥文件', extensions: [KEY_FILE_EXTENSION.replace('.', '')] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });
            if (result.canceled) return { success: false, message: '密钥文件保存已取消' };
            await fsp.writeFile(result.filePath, keyMaterial);
            key = await deriveKeyFromMaterial(keyMaterial);
        } else if (keyOption === 'password') {
            if (typeof password !== 'string' || password.length === 0) {
                throw new Error('未提供密码');
            }
            key = await deriveKeyFromPassword(password);
        } else {
            if (!keyFilePath) throw new Error('未提供密钥文件');
            key = await deriveKey(keyFilePath);
        }

        const stats = await fsp.stat(filePath);
        const isDirectory = stats.isDirectory();

        const originalName = path.basename(filePath);

        // exe mode: encrypt to temp tclock first, then append into decryptor template exe.
        let outputPath = null;
        let tempEncryptedPath = null;
        if (resolvedOutputOption === 'exe') {
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM_AES_256_GCM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
            const header = Buffer.concat([ENCRYPTION_MAGIC, Buffer.from([ENCRYPTION_VERSION_V1, isDirectory ? 1 : 0]), iv]);
            const templatePath = getSelfDecryptExeTemplatePath();
            if (!templatePath) {
                throw new Error(
                    `缺少自解密 exe 模板文件：assets/${SELF_DECRYPT_EXE_TEMPLATE_FILENAME}。\n` +
                    `请先构建并放入该文件，然后再在本应用里选择“生成自解密 exe”。`
                );
            }

            const tempDir = path.join(os.tmpdir(), 'TransCryptProSelfDecrypt');
            await fsp.mkdir(tempDir, { recursive: true });
            tempEncryptedPath = path.join(
                tempDir,
                `${originalName}-${Date.now()}-${Math.random().toString(16).slice(2)}${ENCRYPTED_FILE_EXTENSION}`
            );

            try {
                const saveExeResult = await dialog.showSaveDialog({
                    title: '保存自解密 exe',
                    defaultPath: path.join(path.dirname(filePath), `${originalName}-decrypt.exe`),
                    filters: [{ name: 'Windows 可执行文件', extensions: ['exe'] }],
                });
                if (saveExeResult.canceled) {
                    return { success: false, message: '自解密 exe 保存已取消' };
                }
                outputPath = saveExeResult.filePath;

                const writeStream = fs.createWriteStream(tempEncryptedPath);
                writeStream.write(header);
                if (isDirectory) {
                    const archive = archiver('zip', { zlib: { level: zipCompressionLevel } });
                    archive.pipe(cipher).pipe(writeStream);
                    archive.directory(filePath, false);
                    await archive.finalize();
                } else {
                    const readStream = fs.createReadStream(filePath);
                    readStream.pipe(cipher).pipe(writeStream);
                }

                await new Promise((resolve, reject) => {
                    writeStream.on('finish', () => {
                        const authTag = cipher.getAuthTag();
                        fs.appendFileSync(tempEncryptedPath, authTag);
                        resolve();
                    });
                    writeStream.on('error', reject);
                });

                await buildSelfDecryptExeFromTemplate({
                    templatePath,
                    encryptedFilePath: tempEncryptedPath,
                    outputExePath: outputPath,
                    originalName
                });

                return { success: true, outputPath };
            } finally {
                if (tempEncryptedPath) {
                    await fsp.rm(tempEncryptedPath, { force: true });
                }
            }
        }

        // tclock mode (existing behavior)
        const outputExt = ENCRYPTED_FILE_EXTENSION;
        const outputFileName = `${originalName}${outputExt}`;

        const saveResult = await dialog.showSaveDialog({
            title: '保存加密文件',
            defaultPath: path.join(path.dirname(filePath), outputFileName),
            filters: [
                { name: 'TransCrypt 加密文件', extensions: [ENCRYPTED_FILE_EXTENSION.replace('.', '')] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });

        if (saveResult.canceled) return { success: false, message: '加密文件保存已取消' };
        outputPath = saveResult.filePath;
        if (resolvedAlgorithm === ENCRYPTION_ALGORITHM_XCHACHA20) {
            const plainData = isDirectory
                ? await getDirectoryAsBuffer(filePath, zipCompressionLevel)
                : await fsp.readFile(filePath);
            const nonce = crypto.randomBytes(XCHACHA_NONCE_LENGTH);
            const encrypted = await encryptXChaCha20ToBuffer(key, nonce, plainData);
            const header = Buffer.concat([
                ENCRYPTION_MAGIC,
                Buffer.from([ENCRYPTION_VERSION_V2, isDirectory ? 1 : 0, ENCRYPTION_ALGORITHM_ID_XCHACHA20]),
                nonce
            ]);
            const finalBuffer = Buffer.concat([header, encrypted.encryptedData, encrypted.authTag]);
            await fsp.writeFile(outputPath, finalBuffer);
        } else {
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM_AES_256_GCM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
            const header = Buffer.concat([ENCRYPTION_MAGIC, Buffer.from([ENCRYPTION_VERSION_V1, isDirectory ? 1 : 0]), iv]);
            const writeStream = fs.createWriteStream(outputPath);
            writeStream.write(header);

            if (isDirectory) {
                const archive = archiver('zip', { zlib: { level: zipCompressionLevel } });
                archive.pipe(cipher).pipe(writeStream);
                archive.directory(filePath, false);
                await archive.finalize();
            } else {
                const readStream = fs.createReadStream(filePath);
                readStream.pipe(cipher).pipe(writeStream);
            }

            await new Promise((resolve, reject) => {
                writeStream.on('finish', () => {
                    const authTag = cipher.getAuthTag();
                    fs.appendFileSync(outputPath, authTag);
                    resolve();
                });
                writeStream.on('error', reject);
            });
        }

        return { success: true, outputPath };

    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('decrypt-file', async (event, { filePath, algorithm, keyOption, keyFilePath, password }) => {
    try {
        const resolvedKeyOption = keyOption || 'file';
        let keyCandidates = [];
        if (resolvedKeyOption === 'generate') {
            throw new Error('解密时不能生成新密钥');
        } else if (resolvedKeyOption === 'password') {
            if (typeof password !== 'string' || password.length === 0) {
                throw new Error('未提供密码');
            }
            keyCandidates.push(await deriveKeyFromPassword(password));
        } else if (resolvedKeyOption === 'file') {
            if (!keyFilePath) throw new Error('未提供密钥文件');
            const keyMaterial = await fsp.readFile(keyFilePath);
            const derivedKey = await deriveKeyFromMaterial(keyMaterial);
            keyCandidates.push(derivedKey);
            if (keyMaterial.length === 32 && !derivedKey.equals(keyMaterial)) {
                keyCandidates.push(keyMaterial);
            }
        } else {
            throw new Error('不支持的密钥选项');
        }

        let originalName = path.basename(filePath);
        if (originalName.toLowerCase().endsWith(ENCRYPTED_FILE_EXTENSION)) {
            originalName = originalName.slice(0, -ENCRYPTED_FILE_EXTENSION.length);
        } else if (originalName.toLowerCase().endsWith('.dir.enc')) {
            originalName = originalName.slice(0, -('.dir.enc'.length));
        } else if (originalName.toLowerCase().endsWith('.enc')) {
            originalName = originalName.slice(0, -('.enc'.length));
        }

        const saveResult = await dialog.showSaveDialog({
            title: '保存解密后的文件/文件夹',
            defaultPath: path.join(path.dirname(filePath), originalName)
        });

        if (saveResult.canceled) return { success: false, message: '解密文件保存已取消' };
        const outputPath = saveResult.filePath;

        const fileBuffer = fs.readFileSync(filePath);
        const lowerFileName = path.basename(filePath).toLowerCase();
        const parsedMeta = parseEncryptedFileMeta(fileBuffer);
        if (fileBuffer.length < parsedMeta.headerOffset + parsedMeta.nonceLength + AUTH_TAG_LENGTH) {
            throw new Error('加密文件结构无效');
        }
        const modeFlag = parsedMeta.modeFlag;
        const nonce = fileBuffer.slice(parsedMeta.nonceOffset, parsedMeta.nonceOffset + parsedMeta.nonceLength);
        const authTag = fileBuffer.slice(fileBuffer.length - AUTH_TAG_LENGTH);
        const encryptedDataBuffer = fileBuffer.slice(parsedMeta.headerOffset + parsedMeta.nonceLength, fileBuffer.length - AUTH_TAG_LENGTH);
        let decryptedBuffer = null;
        let lastDecryptError = null;
        for (const candidateKey of keyCandidates) {
            try {
                if (parsedMeta.algorithm === ENCRYPTION_ALGORITHM_XCHACHA20) {
                    decryptedBuffer = await decryptXChaCha20ToBuffer(candidateKey, nonce, authTag, encryptedDataBuffer);
                } else {
                    decryptedBuffer = decryptAesGcmToBuffer(candidateKey, nonce, authTag, encryptedDataBuffer);
                }
                lastDecryptError = null;
                break;
            } catch (error) {
                lastDecryptError = error;
            }
        }
        if (!decryptedBuffer) {
            throw lastDecryptError || new Error('密钥无效或文件已损坏');
        }
        let shouldExtractDirectory = false;
        let allowFallbackToFile = false;
        if (modeFlag === 1) {
            shouldExtractDirectory = true;
        } else if (modeFlag === 0) {
            shouldExtractDirectory = false;
        } else if (lowerFileName.endsWith('.dir.enc')) {
            shouldExtractDirectory = true;
        } else if (lowerFileName.endsWith('.enc')) {
            shouldExtractDirectory = false;
        } else {
            shouldExtractDirectory = await isLikelyZipBuffer(decryptedBuffer);
            allowFallbackToFile = true;
        }

        if (shouldExtractDirectory) {
            try {
                await fsp.mkdir(outputPath, { recursive: true });
                await extractZipBufferToDirectory(decryptedBuffer, outputPath);
            } catch (error) {
                if (!allowFallbackToFile) {
                    throw error;
                }
                await fsp.rm(outputPath, { recursive: true, force: true });
                await fsp.writeFile(outputPath, decryptedBuffer);
            }
        } else {
            await fsp.writeFile(outputPath, decryptedBuffer);
        }

        return { success: true, outputPath };

    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('disguise-encrypt-file', async (_event, { sourceFilePath, carrierFilePath }) => {
    try {
        if (!sourceFilePath || !carrierFilePath) {
            throw new Error('请同时提供被加密文件和载体文件');
        }

        const sourceStat = await fsp.stat(sourceFilePath);
        const carrierStat = await fsp.stat(carrierFilePath);
        if (!carrierStat.isFile()) {
            throw new Error('载体仅支持文件');
        }
        if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
            throw new Error('被加密路径仅支持文件或文件夹');
        }

        const isSourceDirectory = sourceStat.isDirectory();
        const sourceBuffer = isSourceDirectory
            ? await getDirectoryAsBuffer(sourceFilePath)
            : await fsp.readFile(sourceFilePath);
        const carrierBuffer = await fsp.readFile(carrierFilePath);
        const key = crypto.randomBytes(DISGUISE_KEY_LENGTH);
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
        const encryptedData = Buffer.concat([cipher.update(sourceBuffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const originalNameBytes = Buffer.from(path.basename(sourceFilePath), 'utf8');

        if (originalNameBytes.length > 0xffff) {
            throw new Error('原始文件名过长，无法写入伪装加密信息');
        }

        const tail = Buffer.alloc(DISGUISE_TAIL_LENGTH);
        tail.writeBigUInt64LE(BigInt(encryptedData.length), 0);
        tail.writeUInt16LE(originalNameBytes.length, 8);
        tail.writeUInt8(isSourceDirectory ? DISGUISE_MODE_DIRECTORY : DISGUISE_MODE_FILE, 10);
        tail.writeUInt8(DISGUISE_VERSION, 11);
        DISGUISE_MAGIC.copy(tail, 12);

        const carrierExt = path.extname(carrierFilePath);
        const carrierBase = path.basename(carrierFilePath, carrierExt);
        const saveResult = await dialog.showSaveDialog({
            title: '保存伪装加密文件',
            defaultPath: path.join(path.dirname(carrierFilePath), `${carrierBase}_masked${carrierExt}`),
            filters: [{ name: '所有文件', extensions: ['*'] }]
        });
        if (saveResult.canceled || !saveResult.filePath) {
            return { success: false, message: '伪装加密文件保存已取消' };
        }

        const outputBuffer = Buffer.concat([
            carrierBuffer,
            encryptedData,
            key,
            iv,
            authTag,
            originalNameBytes,
            tail
        ]);
        await fsp.writeFile(saveResult.filePath, outputBuffer);
        return { success: true, outputPath: saveResult.filePath };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('disguise-decrypt-file', async (_event, { disguisedFilePath }) => {
    try {
        if (!disguisedFilePath) {
            throw new Error('未提供伪装加密文件');
        }
        const fileBuffer = await fsp.readFile(disguisedFilePath);
        const { originalName, key, iv, authTag, encryptedData, modeFlag } = parseDisguisedContainer(fileBuffer);
        const decryptedBuffer = decryptAesGcmToBuffer(key, iv, authTag, encryptedData);
        const outputDir = path.dirname(disguisedFilePath);

        if (modeFlag === DISGUISE_MODE_DIRECTORY) {
            const result = await dialog.showSaveDialog({
                title: '保存解密后的文件夹',
                defaultPath: path.join(outputDir, originalName || 'restored-folder')
            });
            if (result.canceled || !result.filePath) {
                return { success: false, message: '解密文件夹保存已取消' };
            }
            await fsp.mkdir(result.filePath, { recursive: true });
            await extractZipBufferToDirectory(decryptedBuffer, result.filePath);
            return { success: true, outputPath: result.filePath };
        }

        const saveResult = await dialog.showSaveDialog({
            title: '保存解密后的文件',
            defaultPath: path.join(outputDir, originalName || 'restored-file')
        });
        if (saveResult.canceled || !saveResult.filePath) {
            return { success: false, message: '解密文件保存已取消' };
        }

        await fsp.writeFile(saveResult.filePath, decryptedBuffer);
        return { success: true, outputPath: saveResult.filePath };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('create-safebox', async (_event, { sourceDirectoryPath, password, keyOption, keyFilePath }) => {
    let contentDirPath = sourceDirectoryPath || null;
    let createdTempDir = null;
    try {
        if (process.platform !== 'win32') {
            throw new Error('Safebox 功能目前仅支持 Windows');
        }
        const resolvedKeyOption = keyOption === 'file' ? 'file' : 'password';
        if (!contentDirPath) {
            contentDirPath = path.join(
                os.tmpdir(),
                'TransCryptProSafeboxEmpty',
                `${Date.now()}-${Math.random().toString(16).slice(2)}`
            );
            await fsp.mkdir(contentDirPath, { recursive: true });
            createdTempDir = contentDirPath;
        } else {
            const stat = await fsp.stat(contentDirPath);
            if (!stat.isDirectory()) {
                throw new Error('Safebox 仅支持将文件夹作为容器内容');
            }
        }

        const defaultBaseName = contentDirPath && sourceDirectoryPath
            ? path.basename(sourceDirectoryPath)
            : `safebox-${Date.now()}`;
        const defaultName = `${defaultBaseName}${SAFEBOX_FILE_EXTENSION}`;
        const defaultParentDir = sourceDirectoryPath
            ? path.dirname(sourceDirectoryPath)
            : app.getPath('downloads');
        const saveResult = await dialog.showSaveDialog({
            title: '保存 Safebox 容器文件',
            defaultPath: path.join(defaultParentDir, defaultName),
            filters: [
                { name: 'TransCrypt Safebox', extensions: [SAFEBOX_FILE_EXTENSION.replace('.', '')] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        if (saveResult.canceled || !saveResult.filePath) {
            if (createdTempDir) {
                await fsp.rm(createdTempDir, { recursive: true, force: true });
            }
            return { success: false, message: '保存已取消' };
        }

        const salt = crypto.randomBytes(SAFEBOX_SALT_LENGTH);
        let derivedKey;
        if (resolvedKeyOption === 'file') {
            if (!keyFilePath || typeof keyFilePath !== 'string') {
                throw new Error('请选择密钥文件');
            }
            const keyMaterial = await fsp.readFile(keyFilePath);
            derivedKey = await deriveSafeboxKeyFromMaterial(keyMaterial, salt);
        } else {
            if (typeof password !== 'string' || password.length === 0) {
                throw new Error('请输入 Safebox 密码');
            }
            derivedKey = await deriveSafeboxKeyFromPassword(password, salt);
        }
        const plainZip = await getDirectoryAsBuffer(contentDirPath);
        const baseIv = crypto.randomBytes(IV_LENGTH);
        const finalBuffer = buildSafeboxFileBuffer({
            salt,
            baseIv,
            plainData: plainZip,
            derivedKey
        });
        await fsp.writeFile(saveResult.filePath, finalBuffer);

        if (createdTempDir) {
            await fsp.rm(createdTempDir, { recursive: true, force: true });
        }
        return { success: true, outputPath: saveResult.filePath };
    } catch (error) {
        if (createdTempDir) {
            try {
                await fsp.rm(createdTempDir, { recursive: true, force: true });
            } catch (cleanupError) {
            }
        }
        return { success: false, message: error.message };
    }
});

ipcMain.handle('mount-safebox', async (_event, { safeboxPath, password, keyOption, keyFilePath }) => {
    let tempDirPath = null;
    try {
        if (process.platform !== 'win32') {
            throw new Error('Safebox 挂载目前仅支持 Windows');
        }
        if (!safeboxPath || !safeboxPath.toLowerCase().endsWith(SAFEBOX_FILE_EXTENSION)) {
            throw new Error(`请选择 ${SAFEBOX_FILE_EXTENSION} 文件`);
        }
        const resolvedKeyOption = keyOption === 'file' ? 'file' : 'password';
        const existing = Array.from(safeboxSessions.entries()).find(([, value]) => value.safeboxPath === safeboxPath);
        if (existing) {
            return {
                success: true,
                sessionId: existing[0],
                driveLetter: existing[1].driveLetter,
                drivePath: `${existing[1].driveLetter}:\\`,
                alreadyMounted: true
            };
        }

        const fileBuffer = await fsp.readFile(safeboxPath);
        const parsed = parseSafeboxFile(fileBuffer);
        let derivedKey;
        if (resolvedKeyOption === 'file') {
            if (!keyFilePath || typeof keyFilePath !== 'string') {
                throw new Error('请选择密钥文件');
            }
            const keyMaterial = await fsp.readFile(keyFilePath);
            derivedKey = await deriveSafeboxKeyFromMaterial(keyMaterial, parsed.salt);
        } else {
            if (typeof password !== 'string' || password.length === 0) {
                throw new Error('请输入 Safebox 密码');
            }
            derivedKey = await deriveSafeboxKeyFromPassword(password, parsed.salt);
        }
        let plainZip;
        if (parsed.version === SAFEBOX_VERSION_V2) {
            const decryptedBlocks = [];
            for (const block of parsed.blocks) {
                const blockIv = deriveSafeboxBlockIv(parsed.baseIv, block.blockIndex);
                const plainBlock = decryptAesGcmWithKey(derivedKey, blockIv, block.authTag, block.encryptedData);
                decryptedBlocks.push(plainBlock);
            }
            plainZip = Buffer.concat(decryptedBlocks, parsed.plainSize);
        } else {
            plainZip = decryptAesGcmWithKey(derivedKey, parsed.iv, parsed.authTag, parsed.encryptedData);
        }

        tempDirPath = path.join(os.tmpdir(), 'TransCryptProSafebox', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await fsp.mkdir(tempDirPath, { recursive: true });
        await extractZipBufferToDirectory(plainZip, tempDirPath);

        const driveLetter = mountDirectoryToDriveLetter(tempDirPath);
        const sessionId = crypto.randomUUID();
        safeboxSessions.set(sessionId, {
            safeboxPath,
            tempDirPath,
            driveLetter,
            salt: Buffer.from(parsed.salt),
            derivedKey,
            safeboxVersion: parsed.version,
            baseIv: parsed.version === SAFEBOX_VERSION_V2 ? Buffer.from(parsed.baseIv) : null,
            blockEntries: parsed.version === SAFEBOX_VERSION_V2
                ? parsed.blocks.map((block) => ({
                    blockIndex: block.blockIndex,
                    plainOffset: block.plainOffset,
                    plainLength: block.plainLength,
                    encryptedOffset: block.encryptedOffset,
                    tagOffset: block.tagOffset
                }))
                : null,
            originalPlainZip: parsed.version === SAFEBOX_VERSION_V2 ? Buffer.from(plainZip) : null
        });
        return {
            success: true,
            sessionId,
            driveLetter,
            drivePath: `${driveLetter}:\\`
        };
    } catch (error) {
        if (tempDirPath) {
            try {
                await fsp.rm(tempDirPath, { recursive: true, force: true });
            } catch (cleanupError) {
            }
        }
        return { success: false, message: error.message };
    }
});

ipcMain.handle('unmount-safebox', async (_event, { sessionId }) => {
    try {
        if (!sessionId) {
            throw new Error('缺少 sessionId');
        }
        await flushSafeboxSession(sessionId);
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('list-safebox-sessions', async () => {
    return Array.from(safeboxSessions.entries()).map(([sessionId, session]) => ({
        sessionId,
        safeboxPath: session.safeboxPath,
        driveLetter: session.driveLetter,
        drivePath: `${session.driveLetter}:\\`
    }));
});

function runProbe(filePath) {
    if (!ffprobePath) {
        throw new Error('未找到 FFprobe，请确认 FFmpeg 已正确安装');
    }
    const probeRaw = execFileSync(
        ffprobePath,
        [
            '-v', 'error',
            '-show_entries', 'format=filename,format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,bit_rate,pix_fmt,profile,sample_rate,channels',
            '-of', 'json',
            filePath
        ],
        {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 16
        }
    );
    return JSON.parse(probeRaw || '{}');
}

function parseFps(raw) {
    if (!raw || typeof raw !== 'string') return 0;
    if (!raw.includes('/')) {
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
    }
    const [a, b] = raw.split('/');
    const an = Number(a);
    const bn = Number(b);
    if (!Number.isFinite(an) || !Number.isFinite(bn) || bn === 0) return 0;
    return an / bn;
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getMediaProbe(filePath) {
    const probe = runProbe(filePath);
    const format = probe.format || {};
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const videoStream = streams.find((item) => item.codec_type === 'video');
    const audioStream = streams.find((item) => item.codec_type === 'audio');
    const sourceExt = path.extname(filePath).replace('.', '').toLowerCase();
    const container = sourceExt || String(format.format_name || '').split(',')[0] || '';
    const durationSec = toNumber(format.duration, 0);
    const videoCodec = videoStream ? String(videoStream.codec_name || '') : '';
    const audioCodec = audioStream ? String(audioStream.codec_name || '') : '';
    let recommendedContainer = container;
    if (videoStream) {
        if (['avi', 'flv'].includes(container)) recommendedContainer = 'mp4';
        if (['wmv'].includes(container)) recommendedContainer = 'mkv';
        if (videoCodec.includes('vp9') || videoCodec.includes('av1')) recommendedContainer = 'webm';
    } else if (audioStream) {
        if (container === 'wav') recommendedContainer = 'flac';
        if (container === 'wma') recommendedContainer = 'm4a';
    }
    return {
        sourcePath: filePath,
        fileName: path.basename(filePath),
        format: {
            container,
            formatName: String(format.format_name || ''),
            durationSec,
            sizeBytes: toNumber(format.size, 0),
            bitrate: toNumber(format.bit_rate, 0)
        },
        streams: {
            hasVideo: !!videoStream,
            hasAudio: !!audioStream,
            video: videoStream
                ? {
                    codec: String(videoStream.codec_name || ''),
                    width: toNumber(videoStream.width, 0),
                    height: toNumber(videoStream.height, 0),
                    fps: parseFps(String(videoStream.avg_frame_rate || videoStream.r_frame_rate || '0')),
                    bitrate: toNumber(videoStream.bit_rate, 0),
                    pixelFormat: String(videoStream.pix_fmt || ''),
                    profile: String(videoStream.profile || '')
                }
                : null,
            audio: audioStream
                ? {
                    codec: String(audioStream.codec_name || ''),
                    sampleRate: toNumber(audioStream.sample_rate, 0),
                    channels: toNumber(audioStream.channels, 0),
                    bitrate: toNumber(audioStream.bit_rate, 0)
                }
                : null
        },
        recommended: {
            container: recommendedContainer
        }
    };
}

function normalizeVideoCodec(codecValue) {
    const codec = String(codecValue || '').trim();
    return codec || '';
}

function buildProfessionalConversionArgs({
    sourcePath,
    outputPath,
    config,
    sourceProbe,
    resumeFromMs = 0
}) {
    const cfg = config || {};
    const errors = [];
    const warnings = [];
    const hasVideo = !!(sourceProbe && sourceProbe.streams && sourceProbe.streams.hasVideo);
    const hasAudio = !!(sourceProbe && sourceProbe.streams && sourceProbe.streams.hasAudio);
    const container = String(cfg.container || '').toLowerCase();
    const isAudioContainer = ['mp3', 'aac', 'm4a', 'wav', 'flac', 'ogg', 'wma'].includes(container);
    const isWebmContainer = container === 'webm';
    const qsvVideoCodecs = new Set(['h264_qsv', 'hevc_qsv']);
    const webmVideoCodecs = new Set(['libvpx', 'libvpx-vp9', 'libaom-av1']);
    const webmAudioCodecs = new Set(['libopus', 'libvorbis']);
    const opusSampleRates = new Set(['8000', '12000', '16000', '24000', '48000']);
    const videoCodec = normalizeVideoCodec(cfg.videoCodec);
    const audioCodec = String(cfg.audioCodec || '').trim();
    const hwAccel = String(cfg.hwAccel || '').toLowerCase();
    const pixelFormat = String(cfg.pixelFormat || '').toLowerCase();
    const sampleRate = String(cfg.sampleRate || '').trim();

    if (videoCodec === 'copy' && (cfg.videoBitrate || cfg.crf || cfg.preset || cfg.profile || cfg.gop || cfg.pixelFormat || cfg.fps || cfg.resolution)) {
        errors.push('视频编码器为 copy 时，不能同时设置码率、CRF、预设、Profile、GOP、像素格式、帧率或分辨率');
    }
    if (audioCodec === 'copy' && (cfg.audioBitrate || cfg.sampleRate || cfg.channels)) {
        errors.push('音频编码器为 copy 时，不能同时设置音频码率、采样率或声道');
    }
    if (isAudioContainer && videoCodec && videoCodec !== 'none') {
        errors.push('目标容器为音频格式时，视频流必须设置为 none');
    }
    if (hwAccel === 'qsv' && videoCodec && videoCodec !== 'none' && !qsvVideoCodecs.has(videoCodec)) {
        errors.push('QSV 硬件加速模式下，视频编码器仅允许 h264_qsv 或 hevc_qsv');
    }
    if (hwAccel === 'qsv' && cfg.crf !== '' && cfg.crf !== undefined && cfg.crf !== null) {
        errors.push('QSV 硬件加速模式下不支持 CRF 参数');
    }
    if (hwAccel === 'qsv' && pixelFormat && pixelFormat !== 'nv12') {
        errors.push('QSV 硬件加速模式下像素格式仅支持 nv12');
    }
    if (isWebmContainer && videoCodec && videoCodec !== 'none' && videoCodec !== 'copy' && !webmVideoCodecs.has(videoCodec)) {
        errors.push('WebM 容器仅支持 VP8/VP9/AV1 视频编码器');
    }
    if (isWebmContainer && audioCodec && audioCodec !== 'none' && audioCodec !== 'copy' && !webmAudioCodecs.has(audioCodec)) {
        errors.push('WebM 容器仅支持 Opus/Vorbis 音频编码器');
    }
    if (isWebmContainer && sampleRate && !opusSampleRates.has(sampleRate)) {
        errors.push('WebM 容器采样率仅支持 8000/12000/16000/24000/48000');
    }
    if (audioCodec === 'libopus' && sampleRate && !opusSampleRates.has(sampleRate)) {
        errors.push('Opus 编码仅支持 8000/12000/16000/24000/48000 采样率');
    }
    if (!hasVideo && videoCodec && videoCodec !== 'none') {
        warnings.push('源文件不包含视频流，视频参数将被忽略');
    }
    if (!hasAudio && audioCodec && audioCodec !== 'none') {
        warnings.push('源文件不包含音频流，音频参数将被忽略');
    }
    if (cfg.crf && cfg.videoBitrate) {
        warnings.push('同时设置 CRF 与视频码率时，编码器行为可能与预期不一致');
    }

    if (errors.length > 0) {
        return { errors, warnings, args: [] };
    }

    const args = ['-hide_banner', '-y'];
    if (resumeFromMs > 0) {
        args.push('-ss', (resumeFromMs / 1000).toFixed(3));
    }
    if (hwAccel && videoCodec && videoCodec !== 'copy' && videoCodec !== 'none') {
        args.push('-hwaccel', hwAccel);
        if (hwAccel === 'qsv') {
            args.push('-hwaccel_output_format', 'qsv');
        }
    }
    args.push('-i', sourcePath);

    if (cfg.stripMetadata) {
        args.push('-map_metadata', '-1', '-map_chapters', '-1');
    }

    if (hasVideo && !isAudioContainer) {
        if (videoCodec === 'none') {
            args.push('-vn');
        } else if (videoCodec === 'copy') {
            args.push('-c:v', 'copy');
        } else if (videoCodec) {
            args.push('-c:v', videoCodec);
        }
        if (cfg.videoBitrate) args.push('-b:v', String(cfg.videoBitrate));
        if (cfg.fps) args.push('-r', String(cfg.fps));
        if (hwAccel !== 'qsv' && cfg.crf !== '' && cfg.crf !== undefined && cfg.crf !== null) args.push('-crf', String(cfg.crf));
        if (cfg.preset) args.push('-preset', String(cfg.preset));
        if (cfg.profile) args.push('-profile:v', String(cfg.profile));
        if (cfg.gop) args.push('-g', String(cfg.gop));
        if (cfg.pixelFormat) args.push('-pix_fmt', String(cfg.pixelFormat));
        if (cfg.resolution) {
            const [w, h] = String(cfg.resolution).toLowerCase().split('x');
            if (toNumber(w, 0) > 0 && toNumber(h, 0) > 0) {
                args.push('-vf', `scale=${w}:${h}`);
            }
        }
    } else {
        args.push('-vn');
    }

    if (hasAudio) {
        if (audioCodec === 'none') {
            args.push('-an');
        } else if (audioCodec === 'copy') {
            args.push('-c:a', 'copy');
        } else if (audioCodec) {
            args.push('-c:a', audioCodec);
        }
        if (cfg.audioBitrate) args.push('-b:a', String(cfg.audioBitrate));
        if (cfg.sampleRate) args.push('-ar', String(cfg.sampleRate));
        if (cfg.channels) args.push('-ac', String(cfg.channels));
    } else {
        args.push('-an');
    }

    if (cfg.container) {
        args.push('-f', String(cfg.container).toLowerCase());
    }

    if (String(cfg.container || '').toLowerCase() === 'mp4') {
        args.push('-movflags', '+faststart');
    }

    args.push('-progress', 'pipe:1', '-nostats', outputPath);
    return { errors, warnings, args };
}

function detectHardwareAccelerationCapabilities() {
    const defaultResult = {
        success: true,
        gpus: [],
        hasIntelQsv: false,
        preferHwAccel: '',
        supportedHwAccels: []
    };
    if (process.platform !== 'win32') {
        return defaultResult;
    }
    try {
        const output = execFileSync(
            'powershell',
            [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command',
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
            ],
            {
                encoding: 'utf8',
                windowsHide: true,
                maxBuffer: 1024 * 1024 * 4
            }
        );
        const gpus = String(output || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        const hasIntelQsv = gpus.some((name) => /intel/i.test(name) && /(uhd|iris|xe|graphics|hd)/i.test(name));
        return {
            success: true,
            gpus,
            hasIntelQsv,
            preferHwAccel: hasIntelQsv ? 'qsv' : '',
            supportedHwAccels: hasIntelQsv ? ['qsv'] : []
        };
    } catch (error) {
        return {
            ...defaultResult,
            success: false,
            message: error.message
        };
    }
}

function quoteCommandArg(value) {
    const raw = String(value ?? '');
    if (!raw) return '""';
    if (/[\s"&<>|^]/.test(raw)) {
        return `"${raw.replace(/"/g, '\\"')}"`;
    }
    return raw;
}

ipcMain.handle('get-file-info', async (event, filePath) => {
    try {
        const stats = await fsp.stat(filePath);
        const size = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
        const ext = path.extname(filePath).toLowerCase().substring(1);
        
        let info = { size, ext };
        
        // 如果是多媒体文件，尝试获取更详细信息
        if (['mp4', 'mkv', 'avi', 'mp3', 'wav', 'm4a'].includes(ext) && ffprobePath) {
            try {
                const ffprobeRaw = execSync(`"${ffprobePath}" -v error -show_entries format=duration:stream=width,height,bit_rate -of json "${filePath}"`, { encoding: 'utf8' });
                const ffData = JSON.parse(ffprobeRaw);
                if (ffData.format) info.duration = Math.round(ffData.format.duration) + 's';
                if (ffData.streams && ffData.streams[0]) {
                    if (ffData.streams[0].width) info.res = `${ffData.streams[0].width}x${ffData.streams[0].height}`;
                    if (ffData.streams[0].bit_rate) info.bitrate = Math.round(ffData.streams[0].bit_rate / 1000) + 'kbps';
                }
            } catch (e) {
                // 如果 ffprobe 不存在或执行失败，静默失败，只返回基础 stats 信息
            }
        }
        
        return info;
    } catch (e) {
        return null;
    }
});

ipcMain.handle('pro-check-tools', async () => {
    const ffmpegReady = !!(ffmpegPath && fs.existsSync(ffmpegPath));
    const ffprobeReady = !!(ffprobePath && fs.existsSync(ffprobePath));
    return {
        success: ffmpegReady && ffprobeReady,
        ffmpegReady,
        ffprobeReady,
        ffmpegPath: ffmpegReady ? ffmpegPath : null,
        ffprobePath: ffprobeReady ? ffprobePath : null,
        message: ffmpegReady && ffprobeReady
            ? 'FFmpeg 与 FFprobe 可用'
            : 'FFmpeg 或 FFprobe 不可用，请检查安装'
    };
});

ipcMain.handle('pro-detect-hardware', async () => {
    return detectHardwareAccelerationCapabilities();
});

ipcMain.handle('pro-probe-media', async (_event, { filePath }) => {
    try {
        if (!filePath) {
            throw new Error('缺少文件路径');
        }
        const stats = await fsp.stat(filePath);
        if (!stats.isFile()) {
            throw new Error('仅支持单个文件');
        }
        const probe = getMediaProbe(filePath);
        const checkpoint = proResumeCheckpoints.get(filePath);
        return {
            success: true,
            probe,
            checkpoint: checkpoint || null
        };
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
});

ipcMain.handle('pro-build-command', async (_event, payload) => {
    try {
        if (!payload || !payload.sourcePath || !payload.outputPath) {
            throw new Error('缺少 sourcePath 或 outputPath');
        }
        const sourceProbe = payload.sourceProbe || getMediaProbe(payload.sourcePath);
        const built = buildProfessionalConversionArgs({
            sourcePath: payload.sourcePath,
            outputPath: payload.outputPath,
            config: payload.config || {},
            sourceProbe,
            resumeFromMs: toNumber(payload.resumeFromMs, 0)
        });
        return {
            success: built.errors.length === 0,
            errors: built.errors,
            warnings: built.warnings,
            args: built.args,
            command: built.errors.length > 0
                ? ''
                : `"${ffmpegPath}" ${built.args.map(quoteCommandArg).join(' ')}`
        };
    } catch (error) {
        return {
            success: false,
            errors: [error.message],
            warnings: [],
            args: [],
            command: ''
        };
    }
});

ipcMain.handle('pro-start-conversion', async (event, payload) => {
    try {
        if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
            throw new Error('FFmpeg 不可用');
        }
        const taskId = String(payload && payload.taskId ? payload.taskId : crypto.randomUUID());
        const sourcePath = payload && payload.sourcePath;
        const outputPath = payload && payload.outputPath;
        if (!sourcePath || !outputPath) {
            throw new Error('缺少输入或输出路径');
        }
        if (activeProConversions.has(taskId)) {
            throw new Error('任务 ID 已存在');
        }
        const sourceProbe = payload.sourceProbe || getMediaProbe(sourcePath);
        const checkpoint = proResumeCheckpoints.get(sourcePath);
        const shouldResumeFromCheckpoint = !!(payload && payload.resumeFromCheckpoint && checkpoint && checkpoint.timeMs > 0);
        const resumeFromMs = shouldResumeFromCheckpoint
            ? checkpoint.timeMs
            : toNumber(payload && payload.resumeFromMs, 0);
        const built = buildProfessionalConversionArgs({
            sourcePath,
            outputPath,
            config: payload && payload.config ? payload.config : {},
            sourceProbe,
            resumeFromMs
        });
        if (built.errors.length > 0) {
            return {
                success: false,
                message: built.errors[0],
                errors: built.errors,
                warnings: built.warnings
            };
        }

        const ffmpeg = spawn(ffmpegPath, built.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });
        const runtime = {
            taskId,
            process: ffmpeg,
            sourcePath,
            outputPath,
            startedAt: Date.now(),
            paused: false,
            cancelled: false,
            lastOutTimeMs: resumeFromMs,
            durationSec: toNumber(sourceProbe && sourceProbe.format ? sourceProbe.format.durationSec : 0, 0)
        };
        activeProConversions.set(taskId, runtime);

        let stdoutBuffer = '';
        const sendEvent = (payloadPart) => {
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('pro-conversion-event', { taskId, ...payloadPart });
            }
        };

        sendEvent({
            type: 'state',
            state: 'running',
            warnings: built.warnings,
            command: `"${ffmpegPath}" ${built.args.map(quoteCommandArg).join(' ')}`
        });

        ffmpeg.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk.toString();
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() || '';
            const progressData = {};
            for (const line of lines) {
                if (!line || !line.includes('=')) continue;
                const idx = line.indexOf('=');
                const key = line.slice(0, idx).trim();
                const value = line.slice(idx + 1).trim();
                progressData[key] = value;
            }
            const outTimeMs = toNumber(progressData.out_time_ms, runtime.lastOutTimeMs);
            runtime.lastOutTimeMs = Math.max(runtime.lastOutTimeMs, outTimeMs);
            if (Object.keys(progressData).length > 0) {
                const elapsedSec = Math.max(0, (Date.now() - runtime.startedAt) / 1000);
                const processedSec = runtime.lastOutTimeMs / 1000000;
                const speedRaw = String(progressData.speed || '0x').replace('x', '');
                const speedValue = toNumber(speedRaw, 0);
                const percent = runtime.durationSec > 0
                    ? Math.max(0, Math.min(100, Number(((processedSec / runtime.durationSec) * 100).toFixed(2))))
                    : 0;
                const remainingSec = speedValue > 0 && runtime.durationSec > 0
                    ? Math.max(0, (runtime.durationSec - processedSec) / speedValue)
                    : null;
                sendEvent({
                    type: 'progress',
                    percent,
                    elapsedSec: Number(elapsedSec.toFixed(2)),
                    remainingSec: remainingSec === null ? null : Number(remainingSec.toFixed(2)),
                    speed: progressData.speed || '',
                    fps: progressData.fps || '',
                    frame: progressData.frame || '',
                    outTimeMs: runtime.lastOutTimeMs
                });
            }
        });

        ffmpeg.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            const lines = text.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
                sendEvent({
                    type: 'log',
                    level: /error/i.test(line) ? 'error' : 'info',
                    line
                });
            }
        });

        ffmpeg.on('error', (err) => {
            activeProConversions.delete(taskId);
            sendEvent({
                type: 'error',
                message: err.message
            });
        });

        ffmpeg.on('close', (code) => {
            activeProConversions.delete(taskId);
            if (runtime.cancelled) {
                proResumeCheckpoints.set(sourcePath, {
                    timeMs: runtime.lastOutTimeMs,
                    updatedAt: Date.now()
                });
                sendEvent({
                    type: 'state',
                    state: 'cancelled',
                    checkpointMs: runtime.lastOutTimeMs
                });
                return;
            }
            if (code === 0) {
                proResumeCheckpoints.delete(sourcePath);
                sendEvent({
                    type: 'success',
                    outputPath,
                    checkpointMs: 0
                });
                return;
            }
            proResumeCheckpoints.set(sourcePath, {
                timeMs: runtime.lastOutTimeMs,
                updatedAt: Date.now()
            });
            sendEvent({
                type: 'error',
                message: `FFmpeg 退出码: ${code}`,
                checkpointMs: runtime.lastOutTimeMs
            });
        });

        return {
            success: true,
            taskId,
            warnings: built.warnings
        };
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
});

ipcMain.handle('pro-pause-conversion', async (_event, { taskId }) => {
    try {
        const runtime = activeProConversions.get(taskId);
        if (!runtime || !runtime.process) {
            throw new Error('未找到正在运行的任务');
        }
        if (runtime.paused) {
            return { success: true, state: 'paused' };
        }
        runtime.process.stdin.write('p');
        runtime.paused = true;
        return { success: true, state: 'paused' };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('pro-resume-conversion', async (_event, { taskId }) => {
    try {
        const runtime = activeProConversions.get(taskId);
        if (!runtime || !runtime.process) {
            throw new Error('未找到正在运行的任务');
        }
        if (!runtime.paused) {
            return { success: true, state: 'running' };
        }
        runtime.process.stdin.write('p');
        runtime.paused = false;
        return { success: true, state: 'running' };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('pro-cancel-conversion', async (_event, { taskId }) => {
    try {
        const runtime = activeProConversions.get(taskId);
        if (!runtime || !runtime.process) {
            throw new Error('未找到正在运行的任务');
        }
        runtime.cancelled = true;
        try {
            runtime.process.stdin.write('q');
        } catch (error) {
            try {
                runtime.process.kill();
            } catch (killError) {
            }
        }
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('pro-get-checkpoint', async (_event, { sourcePath }) => {
    if (!sourcePath) {
        return { success: false, message: '缺少 sourcePath' };
    }
    const checkpoint = proResumeCheckpoints.get(sourcePath) || null;
    return {
        success: true,
        checkpoint
    };
});

ipcMain.handle('get-path-type', async (_event, filePath) => {
    try {
        const stats = await fsp.stat(filePath);
        return {
            success: true,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
        };
    } catch (error) {
        return { success: false, isDirectory: false, isFile: false, message: error.message };
    }
});

// Helper function to calculate hash for a single file
async function calculateFileHash(filePath, algorithm) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algorithm);
        const fileStream = fs.createReadStream(filePath);

        fileStream.on('data', (chunk) => {
            hash.update(chunk);
        });

        fileStream.on('end', () => {
            resolve(hash.digest('hex'));
        });

        fileStream.on('error', (err) => {
            reject(err);
        });
    });
}

// Helper function to calculate hash for a folder
async function calculateFolderHash(folderPath, algorithm) {
    const files = await fsp.readdir(folderPath, { withFileTypes: true });
    let allHashes = [];

    for (const file of files) {
        const fullPath = path.join(folderPath, file.name);
        if (file.isDirectory()) {
            const subFolderHash = await calculateFolderHash(fullPath, algorithm);
            allHashes.push(`${file.name}:${subFolderHash}`);
        } else if (file.isFile()) {
            const fileHash = await calculateFileHash(fullPath, algorithm);
            allHashes.push(`${file.name}:${fileHash}`);
        }
    }

    // Sort the hashes to ensure consistent folder hash regardless of file system order
    allHashes.sort();

    // Hash the combined string of all sorted hashes
    const combinedHash = crypto.createHash(algorithm);
    combinedHash.update(allHashes.join('|'));
    return combinedHash.digest('hex');
}

ipcMain.handle('calculate-hash', async (event, { filePath, algorithm }) => {
    try {
        const stats = await fsp.stat(filePath);
        let hashValue;

        if (stats.isDirectory()) {
            hashValue = await calculateFolderHash(filePath, algorithm);
        } else if (stats.isFile()) {
            hashValue = await calculateFileHash(filePath, algorithm);
        } else {
            throw new Error('不支持的路径类型 (既不是文件也不是文件夹)');
        }

        return { success: true, hash: hashValue };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.on('show-context-menu', (event, filePath) => {
    const template = [
        { label: '在文件夹中显示', click: () => shell.showItemInFolder(filePath) },
        { label: '使用默认应用打开', click: () => shell.openPath(filePath) },
        { type: 'separator' },
        { label: '复制完整路径', click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(filePath);
        }}
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('open-path', (event, filePath) => {
    shell.openPath(filePath);
});

ipcMain.on('show-item-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
});

// 设置保存与加载
ipcMain.handle('save-settings', async (event, settings) => {
    try {
        await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('load-settings', async () => {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = await fsp.readFile(settingsPath, 'utf8');
            return JSON.parse(data);
        }
        return null;
    } catch (e) {
        console.error('加载设置失败:', e);
        return null;
    }
});

async function runWorkerConversion({ sender, filePath, outputPath, targetFormat, category, options, controller, batchId }) {
    return new Promise((resolve) => {
        const worker = new Worker(path.join(__dirname, 'worker.js'));
        if (controller) {
            controller.workers.add(worker);
        }

        const complete = (result) => {
            if (controller) {
                controller.workers.delete(worker);
            }
            resolve(result);
            worker.terminate();
        };

        worker.on('message', (msg) => {
            if (msg.type === 'progress') {
                if (batchId) {
                    sender.send('batch-conversion-progress', {
                        batchId,
                        type: 'file-progress',
                        filePath,
                        progress: msg.value
                    });
                } else {
                    sender.send('conversion-progress', msg.value);
                }
            } else if (msg.type === 'success') {
                complete({
                    success: true,
                    message: `文件已成功转换并保存至: ${msg.outputPath}`,
                    outputPath: msg.outputPath,
                    extra: msg.extra
                });
            } else if (msg.type === 'error') {
                complete({
                    success: false,
                    message: `转换失败: ${msg.message}`
                });
            }
        });

        worker.on('error', (err) => {
            complete({
                success: false,
                message: `Worker错误: ${err.message}`
            });
        });

        worker.on('exit', (code) => {
            if (code !== 0 && !controller?.cancelled) {
                console.error(`Worker stopped with exit code ${code}`);
            }
        });

        worker.postMessage({
            filePath,
            outputPath,
            targetFormat,
            category,
            options,
            ffmpegPath
        });
    });
}

async function createZipFromFiles(filePaths, zipPath) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        filePaths.forEach(filePath => {
            archive.file(filePath, { name: path.basename(filePath) });
        });
        archive.finalize();
    });
}
