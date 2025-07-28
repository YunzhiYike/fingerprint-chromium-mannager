const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class UltimateSyncManager {
  constructor() {
    this.masterBrowser = null;
    this.targetBrowsers = [];
    this.isActive = false;
    this.syncTimer = null;
    this.platform = process.platform;
    this.browserUIMode = true; // 启用浏览器UI控制模式
    this.windowCache = new Map(); // 缓存窗口信息
    
    console.log(`🎯 同步管理器初始化 - 平台: ${this.platform}, UI模式: ${this.browserUIMode ? '启用' : '禁用'}`);
  }

  async start({ masterDebugPort, targetDebugPorts, masterConfig, targetConfigs }) {
    console.log('🚀 启动远控同步系统...');
    
    try {
      // 保存配置信息
      this.masterConfig = masterConfig;
      this.targetConfigs = targetConfigs;
      
      
      
      // 连接主浏览器
      console.log(`📱 连接主浏览器: ${masterConfig.configName}`);
      this.masterBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${masterDebugPort}`,
        defaultViewport: null
      });
      
      const masterPages = await this.masterBrowser.pages();
      this.masterPage = masterPages[0] || await this.masterBrowser.newPage();
      console.log(`✅ 主浏览器连接成功`);

      // 连接目标浏览器
      this.targetBrowsers = [];
      for (let i = 0; i < targetDebugPorts.length; i++) {
        console.log(`📱 连接目标浏览器 ${i + 1}: ${targetConfigs[i].configName}`);
        
        const browser = await puppeteer.connect({
          browserURL: `http://localhost:${targetDebugPorts[i]}`,
          defaultViewport: null
        });
        
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        
        this.targetBrowsers.push({
          browser,
          page,
          config: targetConfigs[i]
        });
        
        console.log(`✅ 目标浏览器 ${i + 1} 连接成功`);
      }

      // 启动同步
      await this.startEventSync();
      this.isActive = true;
      
      console.log('🎉 远控同步系统启动成功！');
      return { success: true, message: '远控同步启动成功' };
      
    } catch (error) {
      console.error('❌ 启动失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  async startEventSync() {
    console.log('🔥 开始设置混合事件监控...');
    
    // 缓存浏览器窗口信息
    await this.cacheBrowserWindows();
    
    // 启动网页内事件监控
    await this.startPageEventMonitoring();
    
    // 启动事件同步循环
    this.startSyncLoop();
  }
  
  // 启动网页内事件监控
  async startPageEventMonitoring() {
    console.log('📡 启动网页内事件监控...');
    
    // 添加页面导航监听
    this.masterPage.on('framenavigated', () => {
      console.log('🔄 页面导航，重新注入脚本...');
      setTimeout(() => this.injectEventScript(), 1000);
    });
    
    this.masterPage.on('load', () => {
      console.log('📄 页面加载完成，重新注入脚本...');
      setTimeout(() => this.injectEventScript(), 500);
    });
    
    // 初始注入
    await this.injectEventScript();
  }
  
  // 注入事件捕获脚本
  async injectEventScript() {
    try {
      console.log('📡 注入事件捕获脚本...');
      
      await this.masterPage.evaluate(() => {
        // 清理已存在的监听器
        if (window.__SYNC_CLEANUP__) {
          window.__SYNC_CLEANUP__();
        }
        
        console.log('🌟 开始注入事件监听器');
        
        const eventQueue = [];
        let isCapturing = true;
        
        // 点击事件监听器
        const clickHandler = (e) => {
          if (!isCapturing) return;
          
          eventQueue.push({
            type: 'click',
            x: e.clientX,
            y: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            timestamp: Date.now()
          });
          console.log('👆 捕获点击:', e.clientX, e.clientY, '屏幕:', e.screenX, e.screenY);
        };
        
        // 键盘事件监听器
        const keyHandler = (e) => {
          if (!isCapturing) return;
          
          eventQueue.push({
            type: 'keydown',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            timestamp: Date.now()
          });
          console.log('⌨️ 捕获键盘:', e.key);
        };
        
        // 输入事件监听器
        const inputHandler = (e) => {
          if (!isCapturing) return;
          
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            eventQueue.push({
              type: 'input',
              value: e.target.value,
              targetType: e.target.tagName,
              timestamp: Date.now()
            });
            console.log('📝 捕获输入:', e.target.value);
          }
        };
        
        // 注册事件监听器
        document.addEventListener('click', clickHandler, true);
        document.addEventListener('keydown', keyHandler, true);
        document.addEventListener('input', inputHandler, true);
        
        // 暴露事件队列和清理函数
        window.__REMOTE_SYNC__ = {
          events: eventQueue,
          capturing: true
        };
        
        window.__SYNC_CLEANUP__ = () => {
          isCapturing = false;
          document.removeEventListener('click', clickHandler, true);
          document.removeEventListener('keydown', keyHandler, true);
          document.removeEventListener('input', inputHandler, true);
          delete window.__REMOTE_SYNC__;
          delete window.__SYNC_CLEANUP__;
        };
        
        console.log('✅ 事件监听器注入完成');
      });
      
      console.log('✅ 脚本注入成功');
    } catch (error) {
      console.error('❌ 脚本注入失败:', error.message);
    }
  }

  // 已移除系统级监控方法，改用混合控制策略

  // 缓存浏览器窗口信息
  async cacheBrowserWindows() {
    console.log('📱 缓存浏览器UI窗口信息...');
    
    // 首先缓存主浏览器窗口信息
    if (this.masterBrowser && this.masterConfig) {
      try {
        let masterProcessId = null;
        
        console.log(`🔍 [MASTER_${this.masterConfig.configName}] 开始获取进程ID...`);
        
        // 尝试获取主浏览器进程ID
        try {
          const process = this.masterBrowser.process();
          if (process && process.pid) {
            masterProcessId = process.pid;
            console.log(`✅ [MASTER_${this.masterConfig.configName}] 直接获取进程ID: ${masterProcessId}`);
          } else {
            console.log(`⚠️ [MASTER_${this.masterConfig.configName}] 进程对象无效，尝试端口查找`);
          }
        } catch (e) {
          console.log(`⚠️ [MASTER_${this.masterConfig.configName}] 直接获取进程ID失败: ${e.message}`);
        }
        
        // 如果直接获取失败，使用端口查找
        if (!masterProcessId) {
          try {
            const port = this.masterConfig.debugPort;
            console.log(`🔍 [MASTER_${this.masterConfig.configName}] 通过端口 ${port} 查找进程ID`);
            
            if (this.platform === 'darwin') {
              const { stdout } = await execAsync(`lsof -ti:${port}`);
              console.log(`🔍 [MASTER_${this.masterConfig.configName}] 端口查找输出: "${stdout.trim()}"`);
              
              const pids = stdout.trim().split('\n').filter(pid => pid && pid.match(/^\d+$/));
              console.log(`🔍 [MASTER_${this.masterConfig.configName}] 有效PID列表: ${JSON.stringify(pids)}`);
              
              if (pids.length > 0) {
                masterProcessId = parseInt(pids[0]);
                console.log(`✅ [MASTER_${this.masterConfig.configName}] 端口查找获取进程ID: ${masterProcessId}`);
              } else {
                console.log(`❌ [MASTER_${this.masterConfig.configName}] 端口查找无有效PID`);
              }
            }
          } catch (e2) {
            console.log(`❌ [MASTER_${this.masterConfig.configName}] 端口查找失败: ${e2.message}`);
          }
        }
        
        if (masterProcessId) {
          console.log(`🔍 [MASTER_${this.masterConfig.configName}] 获取窗口信息，PID=${masterProcessId}`);
          const windowInfo = await this.getBrowserWindowInfo(masterProcessId);
          console.log(`🔍 [MASTER_${this.masterConfig.configName}] 窗口信息结果:`, windowInfo);
          
          if (windowInfo.valid) {
            this.windowCache.set('MASTER_' + this.masterConfig.configName, {
              processId: masterProcessId,
              windowInfo,
              lastUpdate: Date.now(),
              isMaster: true
            });
            console.log(`📋 [MASTER_${this.masterConfig.configName}] 主浏览器窗口缓存成功: PID=${masterProcessId}, 位置=(${windowInfo.x},${windowInfo.y}), 大小=${windowInfo.width}x${windowInfo.height}`);
          } else {
            console.log(`❌ [MASTER_${this.masterConfig.configName}] 窗口信息无效:`, windowInfo);
          }
        } else {
          console.log(`❌ [MASTER_${this.masterConfig.configName}] 无法获取进程ID`);
        }
      } catch (error) {
        console.error(`❌ [${this.masterConfig.configName}] 主浏览器窗口信息缓存失败:`, error.message);
      }
    } else {
      console.log(`❌ 主浏览器或主配置无效: masterBrowser=${!!this.masterBrowser}, masterConfig=${!!this.masterConfig}`);
    }
    
    // 然后缓存目标浏览器窗口信息
    for (const targetBrowser of this.targetBrowsers) {
      try {
        let processId = null;
        
        // 尝试获取进程ID
        try {
          const process = targetBrowser.browser.process();
          if (process && process.pid) {
            processId = process.pid;
          }
        } catch (e) {
          // 使用端口查找进程ID
          try {
            const port = targetBrowser.config.debugPort;
            if (this.platform === 'darwin') {
              const { stdout } = await execAsync(`lsof -ti:${port}`);
              const pids = stdout.trim().split('\n').filter(pid => pid);
              if (pids.length > 0) {
                processId = parseInt(pids[0]);
              }
            }
          } catch (e2) {
            console.log(`⚠️ [${targetBrowser.config.configName}] 无法获取进程ID`);
            continue;
          }
        }
        
        if (processId) {
          const windowInfo = await this.getBrowserWindowInfo(processId);
          if (windowInfo.valid) {
            this.windowCache.set(targetBrowser.config.configName, {
              processId,
              windowInfo,
              lastUpdate: Date.now()
            });
            console.log(`📋 [${targetBrowser.config.configName}] UI窗口: PID=${processId}, 位置=(${windowInfo.x},${windowInfo.y}), 大小=${windowInfo.width}x${windowInfo.height}`);
          }
        }
      } catch (error) {
        console.error(`❌ [${targetBrowser.config.configName}] 窗口信息缓存失败:`, error.message);
      }
    }
  }

  // 获取浏览器窗口信息
  async getBrowserWindowInfo(processId) {
    console.log(`🔍 [DEBUG] 获取窗口信息: PID=${processId}, 平台=${this.platform}`);
    
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
        
        console.log(`🔍 [DEBUG] 执行AppleScript获取窗口信息...`);
        const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);
        const output = stdout.trim();
        
        console.log(`🔍 [DEBUG] AppleScript输出: "${output}"`);
        if (stderr) {
          console.log(`🔍 [DEBUG] AppleScript错误输出: "${stderr}"`);
        }
        
        if (output.startsWith('ERROR:')) {
          console.log(`❌ AppleScript执行错误 PID ${processId}:`, output);
          return { x: 0, y: 0, width: 0, height: 0, valid: false, error: output };
        }
        
        if (output === 'NO_WINDOW') {
          console.log(`⚠️ 进程 ${processId} 没有可见窗口`);
          return { x: 0, y: 0, width: 0, height: 0, valid: false, error: 'NO_WINDOW' };
        }
        
        // 清理和解析输出
        const cleanedOutput = output.replace(/\s+/g, ''); // 移除所有空格
        const parts = cleanedOutput.split(',').filter(part => part !== ''); // 过滤空字符串
        console.log(`🔍 [DEBUG] 清理后的输出: "${cleanedOutput}"`);
        console.log(`🔍 [DEBUG] 解析窗口数据: parts=${JSON.stringify(parts)}`);
        
        if (parts.length !== 4) {
          console.log(`❌ 窗口数据格式错误，期望4个值，实际${parts.length}个`);
          return { x: 0, y: 0, width: 0, height: 0, valid: false, error: 'INVALID_FORMAT' };
        }
        
        const [x, y, width, height] = parts.map(part => {
          const num = parseInt(part, 10);
          console.log(`🔍 [DEBUG] 解析 "${part}" -> ${num}`);
          return num;
        });
        console.log(`🔍 [DEBUG] 解析坐标: x=${x}, y=${y}, width=${width}, height=${height}`);
        
        if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
          console.log(`❌ 窗口坐标包含非数字值`);
          return { x: 0, y: 0, width: 0, height: 0, valid: false, error: 'NaN_VALUES' };
        }
        
        if (width > 0 && height > 0) {
          console.log(`✅ 窗口信息有效: PID=${processId}, 位置=(${x},${y}), 大小=${width}x${height}`);
          return { x, y, width, height, valid: true };
        } else {
          console.log(`❌ 窗口大小无效: width=${width}, height=${height}`);
          return { x, y, width, height, valid: false, error: 'INVALID_SIZE' };
        }
      } else {
        console.log(`❌ 不支持的平台: ${this.platform}`);
        return { x: 0, y: 0, width: 0, height: 0, valid: false, error: 'UNSUPPORTED_PLATFORM' };
      }
    } catch (error) {
      console.error(`❌ 获取窗口信息异常 PID ${processId}:`, error.message);
      return { x: 0, y: 0, width: 0, height: 0, valid: false, error: error.message };
    }
  }

  // 判断点击区域
  getBrowserUIRegion(x, y, windowInfo) {
    const relativeX = x - windowInfo.x;
    const relativeY = y - windowInfo.y;
    
    // 浏览器UI区域（适配macOS Chrome浏览器）
    if (relativeY <= 110) { // 扩大UI区域范围，包含工具栏
      if (relativeY <= 28) {
        return { region: 'titleBar', description: "标题栏/窗口控制", isBrowserUI: true };
      } else if (relativeY <= 60) {
        return { region: 'tabBar', description: "标签栏", isBrowserUI: true };
      } else if (relativeY <= 110) {
        return { region: 'addressBar', description: "地址栏/工具栏", isBrowserUI: true };
      }
    }
    
    return { region: 'content', description: "网页内容", isBrowserUI: false };
  }

  // 执行UI点击
  async executeUIClick(configName, x, y) {
    const cached = this.windowCache.get(configName);
    if (!cached || !cached.windowInfo.valid) {
      return false;
    }

    const windowInfo = cached.windowInfo;
    
    // 检查是否在窗口内
    if (x < windowInfo.x || x > windowInfo.x + windowInfo.width ||
        y < windowInfo.y || y > windowInfo.y + windowInfo.height) {
      return false;
    }

    const uiRegion = this.getBrowserUIRegion(x, y, windowInfo);
    
    try {
      // 激活窗口
      await this.activateBrowserWindow(cached.processId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // 执行系统级点击
      const success = await this.executeSystemClick(x, y);
      
      if (success) {
        if (uiRegion.isBrowserUI) {
          console.log(`🎯 [${configName}] ${uiRegion.description}: (${x}, ${y})`);
        } else {
          console.log(`👆 [${configName}] 网页内容: (${x}, ${y})`);
        }
        return true;
      }
    } catch (error) {
      console.error(`❌ [${configName}] UI点击失败:`, error.message);
    }
    
    return false;
  }

  // 执行系统级点击
  async executeSystemClick(x, y) {
    try {
      if (this.platform === 'darwin') {
        const script = `
          tell application "System Events"
            set mousePosition to {${x}, ${y}}
            set the position of the mouse cursor to mousePosition
            delay 0.1
            click at mousePosition
            delay 0.1
          end tell
        `;
        
        const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/\n/g, ' ')}'`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ 系统级点击失败: (${x}, ${y})`, error.message);
      return false;
    }
  }

  // 激活浏览器窗口
  async activateBrowserWindow(processId) {
    try {
      if (this.platform === 'darwin') {
        const script = `
          tell application "System Events"
            set targetApp to first application process whose unix id is ${processId}
            set frontmost of targetApp to true
            if exists (first window of targetApp) then
              set targetWindow to first window of targetApp
              perform action "AXRaise" of targetWindow
            end if
          end tell
        `;
        
        await execAsync(`osascript -e '${script}'`);
        return true;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  // 启动事件同步循环
  startSyncLoop() {
    console.log('🔄 启动事件同步循环...');
    
    this.syncTimer = setInterval(async () => {
      if (!this.isActive || !this.masterPage) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          if (!window.__REMOTE_SYNC__ || !window.__REMOTE_SYNC__.events || window.__REMOTE_SYNC__.events.length === 0) {
            return [];
          }
          
          const events = [...window.__REMOTE_SYNC__.events];
          window.__REMOTE_SYNC__.events.length = 0; // 清空队列
          return events;
        });
        
        // 同步事件到目标浏览器
        if (events.length > 0) {
          console.log(`📤 同步 ${events.length} 个事件`);
          await this.syncEvents(events);
        }
        
      } catch (error) {
        // 如果是页面导航错误，等待重新注入
        if (error.message.includes('Execution context was destroyed')) {
          console.log('🔄 页面导航中，等待重新注入...');
        } else {
          console.error('❌ 事件同步失败:', error.message);
        }
      }
    }, 100); // 每100毫秒检查一次
  }



  async syncEvents(events) {
    for (const event of events) {
      for (const target of this.targetBrowsers) {
        try {
          await this.executeEvent(target, event);
        } catch (error) {
          console.error(`❌ [${target?.config?.configName || 'UNKNOWN'}] 事件执行失败:`, error.message);
        }
      }
    }
  }

  async executeEvent(target, event) {
    const { page, config } = target;
    
    if (!page || !event) return;
    if (!config) {
      console.error(`❌ [${target?.configName || 'UNKNOWN'}] config是undefined`);
      return;
    }
    
    try {
      switch (event.type) {
        case 'click':
          // 智能点击策略：根据浏览器UI模式选择点击方式
          let uiClickSuccess = false;
          
          // 策略1: 尝试浏览器UI控制（如果启用且有屏幕坐标）
          if (this.browserUIMode && event.screenX && event.screenY) {
            // 使用屏幕坐标来判断UI区域
            const masterCacheKey = 'MASTER_' + this.masterConfig.configName;
            const masterCached = this.windowCache.get(masterCacheKey);
            
            if (masterCached && masterCached.windowInfo.valid) {
              const masterWindowInfo = masterCached.windowInfo;
              
              // 使用屏幕坐标判断是否在浏览器UI区域
              const uiRegion = this.getBrowserUIRegion(event.screenX, event.screenY, masterWindowInfo);
              
              console.log(`🔍 主浏览器UI检测: 屏幕点击(${event.screenX}, ${event.screenY}) -> ${uiRegion.description} (UI: ${uiRegion.isBrowserUI})`);
              
              if (uiRegion.isBrowserUI) {
                // 这是UI区域点击，转换为相对坐标
                const relativeX = event.screenX - masterWindowInfo.x;
                const relativeY = event.screenY - masterWindowInfo.y;
                
                console.log(`🎯 UI区域点击 -> 相对坐标: (${relativeX}, ${relativeY})`);
                
                // 同步到所有目标浏览器
                for (const targetBrowser of this.targetBrowsers) {
                  if (targetBrowser.config.configName === config.configName) {
                    const targetCached = this.windowCache.get(config.configName);
                    
                    if (targetCached && targetCached.windowInfo.valid) {
                      const targetWindowInfo = targetCached.windowInfo;
                      const targetX = targetWindowInfo.x + relativeX;
                      const targetY = targetWindowInfo.y + relativeY;
                      
                      console.log(`🎯 同步到 [${config.configName}]: 绝对(${targetX},${targetY})`);
                      uiClickSuccess = await this.executeUIClick(config.configName, targetX, targetY);
                    }
                    break;
                  }
                }
              } else {
                console.log(`📄 这是网页内容区域点击，使用常规同步`);
              }
            }
          }
          
          // 策略2: 如果UI控制失败或未启用，使用网页内点击
          if (!uiClickSuccess) {
            try {
              // 尝试页面内坐标点击
              await page.mouse.click(event.x, event.y);
              console.log(`👆 [${config.configName}] 页面内点击: (${event.x}, ${event.y})`);
            } catch (error) {
              try {
                // 尝试元素点击
                const clickResult = await page.evaluate((x, y) => {
                  const element = document.elementFromPoint(x, y);
                  if (element) {
                    element.click();
                    
                    const mouseEvent = new MouseEvent('click', {
                      view: window,
                      bubbles: true,
                      cancelable: true,
                      clientX: x,
                      clientY: y
                    });
                    element.dispatchEvent(mouseEvent);
                    
                    return {
                      tag: element.tagName,
                      type: element.type,
                      id: element.id,
                      className: element.className.substring(0, 50)
                    };
                  }
                  return null;
                }, event.x, event.y);
                
                if (clickResult) {
                  console.log(`👆 [${config.configName}] 元素点击: ${clickResult.tag} (${event.x}, ${event.y})`);
                } else {
                  console.log(`⚠️ [${config.configName}] 点击位置无元素: (${event.x}, ${event.y})`);
                }
              } catch (fallbackError) {
                console.log(`❌ [${config.configName}] 点击执行失败: (${event.x}, ${event.y})`);
              }
            }
          }
          break;
          
        case 'keydown':
          try {
            // 增强的按键处理
            if (event.key.length === 1) {
              // 单个字符，使用type方法
              await page.keyboard.type(event.key);
              console.log(`⌨️ [${config.configName}] 字符输入: ${event.key}`);
            } else {
              // 特殊键，使用press方法
              await page.keyboard.press(event.key);
              console.log(`⌨️ [${config.configName}] 按键: ${event.key}`);
            }
          } catch (error) {
            // 尝试通过页面评估来模拟按键
            try {
              await page.evaluate((key) => {
                const activeElement = document.activeElement;
                if (activeElement) {
                  const keyEvent = new KeyboardEvent('keydown', {
                    key: key,
                    bubbles: true,
                    cancelable: true
                  });
                  activeElement.dispatchEvent(keyEvent);
                }
              }, event.key);
              console.log(`⌨️ [${config.configName}] 事件按键: ${event.key}`);
            } catch (fallbackError) {
              console.log(`❌ [${config.configName}] 按键失败: ${event.key}`);
            }
          }
          break;
          
        case 'input':
          try {
            // 增强的输入处理 - 更智能的内容同步
            await page.evaluate((value) => {
              const activeElement = document.activeElement;
              if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                // 清空当前内容
                activeElement.select();
                activeElement.value = '';
                
                // 设置新值
                activeElement.value = value;
                
                // 触发所有相关事件
                const events = ['input', 'change', 'keyup', 'blur', 'focus'];
                events.forEach(eventType => {
                  const event = new Event(eventType, { bubbles: true });
                  activeElement.dispatchEvent(event);
                });
                
                return true;
              }
              return false;
            }, event.value);
            
            console.log(`📝 [${config.configName}] 智能输入: ${event.value}`);
          } catch (error) {
            // 备用方案：使用键盘输入
            try {
              // 先清空
              await page.keyboard.down('Meta'); // Cmd键
              await page.keyboard.press('a');
              await page.keyboard.up('Meta');
              await page.keyboard.press('Backspace');
              
              // 再输入
              await page.keyboard.type(event.value);
              console.log(`📝 [${config.configName}] 键盘输入: ${event.value}`);
            } catch (fallbackError) {
              console.log(`❌ [${config.configName}] 输入失败: ${event.value}`);
            }
          }
          break;
          
        case 'wheel':
          // 滚动事件处理
          try {
            await page.mouse.wheel({ deltaX: event.deltaX || 0, deltaY: event.deltaY || 0 });
            console.log(`🖱️ [${config.configName}] 滚动: (${event.deltaX || 0}, ${event.deltaY || 0})`);
          } catch (error) {
            console.log(`❌ [${config.configName}] 滚动失败`);
          }
          break;
      }
    } catch (error) {
      console.error(`❌ [${config.configName}] 事件执行失败:`, error.message);
    }
  }



  async stop() {
    console.log('🛑 停止远控同步系统...');
    
    this.isActive = false;
    
    // 清理同步定时器
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    // 清理事件监听器
    if (this.masterPage) {
      try {
        await this.masterPage.evaluate(() => {
          if (window.__SYNC_CLEANUP__) {
            window.__SYNC_CLEANUP__();
          }
        });
      } catch (error) {
        console.error('清理网页事件监听器失败:', error.message);
      }
    }
    
    // 清理窗口缓存
    this.windowCache.clear();
    
    // 断开连接
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
        console.error(`断开目标浏览器失败:`, error.message);
      }
    }
    
    this.masterBrowser = null;
    this.targetBrowsers = [];
    
    console.log('✅ 远控同步系统已停止');
    return { success: true, message: '远控同步已停止' };
  }

  getStatus() {
    return {
      isActive: this.isActive,
      masterConnected: !!this.masterBrowser,
      targetCount: this.targetBrowsers.length
    };
  }

  async syncWindowSizes() {
    if (!this.masterPage || this.targetBrowsers.length === 0) {
      return { success: false, message: '没有连接的浏览器' };
    }

    try {
      // 获取主浏览器窗口大小
      const masterSize = await this.masterPage.evaluate(() => ({
        width: window.outerWidth,
        height: window.outerHeight,
        x: window.screenX,
        y: window.screenY
      }));

      // 同步到目标浏览器
      const results = [];
      for (let i = 0; i < this.targetBrowsers.length; i++) {
        const target = this.targetBrowsers[i];
        try {
          await target.page.setViewport({
            width: Math.floor(masterSize.width * 0.8),
            height: Math.floor(masterSize.height * 0.8)
          });

          await target.page.evaluate((size, offset) => {
            window.resizeTo(size.width, size.height);
            window.moveTo(size.x + offset, size.y);
          }, masterSize, (i + 1) * 50);

          results.push({ success: true, browserName: target.config.configName });
          
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }

      return {
        success: true,
        message: `窗口同步完成: ${results.filter(r => r.success).length}/${results.length}`,
        results
      };
      
    } catch (error) {
      return { success: false, message: `窗口同步失败: ${error.message}` };
    }
  }
}

module.exports = UltimateSyncManager; 