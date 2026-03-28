// main.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const { execSync } = require('child_process');
const crypto = require('crypto');
const stream = require('stream');
const archiver = require('archiver');
const yauzl = require('yauzl');

const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // GCM auth tag

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

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
    const win = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            devTools: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.loadFile('index.html');
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

app.whenReady().then(() => {
    // 在创建窗口前确保 PNG 图标存在
    ensurePngIcon().then(() => createWindow());
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// 处理文件选择请求
ipcMain.handle('select-file', async (event, { category }) => {
    try {
        const result = await dialog.showOpenDialog({
            title: '选择要转换的文件',
            properties: ['openFile']
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

// 处理文件转换请求
ipcMain.handle('convert-file', async (event, { filePath, targetFormat, category, options }) => {
    try {
        const fileName = path.basename(filePath, path.extname(filePath));
        const newFileName = `${fileName}.${targetFormat.toLowerCase()}`;
        
        // 显示保存文件对话框
        const result = await dialog.showSaveDialog({
            title: '保存转换后的文件',
            defaultPath: path.join(path.dirname(filePath), newFileName),
            filters: [
                { name: targetFormat, extensions: [targetFormat.toLowerCase()] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        
        if (result.canceled) {
            return { success: false, message: '操作已取消' };
        }
        
        const outputPath = result.filePath;
        
        // 使用 Worker 进行转换
        return new Promise((resolve) => {
            const worker = new Worker(path.join(__dirname, 'worker.js'));
            
            worker.on('message', (msg) => {
                if (msg.type === 'progress') {
                    // 发送进度给渲染进程
                    event.sender.send('conversion-progress', msg.value);
                } else if (msg.type === 'success') {
                    resolve({ 
                        success: true, 
                        message: `文件已成功转换并保存至: ${msg.outputPath}`,
                        outputPath: msg.outputPath,
                        extra: msg.extra
                    });
                    worker.terminate();
                } else if (msg.type === 'error') {
                    resolve({ 
                        success: false, 
                        message: `转换失败: ${msg.message}` 
                    });
                    worker.terminate();
                }
            });

            worker.on('error', (err) => {
                resolve({ 
                    success: false, 
                    message: `Worker错误: ${err.message}` 
                });
                worker.terminate();
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`Worker stopped with exit code ${code}`);
                }
            });

            // 启动任务
            worker.postMessage({ 
                filePath, 
                outputPath, 
                targetFormat, 
                category, 
                options,
                ffmpegPath // 将解析到的 ffmpeg 路径传递给 worker
            });
        });

    } catch (error) {
        return { 
            success: false, 
            message: `转换初始化失败: ${error.message}` 
        };
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
async function deriveKey(keyPath) {
    const keyMaterial = await fsp.readFile(keyPath);
    return new Promise((resolve, reject) => {
        crypto.scrypt(keyMaterial, 'a-hardcoded-salt-for-key-derivation', 32, (err, derivedKey) => {
            if (err) reject(err);
            resolve(derivedKey);
        });
    });
}

async function getDirectoryAsBuffer(dirPath) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const buffers = [];

        archive.on('data', (data) => buffers.push(data));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', (err) => reject(err));

        archive.directory(dirPath, false);
        archive.finalize();
    });
}

ipcMain.handle('encrypt-file', async (event, { filePath, algorithm, keyOption, keyFilePath }) => {
    try {
        let key;
        if (keyOption === 'generate') {
            key = crypto.randomBytes(32);
            const result = await dialog.showSaveDialog({
                title: '保存生成的密钥文件',
                defaultPath: path.join(app.getPath('downloads'), 'encryption.key')
            });
            if (result.canceled) return { success: false, message: '密钥文件保存已取消' };
            await fsp.writeFile(result.filePath, key);
        } else {
            if (!keyFilePath) throw new Error('未提供密钥文件');
            key = await deriveKey(keyFilePath);
        }

        const stats = await fsp.stat(filePath);
        const isDirectory = stats.isDirectory();

        const outputExt = isDirectory ? '.dir.enc' : '.enc';
        const outputFileName = `${path.basename(filePath)}${outputExt}`;

        const saveResult = await dialog.showSaveDialog({
            title: '保存加密文件',
            defaultPath: path.join(path.dirname(filePath), outputFileName)
        });

        if (saveResult.canceled) return { success: false, message: '加密文件保存已取消' };
        const outputPath = saveResult.filePath;

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });

        const writeStream = fs.createWriteStream(outputPath);
        writeStream.write(iv);

        if (isDirectory) {
            const archive = archiver('zip', { zlib: { level: 9 } });
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

        return { success: true, outputPath };

    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('decrypt-file', async (event, { filePath, algorithm, keyOption, keyFilePath }) => {
    try {
        let key;
        if (keyOption === 'generate') {
            throw new Error('解密时不能生成新密钥');
        } else {
            if (!keyFilePath) throw new Error('未提供密钥文件');
            key = await deriveKey(keyFilePath);
        }

        const isDirectory = filePath.endsWith('.dir.enc');
        const originalName = path.basename(filePath, isDirectory ? '.dir.enc' : '.enc');

        const saveResult = await dialog.showSaveDialog({
            title: '保存解密后的文件/文件夹',
            defaultPath: path.join(path.dirname(filePath), originalName)
        });

        if (saveResult.canceled) return { success: false, message: '解密文件保存已取消' };
        const outputPath = saveResult.filePath;

        const fileBuffer = fs.readFileSync(filePath); // Read the entire file into a buffer

        const iv = fileBuffer.slice(0, IV_LENGTH);
        const authTag = fileBuffer.slice(fileBuffer.length - AUTH_TAG_LENGTH);
        const encryptedDataBuffer = fileBuffer.slice(IV_LENGTH, fileBuffer.length - AUTH_TAG_LENGTH);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
        decipher.setAuthTag(authTag);

        if (isDirectory) {
            const tempZipPath = path.join(os.tmpdir(), `${Date.now()}.zip`);
            const writeStream = fs.createWriteStream(tempZipPath);

            await new Promise((resolve, reject) => {
                const bufferStream = new stream.PassThrough();
                bufferStream.end(encryptedDataBuffer);
                bufferStream.pipe(decipher).pipe(writeStream)
                    .on('finish', resolve)
                    .on('error', reject);
            });

            await fsp.mkdir(outputPath, { recursive: true });
            await new Promise((resolve, reject) => {
                yauzl.open(tempZipPath, { lazyEntries: true }, (err, zipfile) => {
                    if (err) return reject(err);
                    zipfile.on('entry', (entry) => {
                        const entryPath = path.join(outputPath, entry.fileName);
                        if (/\/$/.test(entry.fileName)) { // Directory
                            fsp.mkdir(entryPath, { recursive: true }).then(() => zipfile.readEntry()).catch(reject);
                        } else { // File
                            zipfile.openReadStream(entry, (err, readStream) => {
                                if (err) return reject(err);
                                const writeStream = fs.createWriteStream(entryPath);
                                readStream.pipe(writeStream)
                                    .on('finish', () => zipfile.readEntry())
                                    .on('error', reject);
                            });
                        }
                    });
                    zipfile.on('end', () => {
                        fsp.unlink(tempZipPath).then(resolve).catch(reject);
                    });
                    zipfile.readEntry();
                });
            });

        } else {
            const writeStream = fs.createWriteStream(outputPath);
            const bufferStream = new stream.PassThrough();
            bufferStream.end(encryptedDataBuffer);
            await new Promise((resolve, reject) => {
                bufferStream.pipe(decipher).pipe(writeStream)
                    .on('finish', resolve)
                    .on('error', reject);
            });
        }

        return { success: true, outputPath };

    } catch (error) {
        return { success: false, message: error.message };
    }
});

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