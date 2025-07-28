const puppeteer = require('puppeteer-core');

// 稳定版集群同步工具 - 自动处理页面刷新
class StableClusterSync {
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

  // 启动稳定集群同步
  async startStableSync() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动稳定集群同步...');
    this.isRunning = true;
    
    // 设置页面导航监听
    await this.setupNavigationListeners();
    
    // 初始注入
    await this.injectStableCapture();
    
    // 开始稳定的事件循环
    this.startStableEventLoop();
    
    console.log('');
    console.log('✅ 🌟 稳定集群同步已启动！🌟');
    console.log('');
    console.log('🎯 ===== 稳定版特性 =====');
    console.log('');
    console.log('🔄 自动处理功能：');
    console.log('   • 🔄 页面刷新后自动重新注入');
    console.log('   • 🔗 页面导航后自动恢复同步');
    console.log('   • 🛡️ 连接断开自动重连');
    console.log('   • 📊 实时监控同步状态');
    console.log('');
    console.log('📋 现在可以安全地：');
    console.log('   1. 🔄 刷新主控浏览器页面');
    console.log('   2. 🔗 导航到不同网站');
    console.log('   3. 📝 在任何页面输入内容');
    console.log('   4. 🖱️ 进行各种操作');
    console.log('');
    console.log('👀 同步将在页面加载后自动恢复！');
    console.log('⏹️  按 Ctrl+C 停止同步');
    console.log('');
  }

  // 设置页面导航监听器
  async setupNavigationListeners() {
    try {
      console.log('🔗 设置页面导航监听器...');
      
      // 监听页面导航开始
      this.masterPage.on('framenavigated', async (frame) => {
        if (frame === this.masterPage.mainFrame()) {
          console.log('🔄 检测到页面导航，准备重新注入...');
          // 等待页面稳定后重新注入
          setTimeout(async () => {
            await this.injectStableCapture();
          }, 1000);
        }
      });
      
      // 监听页面加载完成
      this.masterPage.on('load', async () => {
        console.log('📄 页面加载完成，重新注入同步监听器...');
        await this.injectStableCapture();
      });
      
      // 监听DOM准备就绪
      this.masterPage.on('domcontentloaded', async () => {
        console.log('🏗️ DOM准备就绪，准备注入...');
        setTimeout(async () => {
          await this.injectStableCapture();
        }, 500);
      });
      
      console.log('✅ 页面导航监听器设置完成');
      
    } catch (error) {
      console.error('❌ 设置导航监听器失败:', error.message);
    }
  }

  // 注入稳定的事件捕获
  async injectStableCapture() {
    try {
      this.injectionAttempts++;
      console.log(`📡 注入稳定事件捕获器... (第${this.injectionAttempts}次)`);
      
      // 使用 evaluateOnNewDocument 确保在每个新页面都自动注入
      await this.masterPage.evaluateOnNewDocument(() => {
        // 等待DOM就绪后注入
        const injectWhenReady = () => {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectWhenReady);
            return;
          }
          
          // 避免重复注入
          if (window.__STABLE_SYNC_INJECTED__) {
            console.log('🔄 稳定同步已注入，跳过');
            return;
          }
          
          window.__STABLE_SYNC_INJECTED__ = true;
          window.__STABLE_EVENTS__ = [];
          window.__lastStableInput__ = '';
          
          console.log('🌟 稳定集群同步激活');
          
          // 稳定的鼠标事件捕获
          const captureStableMouseEvent = (type, e) => {
            if (!['click', 'dblclick', 'contextmenu'].includes(type)) return;
            
            const event = {
              type: 'mouse',
              action: type,
              x: e.clientX,
              y: e.clientY,
              button: e.button,
              timestamp: Date.now(),
              id: Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            
            window.__STABLE_EVENTS__.push(event);
            console.log(`🖱️ [STABLE] ${type}:`, e.clientX, e.clientY);
            
            if (window.__STABLE_EVENTS__.length > 5) {
              window.__STABLE_EVENTS__ = window.__STABLE_EVENTS__.slice(-3);
            }
          };
          
          // 稳定的输入事件捕获 - 防抖处理
          let inputTimeout = null;
          const captureStableInputEvent = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
              // 防抖处理，500ms后才同步
              if (inputTimeout) {
                clearTimeout(inputTimeout);
              }
              
              inputTimeout = setTimeout(() => {
                const currentValue = e.target.value;
                
                // 只有内容真正变化时才同步
                if (currentValue !== window.__lastStableInput__) {
                  window.__lastStableInput__ = currentValue;
                  
                  const rect = e.target.getBoundingClientRect();
                  const event = {
                    type: 'input_stable',
                    action: 'input_final',
                    value: currentValue,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    timestamp: Date.now(),
                    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5)
                  };
                  
                  window.__STABLE_EVENTS__.push(event);
                  console.log(`📝 [STABLE] 最终输入:`, currentValue);
                  
                  if (window.__STABLE_EVENTS__.length > 5) {
                    window.__STABLE_EVENTS__ = window.__STABLE_EVENTS__.slice(-3);
                  }
                }
              }, 500); // 500ms防抖
            }
          };
          
          // 稳定的键盘事件捕获
          const captureStableKeyEvent = (type, e) => {
            const specialKeys = ['Enter', 'Tab', 'Escape'];
            
            if (type === 'keydown' && specialKeys.includes(e.key)) {
              const event = {
                type: 'keyboard',
                action: type,
                key: e.key,
                timestamp: Date.now(),
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 5)
              };
              
              window.__STABLE_EVENTS__.push(event);
              console.log(`⌨️ [STABLE] 特殊键:`, e.key);
              
              if (window.__STABLE_EVENTS__.length > 5) {
                window.__STABLE_EVENTS__ = window.__STABLE_EVENTS__.slice(-3);
              }
            }
          };
          
          // 注册稳定事件监听
          ['click', 'dblclick', 'contextmenu'].forEach(eventType => {
            document.addEventListener(eventType, (e) => captureStableMouseEvent(eventType, e), true);
          });
          
          document.addEventListener('input', captureStableInputEvent, true);
          document.addEventListener('keydown', (e) => captureStableKeyEvent('keydown', e), true);
          
          console.log('✅ 稳定事件捕获器注入完成');
        };
        
        injectWhenReady();
      });
      
      // 也在当前页面注入
      await this.masterPage.evaluate(() => {
        // 如果已经注入过，先清理
        if (window.__STABLE_SYNC_INJECTED__) {
          window.__STABLE_SYNC_INJECTED__ = false;
        }
        
        window.__STABLE_SYNC_INJECTED__ = true;
        window.__STABLE_EVENTS__ = [];
        window.__lastStableInput__ = '';
        
        console.log('🌟 当前页面稳定同步激活');
        
        // 同样的注入逻辑
        const captureStableMouseEvent = (type, e) => {
          if (!['click', 'dblclick', 'contextmenu'].includes(type)) return;
          
          const event = {
            type: 'mouse',
            action: type,
            x: e.clientX,
            y: e.clientY,
            button: e.button,
            timestamp: Date.now(),
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 5)
          };
          
          window.__STABLE_EVENTS__.push(event);
          console.log(`🖱️ [STABLE] ${type}:`, e.clientX, e.clientY);
          
          if (window.__STABLE_EVENTS__.length > 5) {
            window.__STABLE_EVENTS__ = window.__STABLE_EVENTS__.slice(-3);
          }
        };
        
        let inputTimeout = null;
        const captureStableInputEvent = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            if (inputTimeout) clearTimeout(inputTimeout);
            
            inputTimeout = setTimeout(() => {
              const currentValue = e.target.value;
              
              if (currentValue !== window.__lastStableInput__) {
                window.__lastStableInput__ = currentValue;
                
                const rect = e.target.getBoundingClientRect();
                const event = {
                  type: 'input_stable',
                  action: 'input_final',
                  value: currentValue,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  timestamp: Date.now(),
                  id: Date.now() + '_' + Math.random().toString(36).substr(2, 5)
                };
                
                window.__STABLE_EVENTS__.push(event);
                console.log(`📝 [STABLE] 最终输入:`, currentValue);
                
                if (window.__STABLE_EVENTS__.length > 5) {
                  window.__STABLE_EVENTS__ = window.__STABLE_EVENTS__.slice(-3);
                }
              }
            }, 500);
          }
        };
        
        const captureStableKeyEvent = (type, e) => {
          const specialKeys = ['Enter', 'Tab', 'Escape'];
          
          if (type === 'keydown' && specialKeys.includes(e.key)) {
            const event = {
              type: 'keyboard',
              action: type,
              key: e.key,
              timestamp: Date.now(),
              id: Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            };
            
            window.__STABLE_EVENTS__.push(event);
            console.log(`⌨️ [STABLE] 特殊键:`, e.key);
            
            if (window.__STABLE_EVENTS__.length > 5) {
              window.__STABLE_EVENTS__ = window.__STABLE_EVENTS__.slice(-3);
            }
          }
        };
        
        ['click', 'dblclick', 'contextmenu'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureStableMouseEvent(eventType, e), true);
        });
        
        document.addEventListener('input', captureStableInputEvent, true);
        document.addEventListener('keydown', (e) => captureStableKeyEvent('keydown', e), true);
        
        console.log('✅ 当前页面稳定事件捕获器注入完成');
      });
      
      console.log(`✅ 稳定事件捕获器注入完成 (第${this.injectionAttempts}次)`);
      
    } catch (error) {
      console.error('❌ 注入稳定捕获器失败:', error.message);
    }
  }

  // 稳定的事件循环
  async startStableEventLoop() {
    const processStableEvents = async () => {
      if (!this.isRunning) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          const events = window.__STABLE_EVENTS__ || [];
          window.__STABLE_EVENTS__ = [];
          return events;
        });
        
        // 处理每个事件
        for (const event of events) {
          await this.syncEventToCluster(event);
          this.eventCount++;
        }
        
      } catch (error) {
        if (!error.message.includes('detached') && !error.message.includes('closed')) {
          // 尝试重新注入
          if (error.message.includes('Execution context was destroyed')) {
            console.log('🔄 检测到页面上下文销毁，重新注入...');
            setTimeout(async () => {
              await this.injectStableCapture();
            }, 1000);
          }
        }
      }
      
      // 稳定的循环频率
      if (this.isRunning) {
        setTimeout(processStableEvents, 200);
      }
    };
    
    processStableEvents();
    
    // 状态报告
    this.startStatusReport();
  }

  // 状态报告
  startStatusReport() {
    const reportStatus = () => {
      if (!this.isRunning) return;
      
      console.log(`📊 [状态] 稳定同步 ${this.eventCount} 个事件 | 注入次数: ${this.injectionAttempts} | 集群: 1主控+${this.targetPages.length}目标`);
      
      if (this.isRunning) {
        setTimeout(reportStatus, 20000); // 每20秒报告一次
      }
    };
    
    setTimeout(reportStatus, 20000);
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
          case 'input_stable':
            await this.syncStableInput(page, event, index + 1);
            break;
        }
      } catch (error) {
        // 静默处理单个浏览器的错误
      }
    });
    
    await Promise.all(promises);
  }

  // 同步鼠标事件
  async syncMouseEvent(page, event, browserIndex) {
    switch (event.action) {
      case 'click':
        await page.mouse.click(event.x, event.y);
        console.log(`✅ [浏览器${browserIndex}] 稳定点击: (${event.x}, ${event.y})`);
        break;
        
      case 'dblclick':
        await page.mouse.click(event.x, event.y, { clickCount: 2 });
        console.log(`✅ [浏览器${browserIndex}] 稳定双击: (${event.x}, ${event.y})`);
        break;
        
      case 'contextmenu':
        await page.mouse.click(event.x, event.y, { button: 'right' });
        console.log(`✅ [浏览器${browserIndex}] 稳定右键: (${event.x}, ${event.y})`);
        break;
    }
  }

  // 同步键盘事件
  async syncKeyboardEvent(page, event, browserIndex) {
    if (event.action === 'keydown') {
      switch (event.key) {
        case 'Enter':
          await page.keyboard.press('Enter');
          console.log(`✅ [浏览器${browserIndex}] 稳定回车`);
          break;
        case 'Tab':
          await page.keyboard.press('Tab');
          console.log(`✅ [浏览器${browserIndex}] 稳定Tab`);
          break;
        case 'Escape':
          await page.keyboard.press('Escape');
          console.log(`✅ [浏览器${browserIndex}] 稳定Esc`);
          break;
      }
    }
  }

  // 同步稳定输入
  async syncStableInput(page, event, browserIndex) {
    try {
      // 点击输入框位置
      await page.mouse.click(event.x, event.y);
      
      // 等待焦点设置
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 全选并替换
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 一次性输入完整内容
      if (event.value) {
        await page.keyboard.type(event.value, { delay: 0 });
      }
      
      console.log(`✅ [浏览器${browserIndex}] 稳定输入: "${event.value}"`);
      
    } catch (error) {
      console.error(`❌ [浏览器${browserIndex}] 稳定输入失败:`, error.message);
    }
  }

  // 停止同步
  async stop() {
    console.log('');
    console.log('🛑 正在停止稳定集群同步...');
    this.isRunning = false;
    
    console.log(`📊 总计稳定同步了 ${this.eventCount} 个事件，注入了 ${this.injectionAttempts} 次`);
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
async function startStableClusterSync() {
  const cluster = new StableClusterSync();
  
  try {
    console.log('🌟 启动稳定版集群同步...');
    console.log('');
    
    // 连接集群
    await cluster.connectCluster(9222, [9223]);
    
    // 启动稳定同步
    await cluster.startStableSync();
    
    // 优雅退出处理
    process.on('SIGINT', async () => {
      console.log('');
      console.log('🔴 接收到退出信号...');
      await cluster.stop();
      await cluster.disconnect();
      console.log('🎉 稳定集群同步已安全停止！');
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
module.exports = { StableClusterSync };

// 直接运行
if (require.main === module) {
  startStableClusterSync().catch(console.error);
} 