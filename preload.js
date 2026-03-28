const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: (category) => 
        ipcRenderer.invoke('select-file', { category }),
    selectPath: (properties) => ipcRenderer.invoke('select-path', properties),
    convertFile: (filePath, targetFormat, category, options) => 
        ipcRenderer.invoke('convert-file', { filePath, targetFormat, category, options }),
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
    encryptFile: (options) => ipcRenderer.invoke('encrypt-file', options),
    decryptFile: (options) => ipcRenderer.invoke('decrypt-file', options),
    calculateHash: (filePath, algorithm) => ipcRenderer.invoke('calculate-hash', { filePath, algorithm }),
    on: (channel, callback) => ipcRenderer.on(channel, (_event, ...args) => callback(...args))
});
