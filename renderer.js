// renderer.js - 渲染进程中的DOM操作和事件处理

// 设置管理
const Settings = {
    data: {},
    async init() {
        // 尝试从本地文件加载设置
        const savedSettings = await window.electronAPI.loadSettings();
        if (savedSettings) {
            this.data = savedSettings;
        } else {
            // 如果文件不存在，从 localStorage 迁移或使用默认值
            this.data = {
                theme: localStorage.getItem('setting_theme') ? JSON.parse(localStorage.getItem('setting_theme')) : 'auto',
                animation: localStorage.getItem('setting_animation') ? JSON.parse(localStorage.getItem('setting_animation')) : true,
                openFolder: localStorage.getItem('setting_openFolder') ? JSON.parse(localStorage.getItem('setting_openFolder')) : false,
                openFile: localStorage.getItem('setting_openFile') ? JSON.parse(localStorage.getItem('setting_openFile')) : false
            };
            // 立即保存一份到文件
            this.saveToFile();
        }
        
        // 应用初始设置
        Object.keys(this.data).forEach(key => {
            this.apply(key, this.data[key]);
        });
    },
    get(key, defaultValue) {
        return this.data[key] !== undefined ? this.data[key] : defaultValue;
    },
    async set(key, value) {
        this.data[key] = value;
        // 同时保存到 localStorage 做备份
        localStorage.setItem(`setting_${key}`, JSON.stringify(value));
        this.apply(key, value);
        await this.saveToFile();
    },
    async saveToFile() {
        await window.electronAPI.saveSettings(this.data);
    },
    apply(key, value) {
        switch (key) {
            case 'theme':
                if (value === 'auto') {
                    document.documentElement.removeAttribute('data-theme');
                } else {
                    document.documentElement.setAttribute('data-theme', value);
                }
                break;
            case 'animation':
                document.body.classList.toggle('no-animations', !value);
                break;
        }
    }
};

// 初始化设置
Settings.init();

// Toast 通知函数
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

// 自定义确认对话框函数
function showConfirm(title, message, confirmText = '确定', cancelText = '取消') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        overlay.innerHTML = `
            <div class="modal-container">
                <div class="modal-title">
                    <i class="bi bi-question-circle-fill"></i>
                    <span>${title}</span>
                </div>
                <div class="modal-body">
                    ${message.replace(/\n/g, '<br>')}
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-secondary" id="modalCancel">${cancelText}</button>
                    <button class="modal-btn modal-btn-primary" id="modalConfirm">${confirmText}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // 强制重绘以触发动画
        overlay.offsetHeight;
        overlay.classList.add('show');
        
        const cleanup = (result) => {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 300);
        };
        
        overlay.querySelector('#modalConfirm').onclick = () => cleanup(true);
        overlay.querySelector('#modalCancel').onclick = () => cleanup(false);
        
        // 点击遮罩层也可以取消
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup(false);
        };
    });
}

// 定义各分类的格式列表
const formatMap = {
    'images': ['PNG', 'JPG', 'JPEG', 'GIF', 'BMP', 'WEBP', 'SVG', 'ICO'],
    'videos': ['MP4', 'AVI', 'MKV', 'MOV', 'FLV', 'WebM', 'WMV'],
    'audio': ['MP3', 'WAV', 'FLAC', 'AAC', 'OGG', 'M4A', 'WMA'],
    'documents': ['PDF', 'DOCX', 'DOC', 'XLSX', 'XLS', 'PPTX', 'PPT', 'TXT', 'ODT', 'ODS', 'ODP', 'CSV', 'RTF']
};

// 获取分类的中文名称
const categoryNameMap = {
    'images': '图片',
    'videos': '视频',
    'audio': '音频',
    'documents': '文档',
    'encryption': '文件加密',
    'decryption': '文件解密',
    'hash': '文件哈希/校验',
    'settings': '设置'
};

// 文档格式兼容性映射表（定义哪些格式可以互转）
const formatCompatibilityMap = {
    // 文字处理类
    'doc': ['PDF', 'DOCX', 'TXT', 'ODT', 'RTF'],
    'docx': ['PDF', 'DOC', 'TXT', 'ODT', 'RTF'],
    'odt': ['PDF', 'DOCX', 'DOC', 'TXT', 'RTF'],
    'rtf': ['PDF', 'DOCX', 'DOC', 'TXT', 'ODT'],
    'txt': ['PDF', 'DOCX', 'DOC', 'ODT', 'RTF'],
    
    // 表格类
    'xls': ['PDF', 'XLSX', 'CSV', 'ODS'],
    'xlsx': ['PDF', 'XLS', 'CSV', 'ODS'],
    'ods': ['PDF', 'XLSX', 'XLS', 'CSV'],
    'csv': ['PDF', 'XLSX', 'XLS', 'ODS'],
    
    // 演示文稿类
    'ppt': ['PDF', 'PPTX', 'ODP'],
    'pptx': ['PDF', 'PPT', 'ODP'],
    'odp': ['PDF', 'PPTX', 'PPT'],
    
    // PDF 作为源文件（通常只能转为图片或部分文档，LibreOffice 转换 PDF 到文档效果有限，但可尝试）
    'pdf': ['DOCX', 'DOC', 'ODT', 'RTF', 'TXT']
};

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']);
const maxImageFileSizeBytes = 50 * 1024 * 1024;
const ORIGINAL_FORMAT_VALUE = '__original__';

function supportsOriginalFormatSelection(category) {
    return category === 'images' || category === 'videos';
}

function getFileExtension(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    const ext = filePath.split('.').pop();
    return ext ? ext.toLowerCase() : '';
}

// 根据源文件更新目标格式列表
function updateTargetFormats(category, sourceFilePath) {
    const targetSelect = document.getElementById('targetFormat');
    if (!targetSelect) return;

    const sourceExt = sourceFilePath ? getFileExtension(sourceFilePath) : null;
    const sourceCategory = detectFileCategory(sourceFilePath);
    let availableFormats = formatMap[category] || [];

    // 只有文档类需要根据源文件进行筛选
    if (category === 'documents' && sourceExt && formatCompatibilityMap[sourceExt]) {
        availableFormats = formatCompatibilityMap[sourceExt];
    }
    
    // 视频转音频的特殊处理：如果源是视频但当前在音频分类，显示所有音频格式
    if (category === 'audio' && sourceCategory === 'videos') {
        availableFormats = formatMap['audio'];
    }

    const filteredFormats = supportsOriginalFormatSelection(category)
        ? availableFormats
        : availableFormats.filter(f => f.toLowerCase() !== sourceExt);

    // 更新下拉菜单
    const currentSelection = targetSelect.value;
    const originalFormatOption = supportsOriginalFormatSelection(category)
        ? `<option value="${ORIGINAL_FORMAT_VALUE}">原格式${sourceExt ? ` (${sourceExt.toUpperCase()})` : ''}</option>`
        : '';
    targetSelect.innerHTML = `
        <option value="">-- 请选择目标格式 --</option>
        ${originalFormatOption}
        ${filteredFormats.map(f => `<option value="${f}">${f}</option>`).join('')}
    `;

    // 如果之前的选择在新的列表中仍然有效，则保持选择
    if (currentSelection === ORIGINAL_FORMAT_VALUE || filteredFormats.includes(currentSelection)) {
        targetSelect.value = currentSelection;
    }
}

// 构建文件扩展名到分类的反向映射
const extensionToCategoryMap = {};
Object.entries(formatMap).forEach(([category, formats]) => {
    formats.forEach(format => {
        extensionToCategoryMap[format.toLowerCase()] = category;
    });
});

// 检测文件所属的分类
function detectFileCategory(fileName) {
    if (!fileName) return null;
    const extension = fileName.split('.').pop().toLowerCase();
    return extensionToCategoryMap[extension] || null;
}

// 检查文件是否可以作为当前分类的输入
function isCompatibleWithCategory(fileName, category) {
    const detected = detectFileCategory(fileName);
    if (detected === category) return true;
    
    // 特殊逻辑：视频文件可以作为音频分类的输入（用于提取音频）
    if (category === 'audio' && detected === 'videos') return true;
    
    return false;
}

// 更新文件详情预览
    async function updateFilePreview(filePath) {
        const previewContainer = document.getElementById('filePreviewInfo');
        if (!previewContainer || !filePath) return;

        const info = await window.electronAPI.getFileInfo(filePath);
        if (info) {
            let html = `
                <div class="meta-item"><i class="bi bi-hdd"></i><span class="meta-label">大小:</span> ${info.size}</div>
                <div class="meta-item"><i class="bi bi-file-earmark"></i><span class="meta-label">格式:</span> ${info.ext.toUpperCase()}</div>
            `;
            if (info.res) html += `<div class="meta-item"><i class="bi bi-aspect-ratio"></i><span class="meta-label">分辨率:</span> ${info.res}</div>`;
            if (info.duration) html += `<div class="meta-item"><i class="bi bi-clock"></i><span class="meta-label">时长:</span> ${info.duration}</div>`;
            if (info.bitrate) html += `<div class="meta-item"><i class="bi bi-speedometer2"></i><span class="meta-label">码率:</span> ${info.bitrate}</div>`;
            
            previewContainer.innerHTML = html;
            previewContainer.classList.add('show');

            // 绑定右键菜单
            previewContainer.oncontextmenu = (e) => {
                e.preventDefault();
                window.electronAPI.showContextMenu(filePath);
            };
            const fileNameSpan = document.getElementById('selectedFileName');
            if (fileNameSpan) {
                fileNameSpan.oncontextmenu = (e) => {
                    e.preventDefault();
                    window.electronAPI.showContextMenu(filePath);
                };
            }
        }
    }

    // 处理文件选择并自动切换分类
    async function handleFileSelection(result, currentCategory, sidebarButtons) {
        if (!result.filePath) return false;
        
        const detectedCategory = detectFileCategory(result.fileName);
        
        // 提取执行切换分类的公共逻辑
        const executeSwitch = async () => {
            document.body.dataset.pendingFilePath = result.filePath;
            document.body.dataset.pendingFileName = result.fileName;
            // 触发对应分类按钮的点击事件
            const targetButton = Array.from(sidebarButtons).find(
                btn => btn.getAttribute('data-category') === detectedCategory
            );
            if (targetButton) {
                if (detectedCategory !== currentCategory) {
                    showToast(`📁 已自动切换到${categoryNameMap[detectedCategory]}分类`, 'info', 3000);
                }
                setTimeout(() => {
                    targetButton.click();
                    // 在新分类加载后，重新获取dropZone并设置文件
                    setTimeout(async () => {
                        const dropZone = document.getElementById('dropZone');
                        const selectedFileName = document.getElementById('selectedFileName');
                        if (dropZone && selectedFileName) {
                            selectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                            dropZone.classList.remove('dragover');
                            
                            // 更新预览详情
                            updateFilePreview(result.filePath);
                            
                            // 更新目标格式列表
                            updateTargetFormats(detectedCategory, result.filePath);
                            
                            // 如果是图片分类，获取并设置原始尺寸
                            if (detectedCategory === 'images') {
                                const dims = await window.electronAPI.getImageDimensions(result.filePath);
                                if (dims) {
                                    const wInput = document.getElementById('imgWidth');
                                    const hInput = document.getElementById('imgHeight');
                                    if (wInput && hInput) {
                                        wInput.value = dims.width;
                                        hInput.value = dims.height;
                                        // 触发 input 事件以更新锁定比例
                                        wInput.dispatchEvent(new Event('input'));
                                    }
                                }
                            }
                        }
                    }, 100);
                }, 200);
                return true; // 返回true表示已切换分类
            }
            return false;
        };

        // 1. 如果检测到的分类与当前分类不同，且不兼容当前分类，则自动切换
        if (detectedCategory && !isCompatibleWithCategory(result.fileName, currentCategory)) {
            return await executeSwitch();
        } 
        
        // 2. 特殊处理：视频文件添加到音频分类时，询问用户是否切换
        if (detectedCategory === 'videos' && currentCategory === 'audio') {
            const shouldSwitch = await showConfirm(
                '文件分类识别',
                `检测到您添加的是视频文件 "${result.fileName}"。\n\n您是想将其转换为其他视频格式，还是提取其中的音频？`,
                '切换到视频分类',
                '留在音频分类提取'
            );
            if (shouldSwitch) {
                return await executeSwitch();
            }
        }
        
        return false; // 返回false表示没有切换分类
    }

document.addEventListener('DOMContentLoaded', () => {
    // 选择器和事件监听器
    const sidebarButtons = document.querySelectorAll('.sidebar-button');
    const mainContent = document.querySelector('.main-content');
    let selectedFilePath = null;
    let currentCategory = null;
    let progressTimer = null;
    let currentProgress = 0;
    let selectedBatchFiles = [];
    let batchState = {
        active: false,
        batchId: null,
        failed: [],
        successful: [],
        outputDirectory: null,
        currentFileName: '',
        completed: 0,
        total: 0
    };

    function extractFileName(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }
        const segments = filePath.split(/[\\/]/);
        return segments[segments.length - 1] || filePath;
    }

    function openEncryptedFileInDecryption(filePath, showSwitchToast = true) {
        if (!filePath || typeof filePath !== 'string') {
            return;
        }
        const normalizedPath = filePath.trim();
        if (!normalizedPath.toLowerCase().endsWith('.tclock')) {
            return;
        }
        document.body.dataset.pendingDecryptionFilePath = normalizedPath;
        document.body.dataset.pendingDecryptionFileName = extractFileName(normalizedPath);
        const decryptionButton = Array.from(sidebarButtons).find(
            btn => btn.getAttribute('data-category') === 'decryption'
        );
        if (!decryptionButton) {
            return;
        }
        if (showSwitchToast && currentCategory !== 'decryption') {
            showToast('已检测到加密文件，正在跳转到解密页面', 'info', 3000);
        }
        decryptionButton.click();
    }

    function openTargetInEncryption(filePath, showSwitchToast = true) {
        if (!filePath || typeof filePath !== 'string') {
            return;
        }
        const normalizedPath = filePath.trim();
        if (!normalizedPath) {
            return;
        }
        document.body.dataset.pendingEncryptionFilePath = normalizedPath;
        document.body.dataset.pendingEncryptionFileName = extractFileName(normalizedPath);
        const encryptionButton = Array.from(sidebarButtons).find(
            btn => btn.getAttribute('data-category') === 'encryption'
        );
        if (!encryptionButton) {
            return;
        }
        if (showSwitchToast && currentCategory !== 'encryption') {
            showToast('已收到加密任务，正在跳转到加密页面', 'info', 3000);
        }
        encryptionButton.click();
    }

    function openTargetInConversion(filePath, showSwitchToast = true) {
        if (!filePath || typeof filePath !== 'string') {
            return;
        }
        const normalizedPath = filePath.trim();
        if (!normalizedPath) {
            return;
        }
        const fileName = extractFileName(normalizedPath);
        const category = detectFileCategory(fileName);
        if (!category || !['images', 'videos', 'audio', 'documents'].includes(category)) {
            showToast('无法识别文件格式，请在应用内手动选择分类', 'info', 4000);
            return;
        }
        document.body.dataset.pendingFilePath = normalizedPath;
        document.body.dataset.pendingFileName = fileName;
        const targetButton = Array.from(sidebarButtons).find(
            btn => btn.getAttribute('data-category') === category
        );
        if (!targetButton) {
            return;
        }
        if (showSwitchToast && currentCategory !== category) {
            showToast(`已识别为${categoryNameMap[category]}，正在跳转`, 'info', 3000);
        }
        targetButton.click();
    }

    function handleLaunchContextAction(payload, showSwitchToast = true) {
        if (!payload || typeof payload !== 'object') {
            return;
        }
        const action = String(payload.action || '').toLowerCase();
        const targetPath = payload.targetPath;
        if (action === 'decrypt') {
            openEncryptedFileInDecryption(targetPath, showSwitchToast);
            return;
        }
        if (action === 'encrypt') {
            openTargetInEncryption(targetPath, showSwitchToast);
            return;
        }
        if (action === 'convert') {
            openTargetInConversion(targetPath, showSwitchToast);
        }
    }

    function updateProgressBar(value) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressContainer = document.getElementById('progressContainer');
        
        if (progressBar && progressText && progressContainer) {
            if (value === 0) {
                progressContainer.style.display = 'block';
            }
            progressBar.style.width = `${value}%`;
            progressText.textContent = `${value}%`;
        }
    }

    function showEncryptionSpinner(show) {
        const spinnerContainer = document.getElementById('encSpinnerContainer');
        if (spinnerContainer) {
            spinnerContainer.style.display = show ? 'flex' : 'none';
        }
    }

    function showDecryptionSpinner(show) {
        const spinnerContainer = document.getElementById('decSpinnerContainer');
        if (spinnerContainer) {
            spinnerContainer.style.display = show ? 'flex' : 'none';
        }
    }

    // 监听进度更新
    window.electronAPI.onProgress((value) => {
        // 如果后端传来的进度大于当前进度，则更新
        if (value > currentProgress) {
            currentProgress = value;
            updateProgressBar(currentProgress);
        }
        
        // 如果进度达到100，清除定时器
        if (currentProgress >= 100 && progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    });

    window.electronAPI.onBatchProgress((payload) => {
        if (!payload || !batchState.active || payload.batchId !== batchState.batchId) {
            return;
        }

        if (payload.type === 'file-start') {
            batchState.currentFileName = payload.fileName || '';
            updateBatchProgressUI({
                percent: batchState.total > 0 ? Math.round((batchState.completed / batchState.total) * 100) : 0,
                completed: batchState.completed,
                total: batchState.total,
                currentFileName: batchState.currentFileName,
                failedCount: batchState.failed.length
            });
        }

        if (payload.type === 'file-complete') {
            batchState.completed = payload.completed || batchState.completed;
            batchState.currentFileName = payload.fileName || batchState.currentFileName;

            if (payload.success) {
                batchState.successful.push({
                    sourcePath: payload.filePath,
                    outputPath: payload.outputPath
                });
            } else {
                batchState.failed.push({
                    sourcePath: payload.filePath,
                    fileName: payload.fileName,
                    message: payload.message || '转换失败'
                });
            }

            updateBatchProgressUI({
                percent: payload.percent || 0,
                completed: batchState.completed,
                total: batchState.total,
                currentFileName: batchState.currentFileName,
                failedCount: batchState.failed.length
            });
        }
    });



    // 侧边栏按钮点击事件
    sidebarButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const category = event.currentTarget.getAttribute('data-category');
            currentCategory = category;
            
            // 移除所有按钮的active类
            sidebarButtons.forEach(btn => btn.classList.remove('active'));
            // 给选中的按钮添加active类
            event.currentTarget.classList.add('active');
            
            loadContent(category);
        });
    });

    window.electronAPI.onLaunchContextAction((payload) => {
        handleLaunchContextAction(payload, true);
    });
    window.electronAPI.consumePendingLaunchAction().then((payload) => {
        if (payload) {
            handleLaunchContextAction(payload, false);
        }
    });

    // 欢迎页的文件输入：支持自动跳转到检测到的分类
    const welcomeDropZone = document.getElementById('WelcomeDropZone');
    const welcomeSelectedFileName = document.getElementById('WelcomeSelectedFileName');
    welcomeDropZone.addEventListener('click', async () => {
        const result = await window.electronAPI.selectFile('welcome');
        if (result.filePath) {
            // 检查是否需要自动切换分类
            const switched = await handleFileSelection(result, "quickstart", sidebarButtons);
            if (!switched) {
                // 如果没有切换分类，直接设置文件
                selectedFilePath = result.filePath;
                selectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                dropZone.classList.remove('dragover');
            } else {
                // 如果切换了分类，在事件处理中已设置文件
                selectedFilePath = result.filePath;
            }
        } else {
            showToast('文件选择已取消', 'info');
        }
    });

    // 拖拽事件处理
    welcomeDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        welcomeDropZone.classList.add('dragover');
    });

    welcomeDropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        welcomeDropZone.classList.add('dragover');
    });

    welcomeDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        welcomeDropZone.classList.remove('dragover');
    });

    welcomeDropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        welcomeDropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            showToast('正在处理拖拽文件...', 'info', 3000);
            
            try {
                // 获取文件真实路径，避免生成临时文件
                const filePath = window.electronAPI.getFilePath(file);
                
                if (filePath) {
                    const result = { filePath: filePath, fileName: file.name };
                    
                    // 3. 使用返回的文件路径进行后续操作
                    welcomeSelectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                    const switched = await handleFileSelection(result, currentCategory, sidebarButtons);
                    if (!switched) {
                        showToast('无法自动识别分类，请从侧边栏选择合适的分类。', 'info', 4000);
                    }
                } else {
                    showToast('无法获取文件路径', 'error');
                }
            } catch (error) {
                console.error('拖拽文件处理全过程错误:', error);
                showToast(`处理拖拽文件失败: ${error.message}`, 'error', 5000);
            }
        }
    });

    function loadSettings() {
        const currentTheme = Settings.get('theme', 'auto');
        const currentAnimation = Settings.get('animation', true);
        const currentOpenFolder = Settings.get('openFolder', false);
        const currentOpenFile = Settings.get('openFile', false);

        mainContent.innerHTML = `
            <div class="settings-container">
                <h1>设置</h1>
                <p>管理您的个性化偏好与转换配置</p>
                
                <div class="settings-section">
                    <h3><i class="bi bi-palette"></i> 个性化设置</h3>
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">外观主题</span>
                            <span class="setting-description">选择您喜欢的主题模式</span>
                        </div>
                        <div class="setting-control">
                            <select id="themeSelect">
                                <option value="auto" ${currentTheme === 'auto' ? 'selected' : ''}>跟随系统</option>
                                <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>浅色模式</option>
                                <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>深色模式</option>
                            </select>
                        </div>
                    </div>
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">界面动画</span>
                            <span class="setting-description">开启或关闭平滑的过渡效果</span>
                        </div>
                        <div class="setting-control">
                            <input type="checkbox" id="animationToggle" ${currentAnimation ? 'checked' : ''}>
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3><i class="bi bi-sliders"></i> 常规设置</h3>
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">转换成功后打开文件夹</span>
                            <span class="setting-description">转换完成后自动在资源管理器中定位文件</span>
                        </div>
                        <div class="setting-control">
                            <input type="checkbox" id="openFolderToggle" ${currentOpenFolder ? 'checked' : ''}>
                        </div>
                    </div>
                    <div class="setting-row">
                        <div class="setting-info">
                            <span class="setting-label">转换成功后打开文件</span>
                            <span class="setting-description">转换完成后直接使用默认程序打开文件</span>
                        </div>
                        <div class="setting-control">
                            <input type="checkbox" id="openFileToggle" ${currentOpenFile ? 'checked' : ''}>
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3><i class="bi bi-info-circle"></i> 关于</h3>
                    <div class="about-info">
                        <div class="about-logo">🚀</div>
                        <div class="version-tag">Version 1.3.3</div>
                        <div class="setting-label">TransCrypt Pro</div>
                        <div class="setting-description" style="margin-top:12px;">
                            一个基于 Electron 和 FFmpeg 的轻量级开源转换工具。<br>
                            旨在提供极致简洁、高效的多媒体处理体验。
                        </div>
                        <div style="margin-top:20px;">
                            <a class="action-link" href="https://github.com/leowmx1/transcrypt-pro" style="justify-content:center;"><i class="bi bi-github"></i> 检查更新</a>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 绑定设置交互
        const themeSelect = document.getElementById('themeSelect');
        const animationToggle = document.getElementById('animationToggle');
        const openFolderToggle = document.getElementById('openFolderToggle');
        const openFileToggle = document.getElementById('openFileToggle');

        themeSelect.addEventListener('change', (e) => {
            Settings.set('theme', e.target.value);
            showToast(`主题已切换`, 'success');
        });

        animationToggle.addEventListener('change', (e) => {
            Settings.set('animation', e.target.checked);
            showToast(`界面动画已${e.target.checked ? '开启' : '关闭'}`, 'success');
        });

        openFolderToggle.addEventListener('change', (e) => {
            Settings.set('openFolder', e.target.checked);
            showToast(`设置已保存`, 'success');
        });

        openFileToggle.addEventListener('change', (e) => {
            Settings.set('openFile', e.target.checked);
            showToast(`设置已保存`, 'success');
        });
    }

    function loadEncryptionView() {
        mainContent.innerHTML = `
            <h1><i class="bi bi-lock"></i> 文件加密</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-file-earmark-zip"></i> 选择文件或文件夹:</label>
                    <div id="encDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击选择文件 或 拖拽文件/文件夹到此</div>
                            <span id="encSelectedFileName" class="selected-file-name"></span>
                        </div>
                    </div>
                    <button id="selectFolderBtn" class="secondary-btn" style="margin-top: 10px;"><i class="bi bi-folder2-open"></i> 选择文件夹</button>
                </div>

                <div class="form-group">
                    <label for="encAlgorithm"><i class="bi bi-shield-shaded"></i> 加密算法:</label>
                    <select id="encAlgorithm">
                        <option value="aes-256-gcm">AES-256-GCM (推荐)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="bi bi-key"></i> 密钥选项:</label>
                    <div class="radio-group">
                        <label><input type="radio" name="keyOption" value="file" checked> 使用密钥文件</label>
                        <label><input type="radio" name="keyOption" value="password"> 使用密码</label>
                        <label><input type="radio" name="keyOption" value="generate"> 随机生成密钥</label>
                    </div>
                </div>

                <div id="keyFileGroup">
                    <div class="form-group">
                        <label for="keyFilePath"><i class="bi bi-file-earmark-lock"></i> 选择密钥文件:</label>
                        <div class="file-input-container">
                            <input type="text" id="keyFilePath" placeholder="点击选择密钥文件" readonly>
                            <button id="selectKeyFileBtn">选择</button>
                        </div>
                        <div class="setting-description">任何文件都可以作为密钥文件，内容将被安全地派生为加密密钥。</div>
                    </div>
                </div>

                <div id="generateKeyGroup" style="display: none;">
                    <div class="form-group">
                       <div class="setting-description">将随机生成一个密钥文件，请务必妥善保存它，否则文件将无法解密。</div>
                    </div>
                </div>

                <div id="passwordKeyGroup" style="display: none;">
                    <div class="form-group">
                        <label for="passwordKeyInput"><i class="bi bi-shield-lock"></i> 输入密码:</label>
                        <input type="password" id="passwordKeyInput" placeholder="请输入加密密码">
                        <div class="setting-description">请牢记该密码，解密时需使用相同密码。</div>
                    </div>
                </div>

                <div class="button-group">
                    <button id="startEncryption"><i class="bi bi-play-circle"></i> 开始加密</button>
                </div>

                <div id="encSpinnerContainer" class="spinner-container" style="display: none; margin-top: 24px;">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <span class="spinner-text">正在加密...</span>
                </div>

                <div id="encResultContainer" class="conversion-result" style="display: none;">
                    <div class="result-header">
                        <i class="bi bi-check-circle-fill success-icon"></i>
                        <span class="result-title">加密完成!</span>
                    </div>
                    <div class="result-info" id="encResultFileInfo">
                        <!-- 文件信息将在这里动态加载 -->
                    </div>
                    <div class="result-actions">
                        <button id="encShowInFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 在文件夹中显示</button>
                        <button id="encOpenPathBtn" class="primary-btn"><i class="bi bi-box-arrow-up-right"></i> 打开文件</button>
                    </div>
                </div>
            </div>
        `;
    }

    function loadDecryptionView() {
        mainContent.innerHTML = `
            <h1><i class="bi bi-unlock"></i> 文件解密</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-file-earmark-zip"></i> 选择要解密的 .tclock 文件:</label>
                    <div id="decDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击或拖拽加密文件到此</div>
                            <span id="decSelectedFileName" class="selected-file-name"></span>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label for="decAlgorithm"><i class="bi bi-shield-shaded"></i> 加密算法:</label>
                    <select id="decAlgorithm">
                        <option value="aes-256-gcm">AES-256-GCM (推荐)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="bi bi-key"></i> 解密密钥选项:</label>
                    <div class="radio-group">
                        <label><input type="radio" name="decKeyOption" value="file" checked> 使用密钥文件</label>
                        <label><input type="radio" name="decKeyOption" value="password"> 使用密码</label>
                    </div>
                </div>

                <div id="decKeyFileGroup">
                    <div class="form-group">
                        <label for="keyFilePath"><i class="bi bi-file-earmark-lock"></i> 选择密钥文件 (.tckey):</label>
                        <div class="file-input-container">
                            <input type="text" id="keyFilePath" placeholder="点击选择密钥文件 .tckey" readonly>
                            <button id="selectKeyFileBtn">选择</button>
                        </div>
                    </div>
                </div>

                <div id="decPasswordKeyGroup" style="display: none;">
                    <div class="form-group">
                        <label for="decPasswordKeyInput"><i class="bi bi-shield-lock"></i> 输入解密密码:</label>
                        <input type="password" id="decPasswordKeyInput" placeholder="请输入解密密码">
                    </div>
                </div>

                <div class="button-group">
                    <button id="startDecryption"><i class="bi bi-unlock"></i> 开始解密</button>
                </div>

                <div id="decSpinnerContainer" class="spinner-container" style="display: none; margin-top: 24px;">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <span class="spinner-text">正在解密...</span>
                </div>

                <div id="decResultContainer" class="conversion-result" style="display: none;">
                    <div class="result-header">
                        <i class="bi bi-check-circle-fill success-icon"></i>
                        <span class="result-title">解密完成!</span>
                    </div>
                    <div class="result-info" id="decResultFileInfo">
                        <!-- 文件信息将在这里动态加载 -->
                    </div>
                    <div class="result-actions">
                        <button id="decShowInFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 在文件夹中显示</button>
                        <button id="decOpenPathBtn" class="primary-btn"><i class="bi bi-box-arrow-up-right"></i> 打开文件</button>
                    </div>
                </div>
            </div>
        `;
    }



    function loadFileHashView() {
        mainContent.innerHTML = `
            <h1><i class="bi bi-hash"></i> 文件哈希/校验</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-file-earmark-zip"></i> 选择文件或文件夹:</label>
                    <div id="hashDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击选择文件/文件夹 或 拖拽文件/文件夹到此</div>
                            <span id="hashSelectedPathName" class="selected-file-name"></span>
                        </div>
                    </div>
                    <button id="selectHashFolderBtn" class="secondary-btn" style="margin-top: 10px;"><i class="bi bi-folder2-open"></i> 选择文件夹</button>
                </div>

                <div class="form-group">
                    <label for="hashAlgorithm"><i class="bi bi-calculator"></i> 哈希算法:</label>
                    <select id="hashAlgorithm">
                        <option value="md5">MD5</option>
                        <option value="sha1">SHA-1</option>
                        <option value="sha256" selected>SHA-256 (推荐)</option>
                        <option value="sha512">SHA-512</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="expectedHashInput"><i class="bi bi-patch-check"></i> 期望哈希值 (用于校验):</label>
                    <input type="text" id="expectedHashInput" placeholder="输入期望的哈希值进行校验">
                </div>

                <div class="button-group">
                    <button id="calculateHashBtn"><i class="bi bi-play-circle"></i> 计算哈希</button>
                </div>

                <div id="hashSpinnerContainer" class="spinner-container" style="display: none; margin-top: 24px;">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <span class="spinner-text">正在计算哈希...</span>
                </div>

                <div id="hashResultContainer" class="conversion-result" style="display: none;">
                    <!-- 动态加载哈希结果 -->
                </div>



                <div id="verificationResult" class="verification-result" style="display: none; margin-top: 15px;">
                    <span id="verificationMessage"></span>
                </div>
            </div>
        `;
    }

    function bindEncryptionEvents() {
        const keyOptionRadios = document.querySelectorAll('input[name="keyOption"]');
        const keyFileGroup = document.getElementById('keyFileGroup');
        const generateKeyGroup = document.getElementById('generateKeyGroup');
        const passwordKeyGroup = document.getElementById('passwordKeyGroup');
        const passwordKeyInput = document.getElementById('passwordKeyInput');
        let encFilePath = null;

        keyOptionRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'file') {
                    keyFileGroup.style.display = 'block';
                    generateKeyGroup.style.display = 'none';
                    passwordKeyGroup.style.display = 'none';
                } else if (radio.value === 'generate') {
                    keyFileGroup.style.display = 'none';
                    generateKeyGroup.style.display = 'block';
                    passwordKeyGroup.style.display = 'none';
                } else {
                    keyFileGroup.style.display = 'none';
                    generateKeyGroup.style.display = 'none';
                    passwordKeyGroup.style.display = 'block';
                }
            });
        });

        const encDropZone = document.getElementById('encDropZone');
        const encSelectedFileName = document.getElementById('encSelectedFileName');
        const applyPendingEncryptionFile = () => {
            const pendingPath = document.body.dataset.pendingEncryptionFilePath;
            if (!pendingPath) {
                return;
            }
            const pendingName = document.body.dataset.pendingEncryptionFileName || extractFileName(pendingPath);
            encFilePath = pendingPath;
            encSelectedFileName.textContent = `✓ 已选择: ${pendingName}`;
            delete document.body.dataset.pendingEncryptionFilePath;
            delete document.body.dataset.pendingEncryptionFileName;
        };

        encDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                encFilePath = result.filePath;
                encSelectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });

        const selectFolderBtn = document.getElementById('selectFolderBtn');
        selectFolderBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openDirectory']);
            if (result.success) {
                encFilePath = result.filePath;
                encSelectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });

        encDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            encDropZone.classList.add('dragover');
        });

        encDropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            encDropZone.classList.remove('dragover');
        });

        encDropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            encDropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                try {
                    const filePath = window.electronAPI.getFilePath(file);
                    if (filePath) {
                        encFilePath = filePath;
                        encSelectedFileName.textContent = `✓ 已选择: ${file.name}`;
                    } else {
                        showToast('无法获取文件路径', 'error');
                    }
                } catch (error) {
                    showToast(`处理拖拽文件失败: ${error.message}`, 'error');
                }
            }
        });

        const selectKeyFileBtn = document.getElementById('selectKeyFileBtn');
        const keyFilePathInput = document.getElementById('keyFilePath');

        selectKeyFileBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                keyFilePathInput.value = result.filePath;
            }
        });

        const startEncryptionBtn = document.getElementById('startEncryption');
        startEncryptionBtn.addEventListener('click', async () => {
            const encResultContainer = document.getElementById('encResultContainer');
            encResultContainer.style.display = 'none';
            showEncryptionSpinner(true); // 显示加载器

            if (!encFilePath) {
                showToast('请先选择要加密的文件或文件夹', 'error');
                showEncryptionSpinner(false); // 隐藏加载器
                return;
            }
            const algorithm = document.getElementById('encAlgorithm').value;
            const keyOption = document.querySelector('input[name="keyOption"]:checked').value;
            const keyFilePath = keyFilePathInput.value;
            const password = passwordKeyInput ? passwordKeyInput.value : '';
            if (keyOption === 'file' && !keyFilePath) {
                showToast('请选择密钥文件', 'error');
                showEncryptionSpinner(false); // 隐藏加载器
                return;
            }
            if (keyOption === 'password' && !password) {
                showToast('请输入加密密码', 'error');
                showEncryptionSpinner(false); // 隐藏加载器
                return;
            }
            showToast('正在加密...', 'info');
            try {
                const result = await window.electronAPI.encryptFile({ 
                    filePath: encFilePath, 
                    algorithm, 
                    keyOption, 
                    keyFilePath,
                    password
                });
                if (result.success) {
                    showToast(`加密成功！文件保存在: ${result.outputPath}`, 'success');
                    // 显示结果框
                    const fileInfo = await window.electronAPI.getFileInfo(result.outputPath);
                    const resultContainer = document.getElementById('encResultContainer');
                    if (resultContainer && fileInfo) {
                        resultContainer.innerHTML = `
                            <div class="conversion-success-card">
                                <div class="success-header">
                                    <i class="bi bi-check-circle-fill"></i>
                                    <span>加密完成</span>
                                </div>
                                <div class="result-info" id="encResultFileInfo">
                                    <div class="meta-item"><i class="bi bi-file-earmark-check"></i><span class="meta-label">文件名:</span> ${result.outputPath.split(/[\\/]/).pop()}</div>
                                    <div class="meta-item"><i class="bi bi-folder"></i><span class="meta-label">大小:</span> ${fileInfo.size}</div>
                                </div>
                                <div class="result-actions">
                                    <button id="encShowInFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 在文件夹中显示</button>
                                    <button id="encOpenPathBtn" class="modal-btn modal-btn-primary"><i class="bi bi-box-arrow-up-right"></i> 打开文件</button>
                                </div>
                            </div>
                        `;
                        resultContainer.style.display = 'block';

                        document.getElementById('encShowInFolderBtn').addEventListener('click', () => {
                            window.electronAPI.showItemInFolder(result.outputPath);
                        });
                        document.getElementById('encOpenPathBtn').addEventListener('click', () => {
                            window.electronAPI.openPath(result.outputPath);
                        });
                    }
                } else {
                    showToast(`加密失败: ${result.message}`, 'error');
                }
            } catch (error) {
                showToast(`加密过程中发生错误: ${error.message}`, 'error');
            } finally {
                showEncryptionSpinner(false); // 隐藏加载器
            }
        });

        applyPendingEncryptionFile();
    }

    function bindDecryptionEvents() {
        let decFilePath = null;
        const decDropZone = document.getElementById('decDropZone');
        const decSelectedFileName = document.getElementById('decSelectedFileName');
        const decKeyOptionRadios = document.querySelectorAll('input[name="decKeyOption"]');
        const decKeyFileGroup = document.getElementById('decKeyFileGroup');
        const decPasswordKeyGroup = document.getElementById('decPasswordKeyGroup');
        const decPasswordKeyInput = document.getElementById('decPasswordKeyInput');
        const applyPendingDecryptionFile = () => {
            const pendingPath = document.body.dataset.pendingDecryptionFilePath;
            if (!pendingPath) {
                return;
            }
            const pendingName = document.body.dataset.pendingDecryptionFileName || extractFileName(pendingPath);
            decFilePath = pendingPath;
            decSelectedFileName.textContent = `✓ 已选择: ${pendingName}`;
            delete document.body.dataset.pendingDecryptionFilePath;
            delete document.body.dataset.pendingDecryptionFileName;
        };

        decDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                decFilePath = result.filePath;
                decSelectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });

        decDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            decDropZone.classList.add('dragover');
        });

        decDropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            decDropZone.classList.remove('dragover');
        });

        decDropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            decDropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                try {
                    const filePath = window.electronAPI.getFilePath(file);
                    if (filePath) {
                        decFilePath = filePath;
                        decSelectedFileName.textContent = `✓ 已选择: ${file.name}`;
                    } else {
                        showToast('无法获取文件路径', 'error');
                    }
                } catch (error) {
                    showToast(`处理拖拽文件失败: ${error.message}`, 'error');
                }
            }
        });

        const selectKeyFileBtn = document.getElementById('selectKeyFileBtn');
        const keyFilePathInput = document.getElementById('keyFilePath');
        decKeyOptionRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'password') {
                    decKeyFileGroup.style.display = 'none';
                    decPasswordKeyGroup.style.display = 'block';
                } else {
                    decKeyFileGroup.style.display = 'block';
                    decPasswordKeyGroup.style.display = 'none';
                }
            });
        });

        selectKeyFileBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                keyFilePathInput.value = result.filePath;
            }
        });

        const startDecryptionBtn = document.getElementById('startDecryption');
        startDecryptionBtn.addEventListener('click', async () => {
            const decResultContainer = document.getElementById('decResultContainer');
            decResultContainer.style.display = 'none';
            showDecryptionSpinner(true); // 显示加载器

            if (!decFilePath) {
                showToast('请先选择要解密的文件', 'error');
                showDecryptionSpinner(false); // 隐藏加载器
                return;
            }
            const algorithm = document.getElementById('decAlgorithm').value;
            const keyOption = document.querySelector('input[name="decKeyOption"]:checked').value;
            const keyFilePath = keyFilePathInput.value;
            const password = decPasswordKeyInput ? decPasswordKeyInput.value : '';
            if (keyOption === 'file' && !keyFilePath) {
                showToast('请选择密钥文件', 'error');
                showDecryptionSpinner(false); // 隐藏加载器
                return;
            }
            if (keyOption === 'password' && !password) {
                showToast('请输入解密密码', 'error');
                showDecryptionSpinner(false); // 隐藏加载器
                return;
            }
            showToast('正在解密...', 'info');
            try {
                const result = await window.electronAPI.decryptFile({ 
                    filePath: decFilePath, 
                    algorithm, 
                    keyOption,
                    keyFilePath,
                    password
                });
                if (result.success) {
                    showToast(`解密成功！文件保存在: ${result.outputPath}`, 'success');
                    // 显示结果框
                    const fileInfo = await window.electronAPI.getFileInfo(result.outputPath);
                    const resultContainer = document.getElementById('decResultContainer');
                    if (resultContainer && fileInfo) {
                        resultContainer.innerHTML = `
                            <div class="conversion-success-card">
                                <div class="success-header">
                                    <i class="bi bi-check-circle-fill"></i>
                                    <span>解密完成</span>
                                </div>
                                <div class="result-info" id="decResultFileInfo">
                                    <div class="meta-item"><i class="bi bi-file-earmark-check"></i><span class="meta-label">文件名:</span> ${result.outputPath.split(/[\\/]/).pop()}</div>
                                    <div class="meta-item"><i class="bi bi-folder"></i><span class="meta-label">大小:</span> ${fileInfo.size}</div>
                                </div>
                                <div class="result-actions">
                                    <button id="decShowInFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 在文件夹中显示</button>
                                    <button id="decOpenPathBtn" class="modal-btn modal-btn-primary"><i class="bi bi-box-arrow-up-right"></i> 打开文件</button>
                                </div>
                            </div>
                        `;
                        resultContainer.style.display = 'block';

                        document.getElementById('decShowInFolderBtn').addEventListener('click', () => {
                            window.electronAPI.showItemInFolder(result.outputPath);
                        });
                        document.getElementById('decOpenPathBtn').addEventListener('click', () => {
                            window.electronAPI.openPath(result.outputPath);
                        });
                    }
                } else {
                    showToast(`解密失败: ${result.message}`, 'error');
                }
            } catch (error) {
                showToast(`解密过程中发生错误: ${error.message}`, 'error');
            } finally {
                showDecryptionSpinner(false); // 隐藏加载器
            }
        });

        applyPendingDecryptionFile();
    }

    function bindFileHashEvents() {
        let hashSelectedPath = null; // To store the currently selected file/folder path

        const hashDropZone = document.getElementById('hashDropZone');
        const hashSelectedPathName = document.getElementById('hashSelectedPathName');
        const selectHashFolderBtn = document.getElementById('selectHashFolderBtn');
        const calculateHashBtn = document.getElementById('calculateHashBtn');
        const hashAlgorithmSelect = document.getElementById('hashAlgorithm');
        const hashSpinnerContainer = document.getElementById('hashSpinnerContainer');
        const hashResultContainer = document.getElementById('hashResultContainer');
        const hashResultPath = document.getElementById('hashResultPath');
        const hashResultAlgorithm = document.getElementById('hashResultAlgorithm');
        const calculatedHashValue = document.getElementById('calculatedHashValue');
        const copyHashBtn = document.getElementById('copyHashBtn');
        const expectedHashInput = document.getElementById('expectedHashInput');
        const verificationResult = document.getElementById('verificationResult');
        const verificationMessage = document.getElementById('verificationMessage');

        // Helper to show/hide spinner
        function showHashSpinner(show) {
            if (hashSpinnerContainer) {
                hashSpinnerContainer.style.display = show ? 'flex' : 'none';
            }
        }

        // Reset UI for new calculation
        function resetHashUI() {
            hashResultContainer.style.display = 'none';
            verificationResult.style.display = 'none';
            verificationMessage.textContent = '';
        }

        // 1. File/Folder selection via click on drop zone
        hashDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                hashSelectedPath = result.filePath;
                hashSelectedPathName.textContent = `✓ 已选择: ${result.fileName}`;
                resetHashUI();
            } else {
                showToast('文件/文件夹选择已取消', 'info');
            }
        });

        // 2. Folder selection via button
        selectHashFolderBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openDirectory']);
            if (result.success) {
                hashSelectedPath = result.filePath;
                hashSelectedPathName.textContent = `✓ 已选择: ${result.fileName}`;
                resetHashUI();
            } else {
                showToast('文件夹选择已取消', 'info');
            }
        });

        // 3. Drag-and-drop events
        hashDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hashDropZone.classList.add('dragover');
        });

        hashDropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hashDropZone.classList.remove('dragover');
        });

        hashDropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            hashDropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                try {
                    const filePath = window.electronAPI.getFilePath(file);
                    if (filePath) {
                        hashSelectedPath = filePath;
                        hashSelectedPathName.textContent = `✓ 已选择: ${file.name}`;
                        resetHashUI();
                    } else {
                        showToast('无法获取文件路径', 'error');
                    }
                } catch (error) {
                    showToast(`处理拖拽文件失败: ${error.message}`, 'error');
                }
            }
        });

        // 4. Calculate Hash button click
        calculateHashBtn.addEventListener('click', async () => {
            if (!hashSelectedPath) {
                showToast('请先选择文件或文件夹', 'error');
                return;
            }
            const algorithm = hashAlgorithmSelect.value;
            resetHashUI();
            showHashSpinner(true);
            showToast('正在计算哈希...', 'info');

            try {
                const result = await window.electronAPI.calculateHash(hashSelectedPath, algorithm);
                if (result.success) {
                    const calculatedHash = result.hash;
                    const expectedHash = expectedHashInput.value.trim();

                    let resultTitle = '哈希计算完成！';
                    let headerIconClass = 'bi-check-circle-fill';
                    let headerClass = 'success-header';
                    let cardClass = 'conversion-success-card';

                    if (expectedHash) {
                        const match = calculatedHash.toLowerCase() === expectedHash.toLowerCase();
                        if (match) {
                            resultTitle = '哈希值匹配！';
                        } else {
                            resultTitle = '哈希值不匹配！';
                            headerIconClass = 'bi-x-circle-fill';
                            headerClass = 'error-header';
                            cardClass = 'conversion-error-card';
                        }
                    }

                    hashResultContainer.innerHTML = `
                        <div class="${cardClass}">
                            <div class="${headerClass}">
                                <i class="${headerIconClass}"></i>
                                <span>${resultTitle}</span>
                            </div>
                            <div class="result-info">
                                <div class="meta-item"><span class="meta-label">文件/文件夹:</span> <span id="hashResultPath">${hashSelectedPath.split(/[\\/]/).pop()}</span></div>
                                <div class="meta-item"><span class="meta-label">算法:</span> <span id="hashResultAlgorithm">${algorithm.toUpperCase()}</span></div>
                                <div class="meta-item"><span class="meta-label">哈希值:</span> <span id="calculatedHashValue" style="word-break: break-all;">${calculatedHash}</span></div>
                            </div>
                            <div class="result-actions">
                                <button id="copyHashBtn" class="secondary-btn"><i class="bi bi-clipboard"></i> 复制哈希值</button>
                            </div>
                        </div>
                    `;
                    hashResultContainer.style.display = 'block';

                    // 重新绑定复制按钮事件
                    document.getElementById('copyHashBtn').addEventListener('click', () => {
                        navigator.clipboard.writeText(calculatedHash).then(() => {
                            showToast('哈希值已复制到剪贴板', 'success');
                        }).catch(err => {
                            showToast(`复制失败: ${err.message}`, 'error');
                        });
                    });

                    showToast('哈希计算完成！', 'success');

                } else {
                    showToast(`哈希计算失败: ${result.message}`, 'error');
                }
            } catch (error) {
                showToast(`哈希计算过程中发生错误: ${error.message}`, 'error');
            } finally {
                showHashSpinner(false);
            }
        });

        // 5. Copy Hash button click
        copyHashBtn.addEventListener('click', () => {
            const hash = calculatedHashValue.textContent;
            if (hash) {
                navigator.clipboard.writeText(hash).then(() => {
                    showToast('哈希值已复制到剪贴板', 'success');
                }).catch(err => {
                    showToast(`复制失败: ${err.message}`, 'error');
                });
            } else {
                showToast('没有可复制的哈希值', 'info');
            }
        });


    }

    function isBatchSupportedCategory(category) {
        return ['images', 'videos', 'audio', 'documents'].includes(category);
    }

    function normalizeBatchFilePath(file) {
        if (typeof file === 'string') {
            return file;
        }
        if (file && typeof file === 'object' && typeof file.filePath === 'string' && file.filePath) {
            return file.filePath;
        }
        return window.electronAPI.getFilePath(file);
    }

    function getBatchValidationResult(category, fileName, fileSize, filePath) {
        const sourceName = fileName || (filePath ? filePath.split(/[\\/]/).pop() : '');
        if (!isCompatibleWithCategory(sourceName, category)) {
            return { valid: false, reason: '文件格式不支持' };
        }
        if (category === 'images' && Number.isFinite(fileSize) && fileSize > maxImageFileSizeBytes) {
            return { valid: false, reason: '文件过大（超过 50MB）' };
        }
        return { valid: true };
    }

    async function validateAndCollectBatchFiles(inputItems, category) {
        const valid = [];
        const invalid = [];
        const uniquePathMap = new Map();

        for (const item of inputItems) {
            const isFileLike = typeof item === 'object' && item !== null;
            const sourcePath = normalizeBatchFilePath(item);
            const sourceName = isFileLike ? (item.name || item.fileName) : sourcePath.split(/[\\/]/).pop();
            const sourceSize = isFileLike && Number.isFinite(item.size) ? item.size : null;

            if (!sourcePath) {
                invalid.push({ name: sourceName || '未知文件', reason: '无法读取文件路径' });
                continue;
            }

            const key = sourcePath.toLowerCase();
            if (uniquePathMap.has(key)) {
                continue;
            }

            const validation = getBatchValidationResult(category, sourceName, sourceSize, sourcePath);
            if (!validation.valid) {
                invalid.push({ name: sourceName || '未知文件', reason: validation.reason });
                continue;
            }

            uniquePathMap.set(key, {
                filePath: sourcePath,
                fileName: sourceName || sourcePath.split(/[\\/]/).pop()
            });
        }

        valid.push(...uniquePathMap.values());
        return { valid, invalid };
    }

    function renderBatchSelectionUI(category) {
        const selectedFileName = document.getElementById('selectedFileName');
        const listContainer = document.getElementById('batchSelectedList');
        if (!selectedFileName || !listContainer) return;

        if (selectedBatchFiles.length === 0) {
            selectedFileName.textContent = '';
            listContainer.style.display = 'none';
            listContainer.innerHTML = '';
            return;
        }

        const categoryName = categoryNameMap[category] || '文件';
        selectedFileName.textContent = `✓ 已选择 ${selectedBatchFiles.length} 个${categoryName}文件`;
        const previewItems = selectedBatchFiles.slice(0, 12).map(file => `
            <div class="batch-selected-item">
                <span class="batch-file-name">${file.fileName}</span>
            </div>
        `).join('');
        const moreText = selectedBatchFiles.length > 12 ? `<div class="batch-selected-more">... 另有 ${selectedBatchFiles.length - 12} 个文件</div>` : '';

        listContainer.innerHTML = `
            <div class="batch-selected-header">待转换文件列表</div>
            <div class="batch-selected-items">${previewItems}</div>
            ${moreText}
        `;
        listContainer.style.display = 'block';
    }

    function updateBatchProgressUI({ percent, completed, total, currentFileName, failedCount = 0 }) {
        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressStats = document.getElementById('batchProgressStats');
        const progressCurrent = document.getElementById('batchCurrentFile');
        if (!progressContainer || !progressBar || !progressText) return;

        progressContainer.style.display = 'block';
        progressBar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
        progressText.textContent = `${Math.max(0, Math.min(100, percent || 0))}%`;

        if (progressStats) {
            progressStats.textContent = `${completed || 0}/${total || 0} 已完成，失败 ${failedCount}`;
        }
        if (progressCurrent) {
            progressCurrent.textContent = currentFileName ? `当前处理: ${currentFileName}` : '等待开始...';
        }
    }

    function renderBatchResult(container, summary) {
        const successful = summary.successful || [];
        const failed = summary.failed || [];
        const successItems = successful.map(item => `<div class="meta-item"><i class="bi bi-check-circle"></i>${item.outputPath.split(/[\\/]/).pop()}</div>`).join('');
        const failedItems = failed.map(item => `<div class="meta-item batch-failed-item"><i class="bi bi-x-circle"></i>${item.fileName || item.sourcePath.split(/[\\/]/).pop()} - ${item.message}</div>`).join('');

        container.innerHTML = `
            <div class="${failed.length > 0 ? 'conversion-error-card' : 'conversion-success-card'}">
                <div class="${failed.length > 0 ? 'error-header' : 'success-header'}">
                    <i class="bi ${failed.length > 0 ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill'}"></i>
                    <span>批量转换完成</span>
                </div>
                <div class="result-info">
                    <div class="meta-item"><span class="meta-label">成功:</span> ${successful.length}</div>
                    <div class="meta-item"><span class="meta-label">失败:</span> ${failed.length}</div>
                    <div class="meta-item"><span class="meta-label">总数:</span> ${summary.total || (successful.length + failed.length)}</div>
                </div>
                <div class="batch-result-list">
                    ${successItems || '<div class="meta-item">暂无成功文件</div>'}
                    ${failedItems}
                </div>
                <div class="result-actions batch-result-actions">
                    <button id="batchOpenFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 打开所在文件夹</button>
                    ${failed.length > 0 ? '<button id="batchRetryFailedBtn" class="modal-btn modal-btn-primary"><i class="bi bi-arrow-repeat"></i> 重试失败文件</button>' : ''}
                </div>
            </div>
        `;
        container.style.display = 'block';

        const folderBtn = document.getElementById('batchOpenFolderBtn');
        const retryBtn = document.getElementById('batchRetryFailedBtn');

        if (folderBtn) {
            folderBtn.onclick = () => {
                if (batchState.outputDirectory) {
                    window.electronAPI.openPath(batchState.outputDirectory);
                }
            };
        }

        if (retryBtn) {
            retryBtn.onclick = async () => {
                selectedBatchFiles = failed.map(item => ({
                    filePath: item.sourcePath,
                    fileName: item.fileName || item.sourcePath.split(/[\\/]/).pop()
                }));
                batchState.failed = [];
                renderBatchSelectionUI(currentCategory);
                selectedFilePath = selectedBatchFiles[0] ? selectedBatchFiles[0].filePath : null;
                showToast(`已重新装载 ${selectedBatchFiles.length} 个失败文件`, 'info');
            };
        }
    }

    async function startBatchConversion(category, targetFormat, options, startButton) {
        if (selectedBatchFiles.length === 0) {
            showToast('请先选择至少一个文件', 'error');
            return;
        }

        const outputResult = await window.electronAPI.selectOutputDirectory();
        if (!outputResult.success || !outputResult.directoryPath) {
            showToast('未选择输出目录，已取消转换', 'info');
            return;
        }

        batchState = {
            active: true,
            batchId: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            failed: [],
            successful: [],
            outputDirectory: outputResult.directoryPath,
            currentFileName: '',
            completed: 0,
            total: selectedBatchFiles.length
        };

        const progressActions = document.getElementById('batchProgressActions');
        if (progressActions) {
            progressActions.style.display = 'flex';
        }

        if (startButton) {
            startButton.style.display = 'none';
        }

        updateBatchProgressUI({
            percent: 0,
            completed: 0,
            total: selectedBatchFiles.length,
            currentFileName: '等待开始...',
            failedCount: 0
        });

        showToast('批量转换已开始', 'info', 3500);
        const batchResult = await window.electronAPI.batchConvertImages({
            batchId: batchState.batchId,
            files: selectedBatchFiles.map(item => item.filePath),
            targetFormat,
            category,
            options,
            outputDirectory: outputResult.directoryPath,
            concurrency: 3
        });

        batchState.active = false;
        if (progressActions) {
            progressActions.style.display = 'none';
        }
        if (startButton) {
            startButton.style.display = 'block';
        }

        const resultContainer = document.getElementById('conversionResult');
        if (!resultContainer) return;

        if (batchResult.cancelled) {
            showToast('批量转换已取消', 'info');
            const progressCurrent = document.getElementById('batchCurrentFile');
            if (progressCurrent) {
                progressCurrent.textContent = '已取消';
            }
            return;
        }

        if (!batchResult.success && batchResult.message) {
            showToast(`批量转换失败: ${batchResult.message}`, 'error');
            return;
        }

        renderBatchResult(resultContainer, {
            total: batchResult.total,
            successful: batchState.successful,
            failed: batchState.failed
        });
    }

    // 加载内容到主容器
    function loadContent(category) {
        if (category === 'settings') {
            loadSettings();
            return;
        }
        if (category === 'encryption') {
            loadEncryptionView();
            bindEncryptionEvents();
            return;
        }
        if (category === 'decryption') {
            loadDecryptionView();
            bindDecryptionEvents();
            return;
        }
        if (category === 'hash') {
            loadFileHashView();
            bindFileHashEvents();
            return;
        }
        //selectedFilePath = null; // 重置文件选择
        const categoryName = categoryNameMap[category] || category;
        const formats = formatMap[category] || [];
        
        let formatOptions = formats.map(format => `<option value="${format}">${format}</option>`).join('');
        const originalFormatOption = supportsOriginalFormatSelection(category)
            ? `<option value="${ORIGINAL_FORMAT_VALUE}">原格式</option>`
            : '';
        
        mainContent.innerHTML = `
            <h1>${categoryName} 转换</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-cloud-upload"></i> 选择或拖拽文件:</label>
                    <div id="dropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">${isBatchSupportedCategory(category) ? '点击多选文件或拖拽多个文件到此' : '点击选择或拖拽文件到此'}</div>
                            <span id="selectedFileName" class="selected-file-name"></span>
                            <div id="batchSelectedList" class="batch-selected-list" style="display:none;"></div>
                            <div id="filePreviewInfo" class="file-preview-info"></div>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label for="targetFormat"><i class="bi bi-bullseye"></i> 目标格式:</label>
                    <select id="targetFormat">
                        <option value="">-- 请选择目标格式 --</option>
                        ${originalFormatOption}
                        ${formatOptions}
                    </select>
                </div>
                <div class="form-group" id="icoOptions" style="display:none;">
                    <label><i class="bi bi-aspect-ratio"></i> ICO 分辨率（单选）:</label>
                    <div>
                        <label><input type="radio" name="icoSize" value="16"> 16×16</label>
                        <label><input type="radio" name="icoSize" value="32"> 32×32</label>
                        <label><input type="radio" name="icoSize" value="48"> 48×48</label>
                        <label><input type="radio" name="icoSize" value="64"> 64×64</label>
                        <label><input type="radio" name="icoSize" value="128"> 128×128</label>
                        <label><input type="radio" name="icoSize" value="256" checked> 256×256</label>
                    </div>
                    <div style="margin-top:6px;color:#666;font-size:13px;"><i class="bi bi-info-circle" style="margin-right:4px;"></i>请选择生成的 ICO 图标尺寸。</div>
                </div>

                <div id="imageAdvancedSettings" class="advanced-settings" style="display:none;">
                    <div class="advanced-header" id="advancedToggle">
                        <span><i class="bi bi-gear-fill"></i> 高级设置 (可选)</span>
                        <i class="bi bi-chevron-down toggle-icon"></i>
                    </div>
                    <div class="advanced-content" id="advancedContent">
                        <!-- 图片高级设置 -->
                        <div id="imageSettingsFields" style="display:none;">
                            <div class="settings-grid">
                                <div class="setting-item">
                                    <label>分辨率 (宽 × 高)</label>
                                    <div class="input-row">
                                        <input type="number" id="imgWidth" placeholder="宽" min="1">
                                        <span>×</span>
                                        <input type="number" id="imgHeight" placeholder="高" min="1">
                                        <button class="lock-btn active" id="aspectLock" title="锁定长宽比">
                                            <i class="bi bi-link-45deg"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="setting-item" id="qualitySettingItem">
                                    <label>输出质量 (0-100)</label>
                                    <div class="range-input-group">
                                        <input type="range" id="imgQuality" min="1" max="100" value="100">
                                        <span class="range-value" id="qualityValue">100</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 视频高级设置 -->
                        <div id="videoSettingsFields" style="display:none;">
                            <div class="settings-grid">
                                <div class="setting-item">
                                    <label>视频分辨率</label>
                                    <select id="videoRes">
                                        <option value="">保持原样</option>
                                        <option value="1920:1080">1080p (1920×1080)</option>
                                        <option value="1280:720">720p (1280×720)</option>
                                        <option value="854:480">480p (854×480)</option>
                                        <option value="640:360">360p (640×360)</option>
                                    </select>
                                </div>
                                <div class="setting-item">
                                    <label>视频预设 (速度 vs 体积)</label>
                                    <select id="videoPreset">
                                        <option value="medium">Medium (默认)</option>
                                        <option value="ultrafast">Ultrafast (最快)</option>
                                        <option value="veryfast">Veryfast</option>
                                        <option value="fast">Fast</option>
                                        <option value="slow">Slow (更小体积)</option>
                                        <option value="veryslow">Veryslow (最小体积)</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div id="privacySettingsField" style="display:none;">
                            <div class="settings-grid">
                                <div class="setting-item">
                                    <label style="display:flex;align-items:center;gap:8px;">
                                        <input type="checkbox" id="privacySanitize">
                                        <span>隐私脱敏（清除元数据）</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <!-- 音频高级设置 -->
                        <div id="audioSettingsFields" style="display:none;">
                            <div class="settings-grid">
                                <div class="setting-item">
                                    <label>音频码率</label>
                                    <select id="audioBitrate">
                                        <option value="">保持原样</option>
                                        <option value="320k">320kbps (极高)</option>
                                        <option value="256k">256kbps (高)</option>
                                        <option value="192k">192kbps (标准)</option>
                                        <option value="128k">128kbps (中)</option>
                                        <option value="64k">64kbps (低)</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <button id="startConversion"><i class="bi bi-play-circle" style="margin-right:6px;"></i>开始转换</button>
                
                <div id="progressContainer" style="display: none; margin-top: 24px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; color: var(--text-secondary);">
                        <span>转换进度</span>
                        <span id="progressText">0%</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div id="progressBar" class="progress-bar-fill"></div>
                    </div>
                    <div id="batchProgressStats" class="batch-progress-meta"></div>
                    <div id="batchCurrentFile" class="batch-progress-current"></div>
                    <div id="batchProgressActions" class="batch-progress-actions" style="display:none;">
                        <button id="cancelBatchBtn" class="secondary-btn"><i class="bi bi-x-circle"></i> 取消转换</button>
                    </div>
                </div>
                <div id="conversionResult" style="display: none;"></div>
            </div>
        `;
        
        // 重新获取新添加的元素并添加事件监听器
        const dropZone = document.getElementById('dropZone');
        const selectedFileName = document.getElementById('selectedFileName');
        const newStartButton = document.getElementById('startConversion');
        const targetFormatSelect = document.getElementById('targetFormat');
        const icoOptions = document.getElementById('icoOptions');
        const imageAdvanced = document.getElementById('imageAdvancedSettings');

        if (category === 'images' || category === 'videos' || category === 'audio') {
            imageAdvanced.style.display = 'block';
            
            // 根据分类显示不同的字段
            document.getElementById('imageSettingsFields').style.display = category === 'images' ? 'block' : 'none';
            document.getElementById('videoSettingsFields').style.display = category === 'videos' ? 'block' : 'none';
            document.getElementById('audioSettingsFields').style.display = category === 'audio' ? 'block' : 'none';
            document.getElementById('privacySettingsField').style.display = (category === 'images' || category === 'videos') ? 'block' : 'none';

            const toggle = document.getElementById('advancedToggle');
            const content = document.getElementById('advancedContent');
            const icon = toggle.querySelector('.toggle-icon');
            
            toggle.addEventListener('click', () => {
                content.classList.toggle('show');
                icon.classList.toggle('bi-chevron-up');
                icon.classList.toggle('bi-chevron-down');
            });

            // 质量滑块
            const qualityInput = document.getElementById('imgQuality');
            const qualityValue = document.getElementById('qualityValue');
            qualityInput.addEventListener('input', (e) => {
                qualityValue.textContent = e.target.value;
            });

            // 长宽比锁定逻辑
            const widthInput = document.getElementById('imgWidth');
            const heightInput = document.getElementById('imgHeight');
            const lockBtn = document.getElementById('aspectLock');
            let aspectRatio = 0;

            const updateRatio = () => {
                if (widthInput.value && heightInput.value) {
                    aspectRatio = widthInput.value / heightInput.value;
                }
            };

            widthInput.addEventListener('input', () => {
                if (lockBtn.classList.contains('active') && aspectRatio > 0) {
                    heightInput.value = Math.round(widthInput.value / aspectRatio);
                } else {
                    updateRatio();
                }
            });

            heightInput.addEventListener('input', () => {
                if (lockBtn.classList.contains('active') && aspectRatio > 0) {
                    widthInput.value = Math.round(heightInput.value * aspectRatio);
                } else {
                    updateRatio();
                }
            });

            lockBtn.addEventListener('click', () => {
                lockBtn.classList.toggle('active');
                if (lockBtn.classList.contains('active')) {
                    updateRatio();
                }
            });
        }

        const pendingPath = document.body.dataset.pendingFilePath;
        const pendingName = document.body.dataset.pendingFileName;
        if (pendingPath && pendingName) {
            if (isBatchSupportedCategory(category)) {
                selectedBatchFiles = [{ filePath: pendingPath, fileName: pendingName }];
                selectedFilePath = pendingPath;
                renderBatchSelectionUI(category);
                updateTargetFormats(category, pendingPath);
            } else {
                selectedFilePath = pendingPath;
                selectedFileName.textContent = `✓ 已选择: ${pendingName}`;
                updateTargetFormats(category, pendingPath);
            }
            delete document.body.dataset.pendingFilePath;
            delete document.body.dataset.pendingFileName;
        }

        if (isBatchSupportedCategory(category) && !(pendingPath && pendingName)) {
            selectedBatchFiles = [];
            renderBatchSelectionUI(category);
            selectedFilePath = null;
        }

        dropZone.addEventListener('click', async () => {
            if (isBatchSupportedCategory(category)) {
                const result = await window.electronAPI.selectImageFiles();
                if (!result.success || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
                    showToast('文件选择已取消', 'info');
                    return;
                }

                const pickedItems = result.filePaths.map((filePath, index) => ({
                    filePath,
                    fileName: result.fileNames[index],
                    size: Array.isArray(result.fileSizes) ? result.fileSizes[index] : null
                }));
                const checked = await validateAndCollectBatchFiles(pickedItems, category);
                selectedBatchFiles = checked.valid;
                selectedFilePath = selectedBatchFiles[0] ? selectedBatchFiles[0].filePath : null;
                renderBatchSelectionUI(category);

                if (checked.valid.length > 0) {
                    const first = checked.valid[0];
                    updateTargetFormats(category, category === 'documents' && checked.valid.length > 1 ? null : first.filePath);
                    updateFilePreview(first.filePath);
                }
                if (checked.invalid.length > 0) {
                    showToast(`已过滤 ${checked.invalid.length} 个无效文件`, 'info');
                }
                return;
            }

            const result = await window.electronAPI.selectFile(category);
            if (result.filePath) {
                const switched = await handleFileSelection(result, category, sidebarButtons);
                if (!switched) {
                    selectedFilePath = result.filePath;
                    selectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                    dropZone.classList.remove('dragover');
                    updateFilePreview(result.filePath);
                    updateTargetFormats(category, result.filePath);

                    if (category === 'images') {
                        const dims = await window.electronAPI.getImageDimensions(result.filePath);
                        if (dims) {
                            const wInput = document.getElementById('imgWidth');
                            const hInput = document.getElementById('imgHeight');
                            if (wInput && hInput) {
                                wInput.value = dims.width;
                                hInput.value = dims.height;
                                wInput.dispatchEvent(new Event('input'));
                            }
                        }
                    }
                } else {
                    selectedFilePath = result.filePath;
                }
            } else {
                showToast('文件选择已取消', 'info');
            }
        });

        // 拖拽事件处理
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                showToast('正在处理拖拽文件...', 'info', 3000);
                
                try {
                    if (isBatchSupportedCategory(category)) {
                        const dropped = Array.from(files);
                        const checked = await validateAndCollectBatchFiles(dropped, category);
                        selectedBatchFiles = checked.valid;
                        selectedFilePath = selectedBatchFiles[0] ? selectedBatchFiles[0].filePath : null;
                        renderBatchSelectionUI(category);

                        if (checked.valid.length > 0) {
                            updateTargetFormats(category, category === 'documents' && checked.valid.length > 1 ? null : checked.valid[0].filePath);
                            updateFilePreview(checked.valid[0].filePath);
                        }
                        if (checked.invalid.length > 0) {
                            const invalidName = checked.invalid.slice(0, 3).map(item => `${item.name}(${item.reason})`).join('、');
                            showToast(`已过滤 ${checked.invalid.length} 个无效文件: ${invalidName}`, 'info', 6000);
                        }
                        return;
                    }

                    const file = files[0];
                    const filePath = window.electronAPI.getFilePath(file);
                    if (filePath) {
                        const result = { filePath: filePath, fileName: file.name };
                        selectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                        selectedFilePath = result.filePath;
                        updateTargetFormats(currentCategory, result.filePath);

                        const switched = await handleFileSelection(result, currentCategory, sidebarButtons);
                        if (!switched) {
                            showToast('无法自动识别分类，请从侧边栏选择合适的分类。', 'info', 4000);
                        }
                    } else {
                        showToast('无法获取文件路径', 'error');
                    }
                } catch (error) {
                    console.error('拖拽文件处理全过程错误:', error);
                    showToast(`处理拖拽文件失败: ${error.message}`, 'error', 5000);
                }
            }
        });
        
        const cancelBatchBtn = document.getElementById('cancelBatchBtn');
        if (cancelBatchBtn) {
            cancelBatchBtn.addEventListener('click', async () => {
                if (!batchState.active || !batchState.batchId) {
                    return;
                }
                const cancelResult = await window.electronAPI.cancelBatchConversion(batchState.batchId);
                if (cancelResult.success) {
                    showToast('正在取消批量转换...', 'info');
                } else {
                    showToast(`取消失败: ${cancelResult.message}`, 'error');
                }
            });
        }

        newStartButton.addEventListener('click', async () => {
            if (!isBatchSupportedCategory(category) && ((!selectedFilePath) || (!selectedFileName.textContent))) {
                if (!selectedFileName.textContent) {
                    showToast('请先选择一个文件', 'error');
                    selectedFilePath = null;
                    selectedFileName.textContent = '';
                    return;
                }
            }
            if (!targetFormatSelect.value) {
                showToast('请先选择目标格式', 'error');
                return;
            }
            const targetFormat = targetFormatSelect.value;
            let options = {};

            // 收集图片高级选项
            if (category === 'images') {
                const width = document.getElementById('imgWidth').value;
                const height = document.getElementById('imgHeight').value;
                const quality = document.getElementById('imgQuality').value;
                const privacySanitize = document.getElementById('privacySanitize');
                
                if (width) options.width = parseInt(width, 10);
                if (height) options.height = parseInt(height, 10);
                options.quality = parseInt(quality, 10);
                options.privacySanitize = !!(privacySanitize && privacySanitize.checked);
            }

            // 收集视频高级选项
            if (category === 'videos') {
                const res = document.getElementById('videoRes').value;
                const preset = document.getElementById('videoPreset').value;
                const privacySanitize = document.getElementById('privacySanitize');
                if (res) options.videoRes = res;
                if (preset) options.videoPreset = preset;
                options.privacySanitize = !!(privacySanitize && privacySanitize.checked);
            }

            // 收集音频高级选项
            if (category === 'audio') {
                const bitrate = document.getElementById('audioBitrate').value;
                if (bitrate) options.audioBitrate = bitrate;
            }

            // 收集 ICO 选项（单选）
            if (category === 'images' && targetFormat.toLowerCase() === 'ico') {
                const selected = icoOptions.querySelector('input[name="icoSize"]:checked');
                if (selected) {
                    options.icoSizes = [parseInt(selected.value, 10)];
                }
            }

            if (isBatchSupportedCategory(category) && selectedBatchFiles.length > 1) {
                const resultContainer = document.getElementById('conversionResult');
                if (resultContainer) {
                    resultContainer.style.display = 'none';
                    resultContainer.innerHTML = '';
                }
                await startBatchConversion(category, targetFormat, options, newStartButton);
                return;
            }

            if (isBatchSupportedCategory(category)) {
                if (selectedBatchFiles.length === 0) {
                    showToast('请先选择至少一个文件', 'error');
                    return;
                }
                selectedFilePath = selectedBatchFiles[0].filePath;
            }

            showToast('正在转换文件，请稍候...', 'info', 999999);
            
            // 重置并显示进度条
            currentProgress = 0;
            updateProgressBar(0);
            
            // 启动假进度条定时器
            if (progressTimer) clearInterval(progressTimer);
            
            // 隐藏开始转换按钮
            newStartButton.style.display = 'none';
            
            progressTimer = setInterval(() => {
                // 30%到95%之间进行假进度模拟
                if (currentProgress >= 30 && currentProgress < 95) {
                    currentProgress += 2;
                    updateProgressBar(currentProgress);
                }
            }, 300); // 每300ms增加1%

            convertFile(selectedFilePath, category, targetFormat, options, newStartButton);
        });

        // 显示/隐藏 ICO 分辨率选项及高级设置
        targetFormatSelect.addEventListener('change', (e) => {
            const selectedFormat = e.target.value;
            const referencePath = isBatchSupportedCategory(category) && selectedBatchFiles[0]
                ? selectedBatchFiles[0].filePath
                : selectedFilePath;
            const format = selectedFormat === ORIGINAL_FORMAT_VALUE
                ? getFileExtension(referencePath)
                : selectedFormat.toLowerCase();
            const isIco = format === 'ico';
            const supportsImgQuality = ['jpg', 'jpeg'].includes(format);
            const supportsAudioBitrate = ['mp3', 'aac', 'm4a', 'ogg', 'wma'].includes(format);
            
            if (category === 'images') {
                if (isIco) {
                    icoOptions.style.display = 'block';
                    imageAdvanced.style.display = 'none';
                } else {
                    icoOptions.style.display = 'none';
                    imageAdvanced.style.display = 'block';
                    
                    // 根据格式显示或隐藏质量设置
                    const qualityItem = document.getElementById('qualitySettingItem');
                    if (qualityItem) {
                        qualityItem.style.display = supportsImgQuality ? 'flex' : 'none';
                    }
                }
            }

            if (category === 'audio') {
                const audioBitrateItem = document.getElementById('audioSettingsFields');
                if (audioBitrateItem) {
                    audioBitrateItem.style.display = supportsAudioBitrate ? 'block' : 'none';
                }
            }
        });
    }

    // 文件转换功能
    function convertFile(filePath, category, targetFormat, options = {}, startButton) {
        console.log(`开始进行 ${categoryNameMap[category]} 转换: ${filePath} -> ${targetFormat}`, options);
        
        // 调用主进程的转换函数
        window.electronAPI.convertFile(filePath, targetFormat, category, options)
            .then(async result => {
                // 移除正在转换的 toast
                const toasts = document.querySelectorAll('.toast.info');
                toasts.forEach(t => t.remove());

                // 清除定时器并设置进度为100%
                if (progressTimer) clearInterval(progressTimer);
                updateProgressBar(100);
                
                // 延迟后隐藏进度条
                setTimeout(() => {
                    const progressContainer = document.getElementById('progressContainer');
                    if (progressContainer) progressContainer.style.display = 'none';
                    // 重新显示开始转换按钮
                    if (startButton) startButton.style.display = 'block';
                }, 2000);

                if (result.success) {
                    let msg = '转换成功！';
                    if (result.extra && result.extra.icoSizes) {
                        const sizes = result.extra.icoSizes.map(s => `${s.width}×${s.height}`).join(', ');
                        msg += `\n📦 包含尺寸: ${sizes}`;
                    }
                    showToast(msg, 'success', 5000);

                    // 如果开启了自动打开文件夹
                    if (Settings.get('openFolder', false)) {
                        window.electronAPI.showItemInFolder(result.outputPath);
                    }

                    // 如果开启了自动打开文件
                    if (Settings.get('openFile', false)) {
                        window.electronAPI.openPath(result.outputPath);
                    }

                    // 获取转换后的文件详情
                    const fileInfo = await window.electronAPI.getFileInfo(result.outputPath);
                    const resultContainer = document.getElementById('conversionResult');
                    
                    if (resultContainer && fileInfo) {
                        resultContainer.innerHTML = `
                            <div class="conversion-success-card">
                                <div class="success-header">
                                    <i class="bi bi-check-circle-fill"></i>
                                    <span>转换完成</span>
                                </div>
                                <div class="result-info" id="resultFileInfo">
                                    <div class="meta-item"><i class="bi bi-file-earmark-check"></i><span class="meta-label">文件名:</span> ${result.outputPath.split(/[\\/]/).pop()}</div>
                                    <div class="meta-item"><i class="bi bi-hdd"></i><span class="meta-label">大小:</span> ${fileInfo.size}</div>
                                    ${fileInfo.res ? `<div class="meta-item"><i class="bi bi-aspect-ratio"></i><span class="meta-label">分辨率:</span> ${fileInfo.res}</div>` : ''}
                                    ${fileInfo.duration ? `<div class="meta-item"><i class="bi bi-clock"></i><span class="meta-label">时长:</span> ${fileInfo.duration}</div>` : ''}
                                </div>
                                <div class="result-actions">
                                    <span class="action-link" id="openFolderAction"><i class="bi bi-folder2-open"></i>打开所在文件夹</span>
                                    <span class="action-link" id="openFileAction"><i class="bi bi-box-arrow-up-right"></i>打开文件</span>
                                </div>
                            </div>
                        `;
                        resultContainer.style.display = 'block';

                        // 绑定右键菜单
                        document.getElementById('resultFileInfo').oncontextmenu = (e) => {
                            e.preventDefault();
                            window.electronAPI.showContextMenu(result.outputPath);
                        };

                        // 绑定快捷操作
                        document.getElementById('openFolderAction').onclick = () => {
                             window.electronAPI.showItemInFolder(result.outputPath);
                        };
                        document.getElementById('openFileAction').onclick = () => {
                             window.electronAPI.openPath(result.outputPath);
                        };
                    }
                } else {
                    showToast(`转换失败: ${result.message}`, 'error', 5000);
                }
            })
            .catch(error => {
                // 移除正在转换的 toast
                const toasts = document.querySelectorAll('.toast.info');
                toasts.forEach(t => t.remove());
                
                if (progressTimer) clearInterval(progressTimer);
                const progressContainer = document.getElementById('progressContainer');
                if (progressContainer) progressContainer.style.display = 'none';
                
                // 转换失败也需要重新显示按钮
                if (startButton) startButton.style.display = 'block';

                showToast(`错误: ${error.message}`, 'error', 5000);
            });
    }
});
