const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const ProxyForwarder = require('./proxy-forwarder');
const BrowserDownloader = require('./browser-downloader');
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
    // mainWindow.webContents.openDevTools();
  });

      // 开发模式下打开开发者工具
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
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
            mainWindow.webContents.send('browser-download-progress', {
                progress: progress,
                downloaded: downloaded,
                total: total
            });
        };
        
        const result = await browserDownloader.downloadAndInstall(installPath, onProgress);
        
        if (result.success) {
            // 自动更新应用设置中的浏览器路径
            appSettings.chromiumPath = result.executablePath;
            await saveAppSettings();
            
            // 通知前端更新
            mainWindow.webContents.send('browser-install-complete', result);
        }
        
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-browser-installation', async () => {
    try {
        const defaultPath = browserDownloader.getDefaultInstallPath();
        
        // 检查默认安装路径是否存在浏览器
        const executablePath = await browserDownloader.findBrowserExecutable(defaultPath);
        
        if (executablePath) {
            return {
                installed: true,
                path: executablePath,
                autoDetected: true
            };
        } else {
            return {
                installed: false,
                autoDetected: false
            };
        }
    } catch (error) {
        return {
            installed: false,
            error: error.message
        };
    }
});