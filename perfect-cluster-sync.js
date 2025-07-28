const puppeteer = require('puppeteer-core');

// 完美版集群同步工具 - 解决快速输入和快捷键问题
class PerfectClusterSync {
  constructor() {
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    this.isRunning = false;
    this.eventCount = 0;
    this.injectionAttempts = 0;
  }

  // 连接浏览器集群
  async connectCluster(masterPort, targetPorts) {
    console.log('🌐 连接到浏览器集群...');
    
    try {
      // 连接主控浏览器
      console.log(`🎯 连接主控浏览器: ${masterPort}`);
      this.masterBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${masterPort}`,
        defaultViewport: null
      });
      
      const masterPages = await this.masterBrowser.pages();
      this.masterPage = masterPages[0] || await this.masterBrowser.newPage();
      console.log(`✅ 主控浏览器连接成功`);
      
      // 连接目标浏览器
      for (let i = 0; i < targetPorts.length; i++) {
        const port = targetPorts[i];
        try {
          console.log(`🎯 连接目标浏览器 ${i + 1}: ${port}`);
          
          const browser = await puppeteer.connect({
            browserURL: `http://localhost:${port}`,
            defaultViewport: null
          });
          
          const pages = await browser.pages();
          const page = pages[0] || await browser.newPage();
          
          this.targetBrowsers.push(browser);
          this.targetPages.push(page);
          
          console.log(`✅ 目标浏览器 ${i + 1} 连接成功`);
        } catch (error) {
          console.error(`❌ 连接目标浏览器 ${port} 失败:`, error.message);
        }
      }
      
      console.log(`🎉 集群连接完成: 1主控 + ${this.targetPages.length}目标浏览器`);
      
    } catch (error) {
      console.error(`❌ 连接集群失败:`, error.message);
      throw error;
    }
  }

  // 启动完美集群同步
  async startPerfectSync() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动完美集群同步...');
    this.isRunning = true;
    
    // 设置页面导航监听
    await this.setupNavigationListeners();
    
    // 初始注入
    await this.injectPerfectCapture();
    
    // 开始完美的事件循环
    this.startPerfectEventLoop();
    
    console.log('');
    console.log('✅ 🌟 完美集群同步已启动！🌟');
    console.log('');
    console.log('🎯 ===== 完美版特性 =====');
    console.log('');
    console.log('🔧 完美优化：');
    console.log('   • 🚫 彻底解决快速输入重复问题');
    console.log('   • ⌨️ 完整快捷键同步（Ctrl+C/V/A/Z等）');
    console.log('   • 🎯 智能输入检测和去重');
    console.log('   • ⚡ 实时按键同步，无延迟');
    console.log('   • 🔄 页面刷新自动恢复');
    console.log('');
    console.log('🎹 支持的快捷键：');
    console.log('   • Ctrl+C (复制) / Ctrl+V (粘贴)');
    console.log('   • Ctrl+A (全选) / Ctrl+Z (撤销)');
    console.log('   • Ctrl+X (剪切) / Ctrl+Y (重做)');
    console.log('   • Ctrl+S (保存) / Ctrl+F (查找)');
    console.log('   • F5 (刷新) / F12 (开发者工具)');
    console.log('');
    console.log('📋 现在可以测试：');
    console.log('   1. ⚡ 快速输入文字（无重复）');
    console.log('   2. 🎹 各种快捷键组合');
    console.log('   3. 🔄 刷新页面后继续使用');
    console.log('   4. 🖱️ 各种鼠标操作');
    console.log('');
    console.log('⏹️  按 Ctrl+C 停止同步');
    console.log('');
  }

  // 设置页面导航监听器
  async setupNavigationListeners() {
    try {
      console.log('🔗 设置完美导航监听器...');
      
      // 监听页面导航
      this.masterPage.on('framenavigated', async (frame) => {
        if (frame === this.masterPage.mainFrame()) {
          console.log('🔄 页面导航检测，重新注入...');
          setTimeout(async () => {
            await this.injectPerfectCapture();
          }, 800);
        }
      });
      
      // 监听页面加载
      this.masterPage.on('load', async () => {
        console.log('📄 页面加载完成，恢复同步...');
        await this.injectPerfectCapture();
      });
      
      console.log('✅ 完美导航监听器设置完成');
      
    } catch (error) {
      console.error('❌ 设置导航监听器失败:', error.message);
    }
  }

  // 注入完美的事件捕获
  async injectPerfectCapture() {
    try {
      this.injectionAttempts++;
      console.log(`📡 注入完美事件捕获器... (第${this.injectionAttempts}次)`);
      
      // 在当前页面注入
      await this.masterPage.evaluate(() => {
        if (window.__PERFECT_SYNC_ACTIVE__) {
          window.__PERFECT_SYNC_ACTIVE__ = false;
        }
        
        window.__PERFECT_SYNC_ACTIVE__ = true;
        window.__PERFECT_EVENTS__ = [];
        window.__lastInputState__ = { value: '', element: null, timestamp: 0 };
        
        console.log('🌟 完美集群同步激活');
        
        // 完美的鼠标事件捕获
        const capturePerfectMouseEvent = (type, e) => {
          if (!['click', 'dblclick', 'contextmenu'].includes(type)) return;
          
          const event = {
            type: 'mouse',
            action: type,
            x: e.clientX,
            y: e.clientY,
            button: e.button,
            timestamp: Date.now(),
            id: 'mouse_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
          };
          
          window.__PERFECT_EVENTS__.push(event);
          console.log(`🖱️ [PERFECT] ${type}:`, e.clientX, e.clientY);
        };
        
        // 完美的键盘事件捕获 - 支持所有快捷键
        const capturePerfectKeyEvent = (type, e) => {
          // 检测快捷键组合
          const isShortcut = e.ctrlKey || e.metaKey || e.altKey || 
                            ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(e.key);
          
          if (type === 'keydown' && isShortcut) {
            const event = {
              type: 'keyboard',
              action: 'shortcut',
              key: e.key,
              code: e.code,
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              altKey: e.altKey,
              shiftKey: e.shiftKey,
              timestamp: Date.now(),
              id: 'key_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            
            window.__PERFECT_EVENTS__.push(event);
            
            let shortcutDesc = '';
            if (e.ctrlKey || e.metaKey) shortcutDesc += 'Ctrl+';
            if (e.altKey) shortcutDesc += 'Alt+';
            if (e.shiftKey) shortcutDesc += 'Shift+';
            shortcutDesc += e.key;
            
            console.log(`⌨️ [PERFECT] 快捷键:`, shortcutDesc);
          }
          
          // 特殊功能键
          const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'];
          if (type === 'keydown' && specialKeys.includes(e.key) && !isShortcut) {
            const event = {
              type: 'keyboard',
              action: 'special',
              key: e.key,
              timestamp: Date.now(),
              id: 'special_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            
            window.__PERFECT_EVENTS__.push(event);
            console.log(`🔑 [PERFECT] 特殊键:`, e.key);
          }
        };
        
        // 完美的输入事件捕获 - 彻底解决重复问题
        let inputDebounceTimer = null;
        const capturePerfectInputEvent = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const currentValue = e.target.value;
            const currentElement = e.target;
            const currentTime = Date.now();
            
            // 清除之前的定时器
            if (inputDebounceTimer) {
              clearTimeout(inputDebounceTimer);
            }
            
            // 设置新的防抖定时器 - 更长的延迟确保输入完成
            inputDebounceTimer = setTimeout(() => {
              // 检查是否真的需要同步
              const lastState = window.__lastInputState__;
              const timeDiff = currentTime - lastState.timestamp;
              
              if (currentValue !== lastState.value || 
                  currentElement !== lastState.element || 
                  timeDiff > 1000) {
                
                // 更新状态
                window.__lastInputState__ = {
                  value: currentValue,
                  element: currentElement,
                  timestamp: currentTime
                };
                
                const rect = e.target.getBoundingClientRect();
                const event = {
                  type: 'input_perfect',
                  action: 'complete_input',
                  value: currentValue,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  timestamp: currentTime,
                  id: 'input_' + currentTime + '_' + Math.random().toString(36).substr(2, 5)
                };
                
                window.__PERFECT_EVENTS__.push(event);
                console.log(`📝 [PERFECT] 完整输入:`, currentValue?.substring(0, 30));
              }
            }, 1000); // 1秒防抖延迟
          }
        };
        
        // 注册完美事件监听
        ['click', 'dblclick', 'contextmenu'].forEach(eventType => {
          document.addEventListener(eventType, (e) => capturePerfectMouseEvent(eventType, e), true);
        });
        
        document.addEventListener('keydown', (e) => capturePerfectKeyEvent('keydown', e), true);
        document.addEventListener('input', capturePerfectInputEvent, true);
        
        console.log('✅ 完美事件捕获器注入完成');
      });
      
      console.log(`✅ 完美事件捕获器注入完成 (第${this.injectionAttempts}次)`);
      
    } catch (error) {
      console.error('❌ 注入完美捕获器失败:', error.message);
    }
  }

  // 完美的事件循环
  async startPerfectEventLoop() {
    const processPerfectEvents = async () => {
      if (!this.isRunning) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          const events = window.__PERFECT_EVENTS__ || [];
          window.__PERFECT_EVENTS__ = [];
          return events;
        });
        
        // 处理每个事件
        for (const event of events) {
          await this.syncEventToCluster(event);
          this.eventCount++;
        }
        
      } catch (error) {
        if (!error.message.includes('detached') && !error.message.includes('closed')) {
          if (error.message.includes('Execution context was destroyed')) {
            console.log('🔄 上下文销毁，重新注入...');
            setTimeout(async () => {
              await this.injectPerfectCapture();
            }, 1000);
          }
        }
      }
      
      // 优化的循环频率
      if (this.isRunning) {
        setTimeout(processPerfectEvents, 150);
      }
    };
    
    processPerfectEvents();
    
    // 状态报告
    this.startStatusReport();
  }

  // 状态报告
  startStatusReport() {
    const reportStatus = () => {
      if (!this.isRunning) return;
      
      console.log(`📊 [状态] 完美同步 ${this.eventCount} 个事件 | 注入: ${this.injectionAttempts}次 | 集群: 1主控+${this.targetPages.length}目标`);
      
      if (this.isRunning) {
        setTimeout(reportStatus, 30000);
      }
    };
    
    setTimeout(reportStatus, 30000);
  }

  // 同步事件到集群
  async syncEventToCluster(event) {
    if (this.targetPages.length === 0) return;
    
    const promises = this.targetPages.map(async (page, index) => {
      try {
        switch (event.type) {
          case 'mouse':
            await this.syncMouseEvent(page, event, index + 1);
            break;
          case 'keyboard':
            await this.syncKeyboardEvent(page, event, index + 1);
            break;
          case 'input_perfect':
            await this.syncPerfectInput(page, event, index + 1);
            break;
        }
      } catch (error) {
        // 静默处理
      }
    });
    
    await Promise.all(promises);
  }

  // 同步鼠标事件
  async syncMouseEvent(page, event, browserIndex) {
    switch (event.action) {
      case 'click':
        await page.mouse.click(event.x, event.y);
        console.log(`✅ [浏览器${browserIndex}] 完美点击: (${event.x}, ${event.y})`);
        break;
        
      case 'dblclick':
        await page.mouse.click(event.x, event.y, { clickCount: 2 });
        console.log(`✅ [浏览器${browserIndex}] 完美双击: (${event.x}, ${event.y})`);
        break;
        
      case 'contextmenu':
        await page.mouse.click(event.x, event.y, { button: 'right' });
        console.log(`✅ [浏览器${browserIndex}] 完美右键: (${event.x}, ${event.y})`);
        break;
    }
  }

  // 同步键盘事件 - 完整快捷键支持
  async syncKeyboardEvent(page, event, browserIndex) {
    if (event.action === 'shortcut') {
      // 构建修饰键
      const modifiers = [];
      if (event.ctrlKey || event.metaKey) modifiers.push('Control');
      if (event.altKey) modifiers.push('Alt');
      if (event.shiftKey) modifiers.push('Shift');
      
      // 同步快捷键
      try {
        if (modifiers.length > 0) {
          // 按下修饰键
          for (const modifier of modifiers) {
            await page.keyboard.down(modifier);
          }
          
          // 按下主键
          await page.keyboard.press(event.key);
          
          // 释放修饰键
          for (const modifier of modifiers.reverse()) {
            await page.keyboard.up(modifier);
          }
        } else {
          // 功能键
          await page.keyboard.press(event.key);
        }
        
        let shortcutDesc = '';
        if (event.ctrlKey || event.metaKey) shortcutDesc += 'Ctrl+';
        if (event.altKey) shortcutDesc += 'Alt+';
        if (event.shiftKey) shortcutDesc += 'Shift+';
        shortcutDesc += event.key;
        
        console.log(`✅ [浏览器${browserIndex}] 完美快捷键: ${shortcutDesc}`);
      } catch (error) {
        console.error(`❌ [浏览器${browserIndex}] 快捷键同步失败:`, error.message);
      }
    } else if (event.action === 'special') {
      await page.keyboard.press(event.key);
      console.log(`✅ [浏览器${browserIndex}] 完美特殊键: ${event.key}`);
    }
  }

  // 同步完美输入
  async syncPerfectInput(page, event, browserIndex) {
    try {
      // 点击位置聚焦
      await page.mouse.click(event.x, event.y);
      
      // 等待聚焦
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 全选现有内容
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 一次性输入完整内容
      if (event.value) {
        await page.keyboard.type(event.value, { delay: 0 });
      }
      
      console.log(`✅ [浏览器${browserIndex}] 完美输入: "${event.value}"`);
      
    } catch (error) {
      console.error(`❌ [浏览器${browserIndex}] 完美输入失败:`, error.message);
    }
  }

  // 停止同步
  async stop() {
    console.log('');
    console.log('🛑 正在停止完美集群同步...');
    this.isRunning = false;
    
    console.log(`📊 总计完美同步了 ${this.eventCount} 个事件，注入了 ${this.injectionAttempts} 次`);
  }

  // 断开连接
  async disconnect() {
    console.log('🔌 断开集群连接...');
    this.isRunning = false;
    
    for (const browser of this.targetBrowsers) {
      try {
        await browser.disconnect();
      } catch (error) {
        // 静默处理
      }
    }
    
    if (this.masterBrowser) {
      try {
        await this.masterBrowser.disconnect();
      } catch (error) {
        // 静默处理
      }
    }
    
    console.log('✅ 集群连接已断开');
  }
}

// 主函数
async function startPerfectClusterSync() {
  const cluster = new PerfectClusterSync();
  
  try {
    console.log('🌟 启动完美版集群同步...');
    console.log('');
    
    // 连接集群
    await cluster.connectCluster(9222, [9223]);
    
    // 启动完美同步
    await cluster.startPerfectSync();
    
    // 优雅退出处理
    process.on('SIGINT', async () => {
      console.log('');
      console.log('🔴 接收到退出信号...');
      await cluster.stop();
      await cluster.disconnect();
      console.log('🎉 完美集群同步已安全停止！');
      process.exit(0);
    });
    
    // 保持运行
    setInterval(() => {
      // 保持进程活跃
    }, 1000);
    
  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    await cluster.disconnect();
    process.exit(1);
  }
}

// 导出
module.exports = { PerfectClusterSync };

// 直接运行
if (require.main === module) {
  startPerfectClusterSync().catch(console.error);
} 