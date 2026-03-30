const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: (category) => 
        ipcRenderer.invoke('select-file', { category }),
    selectPath: (properties) => ipcRenderer.invoke('select-path', properties),
    convertFile: (filePath, targetFormat, category, options) => 
        ipcRenderer.invoke('convert-file', { filePath, targetFormat, category, options }),
    selectImageFiles: () => ipcRenderer.invoke('select-image-files'),
    selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),
    batchConvertImages: (payload) => ipcRenderer.invoke('batch-convert-images', payload),
    cancelBatchConversion: (batchId) => ipcRenderer.invoke('cancel-batch-conversion', { batchId }),
    createBatchZip: (filePaths, suggestedName) => ipcRenderer.invoke('create-batch-zip', { filePaths, suggestedName }),
    handleDroppedFile: (arrayBuffer, fileName) => ipcRenderer.invoke('handle-dropped-file', arrayBuffer, fileName),
    getFilePath: (file) => {
        if (webUtils && webUtils.getPathForFile) {
            return webUtils.getPathForFile(file);
        }
        return file.path;
    },
    getImageDimensions: (filePath) => ipcRenderer.invoke('get-image-dimensions', filePath),
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    showContextMenu: (filePath) => ipcRenderer.send('show-context-menu', filePath),
    openPath: (filePath) => ipcRenderer.send('open-path', filePath),
    showItemInFolder: (filePath) => ipcRenderer.send('show-item-in-folder', filePath),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    onProgress: (callback) => ipcRenderer.on('conversion-progress', (_event, value) => callback(value)),
    onBatchProgress: (callback) => ipcRenderer.on('batch-conversion-progress', (_event, payload) => callback(payload)),
    encryptFile: (options) => ipcRenderer.invoke('encrypt-file', options),
    decryptFile: (options) => ipcRenderer.invoke('decrypt-file', options),
    calculateHash: (filePath, algorithm) => ipcRenderer.invoke('calculate-hash', { filePath, algorithm }),
    consumePendingOpenEncryptedFile: () => ipcRenderer.invoke('consume-pending-open-encrypted-file'),
    onOpenEncryptedFile: (callback) => ipcRenderer.on('open-encrypted-file', (_event, filePath) => callback(filePath)),
    on: (channel, callback) => ipcRenderer.on(channel, (_event, ...args) => callback(...args))
});
