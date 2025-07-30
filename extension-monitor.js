const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');

class ExtensionFileMonitor {
    constructor() {
        this.watchers = new Map();
        this.extensionsBackup = new Map();
        this.lastSnapshot = new Map();
        this.isMonitoring = false;
    }

    // 开始监控指定配置的扩展目录
    async startMonitoring(configId, userDataDir, configName) {
        try {
            const extensionsPath = path.join(userDataDir, 'Extensions');
            
            console.log(`🔍 开始监控配置 "${configName}" 的扩展目录: ${extensionsPath}`);
            
            // 确保目录存在
            await fs.mkdir(extensionsPath, { recursive: true });
            
            // 创建初始快照
            const snapshot = await this.createSnapshot(extensionsPath);
            this.lastSnapshot.set(configId, snapshot);
            
            // 停止现有监控（如果有）
            if (this.watchers.has(configId)) {
                await this.stopMonitoring(configId);
            }

            // 创建文件监控器
            const watcher = chokidar.watch(extensionsPath, {
                ignored: /(^|[\/\\])\../, // 忽略隐藏文件
                persistent: true,
                depth: 10,
                ignoreInitial: true
            });

            // 监听事件
            watcher
                .on('add', (filePath) => {
                    this.handleFileChange(configId, configName, 'add', filePath);
                })
                .on('change', (filePath) => {
                    this.handleFileChange(configId, configName, 'change', filePath);
                })
                .on('unlink', (filePath) => {
                    this.handleFileChange(configId, configName, 'delete', filePath);
                })
                .on('addDir', (dirPath) => {
                    this.handleDirectoryChange(configId, configName, 'add', dirPath);
                })
                .on('unlinkDir', (dirPath) => {
                    this.handleDirectoryChange(configId, configName, 'delete', dirPath);
                })
                .on('error', (error) => {
                    console.error(`❌ 监控器错误 [${configName}]:`, error);
                });

            this.watchers.set(configId, watcher);
            
            // 创建初始备份
            await this.createBackup(configId, extensionsPath, configName);
            
            console.log(`✅ 扩展监控已启动 [${configName}]`);
            
        } catch (error) {
            console.error(`❌ 启动监控失败 [${configName}]:`, error);
        }
    }

    // 停止监控
    async stopMonitoring(configId) {
        const watcher = this.watchers.get(configId);
        if (watcher) {
            await watcher.close();
            this.watchers.delete(configId);
            console.log(`⏹️ 已停止监控配置 ${configId}`);
        }
    }

    // 停止所有监控
    async stopAllMonitoring() {
        for (const [configId, watcher] of this.watchers) {
            await watcher.close();
        }
        this.watchers.clear();
        console.log('⏹️ 已停止所有扩展监控');
    }

    // 处理文件变化
    handleFileChange(configId, configName, action, filePath) {
        const timestamp = new Date().toLocaleString();
        const relativePath = this.getRelativePath(filePath);
        
        switch (action) {
            case 'add':
                console.log(`📄 [${timestamp}] [${configName}] 文件新增: ${relativePath}`);
                break;
            case 'change':
                console.log(`📝 [${timestamp}] [${configName}] 文件修改: ${relativePath}`);
                break;
            case 'delete':
                console.error(`🗑️ [${timestamp}] [${configName}] 文件删除: ${relativePath}`);
                this.handleFileDelete(configId, configName, filePath);
                break;
        }
    }

    // 处理目录变化
    handleDirectoryChange(configId, configName, action, dirPath) {
        const timestamp = new Date().toLocaleString();
        const relativePath = this.getRelativePath(dirPath);
        
        switch (action) {
            case 'add':
                console.log(`📁 [${timestamp}] [${configName}] 目录新增: ${relativePath}`);
                break;
            case 'delete':
                console.error(`🗂️ [${timestamp}] [${configName}] 目录删除: ${relativePath}`);
                this.handleDirectoryDelete(configId, configName, dirPath);
                break;
        }
    }

    // 处理文件删除
    async handleFileDelete(configId, configName, filePath) {
        const relativePath = this.getRelativePath(filePath);
        
        // 检查是否是扩展相关文件
        if (this.isExtensionFile(filePath)) {
            console.error(`🚨 警告：扩展文件被删除！`);
            console.error(`  配置: ${configName}`);
            console.error(`  文件: ${relativePath}`);
            
            // 获取调用栈（如果可能）
            this.logCallStack();
            
            // 尝试从备份恢复
            await this.attemptRestore(configId, configName, filePath);
        }
    }

    // 处理目录删除
    async handleDirectoryDelete(configId, configName, dirPath) {
        const relativePath = this.getRelativePath(dirPath);
        
        // 检查是否是扩展目录
        if (this.isExtensionDirectory(dirPath)) {
            console.error(`🚨 严重警告：扩展目录被删除！`);
            console.error(`  配置: ${configName}`);
            console.error(`  目录: ${relativePath}`);
            
            // 获取调用栈
            this.logCallStack();
            
            // 尝试从备份恢复整个目录
            await this.attemptRestoreDirectory(configId, configName, dirPath);
        }
    }

    // 创建目录快照
    async createSnapshot(extensionsPath) {
        const snapshot = new Map();
        
        try {
            await this.scanDirectory(extensionsPath, snapshot);
        } catch (error) {
            console.warn(`⚠️ 创建快照失败: ${error.message}`);
        }
        
        return snapshot;
    }

    // 递归扫描目录
    async scanDirectory(dirPath, snapshot, relativePath = '') {
        try {
            const items = await fs.readdir(dirPath);
            
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const itemRelativePath = path.join(relativePath, item);
                
                try {
                    const stat = await fs.stat(fullPath);
                    
                    if (stat.isDirectory()) {
                        snapshot.set(itemRelativePath, { type: 'directory', mtime: stat.mtime });
                        await this.scanDirectory(fullPath, snapshot, itemRelativePath);
                    } else {
                        snapshot.set(itemRelativePath, { 
                            type: 'file', 
                            size: stat.size, 
                            mtime: stat.mtime 
                        });
                    }
                } catch (statError) {
                    console.warn(`⚠️ 无法读取项目状态: ${fullPath}`);
                }
            }
        } catch (error) {
            console.warn(`⚠️ 无法读取目录: ${dirPath}`);
        }
    }

    // 创建备份
    async createBackup(configId, extensionsPath, configName) {
        try {
            const backupPath = path.join(path.dirname(extensionsPath), '..', 'ExtensionsBackup');
            await fs.mkdir(backupPath, { recursive: true });
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(backupPath, `backup-${timestamp}`);
            
            await this.copyDirectory(extensionsPath, backupDir);
            
            this.extensionsBackup.set(configId, backupDir);
            
            console.log(`💾 已创建扩展备份 [${configName}]: ${backupDir}`);
            
        } catch (error) {
            console.error(`❌ 创建备份失败 [${configName}]:`, error);
        }
    }

    // 复制目录
    async copyDirectory(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        
        try {
            const items = await fs.readdir(src);
            
            for (const item of items) {
                const srcPath = path.join(src, item);
                const destPath = path.join(dest, item);
                
                try {
                    const stat = await fs.stat(srcPath);
                    
                    if (stat.isDirectory()) {
                        await this.copyDirectory(srcPath, destPath);
                    } else {
                        await fs.copyFile(srcPath, destPath);
                    }
                } catch (error) {
                    console.warn(`⚠️ 复制失败: ${srcPath}`);
                }
            }
        } catch (error) {
            console.warn(`⚠️ 读取源目录失败: ${src}`);
        }
    }

    // 尝试恢复文件
    async attemptRestore(configId, configName, filePath) {
        const backupDir = this.extensionsBackup.get(configId);
        if (!backupDir) {
            console.error(`❌ 没有找到配置 ${configName} 的备份`);
            return;
        }

        try {
            // 计算备份文件路径
            const relativePath = this.getRelativePath(filePath);
            const backupFilePath = path.join(backupDir, relativePath);
            
            // 检查备份文件是否存在
            await fs.access(backupFilePath);
            
            // 确保目标目录存在
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            
            // 恢复文件
            await fs.copyFile(backupFilePath, filePath);
            
            console.log(`✅ 已从备份恢复文件 [${configName}]: ${relativePath}`);
            
        } catch (error) {
            console.error(`❌ 恢复文件失败 [${configName}]:`, error);
        }
    }

    // 尝试恢复目录
    async attemptRestoreDirectory(configId, configName, dirPath) {
        const backupDir = this.extensionsBackup.get(configId);
        if (!backupDir) {
            console.error(`❌ 没有找到配置 ${configName} 的备份`);
            return;
        }

        try {
            const relativePath = this.getRelativePath(dirPath);
            const backupDirPath = path.join(backupDir, relativePath);
            
            // 检查备份目录是否存在
            await fs.access(backupDirPath);
            
            // 恢复整个目录
            await this.copyDirectory(backupDirPath, dirPath);
            
            console.log(`✅ 已从备份恢复目录 [${configName}]: ${relativePath}`);
            
        } catch (error) {
            console.error(`❌ 恢复目录失败 [${configName}]:`, error);
        }
    }

    // 获取相对路径
    getRelativePath(fullPath) {
        const extensionsIndex = fullPath.indexOf('Extensions');
        if (extensionsIndex !== -1) {
            return fullPath.substring(extensionsIndex);
        }
        return path.basename(fullPath);
    }

    // 检查是否是扩展文件
    isExtensionFile(filePath) {
        return filePath.includes('Extensions') && 
               (filePath.endsWith('manifest.json') || 
                filePath.endsWith('.js') || 
                filePath.endsWith('.html') || 
                filePath.endsWith('.css'));
    }

    // 检查是否是扩展目录
    isExtensionDirectory(dirPath) {
        return dirPath.includes('Extensions') && 
               dirPath.split(path.sep).length >= 2;
    }

    // 记录调用栈
    logCallStack() {
        const error = new Error();
        const stack = error.stack.split('\n').slice(2, 8);
        console.error('📚 调用栈:');
        stack.forEach(line => {
            console.error(`  ${line.trim()}`);
        });
    }

    // 获取监控统计
    getStats() {
        return {
            monitoredConfigs: this.watchers.size,
            backupsCreated: this.extensionsBackup.size,
            isActive: this.isMonitoring
        };
    }

    // 手动触发备份
    async manualBackup(configId, userDataDir, configName) {
        const extensionsPath = path.join(userDataDir, 'Extensions');
        await this.createBackup(configId, extensionsPath, configName);
    }
}

module.exports = ExtensionFileMonitor; 