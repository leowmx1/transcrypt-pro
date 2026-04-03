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

function showOperationResultPage({ title, subtitle = '', contentHtml = '', status = 'success', actionBindings = [] }) {
    const overlay = document.createElement('div');
    overlay.className = 'result-page-overlay';
    const statusIcon = status === 'error' ? 'bi-x-circle-fill' : 'bi-check-circle-fill';
    const statusClass = status === 'error' ? 'is-error' : 'is-success';
    overlay.innerHTML = `
        <div class="result-page-shell ${statusClass}">
            <div class="result-page-header">
                <div class="result-page-title-wrap">
                    <div class="result-page-icon"><i class="bi ${statusIcon}"></i></div>
                    <div>
                        <div class="result-page-title">${title}</div>
                        <div class="result-page-subtitle">${subtitle}</div>
                    </div>
                </div>
                <button class="result-page-close" id="resultPageCloseBtn"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="result-page-body">
                <div class="result-page-content" id="resultPageContent">${contentHtml}</div>
            </div>
            <div class="result-page-footer">
                <button class="modal-btn modal-btn-secondary" id="resultPageBackBtn">返回</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.offsetHeight;
    overlay.classList.add('show');

    const closeOverlay = () => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 240);
    };

    const contentRoot = overlay.querySelector('#resultPageContent');
    actionBindings.forEach(binding => {
        const target = contentRoot.querySelector(binding.selector);
        if (target && typeof binding.handler === 'function') {
            target.addEventListener(binding.event || 'click', binding.handler);
        }
    });

    overlay.querySelector('#resultPageCloseBtn').onclick = closeOverlay;
    overlay.querySelector('#resultPageBackBtn').onclick = closeOverlay;
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeOverlay();
        }
    };
}

function ensureUnifiedRuntimeStyles() {
    if (document.getElementById('unifiedRuntimeStyles')) {
        return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = 'unifiedRuntimeStyles';
    styleEl.textContent = `
        .unified-file-title{flex-wrap:wrap}
        .unified-file-title .unified-title-text{word-break:break-all}
        .profile-grid-inline{display:inline-flex;margin-bottom:0}
        .unified-group-file-list{margin-bottom:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
        .unified-group-file-item{font-size:12px;color:var(--text-main);padding:7px 9px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);display:flex;align-items:center;justify-content:space-between;gap:8px}
        .unified-group-file-name{flex:1;min-width:0;word-break:break-all}
        .unified-group-file-remove{border:none;background:transparent;color:var(--text-secondary);padding:2px 4px;line-height:1;cursor:pointer;border-radius:6px}
        .unified-group-file-remove:hover{color:var(--error-color);background:rgba(239,68,68,.1)}
        .unified-group-file-more{margin-top:6px;font-size:12px;color:var(--text-secondary)}
        .unified-form-row select{width:100%;padding:12px 16px;border:1px solid var(--border-color);border-radius:var(--radius-md);font-size:14px;background-color:var(--input-bg);color:var(--text-main);cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px;transition:all .3s cubic-bezier(.4,0,.2,1);outline:none;box-shadow:var(--shadow-sm)}
        .unified-form-row select:hover{border-color:var(--primary-color);background-color:var(--input-hover-bg);box-shadow:var(--shadow-md)}
        .unified-form-row select:focus{border-color:var(--primary-color);box-shadow:0 0 0 3px var(--primary-light)}
        .unified-start-btn{width:100%;padding:14px;border:none;border-radius:12px;color:#fff;font-size:16px;font-weight:700;background:linear-gradient(135deg,#2563eb,#3b82f6 45%,#60a5fa);box-shadow:0 12px 20px -12px rgba(37,99,235,.8);cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,filter .2s ease}
        .unified-start-btn:hover{transform:translateY(-1px);box-shadow:0 18px 22px -14px rgba(37,99,235,.9);filter:brightness(1.03)}
        .unified-start-btn:disabled{cursor:not-allowed;transform:none;box-shadow:none;filter:grayscale(.15)}
        .unified-progress-page{max-width:1180px;margin:0 auto;border:1px solid var(--border-color);border-radius:16px;background:var(--card-bg);padding:22px;box-shadow:var(--shadow-md)}
        .unified-progress-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}
        .unified-progress-head h1{margin-bottom:6px;font-size:30px}
        .unified-progress-head p{margin:0;color:var(--text-secondary)}
        .unified-progress-actions{display:flex;gap:10px;flex-wrap:wrap}
        .unified-progress-overview{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
        .unified-progress-bar{height:14px;margin-bottom:18px}
        .unified-progress-content{display:grid;grid-template-columns:1fr;gap:16px}
        .unified-progress-groups{border:1px solid var(--border-color);border-radius:12px;background:var(--surface-color);padding:12px}
        .unified-progress-groups h3{margin:0 0 10px 0;font-size:16px}
        .progress-group-card{border:1px solid var(--border-color);border-radius:10px;padding:10px;margin-bottom:10px;background:var(--input-bg)}
        .progress-group-card.is-success{border-color:rgba(16,185,129,.4)}
        .progress-group-card.is-warning{border-color:rgba(245,158,11,.55)}
        .progress-group-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;font-weight:600}
        .progress-group-meta{margin-top:6px;font-size:12px;color:var(--text-secondary);display:flex;gap:12px}
        .progress-group-files{margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
        .progress-group-file-item{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--border-color);border-radius:9px;padding:8px 10px;background:#fff0}
        .progress-group-file-item.status-running{border-color:rgba(59,130,246,.45)}
        .progress-group-file-item.status-success{border-color:rgba(16,185,129,.45)}
        .progress-group-file-item.status-failed{border-color:rgba(239,68,68,.45)}
        .progress-group-file-item.status-pending{border-color:rgba(148,163,184,.45)}
        .progress-group-file-name{font-size:12px;color:var(--text-main);word-break:break-all}
        .progress-status-icon{font-size:14px}
        .progress-status-icon.status-running{color:var(--primary-color);animation:unifiedSpin 1.1s linear infinite}
        .progress-status-icon.status-success{color:var(--success-color)}
        .progress-status-icon.status-failed{color:var(--error-color)}
        .progress-status-icon.status-pending{color:var(--text-secondary)}
        @keyframes unifiedSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @media (max-width:980px){.unified-group-file-list{grid-template-columns:1fr}.progress-group-files{grid-template-columns:1fr}}
        @media (max-width:640px){.unified-progress-head{flex-direction:column}}
    `;
    document.head.appendChild(styleEl);
}

function ensureHomeRuntimeStyles() {
    if (document.getElementById('homeRuntimeStyles')) {
        return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = 'homeRuntimeStyles';
    styleEl.textContent = `
        .home-page{max-width:1160px;margin-inline:auto;display:grid;gap:16px}
        .home-hero{background:var(--card-bg);border:1px solid var(--border-color);border-radius:18px;padding:20px;box-shadow:var(--shadow-md)}
        .home-hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
        .home-title{margin:0;font-size:30px;line-height:1.2;color:var(--text-main)}
        .home-subtitle{margin:8px 0 0 0;color:var(--text-secondary)}
        .home-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:var(--primary-light);color:var(--primary-color);font-weight:600;font-size:13px}
        .home-tip-strip{margin-top:14px;display:flex;align-items:center;gap:10px;border:1px solid var(--border-color);background:var(--surface-color);border-radius:12px;padding:11px 12px;min-height:48px}
        .home-tip-emoji{font-size:20px;line-height:1;flex-shrink:0}
        .home-tip-content{min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .home-tip-title{font-size:14px;color:var(--text-main);font-weight:700}
        .home-tip-desc{font-size:13px;color:var(--text-secondary)}
        .home-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px}
        .home-card{grid-column:span 4;background:var(--surface-color);border:1px solid var(--border-color);border-radius:16px;padding:16px;display:grid;gap:10px;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
        .home-card:hover{transform:translateY(-2px);border-color:var(--primary-color);box-shadow:var(--shadow-md)}
        .home-card-emoji{font-size:24px}
        .home-card-title{font-size:16px;font-weight:700;color:var(--text-main)}
        .home-card-desc{font-size:13px;color:var(--text-secondary)}
        .home-feature-btn{margin-top:2px;border:none;border-radius:10px;padding:10px 12px;background:linear-gradient(135deg,#2563eb,#3b82f6 45%,#60a5fa);color:#fff;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .2s ease}
        .home-feature-btn:hover{filter:brightness(1.04);transform:translateY(-1px)}
        .home-feature-btn:active{transform:scale(.98)}
        @media (max-width:1024px){.home-card{grid-column:span 6}}
        @media (max-width:680px){.home-hero{padding:16px}.home-hero-top{flex-direction:column}.home-title{font-size:24px}.home-tip-content{display:block}.home-tip-desc{display:block;margin-top:3px}.home-card{grid-column:span 12}}
    `;
    document.head.appendChild(styleEl);
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
    'home': '首页',
    'conversion': '文件转换',
    'images': '图片',
    'videos': '视频',
    'audio': '音频',
    'documents': '文档',
    'encryption': '文件加密',
    'decryption': '文件解密',
    'disguise': '文件伪装加密',
    'safebox': '虚拟加密磁盘',
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

const conversionCategoryIconMap = {
    images: 'bi-image',
    videos: 'bi-camera-video',
    audio: 'bi-music-note-beamed',
    documents: 'bi-file-earmark-text'
};

function getAvailableFormatsBySource(category, sourceExt, sourceCategory) {
    let availableFormats = formatMap[category] || [];
    if (category === 'documents' && sourceExt && formatCompatibilityMap[sourceExt]) {
        availableFormats = formatCompatibilityMap[sourceExt];
    }
    if (category === 'audio' && sourceCategory === 'videos') {
        availableFormats = formatMap.audio || [];
    }
    return supportsOriginalFormatSelection(category)
        ? availableFormats
        : availableFormats.filter(f => f.toLowerCase() !== sourceExt);
}

function getConversionProfilesForFile(filePath) {
    const sourceExt = getFileExtension(filePath);
    const detectedCategory = detectFileCategory(filePath);
    if (!detectedCategory || !['images', 'videos', 'audio', 'documents'].includes(detectedCategory)) {
        return [];
    }

    const categoryList = detectedCategory === 'videos'
        ? ['videos', 'audio']
        : [detectedCategory];

    return categoryList
        .map(category => {
            const formats = getAvailableFormatsBySource(category, sourceExt, detectedCategory);
            return {
                category,
                formats
            };
        })
        .filter(item => Array.isArray(item.formats) && item.formats.length > 0);
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
    let unifiedConversionFiles = [];
    let unifiedConversionLoading = false;
    let unifiedProgressState = {
        active: false,
        total: 0,
        completed: 0,
        successful: 0,
        failed: 0,
        groups: [],
        files: [],
        outputDirectory: ''
    };
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
    let operationLockCount = 0;
    let operationLockToastTime = 0;
    let homeCarouselTimer = null;

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

    function openTargetInSafebox(filePath, showSwitchToast = true) {
        if (!filePath || typeof filePath !== 'string') return;
        const normalizedPath = filePath.trim();
        if (!normalizedPath) return;

        document.body.dataset.pendingSafeboxFilePath = normalizedPath;
        document.body.dataset.pendingSafeboxFileName = extractFileName(normalizedPath);

        const safeboxButton = Array.from(sidebarButtons).find(
            btn => btn.getAttribute('data-category') === 'safebox'
        );
        if (!safeboxButton) return;

        if (showSwitchToast && currentCategory !== 'safebox') {
            showToast('已检测到 Safebox 文件，正在跳转到虚拟磁盘页面', 'info', 3000);
        }
        safeboxButton.click();
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
        const profiles = getConversionProfilesForFile(fileName);
        if (profiles.length === 0) {
            showToast('无法识别文件格式或暂无可用转换方案', 'info', 4000);
            return;
        }
        document.body.dataset.pendingConversionFiles = JSON.stringify([{
            filePath: normalizedPath,
            fileName
        }]);
        const targetButton = Array.from(sidebarButtons).find(
            btn => btn.getAttribute('data-category') === 'conversion'
        );
        if (!targetButton) {
            return;
        }
        if (showSwitchToast && currentCategory !== 'conversion') {
            showToast('已识别文件类型，正在跳转到转换中心', 'info', 3000);
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
            return;
        }
        if (action === 'safebox-open') {
            openTargetInSafebox(targetPath, showSwitchToast);
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

    function isOperationLocked() {
        return operationLockCount > 0;
    }

    function setOperationSidebarLock(locked) {
        document.body.classList.toggle('operation-sidebar-locked', locked);
    }

    function setOperationButtonState(button, busy, labelText) {
        if (!button) {
            return;
        }
        if (!button.dataset.originalHtml) {
            button.dataset.originalHtml = button.innerHTML;
        }
        if (busy) {
            button.disabled = true;
            button.classList.add('is-busy');
            button.innerHTML = `
                <span class="busy-button-content">
                    <span>${labelText}</span>
                    <span class="loading-dots"><span></span><span></span><span></span></span>
                </span>
            `;
            return;
        }
        button.disabled = false;
        button.classList.remove('is-busy');
        button.innerHTML = button.dataset.originalHtml;
    }

    function setOperationBusy(button, busy, labelText) {
        if (busy) {
            operationLockCount += 1;
            setOperationSidebarLock(true);
            setOperationButtonState(button, true, labelText);
            return;
        }
        operationLockCount = Math.max(0, operationLockCount - 1);
        if (operationLockCount === 0) {
            setOperationSidebarLock(false);
        }
        setOperationButtonState(button, false);
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

        applyUnifiedProgressPayload(payload);

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
            if (isOperationLocked()) {
                const now = Date.now();
                if (now - operationLockToastTime > 1800) {
                    showToast('任务进行中，已锁定侧边栏，请等待当前操作完成', 'info', 2600);
                    operationLockToastTime = now;
                }
                return;
            }
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

    const initialActiveButton = document.querySelector('.sidebar-button.active') || sidebarButtons[0];
    if (initialActiveButton) {
        const category = initialActiveButton.getAttribute('data-category');
        currentCategory = category;
        loadContent(category);
    }

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
                        <option value="xchacha20-poly1305">XChaCha20-Poly1305</option>
                    </select>
                </div>

                <div class="form-group">
                    <label><i class="bi bi-file-earmark-play"></i> 输出类型:</label>
                    <div class="radio-group">
                        <label><input type="radio" name="outputOption" value="tclock" checked> 生成 .tclock 文件</label>
                        <label><input type="radio" name="outputOption" value="exe"> 生成自解密 exe</label>
                    </div>
                    <div class="setting-description">自解密 exe 模式仅支持密码输入（不需要密钥文件 .tckey）。</div>
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
                        <option value="xchacha20-poly1305">XChaCha20-Poly1305</option>
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

    function loadDisguiseView() {
        mainContent.innerHTML = `
            <h1><i class="bi bi-file-earmark-lock2"></i> 文件伪装加密</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-file-lock"></i> 选择要被加密的文件/文件夹:</label>
                    <div id="disguiseSourceDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击选择文件 或 拖拽文件/文件夹到此</div>
                            <span id="disguiseSourceSelectedName" class="selected-file-name"></span>
                        </div>
                    </div>
                    <button id="selectDisguiseSourceFolderBtn" class="secondary-btn" style="margin-top: 10px;"><i class="bi bi-folder2-open"></i> 选择文件夹</button>
                </div>
                <div class="form-group">
                    <label><i class="bi bi-file-earmark"></i> 选择载体文件:</label>
                    <div id="disguiseCarrierDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击选择文件 或 拖拽载体文件到此</div>
                            <span id="disguiseCarrierSelectedName" class="selected-file-name"></span>
                        </div>
                    </div>
                    <div class="setting-description">若选择文件夹，会先自动压缩后再伪装加密；密钥随机生成并存于尾部，解密自动提取。</div>
                </div>
                <div class="button-group">
                    <button id="startDisguiseEncryption" class="primary-btn"><i class="bi bi-play-circle"></i> 开始伪装加密</button>
                </div>
                <hr style="margin: 24px 0;">
                <div class="form-group">
                    <label><i class="bi bi-file-earmark-zip"></i> 选择要解密的伪装文件:</label>
                    <div id="disguiseEncryptedDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-arrow-down"></i></div>
                            <div class="drop-zone-text">点击选择文件 或 拖拽伪装文件到此</div>
                            <span id="disguiseEncryptedSelectedName" class="selected-file-name"></span>
                        </div>
                    </div>
                </div>
                <div class="button-group">
                    <button id="startDisguiseDecryption" class="primary-btn"><i class="bi bi-play-circle"></i> 开始自动解密</button>
                </div>
            </div>
        `;
    }

    function loadSafeboxView() {
        mainContent.innerHTML = `
            <h1><i class="bi bi-hdd-lock"></i> 虚拟加密磁盘</h1>
            <div class="operation-container">
                <div class="form-group">
                    <label><i class="bi bi-hdd"></i> 打开 .tcsafebox 为虚拟磁盘:</label>
                    <div id="safeboxFileDropZone" class="drop-zone">
                        <div class="drop-zone-content">
                            <div class="drop-zone-icon"><i class="bi bi-file-earmark-zip"></i></div>
                            <div class="drop-zone-text">点击选择 .tcsafebox 或拖拽到此</div>
                            <span id="safeboxFileSelectedName" class="selected-file-name"></span>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label><i class="bi bi-key"></i> 挂载解锁方式:</label>
                    <div class="radio-group">
                        <label><input type="radio" name="safeboxMountKeyOption" value="password" checked> 使用密码</label>
                        <label><input type="radio" name="safeboxMountKeyOption" value="file"> 使用密钥文件</label>
                    </div>
                </div>

                <div id="safeboxMountPasswordGroup" class="form-group">
                    <label for="safeboxMountPassword"><i class="bi bi-key"></i> 挂载密码:</label>
                    <input type="password" id="safeboxMountPassword" placeholder="输入密码解密并挂载">
                </div>

                <div id="safeboxMountKeyFileGroup" class="form-group" style="display: none;">
                    <label for="safeboxMountKeyFilePath"><i class="bi bi-file-earmark-lock"></i> 挂载密钥文件:</label>
                    <div class="file-input-container">
                        <input type="text" id="safeboxMountKeyFilePath" placeholder="点击选择密钥文件" readonly>
                        <button id="selectSafeboxMountKeyFileBtn">选择</button>
                    </div>
                </div>

                <div class="button-group">
                    <button id="startSafeboxMount"><i class="bi bi-eject"></i> 挂载虚拟磁盘</button>
                    <button id="startSafeboxUnmount" class="secondary-btn"><i class="bi bi-save2"></i> 弹出并回写加密</button>
                </div>

                <div id="safeboxSessionInfo" class="conversion-result" style="display: none; margin-top: 20px;"></div>

                <hr style="margin: 24px 0;">

                <div class="form-group">
                    <label><i class="bi bi-shield-lock"></i> 创建容器解锁方式:</label>
                    <div class="radio-group">
                        <label><input type="radio" name="safeboxCreateKeyOption" value="password" checked> 使用密码</label>
                        <label><input type="radio" name="safeboxCreateKeyOption" value="file"> 使用密钥文件</label>
                    </div>
                </div>

                <div id="safeboxCreatePasswordGroup" class="form-group">
                    <label for="safeboxCreatePassword"><i class="bi bi-shield-lock"></i> 创建容器密码（空容器）:</label>
                    <input type="password" id="safeboxCreatePassword" placeholder="用于创建 .tcsafebox 的密码">
                </div>

                <div id="safeboxCreateKeyFileGroup" class="form-group" style="display: none;">
                    <label for="safeboxCreateKeyFilePath"><i class="bi bi-file-earmark-lock"></i> 创建密钥文件:</label>
                    <div class="file-input-container">
                        <input type="text" id="safeboxCreateKeyFilePath" placeholder="点击选择密钥文件" readonly>
                        <button id="selectSafeboxCreateKeyFileBtn">选择</button>
                    </div>
                </div>

                <div class="button-group" style="margin-top: 0;">
                    <button id="startSafeboxCreate"><i class="bi bi-file-earmark-lock"></i> 一键生成空 .tcsafebox</button>
                </div>
            </div>
        `;
    }

    function bindDisguiseEvents() {
        let sourcePath = null;
        let carrierPath = null;
        let encryptedPath = null;

        const sourceDropZone = document.getElementById('disguiseSourceDropZone');
        const carrierDropZone = document.getElementById('disguiseCarrierDropZone');
        const encryptedDropZone = document.getElementById('disguiseEncryptedDropZone');
        const sourceSelectedName = document.getElementById('disguiseSourceSelectedName');
        const carrierSelectedName = document.getElementById('disguiseCarrierSelectedName');
        const encryptedSelectedName = document.getElementById('disguiseEncryptedSelectedName');
        const selectSourceFolderBtn = document.getElementById('selectDisguiseSourceFolderBtn');
        const encryptBtn = document.getElementById('startDisguiseEncryption');
        const decryptBtn = document.getElementById('startDisguiseDecryption');
        const validateCarrierAsFile = async (candidatePath) => {
            const info = await window.electronAPI.getFileInfo(candidatePath);
            if (!info) {
                showToast('载体仅支持文件，请勿选择文件夹', 'error');
                return false;
            }
            return true;
        };

        sourceDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                sourcePath = result.filePath;
                sourceSelectedName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });

        selectSourceFolderBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openDirectory']);
            if (result.success) {
                sourcePath = result.filePath;
                sourceSelectedName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });

        carrierDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                if (await validateCarrierAsFile(result.filePath)) {
                    carrierPath = result.filePath;
                    carrierSelectedName.textContent = `✓ 已选择: ${result.fileName}`;
                }
            }
        });

        encryptedDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                encryptedPath = result.filePath;
                encryptedSelectedName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });

        const bindDrop = (zone, onSelect) => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('dragover');
            });
            zone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
            });
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (!files || files.length === 0) return;
                const file = files[0];
                try {
                    const filePath = window.electronAPI.getFilePath(file);
                    if (!filePath) {
                        showToast('无法获取文件路径', 'error');
                        return;
                    }
                    onSelect(filePath, file.name);
                } catch (error) {
                    showToast(`处理拖拽文件失败: ${error.message}`, 'error');
                }
            });
        };

        bindDrop(sourceDropZone, (filePath, fileName) => {
            sourcePath = filePath;
            sourceSelectedName.textContent = `✓ 已选择: ${fileName}`;
        });
        bindDrop(carrierDropZone, (filePath, fileName) => {
            validateCarrierAsFile(filePath).then((ok) => {
                if (!ok) return;
                carrierPath = filePath;
                carrierSelectedName.textContent = `✓ 已选择: ${fileName}`;
            });
        });
        bindDrop(encryptedDropZone, (filePath, fileName) => {
            encryptedPath = filePath;
            encryptedSelectedName.textContent = `✓ 已选择: ${fileName}`;
        });

        encryptBtn.addEventListener('click', async () => {
            const sourceFilePath = sourcePath;
            const carrierFilePath = carrierPath;
            if (!sourceFilePath || !carrierFilePath) {
                showToast('请先选择被加密文件/文件夹和载体文件', 'error');
                return;
            }
            setOperationBusy(encryptBtn, true, '正在加密');
            try {
                const result = await window.electronAPI.disguiseEncryptFile({ sourceFilePath, carrierFilePath });
                if (!result.success) {
                    showToast(`伪装加密失败: ${result.message}`, 'error');
                    return;
                }
                showToast(`伪装加密成功：${result.outputPath}`, 'success');
                showOperationResultPage({
                    title: '伪装加密完成',
                    subtitle: result.outputPath.split(/[\\/]/).pop(),
                    status: 'success',
                    contentHtml: `
                        <div class="conversion-success-card">
                            <div class="success-header"><i class="bi bi-check-circle-fill"></i><span>伪装加密完成</span></div>
                            <div class="result-info"><div class="meta-item"><span class="meta-label">输出文件:</span> ${result.outputPath}</div></div>
                            <div class="result-actions">
                                <button id="dsgShowInFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 在文件夹中显示</button>
                                <button id="dsgOpenPathBtn" class="modal-btn modal-btn-primary"><i class="bi bi-box-arrow-up-right"></i> 打开文件</button>
                            </div>
                        </div>
                    `,
                    actionBindings: [
                        { selector: '#dsgShowInFolderBtn', handler: () => window.electronAPI.showItemInFolder(result.outputPath) },
                        { selector: '#dsgOpenPathBtn', handler: () => window.electronAPI.openPath(result.outputPath) }
                    ]
                });
            } catch (error) {
                showToast(`伪装加密异常: ${error.message}`, 'error');
            } finally {
                setOperationBusy(encryptBtn, false);
            }
        });

        decryptBtn.addEventListener('click', async () => {
            const disguisedFilePath = encryptedPath;
            if (!disguisedFilePath) {
                showToast('请先选择伪装加密文件', 'error');
                return;
            }
            setOperationBusy(decryptBtn, true, '正在解密');
            try {
                const result = await window.electronAPI.disguiseDecryptFile({ disguisedFilePath });
                if (!result.success) {
                    showToast(`自动解密失败: ${result.message}`, 'error');
                    return;
                }
                showToast(`自动解密成功：${result.outputPath}`, 'success');
                showOperationResultPage({
                    title: '自动解密完成',
                    subtitle: result.outputPath.split(/[\\/]/).pop(),
                    status: 'success',
                    contentHtml: `
                        <div class="conversion-success-card">
                            <div class="success-header"><i class="bi bi-check-circle-fill"></i><span>自动解密完成</span></div>
                            <div class="result-info"><div class="meta-item"><span class="meta-label">输出文件:</span> ${result.outputPath}</div></div>
                            <div class="result-actions">
                                <button id="dsgDecShowInFolderBtn" class="secondary-btn"><i class="bi bi-folder2-open"></i> 在文件夹中显示</button>
                                <button id="dsgDecOpenPathBtn" class="modal-btn modal-btn-primary"><i class="bi bi-box-arrow-up-right"></i> 打开文件</button>
                            </div>
                        </div>
                    `,
                    actionBindings: [
                        { selector: '#dsgDecShowInFolderBtn', handler: () => window.electronAPI.showItemInFolder(result.outputPath) },
                        { selector: '#dsgDecOpenPathBtn', handler: () => window.electronAPI.openPath(result.outputPath) }
                    ]
                });
            } catch (error) {
                showToast(`自动解密异常: ${error.message}`, 'error');
            } finally {
                setOperationBusy(decryptBtn, false);
            }
        });
    }

    function bindSafeboxEvents() {
        let safeboxFilePath = null;
        let mountedSessionId = null;
        let mountedDrivePath = null;
        let mountKeyFilePath = null;
        let createKeyFilePath = null;

        const createPasswordInput = document.getElementById('safeboxCreatePassword');
        const mountPasswordInput = document.getElementById('safeboxMountPassword');
        const mountPasswordGroup = document.getElementById('safeboxMountPasswordGroup');
        const mountKeyFileGroup = document.getElementById('safeboxMountKeyFileGroup');
        const createPasswordGroup = document.getElementById('safeboxCreatePasswordGroup');
        const createKeyFileGroup = document.getElementById('safeboxCreateKeyFileGroup');
        const mountKeyFilePathInput = document.getElementById('safeboxMountKeyFilePath');
        const createKeyFilePathInput = document.getElementById('safeboxCreateKeyFilePath');
        const selectMountKeyFileBtn = document.getElementById('selectSafeboxMountKeyFileBtn');
        const selectCreateKeyFileBtn = document.getElementById('selectSafeboxCreateKeyFileBtn');
        const mountKeyOptionInputs = Array.from(document.querySelectorAll('input[name="safeboxMountKeyOption"]'));
        const createKeyOptionInputs = Array.from(document.querySelectorAll('input[name="safeboxCreateKeyOption"]'));
        const safeboxFileDropZone = document.getElementById('safeboxFileDropZone');
        const safeboxFileSelectedName = document.getElementById('safeboxFileSelectedName');
        const sessionInfo = document.getElementById('safeboxSessionInfo');
        const createBtn = document.getElementById('startSafeboxCreate');
        const mountBtn = document.getElementById('startSafeboxMount');
        const unmountBtn = document.getElementById('startSafeboxUnmount');

        const getSelectedMountKeyOption = () => {
            const selected = mountKeyOptionInputs.find((input) => input.checked);
            return selected ? selected.value : 'password';
        };

        const getSelectedCreateKeyOption = () => {
            const selected = createKeyOptionInputs.find((input) => input.checked);
            return selected ? selected.value : 'password';
        };

        const syncMountKeyOptionUI = () => {
            const useFile = getSelectedMountKeyOption() === 'file';
            mountPasswordGroup.style.display = useFile ? 'none' : '';
            mountKeyFileGroup.style.display = useFile ? '' : 'none';
        };

        const syncCreateKeyOptionUI = () => {
            const useFile = getSelectedCreateKeyOption() === 'file';
            createPasswordGroup.style.display = useFile ? 'none' : '';
            createKeyFileGroup.style.display = useFile ? '' : 'none';
        };

        const renderSession = () => {
            if (!mountedSessionId || !mountedDrivePath) {
                sessionInfo.style.display = 'none';
                sessionInfo.innerHTML = '';
                return;
            }
            sessionInfo.style.display = 'block';
            sessionInfo.innerHTML = `
                <div class="conversion-success-card">
                    <div class="success-header"><i class="bi bi-hdd-fill"></i><span>虚拟磁盘已挂载</span></div>
                    <div class="result-info">
                        <div class="meta-item"><span class="meta-label">盘符:</span> ${mountedDrivePath}</div>
                        <div class="meta-item"><span class="meta-label">容器文件:</span> ${safeboxFilePath || '-'}</div>
                    </div>
                    <div class="result-actions">
                        <button id="safeboxOpenDriveBtn" class="modal-btn modal-btn-primary"><i class="bi bi-box-arrow-up-right"></i> 打开磁盘</button>
                    </div>
                </div>
            `;
            const openBtn = document.getElementById('safeboxOpenDriveBtn');
            if (openBtn) {
                openBtn.addEventListener('click', () => window.electronAPI.openPath(mountedDrivePath));
            }
        };

        const bindDrop = (zone, onSelect) => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('dragover');
            });
            zone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
            });
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (!files || files.length === 0) return;
                const file = files[0];
                try {
                    const filePath = window.electronAPI.getFilePath(file);
                    if (!filePath) {
                        showToast('无法获取文件路径', 'error');
                        return;
                    }
                    onSelect(filePath, file.name);
                } catch (error) {
                    showToast(`处理拖拽文件失败: ${error.message}`, 'error');
                }
            });
        };

        const applyPendingSafeboxFile = () => {
            const pendingPath = document.body.dataset.pendingSafeboxFilePath;
            if (!pendingPath) return;
            const pendingName = document.body.dataset.pendingSafeboxFileName || extractFileName(pendingPath);
            safeboxFilePath = pendingPath;
            safeboxFileSelectedName.textContent = `✓ 已选择: ${pendingName}`;
            delete document.body.dataset.pendingSafeboxFilePath;
            delete document.body.dataset.pendingSafeboxFileName;
        };

        safeboxFileDropZone.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (result.success) {
                safeboxFilePath = result.filePath;
                safeboxFileSelectedName.textContent = `✓ 已选择: ${result.fileName}`;
            }
        });
        mountKeyOptionInputs.forEach((input) => {
            input.addEventListener('change', syncMountKeyOptionUI);
        });
        createKeyOptionInputs.forEach((input) => {
            input.addEventListener('change', syncCreateKeyOptionUI);
        });
        syncMountKeyOptionUI();
        syncCreateKeyOptionUI();

        selectMountKeyFileBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (!result.success) {
                return;
            }
            mountKeyFilePath = result.filePath;
            mountKeyFilePathInput.value = result.filePath;
        });

        selectCreateKeyFileBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectPath(['openFile']);
            if (!result.success) {
                return;
            }
            createKeyFilePath = result.filePath;
            createKeyFilePathInput.value = result.filePath;
        });

        bindDrop(safeboxFileDropZone, (filePath, fileName) => {
            safeboxFilePath = filePath;
            safeboxFileSelectedName.textContent = `✓ 已选择: ${fileName}`;
        });

        createBtn.addEventListener('click', async () => {
            const keyOption = getSelectedCreateKeyOption();
            const password = createPasswordInput.value || '';
            if (keyOption === 'password') {
                if (!password) {
                    showToast('请输入容器密码', 'error');
                    return;
                }
            } else if (!createKeyFilePath) {
                showToast('请选择创建密钥文件', 'error');
                return;
            }
            setOperationBusy(createBtn, true, '正在生成');
            try {
                const result = await window.electronAPI.createSafebox({
                    password,
                    keyOption,
                    keyFilePath: createKeyFilePath
                });
                if (!result.success) {
                    showToast(`创建失败: ${result.message}`, 'error');
                    return;
                }
                showToast(`创建成功: ${result.outputPath}`, 'success');
                safeboxFilePath = result.outputPath;
                safeboxFileSelectedName.textContent = `✓ 已选择: ${result.outputPath.split(/[\\/]/).pop()}`;
            } finally {
                setOperationBusy(createBtn, false);
            }
        });

        mountBtn.addEventListener('click', async () => {
            if (!safeboxFilePath) {
                showToast('请先选择 .tcsafebox 文件', 'error');
                return;
            }
            const keyOption = getSelectedMountKeyOption();
            const password = mountPasswordInput.value || '';
            if (keyOption === 'password') {
                if (!password) {
                    showToast('请输入挂载密码', 'error');
                    return;
                }
            } else if (!mountKeyFilePath) {
                showToast('请选择挂载密钥文件', 'error');
                return;
            }
            setOperationBusy(mountBtn, true, '正在挂载');
            try {
                const result = await window.electronAPI.mountSafebox({
                    safeboxPath: safeboxFilePath,
                    password,
                    keyOption,
                    keyFilePath: mountKeyFilePath
                });
                if (!result.success) {
                    showToast(`挂载失败: ${result.message}`, 'error');
                    return;
                }
                mountedSessionId = result.sessionId;
                mountedDrivePath = result.drivePath;
                renderSession();
                showToast(`挂载成功: ${result.drivePath}`, 'success');
                window.electronAPI.openPath(result.drivePath);
            } finally {
                setOperationBusy(mountBtn, false);
            }
        });

        unmountBtn.addEventListener('click', async () => {
            if (!mountedSessionId) {
                showToast('当前没有已挂载的 Safebox', 'info');
                return;
            }
            setOperationBusy(unmountBtn, true, '正在弹出');
            try {
                const result = await window.electronAPI.unmountSafebox({ sessionId: mountedSessionId });
                if (!result.success) {
                    showToast(`弹出失败: ${result.message}`, 'error');
                    return;
                }
                showToast('已弹出并回写加密', 'success');
                mountedSessionId = null;
                mountedDrivePath = null;
                renderSession();
            } finally {
                setOperationBusy(unmountBtn, false);
            }
        });

        applyPendingSafeboxFile();

        window.electronAPI.listSafeboxSessions().then((sessions) => {
            if (!Array.isArray(sessions) || sessions.length === 0) return;

            // 如果是双击预选进来的 safebox，则以预选为准；否则默认展示第一个会话
            const pendingPath = document.body.dataset.pendingSafeboxFilePath;
            const effectiveSelected = safeboxFilePath || pendingPath;

            let matched = null;
            if (effectiveSelected) {
                matched = sessions.find(s => s.safeboxPath === effectiveSelected) || null;
            }

            if (!matched) {
                if (!safeboxFilePath && sessions[0]) {
                    matched = sessions[0];
                    safeboxFilePath = matched.safeboxPath;
                    safeboxFileSelectedName.textContent = `✓ 已选择: ${matched.safeboxPath.split(/[\\/]/).pop()}`;
                } else {
                    return;
                }
            }

            mountedSessionId = matched.sessionId;
            mountedDrivePath = matched.drivePath;
            renderSession();
        }).catch(() => {
        });
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
        const outputOptionRadios = document.querySelectorAll('input[name="outputOption"]');
        const keyFileGroup = document.getElementById('keyFileGroup');
        const generateKeyGroup = document.getElementById('generateKeyGroup');
        const passwordKeyGroup = document.getElementById('passwordKeyGroup');
        const passwordKeyInput = document.getElementById('passwordKeyInput');
        let encFilePath = null;

        const applyOutputOptionUI = () => {
            const outputOption = document.querySelector('input[name="outputOption"]:checked')?.value || 'tclock';
            if (outputOption === 'exe') {
                // exe 模式仅支持密码派生密钥
                keyOptionRadios.forEach(radio => {
                    radio.disabled = radio.value !== 'password';
                    if (radio.value === 'password') radio.checked = true;
                });
                keyFileGroup.style.display = 'none';
                generateKeyGroup.style.display = 'none';
                passwordKeyGroup.style.display = 'block';
                return;
            }

            keyOptionRadios.forEach(radio => (radio.disabled = false));
            const keyOption = document.querySelector('input[name="keyOption"]:checked')?.value || 'file';
            if (keyOption === 'file') {
                keyFileGroup.style.display = 'block';
                generateKeyGroup.style.display = 'none';
                passwordKeyGroup.style.display = 'none';
            } else if (keyOption === 'generate') {
                keyFileGroup.style.display = 'none';
                generateKeyGroup.style.display = 'block';
                passwordKeyGroup.style.display = 'none';
            } else {
                keyFileGroup.style.display = 'none';
                generateKeyGroup.style.display = 'none';
                passwordKeyGroup.style.display = 'block';
            }
        };

        keyOptionRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const outputOption = document.querySelector('input[name="outputOption"]:checked')?.value || 'tclock';
                if (outputOption === 'exe') return;
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

        outputOptionRadios.forEach(radio => {
            radio.addEventListener('change', applyOutputOptionUI);
        });
        applyOutputOptionUI();

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

            if (!encFilePath) {
                showToast('请先选择要加密的文件或文件夹', 'error');
                return;
            }
            const algorithm = document.getElementById('encAlgorithm').value;
            const outputOption = document.querySelector('input[name="outputOption"]:checked').value;
            const keyOption = document.querySelector('input[name="keyOption"]:checked').value;
            const keyFilePath = keyFilePathInput.value;
            const password = passwordKeyInput ? passwordKeyInput.value : '';
            if (outputOption === 'exe' && keyOption !== 'password') {
                showToast('自解密 exe 模式仅支持密码', 'error');
                return;
            }
            if (outputOption === 'exe' && algorithm === 'xchacha20-poly1305') {
                showToast('自解密 exe 暂不支持 XChaCha20，请选择 AES-256-GCM', 'error');
                return;
            }
            if (keyOption === 'file' && !keyFilePath) {
                showToast('请选择密钥文件', 'error');
                return;
            }
            if (keyOption === 'password' && !password) {
                showToast('请输入加密密码', 'error');
                return;
            }
            setOperationBusy(startEncryptionBtn, true, '正在加密');
            showEncryptionSpinner(true); // 显示加载器
            showToast('正在加密...', 'info');
            try {
                const result = await window.electronAPI.encryptFile({ 
                    filePath: encFilePath, 
                    algorithm, 
                    keyOption, 
                    keyFilePath,
                    password,
                    outputOption
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
                        showOperationResultPage({
                            title: '加密完成',
                            subtitle: result.outputPath.split(/[\\/]/).pop(),
                            status: 'success',
                            contentHtml: resultContainer.innerHTML,
                            actionBindings: [
                                { selector: '#encShowInFolderBtn', handler: () => window.electronAPI.showItemInFolder(result.outputPath) },
                                { selector: '#encOpenPathBtn', handler: () => window.electronAPI.openPath(result.outputPath) }
                            ]
                        });
                    }
                } else {
                    showToast(`加密失败: ${result.message}`, 'error');
                    showOperationResultPage({
                        title: '加密失败',
                        subtitle: '请检查密钥与文件权限',
                        status: 'error',
                        contentHtml: `
                            <div class="conversion-error-card">
                                <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>加密失败</span></div>
                                <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${result.message}</div></div>
                            </div>
                        `
                    });
                }
            } catch (error) {
                showToast(`加密过程中发生错误: ${error.message}`, 'error');
                showOperationResultPage({
                    title: '加密异常',
                    subtitle: '执行过程中发生错误',
                    status: 'error',
                    contentHtml: `
                        <div class="conversion-error-card">
                            <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>加密异常</span></div>
                            <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${error.message}</div></div>
                        </div>
                    `
                });
            } finally {
                showEncryptionSpinner(false); // 隐藏加载器
                setOperationBusy(startEncryptionBtn, false);
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

            if (!decFilePath) {
                showToast('请先选择要解密的文件', 'error');
                return;
            }
            const algorithm = document.getElementById('decAlgorithm').value;
            const keyOption = document.querySelector('input[name="decKeyOption"]:checked').value;
            const keyFilePath = keyFilePathInput.value;
            const password = decPasswordKeyInput ? decPasswordKeyInput.value : '';
            if (keyOption === 'file' && !keyFilePath) {
                showToast('请选择密钥文件', 'error');
                return;
            }
            if (keyOption === 'password' && !password) {
                showToast('请输入解密密码', 'error');
                return;
            }
            setOperationBusy(startDecryptionBtn, true, '正在解密');
            showDecryptionSpinner(true); // 显示加载器
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
                        showOperationResultPage({
                            title: '解密完成',
                            subtitle: result.outputPath.split(/[\\/]/).pop(),
                            status: 'success',
                            contentHtml: resultContainer.innerHTML,
                            actionBindings: [
                                { selector: '#decShowInFolderBtn', handler: () => window.electronAPI.showItemInFolder(result.outputPath) },
                                { selector: '#decOpenPathBtn', handler: () => window.electronAPI.openPath(result.outputPath) }
                            ]
                        });
                    }
                } else {
                    showToast(`解密失败: ${result.message}`, 'error');
                    showOperationResultPage({
                        title: '解密失败',
                        subtitle: '请检查密钥或密码是否正确',
                        status: 'error',
                        contentHtml: `
                            <div class="conversion-error-card">
                                <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>解密失败</span></div>
                                <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${result.message}</div></div>
                            </div>
                        `
                    });
                }
            } catch (error) {
                showToast(`解密过程中发生错误: ${error.message}`, 'error');
                showOperationResultPage({
                    title: '解密异常',
                    subtitle: '执行过程中发生错误',
                    status: 'error',
                    contentHtml: `
                        <div class="conversion-error-card">
                            <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>解密异常</span></div>
                            <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${error.message}</div></div>
                        </div>
                    `
                });
            } finally {
                showDecryptionSpinner(false); // 隐藏加载器
                setOperationBusy(startDecryptionBtn, false);
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
            setOperationBusy(calculateHashBtn, true, '正在计算');
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
                    showOperationResultPage({
                        title: '哈希计算完成',
                        subtitle: algorithm.toUpperCase(),
                        status: 'success',
                        contentHtml: hashResultContainer.innerHTML,
                        actionBindings: [
                            {
                                selector: '#copyHashBtn',
                                handler: () => {
                                    navigator.clipboard.writeText(calculatedHash).then(() => {
                                        showToast('哈希值已复制到剪贴板', 'success');
                                    }).catch(err => {
                                        showToast(`复制失败: ${err.message}`, 'error');
                                    });
                                }
                            }
                        ]
                    });

                } else {
                    showToast(`哈希计算失败: ${result.message}`, 'error');
                    showOperationResultPage({
                        title: '哈希计算失败',
                        subtitle: '请检查文件或算法设置',
                        status: 'error',
                        contentHtml: `
                            <div class="conversion-error-card">
                                <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>哈希计算失败</span></div>
                                <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${result.message}</div></div>
                            </div>
                        `
                    });
                }
            } catch (error) {
                showToast(`哈希计算过程中发生错误: ${error.message}`, 'error');
                showOperationResultPage({
                    title: '哈希计算异常',
                    subtitle: '执行过程中发生错误',
                    status: 'error',
                    contentHtml: `
                        <div class="conversion-error-card">
                            <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>哈希计算异常</span></div>
                            <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${error.message}</div></div>
                        </div>
                    `
                });
            } finally {
                showHashSpinner(false);
                setOperationBusy(calculateHashBtn, false);
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

        setOperationBusy(startButton, true, '正在转换');

        updateBatchProgressUI({
            percent: 0,
            completed: 0,
            total: selectedBatchFiles.length,
            currentFileName: '等待开始...',
            failedCount: 0
        });

        showToast('批量转换已开始', 'info', 3500);
        let batchResult = null;
        try {
            batchResult = await window.electronAPI.batchConvertImages({
                batchId: batchState.batchId,
                files: selectedBatchFiles.map(item => item.filePath),
                targetFormat,
                category,
                options,
                outputDirectory: outputResult.directoryPath,
                concurrency: 3
            });
        } finally {
            batchState.active = false;
            if (progressActions) {
                progressActions.style.display = 'none';
            }
            setOperationBusy(startButton, false);
        }

        const resultContainer = document.getElementById('conversionResult');
        if (!resultContainer) return;

        if (batchResult.cancelled) {
            showToast('批量转换已取消', 'info');
            const progressCurrent = document.getElementById('batchCurrentFile');
            if (progressCurrent) {
                progressCurrent.textContent = '已取消';
            }
            showOperationResultPage({
                title: '批量转换已取消',
                subtitle: '任务已停止',
                status: 'error',
                contentHtml: `
                    <div class="conversion-error-card">
                        <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>批量转换已取消</span></div>
                        <div class="result-info"><div class="meta-item"><span class="meta-label">状态:</span> 用户已取消本次批量任务</div></div>
                    </div>
                `
            });
            return;
        }

        if (!batchResult.success && batchResult.message) {
            showToast(`批量转换失败: ${batchResult.message}`, 'error');
            showOperationResultPage({
                title: '批量转换失败',
                subtitle: '请检查失败原因后重试',
                status: 'error',
                contentHtml: `
                    <div class="conversion-error-card">
                        <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>批量转换失败</span></div>
                        <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${batchResult.message}</div></div>
                    </div>
                `
            });
            return;
        }

        renderBatchResult(resultContainer, {
            total: batchResult.total,
            successful: batchState.successful,
            failed: batchState.failed
        });
        showOperationResultPage({
            title: '批量转换完成',
            subtitle: `成功 ${batchState.successful.length} 个，失败 ${batchState.failed.length} 个`,
            status: batchState.failed.length > 0 ? 'error' : 'success',
            contentHtml: resultContainer.innerHTML,
            actionBindings: [
                {
                    selector: '#batchOpenFolderBtn',
                    handler: () => {
                        if (batchState.outputDirectory) {
                            window.electronAPI.openPath(batchState.outputDirectory);
                        }
                    }
                },
                {
                    selector: '#batchRetryFailedBtn',
                    handler: async () => {
                        const failed = batchState.failed || [];
                        selectedBatchFiles = failed.map(item => ({
                            filePath: item.sourcePath,
                            fileName: item.fileName || item.sourcePath.split(/[\\/]/).pop()
                        }));
                        batchState.failed = [];
                        renderBatchSelectionUI(currentCategory);
                        selectedFilePath = selectedBatchFiles[0] ? selectedBatchFiles[0].filePath : null;
                        showToast(`已重新装载 ${selectedBatchFiles.length} 个失败文件`, 'info');
                    }
                }
            ]
        });
    }

    function getSelectedProfileConfig(group) {
        if (!group || !Array.isArray(group.profiles)) {
            return null;
        }
        return group.profiles.find(profile => profile.category === group.selectedProfile) || group.profiles[0] || null;
    }

    function buildUnifiedAdvancedOptions(group, profileCategory, targetFormat) {
        const options = {};
        if (profileCategory === 'images') {
            if (group.advanced.width) options.width = parseInt(group.advanced.width, 10);
            if (group.advanced.height) options.height = parseInt(group.advanced.height, 10);
            options.quality = parseInt(group.advanced.quality || 100, 10);
            options.privacySanitize = !!group.advanced.privacySanitize;
            const normalizedTarget = String(targetFormat || '').toLowerCase();
            if (normalizedTarget === 'ico' && group.advanced.icoSize) {
                options.icoSizes = [parseInt(group.advanced.icoSize, 10)];
            }
        }
        if (profileCategory === 'videos') {
            if (group.advanced.videoRes) options.videoRes = group.advanced.videoRes;
            if (group.advanced.videoPreset) options.videoPreset = group.advanced.videoPreset;
            options.privacySanitize = !!group.advanced.privacySanitize;
        }
        if (profileCategory === 'audio') {
            if (group.advanced.audioBitrate) options.audioBitrate = group.advanced.audioBitrate;
        }
        return options;
    }

    function createUnifiedConversionGroup(sourcePath, sourceName = '') {
        const filePath = String(sourcePath || '').trim();
        const fileName = sourceName || extractFileName(filePath);
        const sourceCategory = detectFileCategory(fileName);
        const sourceExt = getFileExtension(fileName);
        const profiles = getConversionProfilesForFile(fileName);
        const defaultProfile = profiles[0] || null;
        const defaultTarget = defaultProfile && defaultProfile.formats[0] ? defaultProfile.formats[0] : '';
        return {
            groupKey: sourceExt || '__unknown__',
            sourceCategory,
            sourceExt,
            profiles,
            selectedProfile: defaultProfile ? defaultProfile.category : null,
            targetFormat: defaultTarget,
            files: [{
                filePath,
                fileName
            }],
            advanced: {
                width: '',
                height: '',
                quality: 100,
                icoSize: 256,
                videoRes: '',
                videoPreset: 'medium',
                audioBitrate: '',
                privacySanitize: false
            }
        };
    }

    function renderUnifiedConversionCards() {
        const statusEl = document.getElementById('unifiedConversionStatus');
        const listEl = document.getElementById('unifiedConversionList');
        const runBtn = document.getElementById('startUnifiedConversion');
        if (!statusEl || !listEl || !runBtn) return;

        if (unifiedConversionLoading) {
            statusEl.style.display = '';
            statusEl.innerHTML = `<span class="status-pill is-loading"><i class="bi bi-arrow-repeat"></i> 正在分析文件兼容性...</span>`;
            listEl.innerHTML = '';
            runBtn.disabled = true;
            return;
        }

        if (unifiedConversionFiles.length === 0) {
            statusEl.style.display = 'none';
            statusEl.innerHTML = '';
            listEl.innerHTML = `<div class="unified-empty-hint">上传后将自动展示所有可转换格式</div>`;
            runBtn.disabled = true;
            return;
        }

        const totalFiles = unifiedConversionFiles.reduce((sum, group) => sum + (group.files ? group.files.length : 0), 0);
        const unsupportedCount = unifiedConversionFiles.reduce((sum, group) => sum + (group.profiles.length === 0 ? group.files.length : 0), 0);
        const compatibleCount = totalFiles - unsupportedCount;
        statusEl.style.display = '';
        statusEl.innerHTML = `
            <span class="status-pill is-success"><i class="bi bi-check-circle"></i> 兼容 ${compatibleCount}</span>
            <span class="status-pill ${unsupportedCount > 0 ? 'is-error' : ''}"><i class="bi bi-exclamation-triangle"></i> 不兼容 ${unsupportedCount}</span>
            <span class="status-pill"><i class="bi bi-layers"></i> 格式组 ${unifiedConversionFiles.length}</span>
            <span class="status-pill"><i class="bi bi-files"></i> 文件 ${totalFiles}</span>
        `;

        listEl.innerHTML = unifiedConversionFiles.map((group) => {
            const selectedProfile = getSelectedProfileConfig(group);
            const formats = selectedProfile ? selectedProfile.formats : [];
            const currentTarget = formats.includes(group.targetFormat) ? group.targetFormat : (formats[0] || '');
            const formatOptions = formats.map(format => `<option value="${format}" ${currentTarget === format ? 'selected' : ''}>${format}</option>`).join('');
            const cardClassName = selectedProfile ? 'unified-file-card' : 'unified-file-card is-error';
            const filesPreview = (group.files || []).map(file => `
                <div class="unified-group-file-item">
                    <span class="unified-group-file-name">${file.fileName}</span>
                    <button class="unified-group-file-remove" type="button" data-action="remove-file" data-file-key="${encodeURIComponent(String(file.filePath || '').toLowerCase())}" title="移除文件">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            `).join('');
            const isImageProfile = selectedProfile?.category === 'images';
            const isVideoProfile = selectedProfile?.category === 'videos';
            const isAudioProfile = selectedProfile?.category === 'audio';
            const isDocumentProfile = selectedProfile?.category === 'documents';
            const showAdvancedSettings = !!selectedProfile && !isDocumentProfile;
            const showIcoSizeSetting = isImageProfile && currentTarget.toLowerCase() === 'ico';
            return `
                <div class="${cardClassName}" data-group-key="${group.groupKey}">
                    <div class="unified-file-header">
                        <div class="unified-file-title">
                            <i class="bi bi-files"></i>
                            <span class="unified-title-text">${group.sourceExt ? group.sourceExt.toUpperCase() : '未知格式'} 文件组</span>
                            ${selectedProfile ? `
                                <div class="profile-grid profile-grid-inline">
                                    ${group.profiles.map(profile => `
                                        <button class="profile-chip ${group.selectedProfile === profile.category ? 'active' : ''}" type="button" data-action="profile" data-value="${profile.category}">
                                            <i class="bi ${conversionCategoryIconMap[profile.category] || 'bi-arrow-repeat'}"></i>
                                            <span>${categoryNameMap[profile.category]}</span>
                                        </button>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="unified-file-meta">${group.files.length} 个文件${selectedProfile ? ` · ${categoryNameMap[selectedProfile.category]}` : ''}</div>
                    </div>
                    <div class="unified-group-file-list">
                        ${filesPreview}
                    </div>
                    ${selectedProfile ? `
                        <div class="unified-form-row">
                            <label>目标格式</label>
                            <select data-action="target-format">
                                ${supportsOriginalFormatSelection(selectedProfile.category) ? `<option value="${ORIGINAL_FORMAT_VALUE}" ${currentTarget === ORIGINAL_FORMAT_VALUE ? 'selected' : ''}>原格式 (${group.sourceExt.toUpperCase()})</option>` : ''}
                                ${formatOptions}
                            </select>
                        </div>
                        ${showAdvancedSettings ? `
                            <div class="advanced-settings unified-advanced-block">
                                <div class="advanced-header" data-action="toggle-advanced">
                                    <span><i class="bi bi-sliders"></i> 高级设置</span>
                                    <i class="bi bi-chevron-down toggle-icon"></i>
                                </div>
                                <div class="advanced-content">
                                    ${isImageProfile ? `
                                    <div class="settings-grid">
                                        <div class="setting-item">
                                            <label>分辨率</label>
                                            <div class="input-row">
                                                <input type="number" min="1" placeholder="宽" value="${group.advanced.width}" data-action="opt-width">
                                                <span>×</span>
                                                <input type="number" min="1" placeholder="高" value="${group.advanced.height}" data-action="opt-height">
                                            </div>
                                        </div>
                                        <div class="setting-item">
                                            <label>质量</label>
                                            <div class="range-input-group">
                                                <input type="range" min="1" max="100" value="${group.advanced.quality}" data-action="opt-quality">
                                                <span class="range-value">${group.advanced.quality}</span>
                                            </div>
                                        </div>
                                        ${showIcoSizeSetting ? `
                                            <div class="setting-item">
                                                <label>ICO 尺寸</label>
                                                <select data-action="opt-ico-size">
                                                    <option value="16" ${String(group.advanced.icoSize) === '16' ? 'selected' : ''}>16×16</option>
                                                    <option value="32" ${String(group.advanced.icoSize) === '32' ? 'selected' : ''}>32×32</option>
                                                    <option value="48" ${String(group.advanced.icoSize) === '48' ? 'selected' : ''}>48×48</option>
                                                    <option value="64" ${String(group.advanced.icoSize) === '64' ? 'selected' : ''}>64×64</option>
                                                    <option value="128" ${String(group.advanced.icoSize) === '128' ? 'selected' : ''}>128×128</option>
                                                    <option value="256" ${String(group.advanced.icoSize) === '256' ? 'selected' : ''}>256×256</option>
                                                </select>
                                            </div>
                                        ` : ''}
                                        <div class="setting-item">
                                            <label style="display:flex;align-items:center;gap:8px;">
                                                <input type="checkbox" data-action="opt-privacy" ${group.advanced.privacySanitize ? 'checked' : ''}>
                                                <span>隐私脱敏</span>
                                            </label>
                                        </div>
                                    </div>
                                ` : ''}
                                    ${isVideoProfile ? `
                                    <div class="settings-grid">
                                        <div class="setting-item">
                                            <label>视频分辨率</label>
                                            <select data-action="opt-video-res">
                                                <option value="" ${group.advanced.videoRes === '' ? 'selected' : ''}>保持原样</option>
                                                <option value="1920:1080" ${group.advanced.videoRes === '1920:1080' ? 'selected' : ''}>1080p</option>
                                                <option value="1280:720" ${group.advanced.videoRes === '1280:720' ? 'selected' : ''}>720p</option>
                                                <option value="854:480" ${group.advanced.videoRes === '854:480' ? 'selected' : ''}>480p</option>
                                                <option value="640:360" ${group.advanced.videoRes === '640:360' ? 'selected' : ''}>360p</option>
                                            </select>
                                        </div>
                                        <div class="setting-item">
                                            <label>编码预设</label>
                                            <select data-action="opt-video-preset">
                                                <option value="medium" ${group.advanced.videoPreset === 'medium' ? 'selected' : ''}>Medium</option>
                                                <option value="ultrafast" ${group.advanced.videoPreset === 'ultrafast' ? 'selected' : ''}>Ultrafast</option>
                                                <option value="veryfast" ${group.advanced.videoPreset === 'veryfast' ? 'selected' : ''}>Veryfast</option>
                                                <option value="fast" ${group.advanced.videoPreset === 'fast' ? 'selected' : ''}>Fast</option>
                                                <option value="slow" ${group.advanced.videoPreset === 'slow' ? 'selected' : ''}>Slow</option>
                                                <option value="veryslow" ${group.advanced.videoPreset === 'veryslow' ? 'selected' : ''}>Veryslow</option>
                                            </select>
                                        </div>
                                        <div class="setting-item">
                                            <label style="display:flex;align-items:center;gap:8px;">
                                                <input type="checkbox" data-action="opt-privacy" ${group.advanced.privacySanitize ? 'checked' : ''}>
                                                <span>隐私脱敏</span>
                                            </label>
                                        </div>
                                    </div>
                                ` : ''}
                                    ${isAudioProfile ? `
                                    <div class="settings-grid">
                                        <div class="setting-item">
                                            <label>音频码率</label>
                                            <select data-action="opt-audio-bitrate">
                                                <option value="" ${group.advanced.audioBitrate === '' ? 'selected' : ''}>保持原样</option>
                                                <option value="320k" ${group.advanced.audioBitrate === '320k' ? 'selected' : ''}>320kbps</option>
                                                <option value="256k" ${group.advanced.audioBitrate === '256k' ? 'selected' : ''}>256kbps</option>
                                                <option value="192k" ${group.advanced.audioBitrate === '192k' ? 'selected' : ''}>192kbps</option>
                                                <option value="128k" ${group.advanced.audioBitrate === '128k' ? 'selected' : ''}>128kbps</option>
                                                <option value="64k" ${group.advanced.audioBitrate === '64k' ? 'selected' : ''}>64kbps</option>
                                            </select>
                                        </div>
                                    </div>
                                ` : ''}
                                </div>
                            </div>
                        ` : ''}
                    ` : `
                        <div class="compatibility-error"><i class="bi bi-x-circle"></i> 当前文件暂不支持转换</div>
                    `}
                </div>
            `;
        }).join('');
        runBtn.disabled = compatibleCount === 0;
    }

    async function appendUnifiedConversionFiles(inputItems) {
        const normalizedItems = [];
        const invalidNames = [];
        for (const item of inputItems) {
            const sourcePath = normalizeBatchFilePath(item);
            const sourceName = typeof item === 'object' && item !== null ? (item.name || item.fileName) : extractFileName(sourcePath);
            if (!sourcePath) {
                invalidNames.push(sourceName || '未知文件');
                continue;
            }
            normalizedItems.push({ filePath: sourcePath, fileName: sourceName || extractFileName(sourcePath) });
        }
        if (normalizedItems.length === 0) {
            if (invalidNames.length > 0) {
                showToast(`无法读取 ${invalidNames.length} 个文件路径`, 'error');
            }
            return;
        }

        unifiedConversionLoading = true;
        renderUnifiedConversionCards();
        const existing = new Set(
            unifiedConversionFiles.flatMap(group => (group.files || []).map(file => file.filePath.toLowerCase()))
        );
        let addedCount = 0;
        normalizedItems.forEach(item => {
            const key = item.filePath.toLowerCase();
            if (existing.has(key)) {
                return;
            }
            existing.add(key);
            const sourceExt = getFileExtension(item.fileName) || '__unknown__';
            let targetGroup = unifiedConversionFiles.find(group => group.groupKey === sourceExt);
            if (!targetGroup) {
                targetGroup = createUnifiedConversionGroup(item.filePath, item.fileName);
                unifiedConversionFiles.push(targetGroup);
            } else {
                targetGroup.files.push({
                    filePath: item.filePath,
                    fileName: item.fileName
                });
            }
            addedCount += 1;
        });
        unifiedConversionLoading = false;
        renderUnifiedConversionCards();

        if (addedCount > 0) {
            showToast(`已加载 ${addedCount} 个文件`, 'success', 2600);
        }
        if (invalidNames.length > 0) {
            showToast(`跳过 ${invalidNames.length} 个无法处理的文件`, 'info');
        }
    }

    function renderUnifiedProgressPage() {
        ensureUnifiedRuntimeStyles();
        const isCompleted = unifiedProgressState.completed >= unifiedProgressState.total && unifiedProgressState.total > 0;
        const statusClass = unifiedProgressState.failed > 0 ? 'is-warning' : (isCompleted ? 'is-success' : 'is-running');
        const statusText = isCompleted
            ? '转换完成'
            : '正在转换';
        mainContent.innerHTML = `
            <div class="unified-progress-page ${statusClass}">
                <div class="unified-progress-head">
                    <div>
                        <h1>${isCompleted ? '批量转换成功' : '批量转换进度'}</h1>
                        <p>${isCompleted ? '转换完成' : `${statusText}，请勿关闭应用窗口`}</p>
                    </div>
                    <div class="unified-progress-actions">
                        ${isCompleted ? '<button id="continueUnifiedConversionBtn" class="secondary-btn"><i class="bi bi-arrow-counterclockwise"></i> 继续转换</button>' : ''}
                        <button id="openUnifiedOutputBtn" class="secondary-btn" ${unifiedProgressState.outputDirectory ? '' : 'disabled'}><i class="bi bi-folder2-open"></i> 打开输出目录</button>
                    </div>
                </div>
                <div class="unified-progress-overview">
                    <div class="status-pill"><i class="bi bi-files"></i> 总计 ${unifiedProgressState.total}</div>
                    <div class="status-pill is-success"><i class="bi bi-check-circle"></i> 成功 ${unifiedProgressState.successful}</div>
                    <div class="status-pill ${unifiedProgressState.failed > 0 ? 'is-error' : ''}"><i class="bi bi-x-circle"></i> 失败 ${unifiedProgressState.failed}</div>
                    <div class="status-pill"><i class="bi bi-hourglass-split"></i> 已完成 ${unifiedProgressState.completed}</div>
                </div>
                <div class="progress-bar-bg unified-progress-bar">
                    <div class="progress-bar-fill" id="unifiedOverallProgressBar" style="width:${unifiedProgressState.total > 0 ? Math.round((unifiedProgressState.completed / unifiedProgressState.total) * 100) : 0}%"></div>
                </div>
                <div class="unified-progress-content">
                    <div class="unified-progress-groups" id="unifiedProgressGroups"></div>
                </div>
            </div>
        `;
        const openBtn = document.getElementById('openUnifiedOutputBtn');
        if (openBtn) {
            openBtn.onclick = () => {
                if (unifiedProgressState.outputDirectory) {
                    window.electronAPI.openPath(unifiedProgressState.outputDirectory);
                }
            };
        }
        const continueBtn = document.getElementById('continueUnifiedConversionBtn');
        if (continueBtn) {
            continueBtn.onclick = () => {
                unifiedConversionFiles = [];
                unifiedConversionLoading = false;
                unifiedProgressState = {
                    active: false,
                    total: 0,
                    completed: 0,
                    successful: 0,
                    failed: 0,
                    groups: [],
                    files: [],
                    outputDirectory: ''
                };
                loadUnifiedConversionView();
            };
        }
        updateUnifiedProgressView();
    }

    function updateUnifiedProgressView() {
        const groupsContainer = document.getElementById('unifiedProgressGroups');
        const overallBar = document.getElementById('unifiedOverallProgressBar');
        if (!groupsContainer) {
            return;
        }

        if (overallBar) {
            const percent = unifiedProgressState.total > 0 ? Math.round((unifiedProgressState.completed / unifiedProgressState.total) * 100) : 0;
            overallBar.style.width = `${percent}%`;
        }

        groupsContainer.innerHTML = `
            <h3>文件组进度</h3>
            ${unifiedProgressState.groups.map(group => {
                const percent = group.total > 0 ? Math.round((group.completed / group.total) * 100) : 0;
                const cardState = group.failed > 0 ? 'is-warning' : (group.completed >= group.total && group.total > 0 ? 'is-success' : 'is-running');
                return `
                    <div class="progress-group-card ${cardState}">
                        <div class="progress-group-head">
                            <div>${group.title}</div>
                            <div>${group.completed}/${group.total}</div>
                        </div>
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill" style="width:${percent}%"></div>
                        </div>
                        <div class="progress-group-meta">
                            <span>成功 ${group.successful}</span>
                            <span>失败 ${group.failed}</span>
                        </div>
                        <div class="progress-group-files">
                            ${(group.files || []).map(file => `
                                <div class="progress-group-file-item status-${file.status}">
                                    <span class="progress-group-file-name">${file.fileName}</span>
                                    <i class="bi ${getFileProgressIcon(file.status)} progress-status-icon status-${file.status}"></i>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('')}
        `;
    }

    function getFileProgressIcon(status) {
        if (status === 'running') return 'bi-arrow-repeat';
        if (status === 'success') return 'bi-check-circle-fill';
        if (status === 'failed') return 'bi-x-circle-fill';
        return 'bi-hourglass-split';
    }

    function initUnifiedProgressState(tasks, outputDirectory) {
        const groupMap = new Map();
        tasks.forEach(task => {
            if (!groupMap.has(task.sourceGroupKey)) {
                groupMap.set(task.sourceGroupKey, {
                    groupKey: task.sourceGroupKey,
                    title: `${(task.sourceExt || '未知').toUpperCase()} 文件组`,
                    total: 0,
                    completed: 0,
                    successful: 0,
                    failed: 0,
                    files: []
                });
            }
            groupMap.get(task.sourceGroupKey).total += 1;
        });
        const files = tasks.map(task => ({
            key: task.filePath.toLowerCase(),
            filePath: task.filePath,
            fileName: task.fileName,
            groupKey: task.sourceGroupKey,
            groupLabel: (task.sourceExt || '未知').toUpperCase(),
            targetFormat: String(task.targetFormat || '').toUpperCase(),
            status: 'pending',
            statusText: '等待中'
        }));
        files.forEach(file => {
            const group = groupMap.get(file.groupKey);
            if (group) {
                group.files.push(file);
            }
        });
        unifiedProgressState = {
            active: true,
            total: files.length,
            completed: 0,
            successful: 0,
            failed: 0,
            groups: Array.from(groupMap.values()),
            files,
            outputDirectory: outputDirectory || ''
        };
        renderUnifiedProgressPage();
    }

    function applyUnifiedProgressPayload(payload) {
        if (!unifiedProgressState.active || !payload || !payload.filePath) {
            return;
        }
        const key = String(payload.filePath).toLowerCase();
        const file = unifiedProgressState.files.find(item => item.key === key);
        if (!file) {
            return;
        }
        const group = unifiedProgressState.groups.find(item => item.groupKey === file.groupKey);
        if (payload.type === 'file-start' && file.status === 'pending') {
            file.status = 'running';
            file.statusText = '转换中';
            updateUnifiedProgressView();
            return;
        }
        if (payload.type === 'file-complete' && !['success', 'failed'].includes(file.status)) {
            const isSuccess = !!payload.success;
            file.status = isSuccess ? 'success' : 'failed';
            file.statusText = isSuccess ? '已完成' : '失败';
            unifiedProgressState.completed += 1;
            if (isSuccess) {
                unifiedProgressState.successful += 1;
            } else {
                unifiedProgressState.failed += 1;
            }
            if (group) {
                group.completed += 1;
                if (isSuccess) {
                    group.successful += 1;
                } else {
                    group.failed += 1;
                }
            }
            updateUnifiedProgressView();
        }
    }

    function finalizeUnifiedProgressState() {
        unifiedProgressState.active = false;
        renderUnifiedProgressPage();
    }

    async function runUnifiedBatchConversion(startButton) {
        const validGroups = unifiedConversionFiles.filter(group => group.profiles.length > 0 && group.files.length > 0);
        if (validGroups.length === 0) {
            showToast('请先添加可转换文件', 'error');
            return;
        }

        const tasks = validGroups.flatMap(group => {
            const selectedProfile = getSelectedProfileConfig(group);
            if (!selectedProfile) {
                return [];
            }
            const targetFormat = group.targetFormat || selectedProfile.formats[0];
            if (!targetFormat) {
                return [];
            }
            return (group.files || []).map(file => ({
                filePath: file.filePath,
                fileName: file.fileName,
                sourceGroupKey: group.groupKey,
                sourceExt: group.sourceExt,
                category: selectedProfile.category,
                targetFormat,
                options: buildUnifiedAdvancedOptions(group, selectedProfile.category, targetFormat)
            }));
        });

        if (tasks.length === 0) {
            showToast('请先完成目标格式选择', 'error');
            return;
        }

        const outputResult = await window.electronAPI.selectOutputDirectory();
        if (!outputResult.success || !outputResult.directoryPath) {
            showToast('未选择输出目录，已取消转换', 'info');
            return;
        }

        initUnifiedProgressState(tasks, outputResult.directoryPath);
        setOperationBusy(startButton, true, '正在转换');

        const grouped = new Map();
        tasks.forEach(task => {
            const key = `${task.category}|${task.targetFormat}|${JSON.stringify(task.options)}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    category: task.category,
                    targetFormat: task.targetFormat,
                    options: task.options,
                    files: []
                });
            }
            grouped.get(key).files.push(task);
        });

        try {
            for (const group of grouped.values()) {
                batchState = {
                    active: true,
                    batchId: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    failed: [],
                    successful: [],
                    outputDirectory: outputResult.directoryPath,
                    currentFileName: '',
                    completed: 0,
                    total: group.files.length
                };
                const batchResult = await window.electronAPI.batchConvertImages({
                    batchId: batchState.batchId,
                    files: group.files.map(file => file.filePath),
                    targetFormat: group.targetFormat,
                    category: group.category,
                    options: group.options,
                    outputDirectory: outputResult.directoryPath,
                    concurrency: 3
                });
                batchState.active = false;

                if (!batchResult.success && !batchResult.cancelled && batchResult.message) {
                    group.files.forEach(file => {
                        applyUnifiedProgressPayload({
                            type: 'file-complete',
                            filePath: file.filePath,
                            success: false,
                            message: batchResult.message
                        });
                    });
                }

                if (batchResult.cancelled) {
                    break;
                }
            }
        } finally {
            setOperationBusy(startButton, false);
            finalizeUnifiedProgressState();
        }

        if (Settings.get('openFolder', false) && outputResult.directoryPath) {
            window.electronAPI.openPath(outputResult.directoryPath);
        }

        showToast(unifiedProgressState.failed > 0 ? '转换完成，部分文件失败' : '全部转换完成', unifiedProgressState.failed > 0 ? 'info' : 'success');
    }

    function bindUnifiedConversionEvents() {
        const dropZone = document.getElementById('unifiedDropZone');
        const uploadBtn = document.getElementById('selectUnifiedFilesBtn');
        const clearBtn = document.getElementById('clearUnifiedFilesBtn');
        const listEl = document.getElementById('unifiedConversionList');
        const runBtn = document.getElementById('startUnifiedConversion');
        if (!dropZone || !uploadBtn || !clearBtn || !listEl || !runBtn) {
            return;
        }

        uploadBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectImageFiles();
            if (!result.success || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
                showToast('文件选择已取消', 'info');
                return;
            }
            const files = result.filePaths.map((filePath, index) => ({
                filePath,
                fileName: result.fileNames[index]
            }));
            await appendUnifiedConversionFiles(files);
        });

        dropZone.addEventListener('click', () => {
            uploadBtn.click();
        });
        ['dragover', 'dragenter'].forEach(evt => {
            dropZone.addEventListener(evt, (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropZone.classList.add('dragover');
            });
        });
        dropZone.addEventListener('dragleave', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            dropZone.classList.remove('dragover');
            const files = Array.from(event.dataTransfer.files || []);
            if (files.length === 0) {
                return;
            }
            await appendUnifiedConversionFiles(files);
        });

        clearBtn.addEventListener('click', () => {
            unifiedConversionFiles = [];
            renderUnifiedConversionCards();
            showToast('已清空待转换文件', 'info');
        });

        listEl.addEventListener('click', (event) => {
            const actionEl = event.target.closest('[data-action]');
            if (!actionEl) return;
            const card = event.target.closest('[data-group-key]');
            if (!card) return;
            const group = unifiedConversionFiles.find(item => item.groupKey === card.getAttribute('data-group-key'));
            if (!group) return;
            const action = actionEl.getAttribute('data-action');
            if (action === 'remove-file') {
                const fileKey = actionEl.getAttribute('data-file-key');
                const fileIndex = (group.files || []).findIndex(file => encodeURIComponent(String(file.filePath || '').toLowerCase()) === fileKey);
                if (fileIndex >= 0) {
                    group.files.splice(fileIndex, 1);
                }
                if (!group.files || group.files.length === 0) {
                    unifiedConversionFiles = unifiedConversionFiles.filter(item => item.groupKey !== group.groupKey);
                }
                renderUnifiedConversionCards();
                return;
            }
            if (action === 'profile') {
                group.selectedProfile = actionEl.getAttribute('data-value');
                const selectedProfile = getSelectedProfileConfig(group);
                if (selectedProfile && !selectedProfile.formats.includes(group.targetFormat)) {
                    group.targetFormat = selectedProfile.formats[0] || '';
                }
                renderUnifiedConversionCards();
                return;
            }
            if (action === 'toggle-advanced') {
                const advanced = card.querySelector('.advanced-content');
                const icon = actionEl.querySelector('.toggle-icon');
                if (advanced) advanced.classList.toggle('show');
                if (icon) {
                    icon.classList.toggle('bi-chevron-down');
                    icon.classList.toggle('bi-chevron-up');
                }
            }
        });

        listEl.addEventListener('input', (event) => {
            const action = event.target.getAttribute('data-action');
            if (!action) return;
            const card = event.target.closest('[data-group-key]');
            if (!card) return;
            const group = unifiedConversionFiles.find(item => item.groupKey === card.getAttribute('data-group-key'));
            if (!group) return;
            if (action === 'opt-width') group.advanced.width = event.target.value;
            if (action === 'opt-height') group.advanced.height = event.target.value;
            if (action === 'opt-quality') {
                group.advanced.quality = Number(event.target.value || 100);
                const valueEl = event.target.closest('.range-input-group')?.querySelector('.range-value');
                if (valueEl) valueEl.textContent = String(group.advanced.quality);
            }
        });

        listEl.addEventListener('change', (event) => {
            const action = event.target.getAttribute('data-action');
            if (!action) return;
            const card = event.target.closest('[data-group-key]');
            if (!card) return;
            const group = unifiedConversionFiles.find(item => item.groupKey === card.getAttribute('data-group-key'));
            if (!group) return;
            if (action === 'target-format') group.targetFormat = event.target.value;
            if (action === 'opt-ico-size') group.advanced.icoSize = event.target.value;
            if (action === 'opt-video-res') group.advanced.videoRes = event.target.value;
            if (action === 'opt-video-preset') group.advanced.videoPreset = event.target.value;
            if (action === 'opt-audio-bitrate') group.advanced.audioBitrate = event.target.value;
            if (action === 'opt-privacy') group.advanced.privacySanitize = !!event.target.checked;
            if (action === 'target-format') {
                renderUnifiedConversionCards();
            }
        });

        runBtn.addEventListener('click', async () => {
            await runUnifiedBatchConversion(runBtn);
        });
    }

    function loadUnifiedConversionView() {
        ensureUnifiedRuntimeStyles();
        mainContent.innerHTML = `
            <h1>文件转换</h1>
            <p>仅需三步即可完成转换：上传文件 → 选择目标格式 → 执行转换</p>
            <div class="operation-container unified-conversion-container">
                <div id="unifiedDropZone" class="drop-zone unified-drop-zone">
                    <div class="drop-zone-content">
                        <div class="drop-zone-icon"><i class="bi bi-cloud-arrow-up"></i></div>
                        <div class="drop-zone-text">拖拽文件到此，或点击选择文件</div>
                        <div class="drop-zone-text">支持批量添加，系统会自动识别并给出可转换方案</div>
                    </div>
                </div>
                <div class="unified-actions-row">
                    <button id="selectUnifiedFilesBtn" class="secondary-btn"><i class="bi bi-plus-circle"></i> 添加文件</button>
                    <button id="clearUnifiedFilesBtn" class="secondary-btn"><i class="bi bi-trash3"></i> 清空列表</button>
                </div>
                <div id="unifiedConversionStatus" class="unified-status-bar"></div>
                <div id="unifiedConversionList" class="unified-file-list"></div>
                <button id="startUnifiedConversion" class="unified-start-btn"><i class="bi bi-play-circle" style="margin-right:6px;"></i>执行转换</button>
            </div>
        `;
        bindUnifiedConversionEvents();
        renderUnifiedConversionCards();

        const pendingRaw = document.body.dataset.pendingConversionFiles;
        if (pendingRaw) {
            try {
                const pendingFiles = JSON.parse(pendingRaw);
                if (Array.isArray(pendingFiles) && pendingFiles.length > 0) {
                    appendUnifiedConversionFiles(pendingFiles);
                }
            } catch (error) {
            }
            delete document.body.dataset.pendingConversionFiles;
        }
    }

    function stopHomeCarousel() {
        if (homeCarouselTimer) {
            clearInterval(homeCarouselTimer);
            homeCarouselTimer = null;
        }
    }

    function loadHomeView() {
        ensureHomeRuntimeStyles();
        const tips = [
            { emoji: '🚀', title: '本地离线运行', desc: '所有转换与加密均在本机完成，文件不上云、不联网、更安全。' },
            { emoji: '💡', title: '智能识别文件', desc: '拖入任何文件自动识别类型，无需手动分类，小白也能轻松用。' },
            { emoji: '🧩', title: '全能转换页面', desc: '图片、视频、音频、文档统一处理，一屏搞定所有格式转换。' },
            { emoji: '🔐', title: '军用级加密保护', desc: '内置XChaCha20高速加密，支持虚拟磁盘与文件加解密。' },
            { emoji: '🧼', title: '自动清理隐私数据', desc: '转换时自动清除图片/视频元数据，防止位置设备信息泄露。' },
            { emoji: '⚡', title: '轻量高效不吃资源', desc: '低配电脑也流畅运行，不占内存、不卡硬盘、不发热。' },
            { emoji: '📦', title: '批量混合转换', desc: '同时支持多类型文件批量处理，每组格式可独立设置。' },
            { emoji: '🛡️', title: '无广告无捆绑', desc: '纯粹工具软件，界面干净简洁，专注保护你的文件安全。' },
            
            // 👇 下面是新增【使用方法】tips，自然友好
            { emoji: '🖱️', title: '拖拽即可使用', desc: '无需手动选择，直接拖拽文件到软件内即可开始操作。' },
            { emoji: '📂', title: '单文件智能推荐', desc: '选择单个文件时，自动推荐最佳格式与最优转换设置。' },
            { emoji: '📑', title: '多文件分组管理', desc: '混合格式文件会自动分组，每组可独立配置输出格式。' },
            { emoji: '🔑', title: '加密使用步骤', desc: '选择文件 → 设置密码 → 一键加密，安全又简单。' },
            { emoji: '✅', title: '转换完成快速操作', desc: '任务结束后可直接打开文件或所在目录，无需手动查找。' }
        ];
        const featureCards = [
            { emoji: '🚀', title: '文件转换中心', desc: '统一处理图片、视频、音频、文档转换任务。', target: 'conversion', actionText: '进入转换中心' },
            { emoji: '🔒', title: '文件加密', desc: '快速加密敏感文件，保护本地与传输过程安全。', target: 'encryption', actionText: '进入文件加密' },
            { emoji: '🔓', title: '文件解密', desc: '还原加密文件并校验结果，确保可用性。', target: 'decryption', actionText: '进入文件解密' },
            { emoji: '🎭', title: '文件伪装加密', desc: '将加密内容封装为常见文件形态，便于管理。', target: 'disguise', actionText: '进入伪装加密' },
            { emoji: '🗄️', title: '虚拟加密磁盘', desc: '创建安全容器，集中存放关键资料。', target: 'safebox', actionText: '进入虚拟磁盘' },
            { emoji: '📊', title: '文件哈希校验', desc: '计算和比对哈希值，验证文件完整性。', target: 'hash', actionText: '进入哈希校验' },
            { emoji: '⚙️', title: '设置中心', desc: '管理输出目录、自动打开行为与基础偏好。', target: 'settings', actionText: '进入设置中心' }
        ];
        let currentTipIndex = Math.floor(Math.random() * tips.length);
        const pickNextTipIndex = () => {
            if (tips.length <= 1) return 0;
            let nextIndex = currentTipIndex;
            while (nextIndex === currentTipIndex) {
                nextIndex = Math.floor(Math.random() * tips.length);
            }
            return nextIndex;
        };
        mainContent.innerHTML = `
            <div id="homePage" class="home-page">
                <section class="home-hero">
                    <div class="home-hero-top">
                        <div>
                            <h1 class="home-title">👏 欢迎使用 TransCrypt Pro</h1>
                            <p class="home-subtitle">在首页直接进入关键功能，快速完成转换与安全处理任务</p>
                        </div>
                        <span class="home-badge">✨ 首页导航中心</span>
                    </div>
                    <div class="home-tip-strip">
                        <span id="homeTipEmoji" class="home-tip-emoji">${tips[currentTipIndex].emoji}</span>
                        <div class="home-tip-content">
                            <span id="homeTipTitle" class="home-tip-title">${tips[currentTipIndex].title}</span>
                            <span id="homeTipDesc" class="home-tip-desc">${tips[currentTipIndex].desc}</span>
                        </div>
                    </div>
                </section>
                <section class="home-grid">
                    ${featureCards.map(card => `
                        <article class="home-card">
                            <div class="home-card-emoji">${card.emoji}</div>
                            <div class="home-card-title">${card.title}</div>
                            <div class="home-card-desc">${card.desc}</div>
                            <button class="home-feature-btn" type="button" data-action="home-nav" data-target-category="${card.target}">
                                ${card.emoji} ${card.actionText}
                            </button>
                        </article>
                    `).join('')}
                </section>
            </div>
        `;
        const homePageEl = document.getElementById('homePage');
        const tipEmojiEl = document.getElementById('homeTipEmoji');
        const tipTitleEl = document.getElementById('homeTipTitle');
        const tipDescEl = document.getElementById('homeTipDesc');
        const renderTip = (index) => {
            currentTipIndex = index;
            const tip = tips[currentTipIndex];
            if (!tip) return;
            if (tipEmojiEl) tipEmojiEl.textContent = tip.emoji;
            if (tipTitleEl) tipTitleEl.textContent = tip.title;
            if (tipDescEl) tipDescEl.textContent = tip.desc;
        };
        const restartAutoPlay = () => {
            stopHomeCarousel();
            homeCarouselTimer = setInterval(() => {
                renderTip(pickNextTipIndex());
            }, 3000);
        };
        renderTip(currentTipIndex);
        restartAutoPlay();
        if (homePageEl) {
            homePageEl.addEventListener('click', (event) => {
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.getAttribute('data-action');
                if (action === 'home-nav') {
                    const targetCategory = actionEl.getAttribute('data-target-category');
                    const targetButton = Array.from(sidebarButtons).find(
                        btn => btn.getAttribute('data-category') === targetCategory
                    );
                    if (targetButton) {
                        targetButton.click();
                    }
                }
            });
        }
    }

    // 加载内容到主容器
    function loadContent(category) {
        if (category !== 'home') {
            stopHomeCarousel();
        }
        if (category === 'home') {
            loadHomeView();
            return;
        }
        if (category === 'conversion') {
            loadUnifiedConversionView();
            return;
        }
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
        if (category === 'disguise') {
            loadDisguiseView();
            bindDisguiseEvents();
            return;
        }
        if (category === 'safebox') {
            loadSafeboxView();
            bindSafeboxEvents();
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
            
            setOperationBusy(newStartButton, true, '正在转换');
            
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
                        showOperationResultPage({
                            title: '转换完成',
                            subtitle: `${categoryNameMap[category]} → ${targetFormat.toUpperCase()}`,
                            status: 'success',
                            contentHtml: resultContainer.innerHTML,
                            actionBindings: [
                                { selector: '#openFolderAction', handler: () => window.electronAPI.showItemInFolder(result.outputPath) },
                                { selector: '#openFileAction', handler: () => window.electronAPI.openPath(result.outputPath) },
                                {
                                    selector: '#resultFileInfo',
                                    event: 'contextmenu',
                                    handler: (e) => {
                                        e.preventDefault();
                                        window.electronAPI.showContextMenu(result.outputPath);
                                    }
                                }
                            ]
                        });
                    }
                } else {
                    showToast(`转换失败: ${result.message}`, 'error', 5000);
                    showOperationResultPage({
                        title: '转换失败',
                        subtitle: `${categoryNameMap[category]} → ${targetFormat.toUpperCase()}`,
                        status: 'error',
                        contentHtml: `
                            <div class="conversion-error-card">
                                <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>转换失败</span></div>
                                <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${result.message}</div></div>
                            </div>
                        `
                    });
                }
            })
            .catch(error => {
                // 移除正在转换的 toast
                const toasts = document.querySelectorAll('.toast.info');
                toasts.forEach(t => t.remove());
                
                if (progressTimer) clearInterval(progressTimer);
                const progressContainer = document.getElementById('progressContainer');
                if (progressContainer) progressContainer.style.display = 'none';
                
                showToast(`错误: ${error.message}`, 'error', 5000);
                showOperationResultPage({
                    title: '转换异常',
                    subtitle: `${categoryNameMap[category]} → ${targetFormat.toUpperCase()}`,
                    status: 'error',
                    contentHtml: `
                        <div class="conversion-error-card">
                            <div class="error-header"><i class="bi bi-x-circle-fill"></i><span>转换异常</span></div>
                            <div class="result-info"><div class="meta-item"><span class="meta-label">错误信息:</span> ${error.message}</div></div>
                        </div>
                    `
                });
            })
            .finally(() => {
                setOperationBusy(startButton, false);
            });
    }
});
