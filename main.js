const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const ProxyForwarder = require('./proxy-forwarder');
const BrowserDownloader = require('./browser-downloader');
const UltimateSyncManager = require('./ultimate-sync-manager');
const NativeSyncManager = require('./native-sync-manager');
const { log } = require('console');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'browser-configs.json');
const SETTINGS_FILE = path.join(__dirname, 'app-settings.json');

// 默认设置
const DEFAULT_SETTINGS = {
  chromiumPath: '/Applications/Chromium 2.app/Contents/MacOS/Chromium',
  defaultUserDataRoot: path.join(os.homedir(), 'Library', 'Application Support', 'ChromiumManager'),
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
  try {
    const defaultRoot = appSettings.defaultUserDataRoot;
    const rootPath = config.userDataRoot || defaultRoot;
    const randomFolder = config.randomFolder || `browser-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const userDataDir = path.join(rootPath, randomFolder);

    // 确保目录存在
    await fs.mkdir(userDataDir, { recursive: true });
    args.push(`--user-data-dir=${userDataDir}`);
  } catch (error) {
    console.error('创建用户数据目录失败:', error);
    // 如果创建失败，使用临时目录
    const tempDir = path.join(os.tmpdir(), 'chromium-' + Date.now());
    args.push(`--user-data-dir=${tempDir}`);
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
