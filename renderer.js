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

// 根据源文件更新目标格式列表
function updateTargetFormats(category, sourceFilePath) {
    const targetSelect = document.getElementById('targetFormat');
    if (!targetSelect) return;

    const sourceExt = sourceFilePath ? sourceFilePath.split('.').pop().toLowerCase() : null;
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

    // 过滤掉与源文件相同的格式
    const filteredFormats = availableFormats.filter(f => f.toLowerCase() !== sourceExt);

    // 更新下拉菜单
    const currentSelection = targetSelect.value;
    targetSelect.innerHTML = `
        <option value="">-- 请选择目标格式 --</option>
        ${filteredFormats.map(f => `<option value="${f}">${f}</option>`).join('')}
    `;

    // 如果之前的选择在新的列表中仍然有效，则保持选择
    if (filteredFormats.includes(currentSelection)) {
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

    function updateProgressBar(value) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressContainer = document.getElementById('progressContainer');
        
        if (progressBar && progressText && progressContainer) {
            progressContainer.style.display = 'block';
            progressBar.style.width = `${value}%`;
            progressText.textContent = `${value}%`;
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

    // 侧边栏按钮点击事件
    sidebarButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const category = event.target.getAttribute('data-category');
            currentCategory = category;
            
            // 移除所有按钮的active类
            sidebarButtons.forEach(btn => btn.classList.remove('active'));
            // 给选中的按钮添加active类
            event.target.classList.add('active');
            
            loadContent(category);
        });
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
                        <div class="version-tag">Version 1.2.0</div>
                        <div class="setting-label">文件格式转换器</div>
                        <div class="setting-description" style="margin-top:12px;">
                            一个基于 Electron 和 FFmpeg 的轻量级开源转换工具。<br>
                            旨在提供极致简洁、高效的多媒体处理体验。
                        </div>
                        <div style="margin-top:20px;">
                            <a class="action-link" href="https://github.com/leowmx1/FormatTransformer" style="justify-content:center;"><i class="bi bi-github"></i> 检查更新</a>
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
            <h1><i class="bi bi-shield-lock"></i> 文件加密</h1>
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
                        <option value="chacha20-poly1305">ChaCha20-Poly1305</option>
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="bi bi-key"></i> 密钥选项:</label>
                    <div class="radio-group">
                        <label><input type="radio" name="keyOption" value="file" checked> 使用密钥文件</label>
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

                <div class="button-group">
                    <button id="startEncryption"><i class="bi bi-play-circle"></i> 开始加密</button>
                </div>
            </div>
        `;
    }

    function loadDecryptionView() {
        mainContent.innerHTML = `
            <h1><i class="bi bi-shield-unlock"></i> 文件解密</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-file-earmark-zip"></i> 选择要解密的 .enc 或 .dir.enc 文件:</label>
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
                        <option value="chacha20-poly1305">ChaCha20-Poly1305</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="keyFilePath"><i class="bi bi-file-earmark-lock"></i> 选择密钥文件:</label>
                    <div class="file-input-container">
                        <input type="text" id="keyFilePath" placeholder="点击选择密钥文件" readonly>
                        <button id="selectKeyFileBtn">选择</button>
                    </div>
                </div>

                <div class="button-group">
                    <button id="startDecryption"><i class="bi bi-unlock"></i> 开始解密</button>
                </div>
            </div>
        `;
    }

    function bindEncryptionEvents() {
        const keyOptionRadios = document.querySelectorAll('input[name="keyOption"]');
        const keyFileGroup = document.getElementById('keyFileGroup');
        const generateKeyGroup = document.getElementById('generateKeyGroup');
        let encFilePath = null;

        keyOptionRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'file') {
                    keyFileGroup.style.display = 'block';
                    generateKeyGroup.style.display = 'none';
                } else {
                    keyFileGroup.style.display = 'none';
                    generateKeyGroup.style.display = 'block';
                }
            });
        });

        const encDropZone = document.getElementById('encDropZone');
        const encSelectedFileName = document.getElementById('encSelectedFileName');

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
            if (!encFilePath) {
                showToast('请先选择要加密的文件或文件夹', 'error');
                return;
            }
            const algorithm = document.getElementById('encAlgorithm').value;
            const keyOption = document.querySelector('input[name="keyOption"]:checked').value;
            const keyFilePath = keyFilePathInput.value;
            if (keyOption === 'file' && !keyFilePath) {
                showToast('请选择密钥文件', 'error');
                return;
            }
            showToast('正在加密...', 'info');
            const result = await window.electronAPI.encryptFile({ 
                filePath: encFilePath, 
                algorithm, 
                keyOption, 
                keyFilePath
            });
            if (result.success) {
                showToast(`加密成功！文件保存在: ${result.outputPath}`, 'success');
            } else {
                showToast(`加密失败: ${result.message}`, 'error');
            }
        });
    }

    function bindDecryptionEvents() {
        let decFilePath = null;
        const decDropZone = document.getElementById('decDropZone');
        const decSelectedFileName = document.getElementById('decSelectedFileName');

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

        selectKeyFileBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                keyFilePathInput.value = result.filePath;
            }
        });

        const startDecryptionBtn = document.getElementById('startDecryption');
        startDecryptionBtn.addEventListener('click', async () => {
            if (!decFilePath) {
                showToast('请先选择要解密的文件', 'error');
                return;
            }
            const algorithm = document.getElementById('decAlgorithm').value;
            const keyFilePath = keyFilePathInput.value;
            if (!keyFilePath) {
                showToast('请选择密钥文件', 'error');
                return;
            }
            showToast('正在解密...', 'info');
            const result = await window.electronAPI.decryptFile({ 
                filePath: decFilePath, 
                algorithm, 
                keyFilePath 
            });
            if (result.success) {
                showToast(`解密成功！文件保存在: ${result.outputPath}`, 'success');
            } else {
                showToast(`解密失败: ${result.message}`, 'error');
            }
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
        //selectedFilePath = null; // 重置文件选择
        const categoryName = categoryNameMap[category] || category;
        const formats = formatMap[category] || [];
        
        let formatOptions = formats.map(format => `<option value="${format}">${format}</option>`).join('');
        
        mainContent.innerHTML = `
            <h1>${categoryName} 转换</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-cloud-upload"></i> 选择或拖拽文件:</label>
                    <div id="dropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击选择或拖拽文件到此</div>
                            <span id="selectedFileName" class="selected-file-name"></span>
                            <div id="filePreviewInfo" class="file-preview-info"></div>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label for="targetFormat"><i class="bi bi-bullseye"></i> 目标格式:</label>
                    <select id="targetFormat">
                        <option value="">-- 请选择目标格式 --</option>
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
            selectedFilePath = pendingPath; // 更新外层状态变量
            selectedFileName.textContent = `✓ 已选择: ${pendingName}`;
            
            // 更新目标格式列表
            updateTargetFormats(category, pendingPath);
            
            // 清除暂存的数据，避免影响后续操作
            delete document.body.dataset.pendingFilePath;
            delete document.body.dataset.pendingFileName;
        }
        // 点击选择文件
        dropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectFile(category);
            if (result.filePath) {
                // 检查是否需要自动切换分类
                const switched = await handleFileSelection(result, category, sidebarButtons);
                if (!switched) {
                    // 如果没有切换分类，直接设置文件
                    selectedFilePath = result.filePath;
                    selectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                    dropZone.classList.remove('dragover');
                    
                    // 更新预览详情
                    updateFilePreview(result.filePath);

                    // 更新目标格式列表
                    updateTargetFormats(category, result.filePath);

                    // 如果是图片分类，获取并设置原始尺寸
                    if (category === 'images') {
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
                } else {
                    // 如果切换了分类，在事件处理中已设置文件
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
                const file = files[0];
                showToast('正在处理拖拽文件...', 'info', 3000);
                
                try {
                // 获取文件真实路径，避免生成临时文件
                const filePath = window.electronAPI.getFilePath(file);
                
                if (filePath) {
                    const result = { filePath: filePath, fileName: file.name };
                    
                    // 3. 使用返回的文件路径进行后续操作
                    selectedFileName.textContent = `✓ 已选择: ${result.fileName}`;
                    selectedFilePath = result.filePath;
                    
                    // 更新目标格式列表
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
        
        // 点击开始转换按钮
        newStartButton.addEventListener('click', () => {
            if ((!selectedFilePath) || (!selectedFileName.textContent)) {
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
                
                if (width) options.width = parseInt(width, 10);
                if (height) options.height = parseInt(height, 10);
                options.quality = parseInt(quality, 10);
            }

            // 收集视频高级选项
            if (category === 'videos') {
                const res = document.getElementById('videoRes').value;
                const preset = document.getElementById('videoPreset').value;
                if (res) options.videoRes = res;
                if (preset) options.videoPreset = preset;
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
            const format = e.target.value.toLowerCase();
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
