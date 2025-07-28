const puppeteer = require('puppeteer-core');
const { mouse, keyboard, screen, Point, Key } = require('@nut-tree-fork/nut-js');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class NativeSyncManager {
  constructor() {
    this.isActive = false;
    this.platform = process.platform;
    this.masterBrowser = null;
    this.targetBrowsers = [];
    this.windowCache = new Map();
    this.masterConfig = null;
    this.targetConfigs = [];
    this.mouseTimer = null;
    this.keyboardTimer = null;
    this.isExecutingClick = false; // 防止循环检测的标志
    
    // 系统级监控状态
    this.lastMouseState = { x: 0, y: 0, pressed: false };
    this.lastKeyboardTime = 0;
    this.mouseStableCount = 0;
    this.stablePosition = { x: 0, y: 0 };
    
    // 配置nut-js
    this.setupNutJs();
  }

  setupNutJs() {
    // 设置nut-js配置以提高性能
    mouse.config.autoDelayMs = 50;
    mouse.config.mouseSpeed = 3000;
    keyboard.config.autoDelayMs = 50;
  }

  async start({ masterDebugPort, targetDebugPorts, masterConfig, targetConfigs }) {
    console.log('🚀 启动原生句柄同步系统...');
    this.isActive = true;
    this.masterConfig = masterConfig;
    this.targetConfigs = targetConfigs;

    try {
      // 连接主浏览器
      console.log(`📱 连接主浏览器: ${masterConfig.configName}`);
      this.masterBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${masterDebugPort}`,
        defaultViewport: null
      });

      // 连接目标浏览器
      this.targetBrowsers = [];
      for (let i = 0; i < targetDebugPorts.length; i++) {
        const port = targetDebugPorts[i];
        const config = targetConfigs[i];
        
        console.log(`📱 连接目标浏览器 ${i + 1}: ${config.configName}`);
        const browser = await puppeteer.connect({
          browserURL: `http://localhost:${port}`,
          defaultViewport: null
        });
        
        this.targetBrowsers.push({ browser, config });
      }

      // 缓存所有浏览器窗口信息
      await this.cacheBrowserWindows();

      // 启动浏览器内事件监控（结合原生执行）
      await this.startBrowserEventMonitoring();

      console.log('🎉 原生句柄同步系统启动成功！');
      return { success: true };

    } catch (error) {
      console.error('❌ 启动失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 缓存浏览器窗口信息
  async cacheBrowserWindows() {
    console.log('📱 缓存浏览器窗口信息...');

    // 缓存主浏览器
    if (this.masterBrowser && this.masterConfig) {
      const masterProcessId = await this.getBrowserProcessId(this.masterBrowser, this.masterConfig.debugPort);
      if (masterProcessId) {
        const windowInfo = await this.getBrowserWindowInfo(masterProcessId);
        if (windowInfo.valid) {
          this.windowCache.set('MASTER_' + this.masterConfig.configName, {
            processId: masterProcessId,
            windowInfo,
            isMaster: true
          });
          console.log(`📋 [MASTER_${this.masterConfig.configName}] 窗口缓存: PID=${masterProcessId}, 位置=(${windowInfo.x},${windowInfo.y}), 大小=${windowInfo.width}x${windowInfo.height}`);
        }
      }
    }

    // 缓存目标浏览器
    for (const targetBrowser of this.targetBrowsers) {
      const processId = await this.getBrowserProcessId(targetBrowser.browser, targetBrowser.config.debugPort);
      if (processId) {
        const windowInfo = await this.getBrowserWindowInfo(processId);
        if (windowInfo.valid) {
          this.windowCache.set(targetBrowser.config.configName, {
            processId,
            windowInfo,
            isMaster: false
          });
          console.log(`📋 [${targetBrowser.config.configName}] 窗口缓存: PID=${processId}, 位置=(${windowInfo.x},${windowInfo.y}), 大小=${windowInfo.width}x${windowInfo.height}`);
        }
      }
    }
  }

  // 获取浏览器进程ID
  async getBrowserProcessId(browser, debugPort) {
    try {
      console.log(`🔍 获取进程ID - 端口: ${debugPort}`);
      
      // 尝试直接获取
      const process = browser.process();
      if (process && process.pid) {
        console.log(`✅ 直接获取进程ID: ${process.pid} (端口: ${debugPort})`);
        return process.pid;
      }

      // 通过端口和进程名查找具体的浏览器进程
      if (this.platform === 'darwin') {
        const { stdout } = await execAsync(`lsof -ti:${debugPort}`);
        const allPids = stdout.trim().split('\n').filter(pid => pid.match(/^\d+$/));
        
        console.log(`🔍 端口 ${debugPort} 关联的所有进程: ${allPids.join(', ')}`);
        
        // 查找每个PID对应的进程信息，选择Chromium相关的进程
        for (const pid of allPids) {
          try {
            const { stdout: processInfo } = await execAsync(`ps -p ${pid} -o comm=`);
            const processName = processInfo.trim();
            console.log(`🔍 PID ${pid} 进程名: ${processName}`);
            
            // 查找Chromium主进程或渲染进程
            if (processName.includes('Chromium') || processName.includes('Chrome')) {
              // 进一步验证这个进程确实在监听指定端口
              try {
                const { stdout: portCheck } = await execAsync(`lsof -p ${pid} | grep ${debugPort}`);
                if (portCheck.trim()) {
                  console.log(`✅ 找到匹配的浏览器进程: PID=${pid}, 端口=${debugPort}`);
                  return parseInt(pid);
                }
              } catch (error) {
                // 端口验证失败，继续下一个
              }
            }
          } catch (error) {
            // 无法获取进程信息，继续下一个
          }
        }
        
        // 如果没有找到精确匹配，使用第一个PID
        if (allPids.length > 0) {
          const fallbackPid = parseInt(allPids[0]);
          console.log(`⚠️ 使用第一个PID作为备选: ${fallbackPid} (端口: ${debugPort})`);
          return fallbackPid;
        }
      }

      console.log(`❌ 无法获取进程ID (端口: ${debugPort})`);
      return null;
    } catch (error) {
      console.log(`❌ 获取进程ID失败 (端口: ${debugPort}):`, error.message);
      return null;
    }
  }

  // 获取窗口信息
  async getBrowserWindowInfo(processId) {
    try {
      if (this.platform === 'darwin') {
        const script = `
          tell application "System Events"
            try
              set targetApp to first application process whose unix id is ${processId}
              if exists (first window of targetApp) then
                set targetWindow to first window of targetApp
                set windowPosition to position of targetWindow
                set windowSize to size of targetWindow
                set x to (item 1 of windowPosition) as string
                set y to (item 2 of windowPosition) as string
                set w to (item 1 of windowSize) as string
                set h to (item 2 of windowSize) as string
                return x & "," & y & "," & w & "," & h
              else
                return "NO_WINDOW"
              end if
            on error errMsg
              return "ERROR:" & errMsg
            end try
          end tell
        `;

        const { stdout } = await execAsync(`osascript -e '${script}'`);
        const output = stdout.trim();

        if (output.startsWith('ERROR:') || output === 'NO_WINDOW') {
          return { x: 0, y: 0, width: 0, height: 0, valid: false };
        }

        const cleanedOutput = output.replace(/\s+/g, '');
        const parts = cleanedOutput.split(',').filter(part => part !== '');

        if (parts.length === 4) {
          const [x, y, width, height] = parts.map(Number);
          if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
            return { x, y, width, height, valid: true };
          }
        }
      }

      return { x: 0, y: 0, width: 0, height: 0, valid: false };
    } catch (error) {
      return { x: 0, y: 0, width: 0, height: 0, valid: false };
    }
  }

  // 启动纯系统级事件监控（可控制浏览器UI）
  async startBrowserEventMonitoring() {
    console.log('🎯 启动纯系统级事件监控...');
    
    try {
      // 初始化状态
      this.lastMouseState = { x: 0, y: 0, pressed: false };
      this.lastKeyboardTime = 0;
      this.mouseStableCount = 0;
      this.stablePosition = { x: 0, y: 0 };
      
      // 启动鼠标监控
      this.startSystemMouseMonitoring();
      
      // 启动键盘监控
      this.startSystemKeyboardMonitoring();
      
    } catch (error) {
      console.error('❌ 启动系统级事件监控失败:', error.message);
    }
  }

  // 启动键盘快捷键同步点击监控
  startSystemMouseMonitoring() {
    console.log('🖱️ 启动快捷键同步点击监控...');
    console.log('💡 使用方法: 按 Cmd+Shift+C 在当前鼠标位置触发同步点击');
    
    this.mouseTimer = setInterval(async () => {
      if (this.isExecutingClick) return;
      
      try {
        // 检测快捷键组合: Cmd+Shift+C (在macOS上)
        const isShortcutPressed = await this.checkSyncClickShortcut();
        
        if (isShortcutPressed) {
          const currentPos = await mouse.getPosition();
          
          // 检查是否在主浏览器窗口内
          const inMasterWindow = await this.isMouseInMasterBrowser(currentPos.x, currentPos.y);
          
          if (inMasterWindow) {
            console.log(`⌨️🖱️ 快捷键触发同步点击: (${currentPos.x}, ${currentPos.y})`);
            await this.handleSystemClick(currentPos.x, currentPos.y);
          } else {
            console.log(`⚠️ 鼠标不在主浏览器窗口内，无法同步点击`);
          }
        }
        
      } catch (error) {
        console.error('🖱️ 快捷键监控错误:', error.message);
      }
    }, 100); // 100ms间隔检测快捷键
  }

  // 检测同步点击快捷键 (Cmd+Shift+C)
  async checkSyncClickShortcut() {
    try {
      if (this.platform === 'darwin') {
        const { stdout } = await execAsync(`
          osascript -e '
            tell application "System Events"
              set cmdPressed to (command down)
              set shiftPressed to (shift down) 
              set cPressed to (key code 8 down)
              return (cmdPressed and shiftPressed and cPressed)
            end tell
          '
        `);
        return stdout.trim() === 'true';
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // 启动系统级键盘监控（暂时简化）
  startSystemKeyboardMonitoring() {
    console.log('⌨️ 启动系统级键盘监控...');
    
    // 暂时禁用键盘监控，专注于鼠标测试
    this.keyboardTimer = setInterval(async () => {
      // 先专注于鼠标功能，键盘监控暂时禁用
      return;
    }, 1000); // 1秒间隔，减少资源消耗
  }

  // 改进的鼠标状态检测（监控点击事件而不是按键状态）
  async isSystemMousePressed() {
    try {
      if (this.platform === 'darwin') {
        // 使用更可靠的方法：检测鼠标事件而不是状态
        const { stdout } = await execAsync(`
          osascript -e '
            tell application "System Events"
              try
                set mousePos to (current position of mouse)
                return "false"
              on error
                return "false"
              end try
            end tell
          '
        `);
        
        // 暂时返回 false，我们改用位置变化检测点击
        return false;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // 检查鼠标是否在主浏览器窗口内
  async isMouseInMasterBrowser(x, y) {
    try {
      const masterCacheKey = 'MASTER_' + this.masterConfig.configName;
      const masterCached = this.windowCache.get(masterCacheKey);
      
      if (!masterCached || !masterCached.windowInfo.valid) {
        // 调试：窗口信息无效
        if (Date.now() % 1000 < 50) {
          console.log('⚠️ 主浏览器窗口信息无效或未缓存');
        }
        return false;
      }

      const windowInfo = masterCached.windowInfo;
      const inWindow = x >= windowInfo.x && 
                      x <= (windowInfo.x + windowInfo.width) &&
                      y >= windowInfo.y && 
                      y <= (windowInfo.y + windowInfo.height);
      
      // 调试：窗口范围检测（每2秒1次）
      if (Date.now() % 2000 < 50) {
        console.log(`🪟 窗口检测: 鼠标(${x},${y}) 窗口[${windowInfo.x},${windowInfo.y} ${windowInfo.width}x${windowInfo.height}] 在内:${inWindow}`);
      }
      
      return inWindow;
    } catch (error) {
      console.error('🪟 窗口检测错误:', error.message);
      return false;
    }
  }

  // 检查主浏览器是否获得焦点
  async isMasterBrowserFocused() {
    try {
      if (this.platform === 'darwin') {
        const masterCacheKey = 'MASTER_' + this.masterConfig.configName;
        const masterCached = this.windowCache.get(masterCacheKey);
        
        if (!masterCached) return false;
        
        const { stdout } = await execAsync(`
          osascript -e '
            tell application "System Events"
              set frontApp to name of first application process whose frontmost is true
              return frontApp
            end tell
          '
        `);
        
        const frontAppName = stdout.trim();
        return frontAppName.includes('Chromium') || frontAppName.includes('Chrome');
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // 处理系统级点击事件
  async handleSystemClick(x, y) {
    console.log(`🖱️ 处理系统点击: (${x}, ${y})`);
    
    // 防止执行循环
    this.isExecutingClick = true;
    
    try {
      // 获取主浏览器窗口信息
      const masterCacheKey = 'MASTER_' + this.masterConfig.configName;
      const masterCached = this.windowCache.get(masterCacheKey);
      
      if (!masterCached || !masterCached.windowInfo.valid) {
        console.log('⚠️ 主浏览器窗口信息无效');
        return;
      }

      const masterWindowInfo = masterCached.windowInfo;
      
      // 计算相对坐标（绝对坐标 - 窗口起始位置）
      const relativeX = x - masterWindowInfo.x;
      const relativeY = y - masterWindowInfo.y;

      // 同步到所有目标浏览器
      for (const targetBrowser of this.targetBrowsers) {
        const targetCached = this.windowCache.get(targetBrowser.config.configName);
        if (targetCached && targetCached.windowInfo.valid) {
          const targetWindowInfo = targetCached.windowInfo;
          const targetX = targetWindowInfo.x + relativeX;
          const targetY = targetWindowInfo.y + relativeY;
          
          console.log(`🎯 同步到 [${targetBrowser.config.configName}]: (${targetX}, ${targetY})`);
          await this.executeNativeClick(targetX, targetY);
        }
      }
    } catch (error) {
      console.error('❌ 点击同步失败:', error.message);
    }
    
    setTimeout(() => { this.isExecutingClick = false; }, 100);
  }

  // 检查系统键盘活动
  async hasSystemKeyboardActivity() {
    // 简化版：通过监控系统输入法状态变化来检测键盘活动
    try {
      const now = Date.now();
      return (now - this.lastKeyboardTime) > 50; // 简单的时间间隔检测
    } catch (error) {
      return false;
    }
  }

  // 获取最后按下的键（简化版）
  async getLastKeyPressed() {
    // 注意：这是一个简化的实现
    // 实际的键盘监控需要更复杂的系统级API
    try {
      const timestamp = Date.now();
      return {
        key: 'unknown',
        timestamp: timestamp
      };
    } catch (error) {
      return null;
    }
  }

  // 处理系统级键盘事件
  async handleSystemKeyboard(keyData) {
    console.log(`⌨️ 处理系统键盘: ${keyData.key}`);
    
    this.isExecutingClick = true;
    
    try {
      // 为每个目标浏览器执行键盘操作
      for (const targetBrowser of this.targetBrowsers) {
        const targetCached = this.windowCache.get(targetBrowser.config.configName);
        if (targetCached && targetCached.windowInfo.valid) {
          // 激活目标窗口然后发送键盘事件
          const targetWindowInfo = targetCached.windowInfo;
          const centerX = targetWindowInfo.x + targetWindowInfo.width / 2;
          const centerY = targetWindowInfo.y + targetWindowInfo.height / 2;
          
          await mouse.setPosition(new Point(centerX, centerY));
          await mouse.leftClick();
          
          // 简单的键盘输入（实际使用中需要改进）
          if (keyData.key.length === 1) {
            await keyboard.type(keyData.key);
          }
          
          console.log(`⌨️ [${targetBrowser.config.configName}] 键盘同步完成`);
        }
      }
    } catch (error) {
      console.error('❌ 键盘同步失败:', error.message);
    }
    
    setTimeout(() => { this.isExecutingClick = false; }, 100);
  }



  // 判断点击是否在浏览器UI区域
  getBrowserUIRegion(screenX, screenY, windowInfo) {
    // 计算相对于窗口的坐标
    const relativeX = screenX - windowInfo.x;
    const relativeY = screenY - windowInfo.y;
    
    // 判断是否在浏览器UI区域（工具栏、地址栏等）
    // 一般来说，前60像素是工具栏区域
    const toolbarHeight = 60;
    
    if (relativeY <= toolbarHeight) {
      return {
        isBrowserUI: true,
        description: '浏览器工具栏区域'
      };
    }
    
    return {
      isBrowserUI: false,
      description: '网页内容区域'
    };
  }



  // 发送特殊按键
  async sendSpecialKey(event) {
    try {
      // 处理常见的特殊键
      switch (event.key) {
        case 'Enter':
          await keyboard.pressKey(Key.Return);
          break;
        case 'Backspace':
          await keyboard.pressKey(Key.Backspace);
          break;
        case 'Tab':
          await keyboard.pressKey(Key.Tab);
          break;
        case 'Escape':
          await keyboard.pressKey(Key.Escape);
          break;
        case 'ArrowUp':
          await keyboard.pressKey(Key.Up);
          break;
        case 'ArrowDown':
          await keyboard.pressKey(Key.Down);
          break;
        case 'ArrowLeft':
          await keyboard.pressKey(Key.Left);
          break;
        case 'ArrowRight':
          await keyboard.pressKey(Key.Right);
          break;
        default:
          console.log(`⚠️ 未处理的特殊键: ${event.key}`);
      }
    } catch (error) {
      console.error(`❌ 发送特殊键失败: ${event.key}`, error.message);
    }
  }





  // 执行原生点击
  async executeNativeClick(x, y) {
    try {
      // 移动到目标位置并点击，不恢复鼠标位置避免触发更多检测
      await mouse.setPosition(new Point(x, y));
      await mouse.leftClick();
      
      console.log(`✅ 原生点击完成: (${x}, ${y})`);
      return true;
    } catch (error) {
      console.error(`❌ 原生点击失败: (${x}, ${y})`, error.message);
      return false;
    }
  }



  // 启用/禁用UI模式
  setBrowserUIMode(enabled) {
    console.log(`🎯 浏览器UI控制模式已${enabled ? '启用' : '禁用'}`);
    if (enabled) {
      this.cacheBrowserWindows();
    }
  }

  // 刷新窗口信息
  async refreshWindowInfo() {
    console.log('🔄 刷新窗口信息...');
    await this.cacheBrowserWindows();
  }

  // 停止同步
  async stop() {
    console.log('🛑 停止原生句柄同步系统...');
    
    this.isActive = false;

    // 清理系统级监控定时器
    if (this.mouseTimer) {
      clearInterval(this.mouseTimer);
      this.mouseTimer = null;
    }
    
    if (this.keyboardTimer) {
      clearInterval(this.keyboardTimer);
      this.keyboardTimer = null;
    }

    // 重置所有状态标志
    this.isExecutingClick = false;
    this.lastMouseState = { x: 0, y: 0, pressed: false };
    this.lastKeyboardTime = 0;
    this.mouseStableCount = 0;
    this.stablePosition = { x: 0, y: 0 };

    // 清理窗口缓存
    this.windowCache.clear();

    // 断开浏览器连接
    if (this.masterBrowser) {
      try {
        await this.masterBrowser.disconnect();
      } catch (error) {
        console.error('断开主浏览器失败:', error.message);
      }
    }

    for (const target of this.targetBrowsers) {
      try {
        await target.browser.disconnect();
      } catch (error) {
        console.error('断开目标浏览器失败:', error.message);
      }
    }

    this.masterBrowser = null;
    this.targetBrowsers = [];

    console.log('✅ 原生句柄同步系统已停止');
    return { success: true };
  }
}

module.exports = NativeSyncManager; 