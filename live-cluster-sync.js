const puppeteer = require('puppeteer-core');

// 持续运行的集群同步工具
class LiveClusterSync {
  constructor() {
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    this.isRunning = false;
    this.eventCount = 0;
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

  // 启动持续集群同步
  async startLiveSync() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动持续集群同步...');
    this.isRunning = true;
    
    // 注入事件捕获
    await this.injectEventCapture();
    
    // 开始事件循环
    this.startEventLoop();
    
    console.log('');
    console.log('✅ 🌟 集群同步已完全启动！🌟');
    console.log('');
    console.log('🎯 ===== 现在可以测试远程集群操作效果 =====');
    console.log('');
    console.log('📋 请在主控浏览器中尝试以下操作：');
    console.log('   1. 🖱️ 点击页面任意位置');
    console.log('   2. 📝 在输入框中输入文字');
    console.log('   3. ⌨️ 按回车键或其他按键');
    console.log('   4. 📜 滚动页面内容');
    console.log('   5. 🖱️ 双击或右键点击');
    console.log('');
    console.log('👀 观察：其他浏览器会实时同步相同操作！');
    console.log('');
    console.log('⚡ 提示：操作会在100ms内同步，几乎实时！');
    console.log('⏹️  按 Ctrl+C 停止同步');
    console.log('');
  }

  // 注入事件捕获
  async injectEventCapture() {
    try {
      console.log('📡 注入实时事件捕获器...');
      
      await this.masterPage.evaluate(() => {
        if (window.__LIVE_CLUSTER_SYNC__) {
          console.log('🔄 实时捕获器已激活');
          return;
        }
        
        window.__LIVE_CLUSTER_SYNC__ = true;
        window.__LIVE_EVENTS__ = [];
        
        console.log('🌟 激活实时集群同步事件捕获');
        
        // 鼠标事件捕获
        const captureMouseEvent = (type, e) => {
          const event = {
            type: 'mouse',
            action: type,
            x: e.clientX,
            y: e.clientY,
            button: e.button,
            timestamp: Date.now()
          };
          
          window.__LIVE_EVENTS__.push(event);
          console.log(`🖱️ [MASTER] ${type}:`, e.clientX, e.clientY);
          
          if (window.__LIVE_EVENTS__.length > 20) {
            window.__LIVE_EVENTS__ = window.__LIVE_EVENTS__.slice(-10);
          }
        };
        
        // 键盘事件捕获
        const captureKeyEvent = (type, e) => {
          const event = {
            type: 'keyboard',
            action: type,
            key: e.key,
            code: e.code,
            keyCode: e.keyCode,
            timestamp: Date.now()
          };
          
          window.__LIVE_EVENTS__.push(event);
          console.log(`⌨️ [MASTER] ${type}:`, e.key);
          
          if (window.__LIVE_EVENTS__.length > 20) {
            window.__LIVE_EVENTS__ = window.__LIVE_EVENTS__.slice(-10);
          }
        };
        
        // 滚轮事件捕获
        const captureWheelEvent = (e) => {
          const event = {
            type: 'wheel',
            action: 'wheel',
            x: e.clientX,
            y: e.clientY,
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            timestamp: Date.now()
          };
          
          window.__LIVE_EVENTS__.push(event);
          console.log(`📜 [MASTER] 滚轮:`, e.deltaX, e.deltaY);
          
          if (window.__LIVE_EVENTS__.length > 20) {
            window.__LIVE_EVENTS__ = window.__LIVE_EVENTS__.slice(-10);
          }
        };
        
        // 输入事件捕获
        const captureInputEvent = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const rect = e.target.getBoundingClientRect();
            const event = {
              type: 'input',
              action: 'input',
              value: e.target.value,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              timestamp: Date.now()
            };
            
            window.__LIVE_EVENTS__.push(event);
            console.log(`📝 [MASTER] 输入:`, e.target.value?.substring(0, 10));
            
            if (window.__LIVE_EVENTS__.length > 20) {
              window.__LIVE_EVENTS__ = window.__LIVE_EVENTS__.slice(-10);
            }
          }
        };
        
        // 注册所有事件监听
        ['click', 'dblclick', 'contextmenu'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureMouseEvent(eventType, e), true);
        });
        
        ['keydown', 'keypress'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureKeyEvent(eventType, e), true);
        });
        
        document.addEventListener('wheel', captureWheelEvent, true);
        document.addEventListener('input', captureInputEvent, true);
        
        console.log('✅ 实时事件捕获器激活完成');
      });
      
    } catch (error) {
      console.error('❌ 注入捕获器失败:', error.message);
    }
  }

  // 高频事件循环
  async startEventLoop() {
    const processEvents = async () => {
      if (!this.isRunning) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          const events = window.__LIVE_EVENTS__ || [];
          window.__LIVE_EVENTS__ = [];
          return events;
        });
        
        // 处理每个事件
        for (const event of events) {
          await this.syncEventToCluster(event);
          this.eventCount++;
        }
        
      } catch (error) {
        if (!error.message.includes('detached') && !error.message.includes('closed')) {
          // 静默处理大部分错误
        }
      }
      
      // 高频继续循环 - 50ms实现近实时同步
      if (this.isRunning) {
        setTimeout(processEvents, 50);
      }
    };
    
    processEvents();
    
    // 状态报告
    this.startStatusReport();
  }

  // 状态报告
  startStatusReport() {
    const reportStatus = () => {
      if (!this.isRunning) return;
      
      console.log(`📊 [状态] 已同步 ${this.eventCount} 个事件 | 集群规模: 1主控+${this.targetPages.length}目标`);
      
      if (this.isRunning) {
        setTimeout(reportStatus, 10000); // 每10秒报告一次
      }
    };
    
    setTimeout(reportStatus, 10000);
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
          case 'wheel':
            await this.syncWheelEvent(page, event, index + 1);
            break;
          case 'input':
            await this.syncInputEvent(page, event, index + 1);
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
        console.log(`✅ [浏览器${browserIndex}] 同步点击: (${event.x}, ${event.y})`);
        break;
        
      case 'dblclick':
        await page.mouse.click(event.x, event.y, { clickCount: 2 });
        console.log(`✅ [浏览器${browserIndex}] 同步双击: (${event.x}, ${event.y})`);
        break;
        
      case 'contextmenu':
        await page.mouse.click(event.x, event.y, { button: 'right' });
        console.log(`✅ [浏览器${browserIndex}] 同步右键: (${event.x}, ${event.y})`);
        break;
    }
  }

  // 同步键盘事件
  async syncKeyboardEvent(page, event, browserIndex) {
    if (event.action === 'keydown') {
      switch (event.key) {
        case 'Enter':
          await page.keyboard.press('Enter');
          console.log(`✅ [浏览器${browserIndex}] 同步回车`);
          break;
        case 'Tab':
          await page.keyboard.press('Tab');
          console.log(`✅ [浏览器${browserIndex}] 同步Tab`);
          break;
        case 'Backspace':
          await page.keyboard.press('Backspace');
          console.log(`✅ [浏览器${browserIndex}] 同步退格`);
          break;
        default:
          if (event.key.length === 1 && /^[a-zA-Z0-9\s\u4e00-\u9fff]$/.test(event.key)) {
            await page.keyboard.type(event.key);
            console.log(`✅ [浏览器${browserIndex}] 同步输入: "${event.key}"`);
          }
      }
    }
  }

  // 同步滚轮事件
  async syncWheelEvent(page, event, browserIndex) {
    await page.mouse.wheel({ deltaX: event.deltaX, deltaY: event.deltaY });
    console.log(`✅ [浏览器${browserIndex}] 同步滚轮: (${event.deltaX}, ${event.deltaY})`);
  }

  // 同步输入事件
  async syncInputEvent(page, event, browserIndex) {
    // 点击位置
    await page.mouse.click(event.x, event.y);
    
    // 全选并替换
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    
    // 输入新内容
    if (event.value) {
      await page.keyboard.type(event.value);
    }
    
    console.log(`✅ [浏览器${browserIndex}] 同步输入框: "${event.value?.substring(0, 15)}..."`);
  }

  // 停止同步
  async stop() {
    console.log('');
    console.log('🛑 正在停止集群同步...');
    this.isRunning = false;
    
    console.log(`📊 总计同步了 ${this.eventCount} 个事件`);
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
async function startLiveClusterSync() {
  const cluster = new LiveClusterSync();
  
  try {
    console.log('🌟 启动实时集群同步...');
    console.log('');
    
    // 连接集群
    await cluster.connectCluster(9222, [9223]);
    
    // 启动持续同步
    await cluster.startLiveSync();
    
    // 优雅退出处理
    process.on('SIGINT', async () => {
      console.log('');
      console.log('🔴 接收到退出信号...');
      await cluster.stop();
      await cluster.disconnect();
      console.log('🎉 集群同步已安全停止！');
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
module.exports = { LiveClusterSync };

// 直接运行
if (require.main === module) {
  startLiveClusterSync().catch(console.error);
} 