const puppeteer = require('puppeteer-core');

// 最终版本 - 真正的远程集群操作工具
class FinalClusterSync {
  constructor() {
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    this.isRunning = false;
  }

  // 连接浏览器集群
  async connectCluster(masterPort, targetPorts) {
    console.log('🌐 连接浏览器集群...');
    
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

  // 启动集群同步
  async startSync() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动集群同步...');
    this.isRunning = true;
    
    // 注入事件捕获
    await this.injectEventCapture();
    
    // 开始事件循环
    this.startEventLoop();
    
    console.log('✅ 集群同步已启动！');
    console.log('🎯 在主控浏览器中的所有操作将实时同步到其他浏览器');
  }

  // 注入事件捕获
  async injectEventCapture() {
    try {
      console.log('📡 注入事件捕获器...');
      
      await this.masterPage.evaluate(() => {
        if (window.__CLUSTER_SYNC_ACTIVE__) {
          console.log('🔄 捕获器已激活');
          return;
        }
        
        window.__CLUSTER_SYNC_ACTIVE__ = true;
        window.__CLUSTER_EVENTS__ = [];
        
        console.log('🌟 激活集群同步事件捕获');
        
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
          
          window.__CLUSTER_EVENTS__.push(event);
          console.log(`🖱️ 捕获 ${type}:`, e.clientX, e.clientY);
          
          if (window.__CLUSTER_EVENTS__.length > 50) {
            window.__CLUSTER_EVENTS__ = window.__CLUSTER_EVENTS__.slice(-25);
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
          
          window.__CLUSTER_EVENTS__.push(event);
          console.log(`⌨️ 捕获 ${type}:`, e.key);
          
          if (window.__CLUSTER_EVENTS__.length > 50) {
            window.__CLUSTER_EVENTS__ = window.__CLUSTER_EVENTS__.slice(-25);
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
          
          window.__CLUSTER_EVENTS__.push(event);
          console.log(`🎡 捕获滚轮:`, e.deltaX, e.deltaY);
          
          if (window.__CLUSTER_EVENTS__.length > 50) {
            window.__CLUSTER_EVENTS__ = window.__CLUSTER_EVENTS__.slice(-25);
          }
        };
        
        // 注册事件监听
        ['click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureMouseEvent(eventType, e), true);
        });
        
        ['keydown', 'keyup', 'keypress'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureKeyEvent(eventType, e), true);
        });
        
        document.addEventListener('wheel', captureWheelEvent, true);
        
        console.log('✅ 事件捕获器激活完成');
      });
      
    } catch (error) {
      console.error('❌ 注入捕获器失败:', error.message);
    }
  }

  // 事件循环
  async startEventLoop() {
    const processEvents = async () => {
      if (!this.isRunning) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          const events = window.__CLUSTER_EVENTS__ || [];
          window.__CLUSTER_EVENTS__ = [];
          return events;
        });
        
        // 处理每个事件
        for (const event of events) {
          await this.replayEvent(event);
        }
        
      } catch (error) {
        if (!error.message.includes('detached')) {
          console.error('事件循环错误:', error.message);
        }
      }
      
      // 继续循环
      if (this.isRunning) {
        setTimeout(processEvents, 100);
      }
    };
    
    processEvents();
  }

  // 重放事件到所有目标浏览器
  async replayEvent(event) {
    if (this.targetPages.length === 0) return;
    
    const promises = this.targetPages.map(async (page, index) => {
      try {
        switch (event.type) {
          case 'mouse':
            await this.replayMouseEvent(page, event, index + 1);
            break;
          case 'keyboard':
            await this.replayKeyboardEvent(page, event, index + 1);
            break;
          case 'wheel':
            await this.replayWheelEvent(page, event, index + 1);
            break;
        }
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 重放失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
  }

  // 重放鼠标事件
  async replayMouseEvent(page, event, browserIndex) {
    switch (event.action) {
      case 'click':
        await page.mouse.click(event.x, event.y);
        console.log(`✅ 浏览器 ${browserIndex} 同步点击: (${event.x}, ${event.y})`);
        break;
        
      case 'dblclick':
        await page.mouse.click(event.x, event.y, { clickCount: 2 });
        console.log(`✅ 浏览器 ${browserIndex} 同步双击: (${event.x}, ${event.y})`);
        break;
        
      case 'contextmenu':
        await page.mouse.click(event.x, event.y, { button: 'right' });
        console.log(`✅ 浏览器 ${browserIndex} 同步右键: (${event.x}, ${event.y})`);
        break;
    }
  }

  // 重放键盘事件
  async replayKeyboardEvent(page, event, browserIndex) {
    if (event.action === 'keydown') {
      switch (event.key) {
        case 'Enter':
          await page.keyboard.press('Enter');
          console.log(`✅ 浏览器 ${browserIndex} 同步回车`);
          break;
        case 'Tab':
          await page.keyboard.press('Tab');
          break;
        case 'Backspace':
          await page.keyboard.press('Backspace');
          break;
        default:
          if (event.key.length === 1) {
            await page.keyboard.type(event.key);
            console.log(`✅ 浏览器 ${browserIndex} 同步输入: ${event.key}`);
          }
      }
    }
  }

  // 重放滚轮事件
  async replayWheelEvent(page, event, browserIndex) {
    await page.mouse.wheel({ deltaX: event.deltaX, deltaY: event.deltaY });
    console.log(`✅ 浏览器 ${browserIndex} 同步滚轮`);
  }

  // 手动测试
  async runTest() {
    console.log('🧪 执行测试...');
    
    for (let i = 0; i < this.targetPages.length; i++) {
      const page = this.targetPages[i];
      
      try {
        await page.mouse.click(400, 300);
        console.log(`✅ 测试浏览器 ${i + 1} 点击`);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await page.keyboard.type('测试');
        console.log(`✅ 测试浏览器 ${i + 1} 输入`);
        
      } catch (error) {
        console.error(`❌ 测试浏览器 ${i + 1} 失败:`, error.message);
      }
    }
  }

  // 停止同步
  async stop() {
    console.log('🛑 停止集群同步...');
    this.isRunning = false;
  }

  // 断开连接
  async disconnect() {
    console.log('🔌 断开集群连接...');
    this.isRunning = false;
    
    for (const browser of this.targetBrowsers) {
      try {
        await browser.disconnect();
      } catch (error) {
        console.error('断开失败:', error.message);
      }
    }
    
    if (this.masterBrowser) {
      try {
        await this.masterBrowser.disconnect();
      } catch (error) {
        console.error('断开主控失败:', error.message);
      }
    }
    
    console.log('✅ 连接已断开');
  }
}

// 主测试函数
async function testFinalClusterSync() {
  const cluster = new FinalClusterSync();
  
  try {
    console.log('🌟 启动最终版集群同步测试...');
    
    await cluster.connectCluster(9222, [9223]);
    await cluster.startSync();
    
    console.log('');
    console.log('🎯 集群同步已完全启动！');
    console.log('💡 现在在主控浏览器中进行任何操作都会同步到其他浏览器');
    console.log('🖱️ 支持: 点击、双击、右键');
    console.log('⌨️ 支持: 键盘输入、回车、退格');
    console.log('📜 支持: 滚轮滚动');
    console.log('⏰ 将运行60秒后自动停止...');
    console.log('');
    
    // 5秒后测试
    setTimeout(async () => {
      await cluster.runTest();
    }, 5000);
    
    // 60秒后停止
    setTimeout(async () => {
      await cluster.stop();
      await cluster.disconnect();
      console.log('🎉 集群同步测试完成！');
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    await cluster.disconnect();
    process.exit(1);
  }
}

// 导出
module.exports = { FinalClusterSync };

// 直接运行
if (require.main === module) {
  testFinalClusterSync().catch(console.error);
} 