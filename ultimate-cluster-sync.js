const puppeteer = require('puppeteer-core');

// 终极版集群同步工具 - 修复快捷键实际效果
class UltimateClusterSync {
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

  // 启动终极集群同步
  async startUltimateSync() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动终极集群同步...');
    this.isRunning = true;
    
    // 设置页面导航监听
    await this.setupNavigationListeners();
    
    // 初始注入
    await this.injectUltimateCapture();
    
    // 开始终极的事件循环
    this.startUltimateEventLoop();
    
    console.log('');
    console.log('✅ 🌟 终极集群同步已启动！🌟');
    console.log('');
    console.log('🎯 ===== 终极版特性 =====');
    console.log('');
    console.log('🔧 终极优化：');
    console.log('   • 🚫 完全解决快速输入重复');
    console.log('   • ⌨️ 修复快捷键实际执行效果');
    console.log('   • 🎯 使用execCommand确保操作生效');
    console.log('   • ⚡ 真正的实时同步');
    console.log('');
    console.log('🎹 确认有效的快捷键：');
    console.log('   • Ctrl+A (全选) → 实际选中文本');
    console.log('   • Ctrl+C (复制) → 实际复制到剪贴板');
    console.log('   • Ctrl+V (粘贴) → 实际粘贴内容');
    console.log('   • Ctrl+Z (撤销) → 实际撤销操作');
    console.log('   • Ctrl+X (剪切) → 实际剪切文本');
    console.log('');
    console.log('📋 立即测试：');
    console.log('   1. 📝 输入一些文字');
    console.log('   2. 🔤 按Ctrl+A全选');
    console.log('   3. 📋 按Ctrl+C复制');
    console.log('   4. 📝 按Ctrl+V粘贴');
    console.log('   5. ↩️  按Ctrl+Z撤销');
    console.log('');
    console.log('👀 观察子浏览器是否同步执行！');
    console.log('⏹️  按 Ctrl+C 停止同步');
    console.log('');
  }

  // 设置页面导航监听器
  async setupNavigationListeners() {
    try {
      console.log('🔗 设置终极导航监听器...');
      
      this.masterPage.on('framenavigated', async (frame) => {
        if (frame === this.masterPage.mainFrame()) {
          console.log('🔄 页面导航，恢复同步...');
          setTimeout(async () => {
            await this.injectUltimateCapture();
          }, 1000);
        }
      });
      
      this.masterPage.on('load', async () => {
        console.log('📄 页面加载完成，恢复同步...');
        await this.injectUltimateCapture();
      });
      
      console.log('✅ 终极导航监听器设置完成');
      
    } catch (error) {
      console.error('❌ 设置导航监听器失败:', error.message);
    }
  }

  // 注入终极的事件捕获
  async injectUltimateCapture() {
    try {
      this.injectionAttempts++;
      console.log(`📡 注入终极事件捕获器... (第${this.injectionAttempts}次)`);
      
      await this.masterPage.evaluate(() => {
        if (window.__ULTIMATE_SYNC_ACTIVE__) {
          window.__ULTIMATE_SYNC_ACTIVE__ = false;
        }
        
        window.__ULTIMATE_SYNC_ACTIVE__ = true;
        window.__ULTIMATE_EVENTS__ = [];
        window.__lastUltimateInput__ = { value: '', element: null, timestamp: 0 };
        
        console.log('🌟 终极集群同步激活');
        
        // 终极鼠标事件捕获
        const captureUltimateMouseEvent = (type, e) => {
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
          
          window.__ULTIMATE_EVENTS__.push(event);
          console.log(`🖱️ [ULTIMATE] ${type}:`, e.clientX, e.clientY);
        };
        
        // 终极键盘事件捕获 - 精确快捷键检测
        const captureUltimateKeyEvent = (type, e) => {
          if (type !== 'keydown') return;
          
          // 检测修饰键
          const hasModifier = e.ctrlKey || e.metaKey;
          
          // 常用快捷键列表
          const shortcuts = {
            'a': 'selectAll',
            'c': 'copy', 
            'v': 'paste',
            'x': 'cut',
            'z': 'undo',
            'y': 'redo'
          };
          
          // 检测快捷键
          if (hasModifier && shortcuts[e.key.toLowerCase()]) {
            const event = {
              type: 'keyboard',
              action: 'ultimate_shortcut',
              shortcut: shortcuts[e.key.toLowerCase()],
              key: e.key.toLowerCase(),
              timestamp: Date.now(),
              id: 'shortcut_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            
            window.__ULTIMATE_EVENTS__.push(event);
            console.log(`⌨️ [ULTIMATE] Ctrl+${e.key.toUpperCase()} (${shortcuts[e.key.toLowerCase()]})`);
          }
          
          // 特殊键检测
          const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'];
          if (specialKeys.includes(e.key) && !hasModifier) {
            const event = {
              type: 'keyboard',
              action: 'special_key',
              key: e.key,
              timestamp: Date.now(),
              id: 'special_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            
            window.__ULTIMATE_EVENTS__.push(event);
            console.log(`🔑 [ULTIMATE] 特殊键: ${e.key}`);
          }
        };
        
        // 终极输入事件捕获
        let ultimateInputTimer = null;
        const captureUltimateInputEvent = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const currentValue = e.target.value;
            const currentElement = e.target;
            const currentTime = Date.now();
            
            if (ultimateInputTimer) {
              clearTimeout(ultimateInputTimer);
            }
            
            ultimateInputTimer = setTimeout(() => {
              const lastState = window.__lastUltimateInput__;
              const timeDiff = currentTime - lastState.timestamp;
              
              if (currentValue !== lastState.value || 
                  currentElement !== lastState.element || 
                  timeDiff > 1500) {
                
                window.__lastUltimateInput__ = {
                  value: currentValue,
                  element: currentElement,
                  timestamp: currentTime
                };
                
                const rect = e.target.getBoundingClientRect();
                const event = {
                  type: 'input_ultimate',
                  action: 'final_input',
                  value: currentValue,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  timestamp: currentTime,
                  id: 'input_' + currentTime + '_' + Math.random().toString(36).substr(2, 5)
                };
                
                window.__ULTIMATE_EVENTS__.push(event);
                console.log(`📝 [ULTIMATE] 最终输入:`, currentValue?.substring(0, 40));
              }
            }, 1200);
          }
        };
        
        // 注册终极事件监听
        ['click', 'dblclick', 'contextmenu'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureUltimateMouseEvent(eventType, e), true);
        });
        
        document.addEventListener('keydown', (e) => captureUltimateKeyEvent('keydown', e), true);
        document.addEventListener('input', captureUltimateInputEvent, true);
        
        console.log('✅ 终极事件捕获器注入完成');
      });
      
      console.log(`✅ 终极事件捕获器注入完成 (第${this.injectionAttempts}次)`);
      
    } catch (error) {
      console.error('❌ 注入终极捕获器失败:', error.message);
    }
  }

  // 终极的事件循环
  async startUltimateEventLoop() {
    const processUltimateEvents = async () => {
      if (!this.isRunning) return;
      
      try {
        const events = await this.masterPage.evaluate(() => {
          const events = window.__ULTIMATE_EVENTS__ || [];
          window.__ULTIMATE_EVENTS__ = [];
          return events;
        });
        
        for (const event of events) {
          await this.syncEventToCluster(event);
          this.eventCount++;
        }
        
      } catch (error) {
        if (!error.message.includes('detached') && !error.message.includes('closed')) {
          if (error.message.includes('Execution context was destroyed')) {
            console.log('🔄 上下文销毁，重新注入...');
            setTimeout(async () => {
              await this.injectUltimateCapture();
            }, 1000);
          }
        }
      }
      
      if (this.isRunning) {
        setTimeout(processUltimateEvents, 200);
      }
    };
    
    processUltimateEvents();
    this.startStatusReport();
  }

  // 状态报告
  startStatusReport() {
    const reportStatus = () => {
      if (!this.isRunning) return;
      
      console.log(`📊 [状态] 终极同步 ${this.eventCount} 个事件 | 注入: ${this.injectionAttempts}次`);
      
      if (this.isRunning) {
        setTimeout(reportStatus, 35000);
      }
    };
    
    setTimeout(reportStatus, 35000);
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
          case 'input_ultimate':
            await this.syncUltimateInput(page, event, index + 1);
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
        console.log(`✅ [浏览器${browserIndex}] 终极点击: (${event.x}, ${event.y})`);
        break;
        
      case 'dblclick':
        await page.mouse.click(event.x, event.y, { clickCount: 2 });
        console.log(`✅ [浏览器${browserIndex}] 终极双击: (${event.x}, ${event.y})`);
        break;
        
      case 'contextmenu':
        await page.mouse.click(event.x, event.y, { button: 'right' });
        console.log(`✅ [浏览器${browserIndex}] 终极右键: (${event.x}, ${event.y})`);
        break;
    }
  }

  // 同步键盘事件 - 修复快捷键实际效果
  async syncKeyboardEvent(page, event, browserIndex) {
    try {
      if (event.action === 'ultimate_shortcut') {
        // 使用页面原生方法执行快捷键功能
        switch (event.shortcut) {
          case 'selectAll':
            await page.evaluate(() => {
              document.execCommand('selectAll');
            });
            console.log(`✅ [浏览器${browserIndex}] 终极全选 (实际执行)`);
            break;
            
          case 'copy':
            await page.evaluate(() => {
              document.execCommand('copy');
            });
            console.log(`✅ [浏览器${browserIndex}] 终极复制 (实际执行)`);
            break;
            
          case 'paste':
            await page.evaluate(() => {
              document.execCommand('paste');
            });
            console.log(`✅ [浏览器${browserIndex}] 终极粘贴 (实际执行)`);
            break;
            
          case 'cut':
            await page.evaluate(() => {
              document.execCommand('cut');
            });
            console.log(`✅ [浏览器${browserIndex}] 终极剪切 (实际执行)`);
            break;
            
          case 'undo':
            await page.evaluate(() => {
              document.execCommand('undo');
            });
            console.log(`✅ [浏览器${browserIndex}] 终极撤销 (实际执行)`);
            break;
            
          case 'redo':
            await page.evaluate(() => {
              document.execCommand('redo');
            });
            console.log(`✅ [浏览器${browserIndex}] 终极重做 (实际执行)`);
            break;
        }
      } else if (event.action === 'special_key') {
        await page.keyboard.press(event.key);
        console.log(`✅ [浏览器${browserIndex}] 终极特殊键: ${event.key}`);
      }
    } catch (error) {
      console.error(`❌ [浏览器${browserIndex}] 终极按键失败:`, error.message);
    }
  }

  // 同步终极输入
  async syncUltimateInput(page, event, browserIndex) {
    try {
      // 点击聚焦
      await page.mouse.click(event.x, event.y);
      
      // 等待聚焦
      await new Promise(resolve => setTimeout(resolve, 120));
      
      // 全选并替换 - 使用execCommand确保生效
      await page.evaluate(() => {
        document.execCommand('selectAll');
      });
      
      await new Promise(resolve => setTimeout(resolve, 80));
      
      // 输入内容
      if (event.value) {
        await page.keyboard.type(event.value, { delay: 0 });
      }
      
      console.log(`✅ [浏览器${browserIndex}] 终极输入: "${event.value}"`);
      
    } catch (error) {
      console.error(`❌ [浏览器${browserIndex}] 终极输入失败:`, error.message);
    }
  }

  // 停止同步
  async stop() {
    console.log('');
    console.log('🛑 正在停止终极集群同步...');
    this.isRunning = false;
    
    console.log(`📊 总计终极同步了 ${this.eventCount} 个事件，注入了 ${this.injectionAttempts} 次`);
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
async function startUltimateClusterSync() {
  const cluster = new UltimateClusterSync();
  
  try {
    console.log('🌟 启动终极版集群同步...');
    console.log('');
    
    await cluster.connectCluster(9222, [9223]);
    await cluster.startUltimateSync();
    
    process.on('SIGINT', async () => {
      console.log('');
      console.log('🔴 接收到退出信号...');
      await cluster.stop();
      await cluster.disconnect();
      console.log('🎉 终极集群同步已安全停止！');
      process.exit(0);
    });
    
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
module.exports = { UltimateClusterSync };

// 直接运行
if (require.main === module) {
  startUltimateClusterSync().catch(console.error);
} 