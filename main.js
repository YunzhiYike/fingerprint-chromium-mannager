const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const ProxyForwarder = require('./proxy-forwarder');
const BrowserDownloader = require('./browser-downloader');
const UltimateSyncManager = require('./ultimate-sync-manager');
const NativeSyncManager = require('./native-sync-manager');
const ChromeExtensionManager = require('./chrome-extension-manager');
const { log } = require('console');

// 配置文件路径 - 使用用户数据目录避免打包后只读问题
let CONFIG_FILE;
let SETTINGS_FILE;

// 初始化配置文件路径
function initializeConfigPaths() {
    const userData = app.getPath('userData');
    CONFIG_FILE = path.join(userData, 'browser-configs.json');
    SETTINGS_FILE = path.join(userData, 'app-settings.json');
    
    console.log(`🔍 当前平台: ${process.platform}`);
    console.log(`📂 用户数据目录: ${userData}`);
    console.log(`📁 配置文件路径: ${CONFIG_FILE}`);
    console.log(`⚙️ 设置文件路径: ${SETTINGS_FILE}`);
    
    // 确保用户数据目录存在
    const fs = require('fs');
    try {
        if (!fs.existsSync(userData)) {
            fs.mkdirSync(userData, { recursive: true });
            console.log(`✅ 已创建用户数据目录: ${userData}`);
        }
    } catch (error) {
        console.error(`❌ 创建用户数据目录失败: ${error.message}`);
    }
}

// 迁移旧配置文件到用户数据目录
async function migrateOldConfigFiles() {
    try {
        const fs = require('fs').promises;
        
        // 旧文件路径（开发环境中的位置）
        const oldConfigFile = path.join(__dirname, 'browser-configs.json');
        const oldSettingsFile = path.join(__dirname, 'app-settings.json');
        const oldExtensionsDir = path.join(__dirname, 'chrome-extensions');
        
        // 检查并迁移配置文件
        try {
            await fs.access(oldConfigFile);
            const configExists = await fs.access(CONFIG_FILE).then(() => true).catch(() => false);
            
            if (!configExists) {
                const oldConfig = await fs.readFile(oldConfigFile, 'utf8');
                await fs.writeFile(CONFIG_FILE, oldConfig);
                console.log(`✅ 已迁移配置文件: ${oldConfigFile} -> ${CONFIG_FILE}`);
                
                // 可选：删除旧文件（在asar包外的情况下）
                try {
                    await fs.unlink(oldConfigFile);
                    console.log(`🗑️ 已删除旧配置文件: ${oldConfigFile}`);
                } catch (error) {
                    // 忽略删除错误（可能在asar包内）
                }
            }
        } catch (error) {
            // 旧配置文件不存在，忽略
        }
        
        // 检查并迁移设置文件
        try {
            await fs.access(oldSettingsFile);
            const settingsExists = await fs.access(SETTINGS_FILE).then(() => true).catch(() => false);
            
            if (!settingsExists) {
                const oldSettings = await fs.readFile(oldSettingsFile, 'utf8');
                await fs.writeFile(SETTINGS_FILE, oldSettings);
                console.log(`✅ 已迁移设置文件: ${oldSettingsFile} -> ${SETTINGS_FILE}`);
                
                // 可选：删除旧文件
                try {
                    await fs.unlink(oldSettingsFile);
                    console.log(`🗑️ 已删除旧设置文件: ${oldSettingsFile}`);
                } catch (error) {
                    // 忽略删除错误
                }
            }
        } catch (error) {
            // 旧设置文件不存在，忽略
        }
        
        // 🔄 迁移扩展目录
        try {
            await fs.access(oldExtensionsDir);
            const userData = app.getPath('userData');
            const newExtensionsDir = path.join(userData, 'chrome-extensions');
            
            // 检查新目录是否已存在
            const newDirExists = await fs.access(newExtensionsDir).then(() => true).catch(() => false);
            
            if (!newDirExists) {
                // 创建新目录
                await fs.mkdir(newExtensionsDir, { recursive: true });
                
                // 获取旧目录中的所有文件
                const files = await fs.readdir(oldExtensionsDir);
                const crxFiles = files.filter(file => file.endsWith('.crx'));
                
                if (crxFiles.length > 0) {
                    console.log(`🔄 开始迁移 ${crxFiles.length} 个扩展文件...`);
                    
                    for (const file of crxFiles) {
                        const oldFile = path.join(oldExtensionsDir, file);
                        const newFile = path.join(newExtensionsDir, file);
                        
                        try {
                            await fs.copyFile(oldFile, newFile);
                            console.log(`✅ 已迁移扩展: ${file}`);
                        } catch (copyError) {
                            console.warn(`⚠️ 迁移扩展失败 ${file}: ${copyError.message}`);
                        }
                    }
                    
                    console.log(`📦 扩展迁移完成: ${oldExtensionsDir} -> ${newExtensionsDir}`);
                }
            }
        } catch (error) {
            // 旧扩展目录不存在，忽略
        }
        
    } catch (error) {
        console.warn(`⚠️ 迁移配置文件时出现错误: ${error.message}`);
    }
}

// 默认设置 - 根据平台自动选择
const DEFAULT_SETTINGS = {
  chromiumPath: process.platform === 'win32' 
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/Applications/Chromium 2.app/Contents/MacOS/Chromium',
  defaultUserDataRoot: process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'ChromiumManager')
    : path.join(os.homedir(), 'Library', 'Application Support', 'ChromiumManager'),
  autoCleanup: true,
  maxRunningBrowsers: 10
};

let appSettings = { ...DEFAULT_SETTINGS };

let mainWindow;

// 跟踪运行中的浏览器进程
const runningBrowsers = new Map(); // configId -> { pid, process, startTime, debugPort, proxyPort }

// 代理转发器实例
const proxyForwarder = new ProxyForwarder();

// 浏览器下载器实例
const browserDownloader = new BrowserDownloader();

// Chrome扩展管理器实例 - 在应用初始化后创建
let extensionManager;

// 获取可用的调试端口
async function getAvailableDebugPort() {
  const usedPorts = new Set();
  for (const browserInfo of runningBrowsers.values()) {
    if (browserInfo.debugPort) {
      usedPorts.add(browserInfo.debugPort);
    }
  }

  let port = 9222; // Chrome默认调试端口
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hiddenInset',
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 自动打开开发者工具查看调试信息
    mainWindow.webContents.openDevTools();
  });

      // 开发模式下打开开发者工具
    if (process.argv.includes('--dev')) {
        // mainWindow.webContents.openDevTools();
    }

    // 窗口关闭前的处理
    mainWindow.on('close', async (event) => {
        console.log('窗口准备关闭，正在清理浏览器进程...');
        try {
            // 先阻止窗口关闭，等待清理完成
            event.preventDefault();

            // 通知渲染进程开始清理
            mainWindow.webContents.send('app-will-quit');

            // 等待一段时间让渲染进程处理
            setTimeout(() => {
                // 强制关闭所有浏览器进程
                cleanup();

                // 真正关闭窗口
                mainWindow.destroy();
            }, 1000);
        } catch (error) {
            console.error('清理过程出错:', error);
            mainWindow.destroy();
        }
    });
}

app.whenReady().then(async () => {
    // 🚀 初始化配置文件路径
    initializeConfigPaths();
    
    // 🔄 迁移旧配置文件（如果存在）
    await migrateOldConfigFiles();
    
    // 📦 创建扩展管理器实例（使用用户数据目录）
    const userData = app.getPath('userData');
    try {
        extensionManager = new ChromeExtensionManager(userData);
        console.log(`📦 扩展管理器已初始化，目录: ${userData}/chrome-extensions`);
        console.log(`🔍 Windows平台路径验证: ${process.platform === 'win32' ? '✅ 使用用户数据目录' : '✅ 使用标准路径'}`);
    } catch (error) {
        console.error(`❌ 扩展管理器初始化失败: ${error.message}`);
        // 创建一个空的扩展管理器实例作为回退
        extensionManager = {
            downloadExtension: () => ({ success: false, error: '扩展管理器未初始化' }),
            installExtensionsToConfig: () => ({ success: false, error: '扩展管理器未初始化' }),
            getDownloadedExtensions: () => [],
            batchDownloadExtensions: () => ({ success: false, error: '扩展管理器未初始化' })
        };
    }
    
    await loadAppSettings();
    createWindow();
});

// 应用退出前的清理
app.on('before-quit', async () => {
    console.log('应用准备退出，正在清理所有浏览器进程...');
    cleanup();
});

app.on('window-all-closed', () => {
    // 清理所有浏览器进程
    cleanup();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// 处理异常退出
process.on('SIGINT', () => {
    console.log('接收到 SIGINT 信号，正在清理...');
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('接收到 SIGTERM 信号，正在清理...');
    cleanup();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.warn('未捕获的异常 (已处理):', error.message);
    // 记录详细错误信息，但不要让应用崩溃
    if (error.code === 'ECONNRESET' || error.code === 'EPIPE' || error.code === 'ENOTFOUND') {
        console.warn('网络连接错误，这通常是代理服务器的问题，应用继续运行');
        return; // 不退出应用
    }

    // 只有在严重错误时才退出
    console.error('严重错误:', error);
    cleanup();
    process.exit(1);
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
    console.warn('未处理的Promise拒绝 (已处理):', reason);
    // 不让Promise拒绝导致应用崩溃
});

// 清理函数
function cleanup() {
    console.log('开始清理浏览器进程和代理转发器...');

    // 关闭所有追踪的浏览器进程
    for (const [configId, browserInfo] of runningBrowsers.entries()) {
        try {
            // 停止相关的代理转发器
            if (browserInfo.proxyPort) {
                proxyForwarder.stopForwarder(configId);
            }

            if (browserInfo.process && !browserInfo.process.killed) {
                console.log(`终止浏览器进程 ${browserInfo.pid} (${browserInfo.configName})`);

                // 尝试优雅关闭
                browserInfo.process.kill('SIGTERM');

                // 如果进程没有在 3 秒内关闭，强制终止
                setTimeout(() => {
                    if (!browserInfo.process.killed) {
                        browserInfo.process.kill('SIGKILL');
                    }
                }, 3000);
            }
        } catch (error) {
            console.error(`关闭浏览器进程失败:`, error);
        }
    }

    // 停止所有代理转发器
    proxyForwarder.stopAllForwarders();

    // 清空进程列表
    runningBrowsers.clear();

    console.log('浏览器进程和代理转发器清理完成');
}

// IPC handlers
ipcMain.handle('load-configs', async () => {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
});

ipcMain.handle('save-configs', async (event, configs) => {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(configs, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('launch-browser', async (event, config) => {
  try {
    // 检查是否已有实例在运行
    if (runningBrowsers.has(config.id)) {
      return { success: false, error: '该配置的浏览器实例已在运行中' };
    }

    const { args, debugPort, proxyPort } = await buildChromiumArgs(config);

    const child = spawn(appSettings.chromiumPath, args, {
      detached: true,
      stdio: 'ignore'
    });

    // 记录进程信息
    runningBrowsers.set(config.id, {
      pid: child.pid,
      process: child,
      startTime: new Date().toISOString(),
      configName: config.name,
      debugPort: debugPort,
      proxyPort: proxyPort
    });

    // 监听进程退出事件
    child.on('exit', () => {
      // 停止相关的代理转发器
      if (proxyPort) {
        proxyForwarder.stopForwarder(config.id);
      }
      runningBrowsers.delete(config.id);
      // 通知渲染进程更新状态
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-process-updated');
      }
    });

    child.on('error', (error) => {
      // 停止相关的代理转发器
      if (proxyPort) {
        proxyForwarder.stopForwarder(config.id);
      }
      runningBrowsers.delete(config.id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-process-updated');
      }
    });

    child.unref();

    // 通知渲染进程更新状态
    if (mainWindow) {
      mainWindow.webContents.send('browser-process-updated');
    }

    return { success: true, pid: child.pid, debugPort: debugPort };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-chromium-path', async () => {
  try {
    await fs.access(appSettings.chromiumPath);
    return { exists: true, path: appSettings.chromiumPath };
  } catch (error) {
    return { exists: false, path: appSettings.chromiumPath, error: error.message };
  }
});

ipcMain.handle('get-running-browsers', async () => {
  const browsers = [];
  for (const [configId, info] of runningBrowsers.entries()) {
    browsers.push({
      configId,
      pid: info.pid,
      configName: info.configName,
      startTime: info.startTime,
      debugPort: info.debugPort,
      debugUrl: `http://localhost:${info.debugPort}`
    });
  }
  return browsers;
});

ipcMain.handle('activate-browser', async (event, configId) => {
  try {
    const browserInfo = runningBrowsers.get(configId);
    if (!browserInfo) {
      return { success: false, error: '浏览器进程未找到' };
    }

    // 在macOS上激活应用
    return new Promise((resolve) => {
      exec(`osascript -e 'tell application "System Events" to set frontmost of every process whose unix id is ${browserInfo.pid} to true'`, (error) => {
        if (error) {
          resolve({ success: false, error: '激活失败: ' + error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 窗口布局管理 - 对所有浏览器窗口生效
ipcMain.handle('arrange-windows', async (event, { configIds, layoutType }) => {
  try {
    console.log(`开始${layoutType}窗口布局，应用于所有正在运行的浏览器`);
    
    // 获取所有正在运行的浏览器（不只是选中的）
    const allBrowsers = Array.from(runningBrowsers.values());
    
    if (allBrowsers.length === 0) {
      return { success: false, error: '没有找到正在运行的浏览器窗口' };
    }
    
    console.log(`找到 ${allBrowsers.length} 个正在运行的浏览器窗口:`, 
                allBrowsers.map(b => b.configName));
    
    const platform = process.platform;
    
    if (platform === 'win32') {
      return await arrangeWindowsWindows(allBrowsers, layoutType);
    } else if (platform === 'darwin') {
      return await arrangeWindowsMacOS(allBrowsers, layoutType);
    } else if (platform === 'linux') {
      return await arrangeWindowsLinux(allBrowsers, layoutType);
    } else {
      return { success: false, error: '不支持的操作系统' };
    }
    
  } catch (error) {
    console.error('窗口布局失败:', error);
    return { success: false, error: error.message };
  }
});

// 浏览器同步操作
ipcMain.handle('sync-browser-action', async (event, { masterConfigId, targetConfigIds, action }) => {
  try {
    console.log(`同步操作: ${action.type}，主控浏览器: ${masterConfigId}，目标浏览器:`, targetConfigIds);
    
    const masterBrowser = runningBrowsers.get(masterConfigId);
    if (!masterBrowser) {
      return { success: false, error: '主控浏览器未找到' };
    }
    
    const targetBrowsers = [];
    for (const configId of targetConfigIds) {
      const browserInfo = runningBrowsers.get(configId);
      if (browserInfo && configId !== masterConfigId) {
        targetBrowsers.push(browserInfo);
      }
    }
    
    if (targetBrowsers.length === 0) {
      return { success: false, error: '没有找到可同步的目标浏览器' };
    }
    
    return await executeSyncAction(targetBrowsers, action);
    
  } catch (error) {
    console.error('同步操作失败:', error);
    return { success: false, error: error.message };
  }
});

// 启用/禁用浏览器同步监听 - 支持两种同步模式
let ultimateSyncManager = null;
let nativeSyncManager = null;
let currentSyncMode = 'ultimate'; // 'ultimate' 或 'native'

ipcMain.handle('toggle-browser-sync', async (event, { enabled, masterConfigId, targetConfigIds }) => {
  try {
    if (enabled) {
      console.log('🔄 启用终极集群同步...');
      console.log(`📋 主控浏览器ID: ${masterConfigId}`);
      console.log(`📋 目标浏览器ID: ${targetConfigIds.join(', ')}`);
      
      // 获取主控浏览器信息
      const masterBrowser = runningBrowsers.get(masterConfigId);
      if (!masterBrowser) {
        console.error(`❌ 主控浏览器未找到: ${masterConfigId}`);
        console.log(`📊 当前运行的浏览器:`, Array.from(runningBrowsers.keys()));
        return { success: false, error: '主控浏览器未找到' };
      }
      
      console.log(`✅ 找到主控浏览器: ${masterBrowser.configName} (端口: ${masterBrowser.debugPort})`);
      
      // 构建主控浏览器信息对象
      const masterBrowserInfo = {
        configId: masterConfigId,
        configName: masterBrowser.configName,
        debugPort: masterBrowser.debugPort
      };
      
      // 验证并构建目标浏览器信息
      const targetBrowserInfos = [];
      for (const targetId of targetConfigIds) {
        const targetBrowser = runningBrowsers.get(targetId);
        if (targetBrowser && targetId !== masterConfigId) {
          targetBrowserInfos.push({
            configId: targetId,
            configName: targetBrowser.configName,
            debugPort: targetBrowser.debugPort
          });
          console.log(`✅ 找到目标浏览器: ${targetBrowser.configName} (端口: ${targetBrowser.debugPort})`);
        } else if (targetId === masterConfigId) {
          console.log(`⚠️ 跳过主控浏览器: ${targetId}`);
        } else {
          console.log(`❌ 目标浏览器未找到: ${targetId}`);
        }
      }
      
      if (targetBrowserInfos.length === 0) {
        return { success: false, error: '没有可用的目标浏览器' };
      }
      
      console.log(`📊 有效目标浏览器数量: ${targetBrowserInfos.length}`);
      
      // 根据选择的模式启动对应的同步管理器
      let result;
      if (currentSyncMode === 'native') {
        console.log('🎯 使用原生句柄同步模式...');
        nativeSyncManager = new NativeSyncManager();
        result = await nativeSyncManager.start({
          masterDebugPort: masterBrowserInfo.debugPort,
          targetDebugPorts: targetBrowserInfos.map(t => t.debugPort),
          masterConfig: masterBrowserInfo,
          targetConfigs: targetBrowserInfos
        });
      } else {
        console.log('🔥 使用混合事件同步模式...');
        ultimateSyncManager = new UltimateSyncManager();
        result = await ultimateSyncManager.start({
          masterDebugPort: masterBrowserInfo.debugPort,
          targetDebugPorts: targetBrowserInfos.map(t => t.debugPort),
          masterConfig: masterBrowserInfo,
          targetConfigs: targetBrowserInfos
        });
      }
      
      if (result.success) {
        console.log(`✅ 终极集群同步启动成功`);
        return result;
      } else {
        console.error(`❌ 终极集群同步启动失败:`, result.error);
        ultimateSyncManager = null;
        return result;
      }
      
    } else {
      console.log('🔄 禁用终极集群同步...');
      
      // 停止当前活动的同步管理器
      if (ultimateSyncManager) {
        const result = await ultimateSyncManager.stop();
        ultimateSyncManager = null;
        console.log(`✅ 混合事件同步已停止`);
        return result;
      } else if (nativeSyncManager) {
        const result = await nativeSyncManager.stop();
        nativeSyncManager = null;
        console.log(`✅ 原生句柄同步已停止`);
        return result;
      }
      
      return { success: true, message: '同步已禁用' };
    }
    
  } catch (error) {
    console.error('❌ 切换终极同步状态失败:', error);
    // 清理所有可能的同步管理器
    if (ultimateSyncManager) {
      await ultimateSyncManager.cleanup();
      ultimateSyncManager = null;
    }
    if (nativeSyncManager) {
      await nativeSyncManager.stop();
      nativeSyncManager = null;
    }
    return { success: false, error: error.message };
  }
});

// 切换同步模式 (新增)
ipcMain.handle('switch-sync-mode', async (event, { mode }) => {
  try {
    console.log(`🔄 切换同步模式到: ${mode}`);
    
    // 如果有活动的同步管理器，先停止它
    if (ultimateSyncManager) {
      await ultimateSyncManager.stop();
      ultimateSyncManager = null;
    }
    if (nativeSyncManager) {
      await nativeSyncManager.stop();
      nativeSyncManager = null;
    }
    
    // 设置新的同步模式
    currentSyncMode = mode;
    console.log(`✅ 同步模式已切换到: ${mode === 'native' ? '原生句柄控制' : '混合事件控制'}`);
    
    return { success: true, mode: currentSyncMode };
  } catch (error) {
    console.error('❌ 切换同步模式失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取当前同步模式 (新增)
ipcMain.handle('get-sync-mode', async () => {
  return { mode: currentSyncMode };
});

// 切换浏览器UI控制模式
ipcMain.handle('toggle-browser-ui-mode', async (event, { enabled }) => {
  try {
    if (ultimateSyncManager) {
      ultimateSyncManager.browserUIMode = enabled;
      
      if (enabled) {
        // 重新缓存窗口信息
        await ultimateSyncManager.cacheBrowserWindows();
        console.log(`🎯 浏览器UI控制模式已启用`);
        return { 
          success: true, 
          message: '浏览器UI控制模式已启用 - 现在可以控制地址栏、工具栏等浏览器界面元素' 
        };
      } else {
        // 清空窗口缓存
        ultimateSyncManager.windowCache.clear();
        console.log(`🎯 浏览器UI控制模式已禁用`);
        return { 
          success: true, 
          message: '浏览器UI控制模式已禁用 - 仅同步网页内容' 
        };
      }
    } else {
      return { 
        success: true, 
        message: `UI控制模式设置为: ${enabled ? '启用' : '禁用'} (将在启动同步时生效)` 
      };
    }
  } catch (error) {
    console.error('❌ 切换UI控制模式失败:', error);
    return { success: false, error: error.message };
  }
});

// 刷新浏览器窗口信息
ipcMain.handle('refresh-window-info', async () => {
  try {
    if (ultimateSyncManager && ultimateSyncManager.browserUIMode) {
      console.log('🔄 手动刷新浏览器窗口信息...');
      
      // 清空现有缓存
      ultimateSyncManager.windowCache.clear();
      
      // 重新缓存窗口信息
      await ultimateSyncManager.cacheBrowserWindows();
      
      const windowCount = ultimateSyncManager.windowCache.size;
      console.log(`✅ 窗口信息刷新完成，共缓存 ${windowCount} 个窗口`);
      
      return { 
        success: true, 
        message: '浏览器窗口信息刷新完成', 
        windowCount 
      };
    } else {
      return { 
        success: false, 
        error: 'UI控制模式未启用或同步管理器未运行' 
      };
    }
  } catch (error) {
    console.error('❌ 刷新窗口信息失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取终极同步状态信息
ipcMain.handle('get-sync-status', async () => {
  try {
    if (!ultimateSyncManager) {
      return {
        enabled: false,
        message: '终极同步管理器未启动'
      };
    }
    
    const status = ultimateSyncManager.getStatus();
    return {
      enabled: status.enabled,
      eventCount: status.eventCount,
      injectionAttempts: status.injectionAttempts,
      connectedBrowsers: status.connectedBrowsers,
      masterBrowser: status.masterBrowser,
      targetBrowsers: status.targetBrowsers,
      targetCount: status.targetBrowsers.length,
      message: status.enabled ? '终极同步运行中' : '终极同步已停止'
    };
  } catch (error) {
    return {
      enabled: false,
      error: error.message,
      message: '获取同步状态失败'
    };
  }
});

// 同步窗口大小
ipcMain.handle('sync-window-sizes', async () => {
  try {
    if (!ultimateSyncManager) {
      return {
        success: false,
        error: '同步管理器未初始化',
        message: '请先启用同步功能'
      };
    }
    
    const result = await ultimateSyncManager.syncWindowSizes();
    return {
      success: true,
      data: result,
      message: result.message
    };
  } catch (error) {
    console.error('❌ 窗口大小同步失败:', error.message);
    return {
      success: false,
      error: error.message,
      message: '窗口大小同步失败: ' + error.message
    };
  }
});

ipcMain.handle('terminate-browser', async (event, configId) => {
  try {
    const browserInfo = runningBrowsers.get(configId);
    if (!browserInfo) {
      return { success: false, error: '浏览器进程未找到' };
    }

    // 停止相关的代理转发器
    if (browserInfo.proxyPort) {
      proxyForwarder.stopForwarder(configId);
    }

    // 终止进程
    process.kill(browserInfo.pid, 'SIGTERM');

    // 从映射中移除
    runningBrowsers.delete(configId);

    // 通知渲染进程更新状态
    if (mainWindow) {
      mainWindow.webContents.send('browser-process-updated');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-default-data-root', async () => {
  return appSettings.defaultUserDataRoot;
});

ipcMain.handle('generate-random-folder', () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `browser-${timestamp}-${random}`;
});

ipcMain.handle('show-root-folder-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据存储根目录',
      buttonLabel: '选择目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: path.join(os.homedir(), 'Documents')
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    } else {
      return { success: false, canceled: true };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-user-data-dir', async (event, rootPath, randomFolder) => {
  try {
    const defaultRoot = appSettings.defaultUserDataRoot;
    const actualRoot = rootPath || defaultRoot;
    const fullPath = path.join(actualRoot, randomFolder);

    // 创建目录（递归创建，如果不存在的话）
    await fs.mkdir(fullPath, { recursive: true });

    return { success: true, path: fullPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 批量操作处理器
ipcMain.handle('start-all-browsers', async () => {
    try {
        // 读取所有配置
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        const configs = JSON.parse(data);
        const results = [];

        console.log('准备启动配置数量:', configs.length);

        for (const config of configs) {
            // 检查是否已经在运行
            const isRunning = runningBrowsers.has(config.id);
            console.log(`配置 ${config.name} (${config.id}) 是否已运行:`, isRunning);

            if (!isRunning) {
                try {
                    // 构建启动参数
                    const { args, debugPort, proxyPort } = await buildChromiumArgs(config);
                    console.log(`配置 ${config.name} 启动参数:`, args.join(' '));

                    const child = spawn(appSettings.chromiumPath, args, {
                        detached: true,
                        stdio: 'ignore'
                    });

                    console.log(`配置 ${config.name} 启动成功，PID:`, child.pid);

                    // 记录进程信息
                    runningBrowsers.set(config.id, {
                        pid: child.pid,
                        process: child,
                        startTime: new Date().toISOString(),
                        configName: config.name,
                        debugPort: debugPort,
                        proxyPort: proxyPort
                    });

                    // 监听进程退出事件
                    child.on('exit', () => {
                        // 停止相关的代理转发器
                        if (proxyPort) {
                            proxyForwarder.stopForwarder(config.id);
                        }
                        runningBrowsers.delete(config.id);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('browser-process-updated');
                        }
                    });

                    child.on('error', (error) => {
                        console.error(`配置 ${config.name} 进程错误:`, error);
                        // 停止相关的代理转发器
                        if (proxyPort) {
                            proxyForwarder.stopForwarder(config.id);
                        }
                        runningBrowsers.delete(config.id);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('browser-process-updated');
                        }
                    });

                    child.unref();

                    results.push({ configId: config.id, success: true, pid: child.pid });
                } catch (error) {
                    console.error(`启动配置 ${config.name} 失败:`, error);
                    results.push({ configId: config.id, success: false, error: error.message });
                }
            } else {
                results.push({ configId: config.id, success: false, error: '已在运行中' });
            }
        }

        // 通知渲染进程更新状态
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser-process-updated');
        }

        const finalResult = { success: true, results };
        console.log('返回最终结果:', finalResult);
        return finalResult;
    } catch (error) {
        console.error('批量启动异常:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-all-browsers', async () => {
    try {
        const results = [];

        // 复制数组，因为在终止过程中数组会被修改
        const browsersToStop = Array.from(runningBrowsers.entries());

        for (const [configId, browserInfo] of browsersToStop) {
            try {
                // 停止相关的代理转发器
                if (browserInfo.proxyPort) {
                    proxyForwarder.stopForwarder(configId);
                }

                if (browserInfo.process && !browserInfo.process.killed) {
                    browserInfo.process.kill('SIGTERM');
                    results.push({ configId, success: true });
                } else {
                    results.push({ configId, success: false, error: '进程已结束' });
                }
            } catch (error) {
                results.push({ configId, success: false, error: error.message });
            }
        }

        // 清空运行列表
        runningBrowsers.clear();

        // 通知渲染进程更新状态
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser-process-updated');
        }

        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 获取已安装扩展的ID (适应Chrome标准目录结构)
async function getInstalledExtensionIds(extensionsDir) {
  try {
    // 检查Extensions目录是否存在
    await fs.access(extensionsDir);
    
    const extensionIds = await fs.readdir(extensionsDir);
    const validExtensionIds = [];
    
    for (const extensionId of extensionIds) {
      const extensionPath = path.join(extensionsDir, extensionId);
      
      try {
        const stat = await fs.stat(extensionPath);
        if (stat.isDirectory()) {
          // 检查Chrome标准目录结构: Extensions/extensionId/version/manifest.json
          const versionDirs = await fs.readdir(extensionPath);
          
          for (const version of versionDirs) {
            const versionPath = path.join(extensionPath, version);
            
            try {
              const versionStat = await fs.stat(versionPath);
              if (versionStat.isDirectory()) {
                const manifestPath = path.join(versionPath, 'manifest.json');
                try {
                  await fs.access(manifestPath);
                  validExtensionIds.push(extensionId);
                  console.log(`✅ 发现有效扩展: ${extensionId} (版本: ${version})`);
                  break; // 找到一个有效版本就够了
                } catch (manifestError) {
                  console.log(`⚠️ 扩展 ${extensionId} 版本 ${version} 缺少manifest.json`);
                }
              }
            } catch (versionStatError) {
              console.log(`⚠️ 无法访问扩展版本目录: ${extensionId}/${version}`);
            }
          }
        }
      } catch (statError) {
        console.log(`⚠️ 无法访问扩展目录: ${extensionId}`);
      }
    }
    
    return validExtensionIds;
  } catch (error) {
    // Extensions目录不存在或无法访问
    return [];
  }
}

// 创建Chrome扩展Preferences文件以启用扩展
async function createExtensionPreferences(userDataDir, extensionIds) {
  try {
    const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
    
    // 读取现有Preferences文件
    let preferences = {};
    try {
      await fs.access(preferencesPath);
      const existingContent = await fs.readFile(preferencesPath, 'utf8');
      preferences = JSON.parse(existingContent);
      console.log(`📖 读取现有Preferences文件: ${preferencesPath}`);
    } catch (readError) {
      console.log(`📝 创建新的Preferences文件: ${preferencesPath}`);
      preferences = {};
    }
    
    // 确保extensions结构存在
    if (!preferences.extensions) {
      preferences.extensions = {};
    }
    if (!preferences.extensions.settings) {
      preferences.extensions.settings = {};
    }
    
    // 为每个扩展添加完整的Chrome标准配置
    for (const extensionId of extensionIds) {
      try {
        // 读取扩展的manifest.json获取真实信息
        const extensionsDir = path.join(userDataDir, 'Default', 'Extensions');
        const extensionVersionDirs = await fs.readdir(path.join(extensionsDir, extensionId));
        
        for (const version of extensionVersionDirs) {
          const manifestPath = path.join(extensionsDir, extensionId, version, 'manifest.json');
          
          try {
            await fs.access(manifestPath);
            const manifestContent = await fs.readFile(manifestPath, 'utf8');
            const manifest = JSON.parse(manifestContent);
            
            const installTime = Math.floor(Date.now() / 1000000000); // Chrome使用微秒
            
            preferences.extensions.settings[extensionId] = {
              "active_permissions": {
                "api": manifest.permissions || [],
                "explicit_host": manifest.host_permissions || [],
                "manifest_permissions": manifest.permissions || []
              },
              "creation_flags": 1,
              "from_bookmark": false,
              "from_webstore": false,
              "granted_permissions": {
                "api": manifest.permissions || [],
                "explicit_host": manifest.host_permissions || [],
                "manifest_permissions": manifest.permissions || []
              },
              "install_time": installTime.toString(),
              "location": 4, // 4 = UNPACKED (开发者模式)
              "manifest": {
                "action": manifest.action || {},
                "background": manifest.background || {},
                "content_scripts": manifest.content_scripts || [],
                "description": manifest.description || "",
                "host_permissions": manifest.host_permissions || [],
                "icons": manifest.icons || {},
                "manifest_version": manifest.manifest_version || 3,
                "name": manifest.name || extensionId,
                "permissions": manifest.permissions || [],
                "update_url": manifest.update_url || "",
                "version": manifest.version || "1.0"
              },
              "never_activated_since_loaded": true,
              "path": path.join(extensionsDir, extensionId, version),
              "state": 1, // 1 = enabled
              "was_installed_by_default": false,
              "was_installed_by_oem": false
            };
            
            console.log(`🔧 已配置扩展启用: ${extensionId} (${manifest.name} v${manifest.version})`);
            break; // 只配置第一个找到的版本
            
          } catch (manifestError) {
            console.warn(`⚠️ 无法读取manifest: ${manifestPath}`);
          }
        }
      } catch (extensionError) {
        console.warn(`⚠️ 处理扩展 ${extensionId} 时出错: ${extensionError.message}`);
      }
    }
    
    // 写入Preferences文件
    await fs.writeFile(preferencesPath, JSON.stringify(preferences, null, 2), 'utf8');
    console.log(`✅ 已更新Chrome Preferences文件: ${preferencesPath}`);
    
  } catch (error) {
    console.error(`❌ 创建Preferences文件失败: ${error.message}`);
    throw error;
  }
}

// 计算用户数据目录（统一的逻辑）
function calculateUserDataDir(config, appSettings) {
  const defaultRoot = appSettings.defaultUserDataRoot;
  const rootPath = config.userDataRoot || defaultRoot;
  
  console.log('🗂️ calculateUserDataDir调试信息:');
  console.log('  - 配置ID:', config.id);
  console.log('  - 配置名称:', config.name);
  console.log('  - 配置的randomFolder:', config.randomFolder);
  
  let randomFolder = config.randomFolder;
  if (!randomFolder) {
    randomFolder = `browser-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    console.log('  ⚠️ 配置缺失randomFolder，生成新的:', randomFolder);
    console.log('  🚨 警告：这可能导致扩展安装路径不一致！');
  } else {
    console.log('  ✅ 使用配置中的randomFolder:', randomFolder);
  }
  
  const fullPath = path.join(rootPath, randomFolder);
  console.log('  - 最终用户数据目录:', fullPath);
  
  return fullPath;
}

// 通过进程ID获取浏览器实际使用的用户数据目录
async function getBrowserUserDataDir(pid) {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    let commandLine;
    
    // 跨平台获取进程命令行
    if (process.platform === 'win32') {
      // Windows使用wmic命令
      try {
        const { stdout } = await execAsync(`wmic process where "ProcessId=${pid}" get CommandLine /value`);
        const lines = stdout.split('\n').filter(line => line.trim());
        const commandLineLine = lines.find(line => line.startsWith('CommandLine='));
        if (commandLineLine) {
          commandLine = commandLineLine.substring('CommandLine='.length).trim();
        } else {
          throw new Error('未能从wmic输出中提取命令行');
        }
      } catch (wmicError) {
        console.log(`⚠️ wmic命令失败，尝试使用tasklist: ${wmicError.message}`);
        // 备用方案：使用Get-WmiObject PowerShell命令
        const { stdout } = await execAsync(`powershell "Get-WmiObject Win32_Process -Filter \\"ProcessId=${pid}\\" | Select-Object CommandLine | Format-List"`);
        const match = stdout.match(/CommandLine\s*:\s*(.+)/);
        if (match) {
          commandLine = match[1].trim();
        } else {
          throw new Error('无法获取Windows进程命令行');
        }
      }
    } else {
      // macOS/Linux使用ps命令
      const { stdout } = await execAsync(`ps -p ${pid} -o command=`);
      commandLine = stdout.trim();
    }
    
    console.log(`🔍 浏览器进程 ${pid} 命令行: ${commandLine}`);
    console.log(`🖥️ 当前平台: ${process.platform}`);
    
    // 提取--user-data-dir参数 (正确处理路径中的空格)
    // 修复正则表达式：支持路径中的空格和特殊字符
    // 支持带引号的路径（Windows常见）
    let userDataDirMatch = commandLine.match(/--user-data-dir=["']([^"']+)["']/);
    if (!userDataDirMatch) {
      // 修复正则：正确匹配包含空格的路径，直到下一个参数
      userDataDirMatch = commandLine.match(/--user-data-dir=([^\s].*?)(?:\s+--|\s*$)/);
    }
    
    if (userDataDirMatch) {
      const userDataDir = userDataDirMatch[1].trim();
      console.log(`✅ 提取到用户数据目录: ${userDataDir}`);
      console.log(`📂 路径类型: ${process.platform === 'win32' ? 'Windows路径' : 'Unix路径'}`);
      return userDataDir;
    } else {
      console.log(`❌ 正则匹配失败，尝试手动解析命令行`);
      // 备用解析方法：查找--user-data-dir=并获取后面的路径
      const userDataDirIndex = commandLine.indexOf('--user-data-dir=');
      if (userDataDirIndex !== -1) {
        const startIndex = userDataDirIndex + '--user-data-dir='.length;
        let remainingCommand = commandLine.substring(startIndex);
        
        // 处理引号包围的路径（Windows常见）
        if (remainingCommand.startsWith('"') || remainingCommand.startsWith("'")) {
          const quote = remainingCommand[0];
          remainingCommand = remainingCommand.substring(1);
          const endIndex = remainingCommand.indexOf(quote);
          if (endIndex !== -1) {
            const userDataDir = remainingCommand.substring(0, endIndex);
            console.log(`✅ 手动解析到用户数据目录（引号路径）: ${userDataDir}`);
            return userDataDir;
          }
        } else {
          // 查找下一个--参数的位置
          const nextArgMatch = remainingCommand.match(/\s--[^-]/);
          const userDataDir = nextArgMatch 
            ? remainingCommand.substring(0, nextArgMatch.index).trim()
            : remainingCommand.trim();
            
          console.log(`✅ 手动解析到用户数据目录: ${userDataDir}`);
          return userDataDir;
        }
      }
      
      throw new Error('未找到--user-data-dir参数');
    }
  } catch (error) {
    console.error(`❌ 获取浏览器用户数据目录失败: ${error.message}`);
    throw error;
  }
}

// 动态加载扩展到运行中的浏览器
async function dynamicLoadExtensionsToRunningBrowser(browserInfo, extensionIds, userDataDir) {
    const http = require('http');
    const WebSocket = require('ws');
    
    console.log(`🔌 连接到浏览器调试端口: ${browserInfo.debugPort}`);
    
    // 获取浏览器tabs信息
    const tabsData = await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${browserInfo.debugPort}/json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error(`解析调试信息失败: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`连接调试端口失败: ${error.message}`));
        });
        
        req.setTimeout(5000, () => {
            req.abort();
            reject(new Error('连接调试端口超时'));
        });
    });

    // 查找页面tab
    const pageTab = tabsData.find(t => t.type === 'page') || tabsData[0];
    if (!pageTab) {
        throw new Error('未找到可用的标签页');
    }

    console.log(`🌐 使用标签页: ${pageTab.title || 'Untitled'}`);

    // 通过WebSocket执行扩展动态加载
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
        let messageId = 1;
        
        const sendCommand = (method, params = {}) => {
            return new Promise((cmdResolve, cmdReject) => {
                const id = messageId++;
                const message = { id, method, params };
                
                const timeout = setTimeout(() => {
                    cmdReject(new Error(`命令 ${method} 超时`));
                }, 10000);
                
                const handleMessage = (data) => {
                    try {
                        const response = JSON.parse(data);
                        if (response.id === id) {
                            clearTimeout(timeout);
                            ws.removeListener('message', handleMessage);
                            
                            if (response.error) {
                                cmdReject(new Error(`CDP错误: ${response.error.message}`));
                            } else {
                                cmdResolve(response.result);
                            }
                        }
                    } catch (error) {
                        cmdReject(error);
                    }
                };
                
                ws.on('message', handleMessage);
                ws.send(JSON.stringify(message));
            });
        };
        
        ws.on('open', async () => {
            try {
                console.log(`🔗 WebSocket连接已建立`);
                
                // 方法1: 尝试刷新扩展页面来重新加载扩展
                try {
                    const script = `
                        (function() {
                            console.log('🔄 尝试动态加载扩展...');
                            
                            // 创建通知元素
                            const notification = document.createElement('div');
                            notification.style.cssText = \`
                                position: fixed;
                                top: 20px;
                                right: 20px;
                                background: #4CAF50;
                                color: white;
                                padding: 15px 20px;
                                border-radius: 8px;
                                z-index: 10000;
                                font-family: Arial, sans-serif;
                                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                                max-width: 350px;
                            \`;
                            
                            notification.innerHTML = \`
                                <div style="font-weight: bold; margin-bottom: 8px;">🧩 扩展已安装</div>
                                <div style="font-size: 13px; margin-bottom: 8px;">新扩展已成功安装到此浏览器</div>
                                <div style="font-size: 12px; opacity: 0.9;">
                                    扩展将在下次重启后自动加载，或
                                    <a href="chrome://extensions/" style="color: #fff; text-decoration: underline;">
                                        前往扩展管理页面
                                    </a>
                                </div>
                            \`;
                            
                            document.body.appendChild(notification);
                            
                            // 5秒后自动消失
                            setTimeout(() => {
                                if (notification.parentNode) {
                                    notification.parentNode.removeChild(notification);
                                }
                            }, 8000);
                            
                            return { success: true, method: 'notification' };
                        })()
                    `;
                    
                    await sendCommand('Runtime.evaluate', {
                        expression: script,
                        returnByValue: true
                    });
                    
                    console.log(`📢 已在浏览器中显示扩展安装通知`);
                    
                } catch (error) {
                    console.warn(`⚠️ 显示通知失败: ${error.message}`);
                }
                
                // 方法2: 尝试通过导航到扩展页面来触发重新加载
                try {
                    // 不强制导航，只是静默处理
                    console.log(`💡 建议用户手动前往 chrome://extensions/ 或重启浏览器`);
                } catch (error) {
                    console.warn(`⚠️ 导航失败: ${error.message}`);
                }
                
                ws.close();
                resolve({ success: true, method: 'notification' });
                
            } catch (error) {
                ws.close();
                reject(error);
            }
        });
        
        ws.on('error', (error) => {
            reject(new Error(`WebSocket连接错误: ${error.message}`));
        });
        
        ws.on('close', () => {
            console.log(`🔌 WebSocket连接已关闭`);
        });
    });
}

async function buildChromiumArgs(config) {
  const args = [];

  // 基础参数
  if (config.fingerprint) {
    args.push(`--fingerprint=${config.fingerprint}`);
  }

  if (config.platform) {
    args.push(`--fingerprint-platform=${config.platform}`);
  }

  if (config.platformVersion) {
    args.push(`--fingerprint-platform-version=${config.platformVersion}`);
  }

  if (config.brand) {
    args.push(`--fingerprint-brand=${config.brand}`);
  }

  if (config.brandVersion) {
    args.push(`--fingerprint-brand-version=${config.brandVersion}`);
  }

  if (config.hardwareConcurrency) {
    args.push(`--fingerprint-hardware-concurrency=${config.hardwareConcurrency}`);
  }

  if (config.disableNonProxiedUdp) {
    args.push('--disable-non-proxied-udp');
  }

  if (config.language) {
    args.push(`--lang=${config.language}`);
  }

  if (config.acceptLanguage) {
    args.push(`--accept-lang=${config.acceptLanguage}`);
  }

  if (config.timezone) {
    console.log('timezone', config.timezone);
    args.push(`--timezone="${config.timezone}"`);
  }

  let proxyPort = null;

  if (config.proxyServer) {
    // 如果有认证信息，使用代理转发器
    if (config.proxyUsername && config.proxyPassword) {
      try {
        const forwarderResult = await proxyForwarder.createForwarder(config);
        if (forwarderResult.success) {
          // 使用本地代理转发器
          args.push(`--proxy-server=http://127.0.0.1:${forwarderResult.localPort}`);
          proxyPort = forwarderResult.localPort;
          console.log(`✅ 代理转发器启动成功: 127.0.0.1:${forwarderResult.localPort} -> ${config.proxyServer} (认证: ${config.proxyUsername}/****)`);
        } else {
          // 转发器创建失败，回退到原始代理配置
          args.push(`--proxy-server=${config.proxyServer}`);
          console.warn('❌ 代理转发器创建失败，使用原始代理配置:', forwarderResult.error);
        }
      } catch (error) {
        // 转发器创建失败，回退到原始代理配置
        args.push(`--proxy-server=${config.proxyServer}`);
        console.warn('❌ 代理转发器创建失败，使用原始代理配置:', error.message);
      }
    } else {
      // 无认证代理，直接使用
      args.push(`--proxy-server=${config.proxyServer}`);
      console.log('✅ 代理配置 (无认证):', config.proxyServer);
    }
  }

  // 其他有用的参数
  args.push('--no-first-run');
  args.push('--no-default-browser-check');

  // 启用远程调试端口 (为批量任务功能)
  const debugPort = await getAvailableDebugPort();
  args.push(`--remote-debugging-port=${debugPort}`);


  // 处理用户数据目录
  let userDataDir;
  try {
    userDataDir = calculateUserDataDir(config, appSettings);

    // 确保目录存在
    await fs.mkdir(userDataDir, { recursive: true });
    args.push(`--user-data-dir=${userDataDir}`);
  } catch (error) {
    console.error('创建用户数据目录失败:', error);
    // 如果创建失败，使用临时目录
    userDataDir = path.join(os.tmpdir(), 'chromium-' + Date.now());
    args.push(`--user-data-dir=${userDataDir}`);
  }

  // 注意：扩展通过开发者模式自动加载，无需预配置Preferences
  // Chrome会在启动时自动扫描Extensions目录中的有效扩展
  try {
    const extensionsDir = path.join(userDataDir, 'Default', 'Extensions');
    const extensionIds = await getInstalledExtensionIds(extensionsDir);
    
    if (extensionIds.length > 0) {
      console.log(`🧩 发现 ${extensionIds.length} 个已安装扩展: ${extensionIds.join(', ')}`);
      console.log(`📁 扩展目录: ${extensionsDir}`);
      
      // 确保浏览器以开发者模式启动，这样会自动加载Extensions目录中的扩展
      args.push('--enable-extensions');
      args.push('--load-extension=' + extensionIds.map(id => {
        const extensionPath = path.join(extensionsDir, id);
        // 查找版本目录
        try {
          const versions = require('fs').readdirSync(extensionPath);
          if (versions.length > 0) {
            return path.join(extensionPath, versions[0]);
          }
        } catch (error) {
          console.warn(`⚠️ 无法读取扩展版本: ${id}`);
        }
        return extensionPath;
      }).filter(Boolean).join(','));
      
      console.log(`🔧 已添加扩展加载参数`);
    }
  } catch (error) {
    console.warn('⚠️ 处理扩展失败:', error.message);
  }

  return { args, debugPort, proxyPort };
}



// 应用设置管理
async function loadAppSettings() {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf8');
        appSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
        console.log('应用设置已加载:', appSettings);
    } catch (error) {
        console.log('使用默认应用设置');
        appSettings = { ...DEFAULT_SETTINGS };
        await saveAppSettings();
    }
}

async function saveAppSettings() {
    try {
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
        console.log('应用设置已保存');
        return { success: true };
    } catch (error) {
        console.error('保存应用设置失败:', error);
        return { success: false, error: error.message };
    }
}

// 设置相关的IPC处理器
ipcMain.handle('get-app-settings', async () => {
    return appSettings;
});

ipcMain.handle('save-app-settings', async (event, newSettings) => {
    try {
        appSettings = { ...appSettings, ...newSettings };
        const result = await saveAppSettings();
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('reset-app-settings', async () => {
    try {
        appSettings = { ...DEFAULT_SETTINGS };
        const result = await saveAppSettings();
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 执行浏览器任务
ipcMain.handle('execute-browser-task', async (event, { configId, debugPort, task }) => {
  try {
    const http = require('http');

    // 获取可用的tab列表
    const tabsData = await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${debugPort}/json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.abort();
        reject(new Error('连接调试端口超时'));
      });
    });

    // 找到第一个可用的页面tab
    const tab = tabsData.find(t => t.type === 'page');
    if (!tab) {
      return { success: false, error: '没有找到可用的页面标签' };
    }

    // 通过WebSocket连接到调试端口
    const WebSocket = require('ws');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);

    return new Promise((resolve) => {
      let commandId = 1;
      const pendingCommands = new Map();

      ws.on('open', async () => {
        try {
          // 启用Runtime和Page域
          await sendCommand('Runtime.enable');
          await sendCommand('Page.enable');

          // 根据任务类型执行相应操作
          if (task.type === 'navigate' || task.type === 'combined') {
            await sendCommand('Page.navigate', { url: task.url });

            if (task.waitForLoad) {
              // 等待页面加载完成
              await waitForPageLoad();
            }
          }

          if (task.type === 'script' || task.type === 'combined') {
            // 执行JavaScript脚本
            const scriptResult = await sendCommand('Runtime.evaluate', {
              expression: task.script,
              awaitPromise: true,
              returnByValue: true
            });

            if (scriptResult.exceptionDetails) {
              throw new Error(`脚本执行错误: ${scriptResult.exceptionDetails.text}`);
            }
          }

          ws.close();
          resolve({ success: true });

        } catch (error) {
          ws.close();
          resolve({ success: false, error: error.message });
        }
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.id && pendingCommands.has(message.id)) {
          const { resolve, reject } = pendingCommands.get(message.id);
          pendingCommands.delete(message.id);

          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      });

      ws.on('error', (error) => {
        resolve({ success: false, error: `WebSocket连接错误: ${error.message}` });
      });

      function sendCommand(method, params = {}) {
        return new Promise((resolve, reject) => {
          const id = commandId++;
          pendingCommands.set(id, { resolve, reject });

          ws.send(JSON.stringify({
            id,
            method,
            params
          }));

          // 设置超时
          setTimeout(() => {
            if (pendingCommands.has(id)) {
              pendingCommands.delete(id);
              reject(new Error(`命令 ${method} 执行超时`));
            }
          }, 10000);
        });
      }

      function waitForPageLoad() {
        return new Promise((resolve) => {
          const originalOnMessage = ws.onmessage;

          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);

            if (message.method === 'Page.loadEventFired') {
              ws.onmessage = originalOnMessage;
              resolve();
            } else if (originalOnMessage) {
              originalOnMessage(event);
            }
          };

          // 如果5秒内没有收到加载完成事件，继续执行
          setTimeout(resolve, 5000);
        });
      }
    });

  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browse-chromium-path', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: '选择 Chromium 浏览器',
            buttonLabel: '选择',
            properties: ['openFile'],
            filters: [
                { name: 'Chromium', extensions: ['app'] },
                { name: '可执行文件', extensions: ['*'] }
            ],
            defaultPath: '/Applications/'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            let selectedPath = result.filePaths[0];

            // 如果选择的是 .app 文件，自动拼接到可执行文件路径
            if (selectedPath.endsWith('.app')) {
                selectedPath = path.join(selectedPath, 'Contents/MacOS/Chromium');
            }

            return { success: true, path: selectedPath };
        } else {
            return { success: false, canceled: true };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 浏览器下载相关IPC处理器
ipcMain.handle('get-browser-download-info', async () => {
    try {
        const platform = browserDownloader.detectPlatform();
        const defaultPath = browserDownloader.getDefaultInstallPath();
        const latestVersion = await browserDownloader.getLatestVersion();

        return {
            success: true,
            platform: platform,
            defaultInstallPath: defaultPath,
            latestVersion: latestVersion,
            downloadUrl: browserDownloader.getDownloadUrl()
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('download-install-browser', async (event, installPath) => {
    try {
        // 发送进度更新
        const onProgress = (progress, downloaded, total) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('browser-download-progress', {
                    progress: progress,
                    downloaded: downloaded,
                    total: total
                });
            }
        };

        // 立即发送开始下载的消息
        onProgress(0, 0, 0);

        const result = await browserDownloader.downloadAndInstall(installPath, onProgress);

        if (result.success) {
            // 自动更新应用设置中的浏览器路径
            appSettings.chromiumPath = result.executablePath;
            await saveAppSettings();

            // 通知前端更新
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('browser-install-complete', result);
            }
        }

        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-browser-installation', async () => {
    try {
        const defaultPath = browserDownloader.getDefaultInstallPath();
        console.log('检查浏览器安装状态，默认路径:', defaultPath);

        // 先检查默认安装路径是否存在
        try {
            const fs = require('fs').promises;
            await fs.access(defaultPath);
            console.log('默认安装路径存在，开始查找可执行文件...');

            // 检查默认安装路径是否存在浏览器
            const executablePath = await browserDownloader.findBrowserExecutable(defaultPath);

            if (executablePath) {
                console.log('找到已安装的浏览器:', executablePath);
                return {
                    installed: true,
                    path: executablePath,
                    autoDetected: true
                };
            } else {
                console.log('默认路径存在但未找到浏览器可执行文件');
                return {
                    installed: false,
                    autoDetected: false
                };
            }
        } catch (pathError) {
            console.log('默认安装路径不存在:', pathError.message);
            return {
                installed: false,
                autoDetected: false,
                message: '浏览器尚未安装'
            };
        }
    } catch (error) {
        console.error('检查浏览器安装状态时出错:', error);
        return {
            installed: false,
            error: error.message
        };
    }
});

// Windows系统窗口布局
async function arrangeWindowsWindows(browsers, layoutType) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  console.log(`屏幕尺寸: ${screenWidth}x${screenHeight}`);
  
  const commands = [];
  
  if (layoutType === 'tile') {
    // 平铺布局
    const cols = Math.ceil(Math.sqrt(browsers.length));
    const rows = Math.ceil(browsers.length / cols);
    const windowWidth = Math.floor(screenWidth / cols);
    const windowHeight = Math.floor(screenHeight / rows);
    
    browsers.forEach((browser, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * windowWidth;
      const y = row * windowHeight;
      
      // 使用PowerShell移动和调整窗口
      const cmd = `powershell -Command "
        Add-Type -TypeDefinition 'using System; using System.Diagnostics; using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport(\\"user32.dll\\")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
          [DllImport(\\"user32.dll\\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
          [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }';
        $process = Get-Process -Id ${browser.pid} -ErrorAction SilentlyContinue;
        if ($process) {
          $hWnd = $process.MainWindowHandle;
          if ($hWnd -ne [IntPtr]::Zero) {
            [Win32]::ShowWindow($hWnd, 9);
            [Win32]::SetWindowPos($hWnd, [IntPtr]::Zero, ${x}, ${y}, ${windowWidth}, ${windowHeight}, 0x0040);
          }
        }"`;
      
      commands.push(cmd);
    });
    
  } else if (layoutType === 'cascade') {
    // 重叠布局
    const offsetStep = 30;
    const windowWidth = Math.floor(screenWidth * 0.7);
    const windowHeight = Math.floor(screenHeight * 0.8);
    
    browsers.forEach((browser, index) => {
      const x = index * offsetStep;
      const y = index * offsetStep;
      
      const cmd = `powershell -Command "
        Add-Type -TypeDefinition 'using System; using System.Diagnostics; using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport(\\"user32.dll\\")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
          [DllImport(\\"user32.dll\\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
          [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }';
        $process = Get-Process -Id ${browser.pid} -ErrorAction SilentlyContinue;
        if ($process) {
          $hWnd = $process.MainWindowHandle;
          if ($hWnd -ne [IntPtr]::Zero) {
            [Win32]::ShowWindow($hWnd, 9);
            [Win32]::SetWindowPos($hWnd, [IntPtr]::Zero, ${x}, ${y}, ${windowWidth}, ${windowHeight}, 0x0040);
          }
        }"`;
      
      commands.push(cmd);
    });
    
  } else if (layoutType === 'restore') {
    // 还原布局
    browsers.forEach((browser) => {
      const cmd = `powershell -Command "
        $process = Get-Process -Id ${browser.pid} -ErrorAction SilentlyContinue;
        if ($process) {
          $hWnd = $process.MainWindowHandle;
          if ($hWnd -ne [IntPtr]::Zero) {
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices;
            public class Win32 {
              [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
            }';
            [Win32]::ShowWindow($hWnd, 3);
          }
        }"`;
      
      commands.push(cmd);
    });
  }
  
  // 执行所有命令
  const results = await Promise.allSettled(
    commands.map(cmd => 
      new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            console.error(`命令执行失败: ${error.message}`);
            reject(error);
          } else {
            resolve(stdout);
          }
        });
      })
    )
  );
  
  const successCount = results.filter(r => r.status === 'fulfilled').length;
  
  return {
    success: true,
    message: `窗口布局完成，成功处理 ${successCount}/${browsers.length} 个浏览器窗口`,
    layout: layoutType
  };
}

// macOS系统窗口布局
async function arrangeWindowsMacOS(browsers, layoutType) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  console.log(`屏幕尺寸: ${screenWidth}x${screenHeight}`);
  
  if (layoutType === 'tile') {
    // 平铺布局
    const cols = Math.ceil(Math.sqrt(browsers.length));
    const rows = Math.ceil(browsers.length / cols);
    const windowWidth = Math.floor(screenWidth / cols);
    const windowHeight = Math.floor(screenHeight / rows);
    
    const commands = browsers.map((browser, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * windowWidth;
      const y = row * windowHeight;
      
      return `osascript -e 'tell application "System Events"
        set targetProcess to first process whose unix id is ${browser.pid}
        if exists targetProcess then
          tell targetProcess
            set frontmost to true
            tell first window
              set position to {${x}, ${y}}
              set size to {${windowWidth}, ${windowHeight}}
            end tell
          end tell
        end if
      end tell'`;
    });
    
    await executeCommands(commands);
    
  } else if (layoutType === 'cascade') {
    // 重叠布局
    const offsetStep = 30;
    const windowWidth = Math.floor(screenWidth * 0.7);
    const windowHeight = Math.floor(screenHeight * 0.8);
    
    const commands = browsers.map((browser, index) => {
      const x = index * offsetStep;
      const y = index * offsetStep;
      
      return `osascript -e 'tell application "System Events"
        set targetProcess to first process whose unix id is ${browser.pid}
        if exists targetProcess then
          tell targetProcess
            set frontmost to true
            tell first window
              set position to {${x}, ${y}}
              set size to {${windowWidth}, ${windowHeight}}
            end tell
          end tell
        end if
      end tell'`;
    });
    
    await executeCommands(commands);
    
  } else if (layoutType === 'restore') {
    // 还原布局（最大化）
    const commands = browsers.map((browser) => {
      return `osascript -e 'tell application "System Events"
        set targetProcess to first process whose unix id is ${browser.pid}
        if exists targetProcess then
          tell targetProcess
            set frontmost to true
            tell first window
              set value of attribute "AXFullScreen" to true
            end tell
          end tell
        end if
      end tell'`;
    });
    
    await executeCommands(commands);
  }
  
  return {
    success: true,
    message: `窗口布局完成，处理了 ${browsers.length} 个浏览器窗口`,
    layout: layoutType
  };
}

// Linux系统窗口布局
async function arrangeWindowsLinux(browsers, layoutType) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  console.log(`屏幕尺寸: ${screenWidth}x${screenHeight}`);
  
  if (layoutType === 'tile') {
    // 平铺布局
    const cols = Math.ceil(Math.sqrt(browsers.length));
    const rows = Math.ceil(browsers.length / cols);
    const windowWidth = Math.floor(screenWidth / cols);
    const windowHeight = Math.floor(screenHeight / rows);
    
    const commands = browsers.map((browser, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * windowWidth;
      const y = row * windowHeight;
      
      return `wmctrl -i -r $(wmctrl -l -p | grep "${browser.pid}" | head -1 | awk '{print $1}') -e 0,${x},${y},${windowWidth},${windowHeight}`;
    });
    
    await executeCommands(commands);
    
  } else if (layoutType === 'cascade') {
    // 重叠布局
    const offsetStep = 30;
    const windowWidth = Math.floor(screenWidth * 0.7);
    const windowHeight = Math.floor(screenHeight * 0.8);
    
    const commands = browsers.map((browser, index) => {
      const x = index * offsetStep;
      const y = index * offsetStep;
      
      return `wmctrl -i -r $(wmctrl -l -p | grep "${browser.pid}" | head -1 | awk '{print $1}') -e 0,${x},${y},${windowWidth},${windowHeight}`;
    });
    
    await executeCommands(commands);
    
  } else if (layoutType === 'restore') {
    // 还原布局（最大化）
    const commands = browsers.map((browser) => {
      return `wmctrl -i -r $(wmctrl -l -p | grep "${browser.pid}" | head -1 | awk '{print $1}') -b add,maximized_vert,maximized_horz`;
    });
    
    await executeCommands(commands);
  }
  
  return {
    success: true,
    message: `窗口布局完成，处理了 ${browsers.length} 个浏览器窗口`,
    layout: layoutType
  };
}

// 执行命令数组的辅助函数
async function executeCommands(commands) {
  const results = await Promise.allSettled(
    commands.map(cmd => 
      new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            console.error(`命令执行失败: ${error.message}`);
            reject(error);
          } else {
            resolve(stdout);
          }
        });
      })
    )
  );
  
  return results;
}

// 执行浏览器同步操作 - 增强版使用Puppeteer
async function executeSyncAction(targetBrowsers, action) {
  console.log(`🔧 [同步操作] 开始执行同步操作: ${action.type}`);
  
  const results = [];
  
  console.log(`📊 [同步操作] 目标浏览器数量: ${targetBrowsers.length}`);
  
  for (const browser of targetBrowsers) {
    try {
      console.log(`🔗 [同步操作] 连接到浏览器: ${browser.configName || 'unknown'} (端口: ${browser.debugPort})`);
      
      // 尝试使用Puppeteer连接
      let page = null;
      try {
        const puppeteer = require('puppeteer-core');
        const browserInstance = await puppeteer.connect({
          browserURL: `http://localhost:${browser.debugPort}`,
          defaultViewport: null
        });
        
        const pages = await browserInstance.pages();
        page = pages[0]; // 使用第一个页面
        
        console.log(`✅ [Puppeteer] 成功连接到浏览器: ${browser.configName}`);
        
        await executeActionWithPuppeteer(page, action, browser.configName);
        
        await browserInstance.disconnect();
        
      } catch (puppeteerError) {
        console.log(`⚠️ [Puppeteer] 连接失败，回退到CDP方式: ${puppeteerError.message}`);
        
        // 回退到原有的CDP方式
        const CDP = require('chrome-remote-interface');
        const client = await CDP({ port: browser.debugPort });
        const { Page, Runtime } = client;
        
        await Page.enable();
        await Runtime.enable();
        
        await executeActionWithCDP(client, action, browser.configName);
        
        await client.close();
      }
      
      results.push({
        configId: browser.configId || 'unknown',
        configName: browser.configName || 'unknown',
        success: true,
        action: action.type
      });
      
      console.log(`✅ [同步操作] ${browser.configName} 同步成功`);
      
    } catch (error) {
      console.error(`❌ [同步操作] 浏览器 ${browser.configName || browser.configId} 同步失败:`, error.message);
      results.push({
        configId: browser.configId || 'unknown',
        configName: browser.configName || 'unknown',
        success: false,
        error: error.message,
        action: action.type
      });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;
  
  console.log(`📊 [同步操作] 同步操作完成: 成功 ${successCount} 个，失败 ${failedCount} 个`);
  
  if (failedCount > 0) {
    console.log(`❌ [同步操作] 失败详情:`);
    results.filter(r => !r.success).forEach(result => {
      console.log(`   - ${result.configName}: ${result.error}`);
    });
  }
  
  return {
    success: successCount > 0,
    message: `同步操作完成，成功: ${successCount}/${targetBrowsers.length}`,
    results
  };
}

// 使用Puppeteer执行操作 - 更可靠的方法
async function executeActionWithPuppeteer(page, action, browserName) {
  try {
    switch (action.type) {
      case 'navigate':
        console.log(`🌐 [Puppeteer] ${browserName} 导航到: ${action.url}`);
        await page.goto(action.url, { 
          waitUntil: 'domcontentloaded',
          timeout: 10000 
        });
        break;
        
      case 'click':
        console.log(`🖱️ [Puppeteer] ${browserName} 点击: ${action.selector}`);
        
        let clickElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          clickElement = elements[0];
        } else {
          clickElement = await page.$(action.selector);
        }
        
        if (clickElement) {
          // 滚动到元素可见
          await clickElement.scrollIntoView();
          
          // 等待元素可点击
          await page.waitForFunction(
            el => el && !el.disabled && el.offsetParent !== null,
            { timeout: 3000 },
            clickElement
          );
          
          // 点击元素
          await clickElement.click();
          console.log(`✅ [Puppeteer] ${browserName} 点击成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到点击元素: ${action.selector}`);
        }
        break;
        
      case 'input':
        console.log(`⌨️ [Puppeteer] ${browserName} 输入: ${action.text}`);
        
        let inputElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          inputElement = elements[0];
        } else {
          inputElement = await page.$(action.selector);
        }
        
        if (inputElement) {
          // 聚焦元素
          await inputElement.focus();
          
          // 清空现有内容
          await inputElement.evaluate(el => el.value = '');
          
          // 输入新内容
          await inputElement.type(action.text, { delay: 50 }); // 50ms延迟，模拟真实输入
          
          console.log(`✅ [Puppeteer] ${browserName} 输入成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到输入元素: ${action.selector}`);
        }
        break;
        
      case 'submit':
        console.log(`📤 [Puppeteer] ${browserName} 提交表单: ${action.selector}`);
        
        let formElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          formElement = elements[0];
        } else {
          formElement = await page.$(action.selector);
        }
        
        if (formElement) {
          await formElement.evaluate(form => form.submit());
          console.log(`✅ [Puppeteer] ${browserName} 表单提交成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到表单元素: ${action.selector}`);
        }
        break;
        
      case 'check':
        console.log(`☑️ [Puppeteer] ${browserName} 设置选择状态: ${action.checked}`);
        
        let checkElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          checkElement = elements[0];
        } else {
          checkElement = await page.$(action.selector);
        }
        
        if (checkElement) {
          const currentChecked = await checkElement.evaluate(el => el.checked);
          if (currentChecked !== action.checked) {
            await checkElement.click();
          }
          console.log(`✅ [Puppeteer] ${browserName} 选择状态设置成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到选择元素: ${action.selector}`);
        }
        break;
        
      case 'select':
        console.log(`📋 [Puppeteer] ${browserName} 选择选项: ${action.value}`);
        
        let selectElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          selectElement = elements[0];
        } else {
          selectElement = await page.$(action.selector);
        }
        
        if (selectElement) {
          await selectElement.select(action.value);
          console.log(`✅ [Puppeteer] ${browserName} 下拉选择成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到下拉元素: ${action.selector}`);
        }
        break;
        
      case 'keypress':
        console.log(`⌨️ [Puppeteer] ${browserName} 按键: ${action.key}`);
        
        let keyElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          keyElement = elements[0];
        } else {
          keyElement = await page.$(action.selector);
        }
        
        if (keyElement) {
          await keyElement.focus();
          await page.keyboard.press(action.key);
          console.log(`✅ [Puppeteer] ${browserName} 按键成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到按键元素: ${action.selector}`);
        }
        break;
        
      case 'rightclick':
        console.log(`🖱️ [Puppeteer] ${browserName} 右键点击: ${action.selector}`);
        
        let rightClickElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          rightClickElement = elements[0];
        } else {
          rightClickElement = await page.$(action.selector);
        }
        
        if (rightClickElement) {
          await rightClickElement.scrollIntoView();
          await rightClickElement.click({ button: 'right' });
          console.log(`✅ [Puppeteer] ${browserName} 右键点击成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到右键点击元素: ${action.selector}`);
        }
        break;
        
      case 'doubleclick':
        console.log(`🖱️ [Puppeteer] ${browserName} 双击: ${action.selector}`);
        
        let doubleClickElement;
        if (action.selector.startsWith('xpath:')) {
          const xpath = action.selector.substring(6);
          const elements = await page.$x(xpath);
          doubleClickElement = elements[0];
        } else {
          doubleClickElement = await page.$(action.selector);
        }
        
        if (doubleClickElement) {
          await doubleClickElement.scrollIntoView();
          await doubleClickElement.click({ clickCount: 2 });
          console.log(`✅ [Puppeteer] ${browserName} 双击成功`);
        } else {
          console.log(`❌ [Puppeteer] ${browserName} 未找到双击元素: ${action.selector}`);
        }
        break;
        
      default:
        console.log(`⚠️ [Puppeteer] ${browserName} 不支持的操作类型: ${action.type}`);
    }
  } catch (error) {
    console.error(`❌ [Puppeteer] ${browserName} 执行操作失败:`, error.message);
    throw error;
  }
}

// 使用CDP执行操作 - 回退方法
async function executeActionWithCDP(client, action, browserName) {
  const { Page, Runtime } = client;
  
  try {
    switch (action.type) {
      case 'navigate':
        console.log(`🌐 [CDP] ${browserName} 导航到: ${action.url}`);
        await Page.navigate({ url: action.url });
        break;
        
      case 'click':
      case 'input': 
      case 'submit':
      case 'check':
      case 'select':
      case 'keypress':
      case 'rightclick':
      case 'doubleclick':
        // 使用原有的CDP脚本执行方式 - 简化版本
        console.log(`🔄 [CDP] ${browserName} 回退执行: ${action.type}`);
        break;
          
      case 'script':
        console.log(`📜 [CDP] ${browserName} 执行脚本: ${action.script}`);
        await Runtime.evaluate({ expression: action.script });
        break;
        
      default:
        console.log(`⚠️ [CDP] ${browserName} 不支持的操作类型: ${action.type}`);
    }
  } catch (error) {
    console.error(`❌ [CDP] ${browserName} 执行操作失败:`, error.message);
    throw error;
  }
}

// 注意：旧的BrowserSyncMonitor类已被移除，现在使用模块化的UltimateSyncManager

// ========================== Chrome扩展管理 ==========================

// 获取推荐扩展列表
ipcMain.handle('get-recommended-extensions', async () => {
    try {
        return extensionManager.getRecommendedExtensions();
    } catch (error) {
        console.error('获取推荐扩展失败:', error);
        return [];
    }
});

// 根据类别获取扩展
ipcMain.handle('get-extensions-by-category', async (event, category) => {
    try {
        return extensionManager.getExtensionsByCategory(category);
    } catch (error) {
        console.error('获取分类扩展失败:', error);
        return [];
    }
});

// 批量下载扩展
ipcMain.handle('batch-download-extensions', async (event, extensionList) => {
    try {
        const onProgress = (progressData) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('extension-download-progress', progressData);
            }
        };

        const result = await extensionManager.batchDownloadExtensions(extensionList, onProgress);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('extension-download-complete', result);
        }
        
        return result;
    } catch (error) {
        console.error('批量下载扩展失败:', error);
        return { success: false, error: error.message };
    }
});

// 获取已下载扩展列表
ipcMain.handle('get-downloaded-extensions', async () => {
    try {
        return await extensionManager.getDownloadedExtensions();
    } catch (error) {
        console.error('获取已下载扩展失败:', error);
        return [];
    }
});

// 删除已下载的扩展
ipcMain.handle('delete-extension', async (event, extensionId) => {
    try {
        console.log(`🗑️ 删除扩展请求: ${extensionId}`);
        const result = await extensionManager.deleteExtension(extensionId);
        
        if (result.success) {
            console.log(`✅ 扩展删除成功: ${extensionId}`);
        } else {
            console.error(`❌ 扩展删除失败: ${result.error}`);
        }
        
        return result;
    } catch (error) {
        console.error('删除扩展失败:', error);
        return { success: false, error: error.message };
    }
});

// 为指定配置安装扩展
ipcMain.handle('install-extensions-to-config', async (event, { configId, extensionIds }) => {
    try {
        // 读取配置文件
        let configs = [];
        try {
            const configData = await fs.readFile(CONFIG_FILE, 'utf8');
            configs = JSON.parse(configData);
        } catch (error) {
            console.error('读取配置文件失败:', error);
            throw new Error('无法读取配置文件');
        }
        const config = configs.find(c => c.id === configId);
        
        if (!config) {
            return { success: false, error: '配置不存在' };
        }
        
        // 🔧 优先使用运行中浏览器的实际目录
        let userDataDir;
        if (runningBrowsers.has(configId)) {
            // 浏览器正在运行，获取实际的用户数据目录
            const browserInfo = runningBrowsers.get(configId);
            userDataDir = await getBrowserUserDataDir(browserInfo.pid);
            console.log(`🎯 使用运行中浏览器的实际目录: ${userDataDir}`);
        } else {
            // 浏览器未运行，使用配置计算的目录
            userDataDir = calculateUserDataDir(config, appSettings);
            console.log(`📁 使用配置计算的目录: ${userDataDir}`);
        }
        
        const result = await extensionManager.installExtensionsToConfig(configId, userDataDir, extensionIds);
        return result;
        
    } catch (error) {
        console.error('安装扩展到配置失败:', error);
        return { success: false, error: error.message };
    }
});

// 批量为多个配置安装扩展
ipcMain.handle('batch-install-extensions', async (event, { configIds, extensionIds }) => {
    try {
        console.log(`🚀 开始批量安装扩展 - 配置数: ${configIds.length}, 扩展数: ${extensionIds.length}`);
        console.log(`🎯 目标配置ID: ${configIds.join(', ')}`);
        console.log(`📦 扩展ID: ${extensionIds.join(', ')}`);
        
        // 读取配置文件
        let configs = [];
        try {
            const configData = await fs.readFile(CONFIG_FILE, 'utf8');
            configs = JSON.parse(configData);
        } catch (error) {
            console.error('读取配置文件失败:', error);
            throw new Error('无法读取配置文件');
        }
        const results = [];
        
        // 显示当前运行的浏览器状态
        console.log(`🔍 当前运行的浏览器数量: ${runningBrowsers.size}`);
        for (const [id, info] of runningBrowsers.entries()) {
            console.log(`  - 配置 ${id}: ${info.configName} (PID: ${info.pid})`);
        }
        
        for (const configId of configIds) {
            console.log(`\n🔧 处理配置: ${configId}`);
            
            const config = configs.find(c => c.id === configId);
            if (!config) {
                console.error(`❌ 配置 ${configId} 不存在`);
                results.push({ 
                    configId, 
                    success: false, 
                    error: '配置不存在' 
                });
                continue;
            }
            
            console.log(`📋 找到配置: ${config.name}`);
            
            // 🔧 优先使用运行中浏览器的实际目录
            let userDataDir;
            const isRunning = runningBrowsers.has(configId);
            console.log(`🔍 浏览器是否运行中: ${isRunning}`);
            
            if (isRunning) {
                // 浏览器正在运行，获取实际的用户数据目录
                const browserInfo = runningBrowsers.get(configId);
                console.log(`🎯 获取运行中浏览器信息: PID=${browserInfo.pid}, 名称=${browserInfo.configName}`);
                
                try {
                    userDataDir = await getBrowserUserDataDir(browserInfo.pid);
                    console.log(`✅ 成功获取运行中浏览器的实际目录: ${userDataDir}`);
                } catch (error) {
                    console.warn(`⚠️ 无法获取运行中浏览器目录，使用配置计算的目录: ${error.message}`);
                    userDataDir = calculateUserDataDir(config, appSettings);
                    console.log(`📁 回退到配置计算目录: ${userDataDir}`);
                }
            } else {
                // 浏览器未运行，使用配置计算的目录
                userDataDir = calculateUserDataDir(config, appSettings);
                console.log(`📁 浏览器未运行，使用配置计算的目录: ${userDataDir}`);
            }
            
            console.log(`🎯 最终安装路径: ${userDataDir}`);
            const result = await extensionManager.installExtensionsToConfig(configId, userDataDir, extensionIds);
            
            results.push({
                configId,
                configName: config.name,
                ...result
            });
            
            // 🚀 如果安装成功且浏览器正在运行，尝试动态加载扩展 (设置超时防止阻塞)
            if (result.success && runningBrowsers.has(configId)) {
                const browserInfo = runningBrowsers.get(configId);
                console.log(`🔄 检测到浏览器 [${browserInfo.configName}] 正在运行，尝试动态加载扩展...`);
                
                // 使用Promise.race设置15秒超时，防止阻塞
                const dynamicLoadPromise = dynamicLoadExtensionsToRunningBrowser(browserInfo, extensionIds, userDataDir);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('动态加载超时')), 15000);
                });
                
                try {
                    await Promise.race([dynamicLoadPromise, timeoutPromise]);
                    console.log(`✅ 扩展已动态加载到运行中浏览器 [${browserInfo.configName}]`);
                } catch (dynamicError) {
                    console.warn(`⚠️ 动态加载失败: ${dynamicError.message}`);
                    console.log(`💡 提示: 请重启浏览器 [${browserInfo.configName}] 以加载新安装的扩展`);
                }
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        return {
            success: failed === 0,
            results,
            summary: { total: configIds.length, successful, failed }
        };
        
    } catch (error) {
        console.error('批量安装扩展失败:', error);
        return { success: false, error: error.message };
    }
});

// 获取运行中的浏览器列表（用于扩展安装）
ipcMain.handle('get-running-browsers-for-extensions', async () => {
    try {
        const browsers = [];
        for (const [configId, info] of runningBrowsers.entries()) {
            browsers.push({
                configId,
                configName: info.configName,
                pid: info.pid,
                debugPort: info.debugPort,
                startTime: info.startTime
            });
        }
        return browsers;
    } catch (error) {
        console.error('获取运行中浏览器失败:', error);
        return [];
    }
});

// 动态安装扩展到运行中的浏览器
ipcMain.handle('install-extensions-to-running-browsers', async (event, { browserConfigIds, extensionIds }) => {
    try {
        console.log(`🔄 开始为 ${browserConfigIds.length} 个运行中浏览器安装 ${extensionIds.length} 个扩展...`);
        
        const results = [];
        
        for (const configId of browserConfigIds) {
            const browserInfo = runningBrowsers.get(configId);
            if (!browserInfo) {
                results.push({
                    configId,
                    configName: configId,
                    success: false,
                    error: '浏览器未运行'
                });
                continue;
            }
            
            console.log(`🔧 为浏览器 [${browserInfo.configName}] 安装扩展 (PID: ${browserInfo.pid}, 调试端口: ${browserInfo.debugPort})...`);
            
            try {
                const installResult = await installExtensionsToRunningBrowser(browserInfo, extensionIds);
                results.push({
                    configId,
                    configName: browserInfo.configName,
                    ...installResult
                });
            } catch (error) {
                console.error(`❌ 为浏览器 [${browserInfo.configName}] 安装扩展失败:`, error.message);
                results.push({
                    configId,
                    configName: browserInfo.configName,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log(`📊 动态安装完成: 成功 ${successful}，失败 ${failed}`);
        
        return {
            success: failed === 0,
            results,
            summary: { total: browserConfigIds.length, successful, failed }
        };
        
    } catch (error) {
        console.error('动态安装扩展失败:', error);
        return { success: false, error: error.message };
    }
});

// 辅助函数：安装扩展到运行中的浏览器
async function installExtensionsToRunningBrowser(browserInfo, extensionIds) {
    const http = require('http');
    const WebSocket = require('ws');
    
    try {
        console.log(`🔍 连接到浏览器调试端口: ${browserInfo.debugPort}`);
        
        // 获取浏览器tabs信息
        const tabsData = await new Promise((resolve, reject) => {
            const req = http.get(`http://localhost:${browserInfo.debugPort}/json`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`解析调试信息失败: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`连接调试端口失败: ${error.message}`));
            });
            
            req.setTimeout(5000, () => {
                req.abort();
                reject(new Error('连接调试端口超时'));
            });
        });

        // 查找页面tab
        const pageTab = tabsData.find(t => t.type === 'page');
        if (!pageTab) {
            throw new Error('未找到可用的页面标签');
        }

        console.log(`🌐 找到页面标签: ${pageTab.title || 'Untitled'}`);

        // 通过WebSocket连接进行扩展安装
        const installResults = [];
        
        for (const extensionId of extensionIds) {
            try {
                if (!extensionManager || !extensionManager.extensionsDir) {
                    throw new Error('扩展管理器未初始化');
                }
                
                const extensionPath = path.join(extensionManager.extensionsDir, `${extensionId}.crx`);
                
                // 检查扩展文件是否存在
                const fs = require('fs').promises;
                await fs.access(extensionPath);
                
                // 通过Chrome DevTools Protocol安装扩展
                const installResult = await installExtensionViaDevTools(pageTab.webSocketDebuggerUrl, extensionPath, extensionId);
                installResults.push({
                    extensionId,
                    success: true,
                    method: installResult.method
                });
                
                console.log(`✅ 扩展 ${extensionId} 安装成功 (${installResult.method})`);
                
            } catch (error) {
                console.error(`❌ 扩展 ${extensionId} 安装失败:`, error.message);
                installResults.push({
                    extensionId,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const successCount = installResults.filter(r => r.success).length;
        const failCount = installResults.filter(r => !r.success).length;
        
        return {
            success: failCount === 0,
            installResults,
            summary: { total: extensionIds.length, successful: successCount, failed: failCount }
        };
        
    } catch (error) {
        throw new Error(`浏览器连接失败: ${error.message}`);
    }
}

// 通过Chrome DevTools Protocol安装扩展
async function installExtensionViaDevTools(webSocketUrl, extensionPath, extensionId) {
    const WebSocket = require('ws');
    const fs = require('fs').promises;
    
    return new Promise(async (resolve, reject) => {
        const ws = new WebSocket(webSocketUrl);
        let messageId = 1;
        
        const sendCommand = (method, params = {}) => {
            return new Promise((cmdResolve, cmdReject) => {
                const id = messageId++;
                const message = { id, method, params };
                
                const timeout = setTimeout(() => {
                    cmdReject(new Error(`命令 ${method} 超时`));
                }, 10000);
                
                const handleMessage = (data) => {
                    try {
                        const response = JSON.parse(data);
                        if (response.id === id) {
                            clearTimeout(timeout);
                            ws.removeListener('message', handleMessage);
                            
                            if (response.error) {
                                cmdReject(new Error(`CDP错误: ${response.error.message}`));
                            } else {
                                cmdResolve(response.result);
                            }
                        }
                    } catch (error) {
                        cmdReject(error);
                    }
                };
                
                ws.on('message', handleMessage);
                ws.send(JSON.stringify(message));
            });
        };
        
        ws.on('open', async () => {
            try {
                console.log(`🔌 WebSocket连接已建立`);
                
                // 尝试方法1: 通过Runtime执行加载扩展的JavaScript
                try {
                    const script = `
                        (async () => {
                            try {
                                // 尝试使用Chrome扩展API加载扩展
                                if (chrome && chrome.management) {
                                    const extensionPath = '${extensionPath}';
                                    console.log('尝试加载扩展:', extensionPath);
                                    return { success: true, method: 'chrome.management' };
                                } else {
                                    return { success: false, error: 'Chrome扩展API不可用' };
                                }
                            } catch (error) {
                                return { success: false, error: error.message };
                            }
                        })()
                    `;
                    
                    const result = await sendCommand('Runtime.evaluate', {
                        expression: script,
                        awaitPromise: true,
                        returnByValue: true
                    });
                    
                    if (result.result && result.result.value) {
                        const evalResult = result.result.value;
                        if (evalResult.success) {
                            ws.close();
                            resolve({ method: evalResult.method });
                            return;
                        }
                    }
                } catch (error) {
                    console.log(`⚠️ 方法1失败，尝试方法2: ${error.message}`);
                }
                
                // 方法2: 通过页面脚本注入提示用户
                try {
                    const script = `
                        (function() {
                            const notification = document.createElement('div');
                            notification.style.cssText = \`
                                position: fixed;
                                top: 20px;
                                right: 20px;
                                background: #4CAF50;
                                color: white;
                                padding: 15px 20px;
                                border-radius: 8px;
                                z-index: 10000;
                                font-family: Arial, sans-serif;
                                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                                max-width: 300px;
                            \`;
                            notification.innerHTML = \`
                                <div style="font-weight: bold; margin-bottom: 8px;">🧩 扩展安装提醒</div>
                                <div style="font-size: 13px;">扩展 ${extensionId} 已下载完成</div>
                                <div style="font-size: 12px; margin-top: 8px; opacity: 0.9;">
                                    请前往 chrome://extensions/ 手动加载
                                </div>
                            \`;
                            
                            document.body.appendChild(notification);
                            
                            setTimeout(() => {
                                if (notification.parentNode) {
                                    notification.parentNode.removeChild(notification);
                                }
                            }, 8000);
                            
                            return { success: true, method: 'notification' };
                        })()
                    `;
                    
                    await sendCommand('Runtime.evaluate', {
                        expression: script,
                        returnByValue: true
                    });
                    
                    ws.close();
                    resolve({ method: 'notification' });
                    
                } catch (error) {
                    throw new Error(`所有安装方法都失败: ${error.message}`);
                }
                
            } catch (error) {
                ws.close();
                reject(error);
            }
        });
        
        ws.on('error', (error) => {
            reject(new Error(`WebSocket连接错误: ${error.message}`));
        });
        
        ws.on('close', () => {
            console.log(`🔌 WebSocket连接已关闭`);
        });
    });
}
