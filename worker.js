const { parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');
const convert = require('libreoffice-convert');
const os = require('os');

parentPort.on('message', async (task) => {
    const { filePath, outputPath, targetFormat, category, options, ffmpegPath } = task;

    try {
        let extraInfo = null;
        // Report start
        parentPort.postMessage({ type: 'progress', value: 5 });

        switch (category) {
            case 'images':
                extraInfo = await convertImage(filePath, outputPath, targetFormat, options);
                break;
            case 'videos':
                await convertVideo(filePath, outputPath, targetFormat, options, ffmpegPath);
                break;
            case 'audio':
                await convertAudio(filePath, outputPath, targetFormat, options, ffmpegPath);
                break;
            case 'documents':
                await convertDocument(filePath, outputPath, targetFormat);
                break;
            default:
                fs.copyFileSync(filePath, outputPath);
        }

        parentPort.postMessage({ type: 'progress', value: 100 });
        parentPort.postMessage({ 
            type: 'success', 
            outputPath: outputPath,
            extra: extraInfo
        });
    } catch (error) {
        parentPort.postMessage({ 
            type: 'error', 
            message: error.message 
        });
    }
});

async function convertImage(inputPath, outputPath, targetFormat, options) {
    try {
        const format = targetFormat.toLowerCase();

        // Check magick
        try {
            execFileSync('magick', ['-version'], { stdio: 'ignore' });
        } catch (e) {
            throw new Error('未找到 ImageMagick (magick)。请安装 ImageMagick 并确保 magick 在 PATH 中。');
        }

        parentPort.postMessage({ type: 'progress', value: 20 });

        // ICO Special Handling
        if (format === 'ico') {
            if (options && Array.isArray(options.icoSizes) && options.icoSizes.length > 0) {
                const tmpDir = os.tmpdir();
                const tmpFiles = [];
                // 排序尺寸，从小到大排列是 ICO 的标准做法
                const sortedSizes = [...options.icoSizes].sort((a, b) => a - b);
                const totalSizes = sortedSizes.length;
                
                for (let i = 0; i < totalSizes; i++) {
                    const s = parseInt(sortedSizes[i], 10);
                    if (!s) continue;
                    
                    // 为每个尺寸生成一个唯一的临时文件名
                    const tmpPng = path.join(tmpDir, `ft_tmp_${Date.now()}_${s}_${i}.png`);
                    
                    // 使用 magick 将原图调整为指定尺寸的 PNG
                    // -background none -gravity center -extent ${s}x${s} 确保即使原图比例不对也能生成正方形
                    execFileSync('magick', [
                        inputPath, 
                        ...(options && options.privacySanitize ? ['-strip'] : []),
                        '-resize', `${s}x${s}`, 
                        '-background', 'none', 
                        '-gravity', 'center', 
                        '-extent', `${s}x${s}`, 
                        tmpPng
                    ]);
                    tmpFiles.push(tmpPng);
                    
                    const progress = 20 + Math.round(((i + 1) / totalSizes) * 60);
                    parentPort.postMessage({ type: 'progress', value: progress });
                }
                
                if (tmpFiles.length === 0) throw new Error('无效的 ICO 尺寸参数');
                
                parentPort.postMessage({ type: 'progress', value: 85 });
                
                // 将所有临时 PNG 合并为一个多图层的 ICO
                execFileSync('magick', [...tmpFiles, outputPath]);
                
                // 清理临时文件
                tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
                
                return { icoSizes: sortedSizes.map(s => ({ width: s, height: s })) };
            } else {
                // ... 默认处理逻辑 ...
            }
        }

        // Other formats
        const args = [inputPath];
        if (options && options.privacySanitize) {
            args.push('-strip');
        }
        
        // Apply resize if provided
        if (options && (options.width || options.height)) {
            const w = options.width || '';
            const h = options.height || '';
            args.push('-resize', `${w}x${h}`);
        }

        const quality = options && options.quality !== undefined ? options.quality : 90;

        if (format === 'jpg' || format === 'jpeg') {
            args.push('-quality', quality.toString());
            args.push(outputPath);
        } else if (format === 'png') {
            args.push('-background', 'none', '-flatten', outputPath);
        } else if (format === 'webp') {
            // WebP 默认处理，不再传递可能失效的 quality 参数
            args.push(outputPath);
        } else if (format === 'gif') {
            args.push(outputPath);
        } else {
            args.push(outputPath);
        }

        parentPort.postMessage({ type: 'progress', value: 50 });
        execFileSync('magick', args, { stdio: 'ignore' });
        
        return null;
    } catch (error) {
        throw new Error(`图片转换失败: ${error.message}`);
    }
}

async function convertVideo(inputPath, outputPath, targetFormat, options, ffmpegPath) {
    return new Promise((resolve, reject) => {
        const args = ['-i', inputPath, '-y'];

        if (options && options.privacySanitize) {
            args.push('-map_metadata', '-1', '-map_chapters', '-1');
        }

        // 视频分辨率
        if (options.videoRes) {
            args.push('-vf', `scale=${options.videoRes}`);
        }

        // 视频预设
        if (options.videoPreset) {
            args.push('-preset', options.videoPreset);
        }

        // 目标格式特定的编码建议
        const format = targetFormat.toLowerCase();
        if (format === 'mp4') {
            args.push('-c:v', 'libx264', '-c:a', 'aac');
        } else if (format === 'webm') {
            args.push('-c:v', 'libvpx-vp9', '-c:a', 'libopus');
        }

        args.push(outputPath);

        runFFmpeg(ffmpegPath, args, resolve, reject);
    });
}

async function convertAudio(inputPath, outputPath, targetFormat, options, ffmpegPath) {
    return new Promise((resolve, reject) => {
        const args = ['-i', inputPath, '-y'];

        // 如果输入是视频，禁用视频流以提取音频
        const inputExt = path.extname(inputPath).toLowerCase().replace('.', '');
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov', 'flv', 'webm', 'wmv'];
        if (videoExtensions.includes(inputExt)) {
            args.push('-vn');
        }

        // 音频码率
        if (options.audioBitrate) {
            args.push('-b:a', options.audioBitrate);
        }

        args.push(outputPath);

        runFFmpeg(ffmpegPath, args, resolve, reject);
    });
}

function runFFmpeg(ffmpegPath, args, resolve, reject) {
    try {
        const { spawn } = require('child_process');
        if (!ffmpegPath) {
            throw new Error('未找到 FFmpeg 执行文件。请手动下载 ffmpeg.exe 并放入项目根目录的 bin 文件夹中。');
        }
        // 使用传递进来的绝对路径启动 FFmpeg
        const ffmpeg = spawn(ffmpegPath, args);
        
        let duration = 0;

        ffmpeg.stderr.on('data', (data) => {
            const str = data.toString();
            
            // 解析总时长
            if (!duration) {
                const durationMatch = str.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
                if (durationMatch) {
                    duration = parseInt(durationMatch[1]) * 3600 + 
                               parseInt(durationMatch[2]) * 60 + 
                               parseInt(durationMatch[3]);
                }
            }

            // 解析当前时间进度
            const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2})/);
            if (timeMatch && duration > 0) {
                const currentTime = parseInt(timeMatch[1]) * 3600 + 
                                    parseInt(timeMatch[2]) * 60 + 
                                    parseInt(timeMatch[3]);
                const progress = Math.min(95, Math.round((currentTime / duration) * 100));
                parentPort.postMessage({ type: 'progress', value: progress });
            }
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg 退出，错误码: ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`无法启动 FFmpeg: ${err.message}。请确保已安装 FFmpeg。`));
        });
    } catch (e) {
        reject(e);
    }
}

async function convertDocument(inputPath, outputPath, targetFormat) {
    const format = targetFormat.toLowerCase();
    const outDir = path.dirname(outputPath);
    const inputExt = path.extname(inputPath).toLowerCase();
    const inputBaseName = path.basename(inputPath, inputExt);

    parentPort.postMessage({ type: 'progress', value: 30 });

    // Try LibreOffice CLI first (using system PATH)
    try {
        // 在 Windows 上，即使在 PATH 中，直接调用 soffice 有时也需要加上 .exe 或者通过 cmd 调用
        // 但根据用户要求使用环境变量里的，直接调用 soffice 通常是最好的
        const cmd = 'soffice';
        
        // 执行转换命令
        // --headless: 无界面模式
        // --convert-to: 目标格式
        // --outdir: 输出目录
        execSync(`"${cmd}" --headless --convert-to ${format} --outdir "${outDir}" "${inputPath}"`, { 
            stdio: 'ignore',
            windowsHide: true 
        });
        
        parentPort.postMessage({ type: 'progress', value: 80 });

        // LibreOffice 默认生成的名称是 "原文件名.目标格式"
        // 注意：LibreOffice 可能会微调扩展名（如 jpeg -> jpg），或者在某些情况下保持原扩展名（如果不转换）
        const generatedFileName = `${inputBaseName}.${format}`;
        let generatedPath = path.join(outDir, generatedFileName);

        // 如果找不到精确匹配的文件，尝试在输出目录搜索以原文件名开头且扩展名为目标格式的文件
        if (!fs.existsSync(generatedPath)) {
            const files = fs.readdirSync(outDir);
            const matchedFile = files.find(f => {
                const fExt = path.extname(f).toLowerCase().replace('.', '');
                return f.startsWith(inputBaseName) && fExt === format;
            });
            if (matchedFile) {
                generatedPath = path.join(outDir, matchedFile);
            }
        }

        if (fs.existsSync(generatedPath)) {
            // 如果生成的文件路径与目标路径不同（用户可能更改了保存的文件名），则进行重命名
            if (path.resolve(generatedPath) !== path.resolve(outputPath)) {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                fs.renameSync(generatedPath, outputPath);
            }
            return;
        } else {
            throw new Error('LibreOffice CLI 未能生成预期的输出文件。');
        }
    } catch (cliErr) {
        parentPort.postMessage({ type: 'progress', value: 40 });
        
        // 如果 CLI 失败，尝试使用 libreoffice-convert 库作为后备
        // 注意：这个库内部也依赖于找到 soffice
        try {
            const fileBuffer = fs.readFileSync(inputPath);
            // 对于库方法，format 需要带点
            const libFormat = '.' + format;
            
            const convertedBuffer = await new Promise((resolve, reject) => {
                convert.convert(fileBuffer, libFormat, undefined, (err, done) => {
                    if (err) return reject(err);
                    resolve(done);
                });
            });
            
            parentPort.postMessage({ type: 'progress', value: 90 });
            fs.writeFileSync(outputPath, convertedBuffer);
            return;
        } catch (libErr) {
            throw new Error(`文档转换失败: 
            CLI 方式错误: ${cliErr.message}
            后备库方式错误: ${libErr.message}
            请确保系统已安装 LibreOffice 并且 'soffice' 已添加到环境变量 PATH 中。`);
        }
    }
}
