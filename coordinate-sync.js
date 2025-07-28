const puppeteer = require('puppeteer-core');

// 基于坐标的精确浏览器同步工具
class CoordinateSyncTester {
  constructor() {
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    this.isMonitoring = false;
    this.lastMousePosition = { x: 0, y: 0 };
  }

  // 连接到主控浏览器和目标浏览器
  async connectToBrowsers(masterPort, targetPorts) {
    console.log('🔗 连接到浏览器...');
    
    try {
      // 连接主控浏览器
      console.log(`📡 连接主控浏览器端口: ${masterPort}`);
      this.masterBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${masterPort}`,
        defaultViewport: null
      });
      
      const masterPages = await this.masterBrowser.pages();
      this.masterPage = masterPages[0];
      console.log(`✅ 主控浏览器连接成功`);
      
      // 连接目标浏览器
      for (const port of targetPorts) {
        try {
          console.log(`📡 连接目标浏览器端口: ${port}`);
          
          const browser = await puppeteer.connect({
            browserURL: `http://localhost:${port}`,
            defaultViewport: null
          });
          
          const pages = await browser.pages();
          const page = pages[0];
          
          this.targetBrowsers.push(browser);
          this.targetPages.push(page);
          
          console.log(`✅ 目标浏览器 ${port} 连接成功`);
        } catch (error) {
          console.error(`❌ 连接目标浏览器 ${port} 失败:`, error.message);
        }
      }
      
      console.log(`📊 连接完成: 1个主控浏览器，${this.targetPages.length}个目标浏览器`);
      
    } catch (error) {
      console.error(`❌ 连接浏览器失败:`, error.message);
      throw error;
    }
  }

  // 开始监听主控浏览器的操作
  async startMonitoring() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器');
    }
    
    console.log('🎯 开始监听主控浏览器操作...');
    this.isMonitoring = true;
    
    // 注入坐标监听脚本到主控浏览器
    await this.masterPage.evaluateOnNewDocument(() => {
      // 添加全局标识
      window.__COORDINATE_SYNC__ = true;
      
      // 存储事件队列
      window.__syncEventQueue__ = [];
      
      // 鼠标移动监听
      document.addEventListener('mousemove', (e) => {
        window.__lastMousePos__ = { x: e.clientX, y: e.clientY };
      }, true);
      
      // 鼠标点击监听
      document.addEventListener('click', (e) => {
        const event = {
          type: 'click',
          x: e.clientX,
          y: e.clientY,
          button: e.button,
          target: {
            tagName: e.target.tagName,
            id: e.target.id,
            className: e.target.className,
            textContent: e.target.textContent?.substring(0, 50)
          },
          timestamp: Date.now()
        };
        
        window.__syncEventQueue__.push(event);
        console.log('🖱️ [坐标同步] 点击:', event);
      }, true);
      
      // 键盘输入监听
      document.addEventListener('keydown', (e) => {
        const event = {
          type: 'keydown',
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          target: {
            tagName: e.target.tagName,
            id: e.target.id,
            value: e.target.value
          },
          timestamp: Date.now()
        };
        
        window.__syncEventQueue__.push(event);
        console.log('⌨️ [坐标同步] 按键:', event);
      }, true);
      
      // 输入事件监听
      document.addEventListener('input', (e) => {
        const event = {
          type: 'input',
          value: e.target.value,
          x: window.__lastMousePos__?.x || 0,
          y: window.__lastMousePos__?.y || 0,
          target: {
            tagName: e.target.tagName,
            id: e.target.id,
            type: e.target.type
          },
          timestamp: Date.now()
        };
        
        window.__syncEventQueue__.push(event);
        console.log('📝 [坐标同步] 输入:', event);
      }, true);
      
      // 滚动监听
      document.addEventListener('scroll', (e) => {
        const event = {
          type: 'scroll',
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          timestamp: Date.now()
        };
        
        window.__syncEventQueue__.push(event);
        console.log('📜 [坐标同步] 滚动:', event);
      }, true);
    });
    
    // 重新加载页面以应用监听脚本
    await this.masterPage.reload({ waitUntil: 'domcontentloaded' });
    
    // 开始轮询事件
    this.startEventPolling();
    
    console.log('✅ 坐标监听已启动');
  }

  // 轮询主控浏览器的事件
  async startEventPolling() {
    const pollEvents = async () => {
      if (!this.isMonitoring) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          const queue = window.__syncEventQueue__ || [];
          window.__syncEventQueue__ = []; // 清空队列
          return queue;
        });
        
        // 处理每个事件
        for (const event of events) {
          await this.syncEvent(event);
        }
        
      } catch (error) {
        console.error('轮询事件失败:', error.message);
      }
      
      // 继续轮询
      setTimeout(pollEvents, 100); // 100ms轮询间隔
    };
    
    pollEvents();
  }

  // 同步事件到目标浏览器
  async syncEvent(event) {
    if (this.targetPages.length === 0) return;
    
    console.log(`🔄 同步事件: ${event.type}`);
    
    const promises = this.targetPages.map(async (page, index) => {
      try {
        switch (event.type) {
          case 'click':
            await this.syncClick(page, event, index + 1);
            break;
            
          case 'keydown':
            await this.syncKeydown(page, event, index + 1);
            break;
            
          case 'input':
            await this.syncInput(page, event, index + 1);
            break;
            
          case 'scroll':
            await this.syncScroll(page, event, index + 1);
            break;
        }
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 同步失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
  }

  // 同步点击事件
  async syncClick(page, event, browserIndex) {
    try {
      // 方法1: 直接在坐标位置点击
      await page.mouse.click(event.x, event.y, {
        button: event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle'
      });
      
      console.log(`✅ 浏览器 ${browserIndex} 坐标点击成功: (${event.x}, ${event.y})`);
      
    } catch (error) {
      console.error(`❌ 浏览器 ${browserIndex} 坐标点击失败:`, error.message);
      
      // 方法2: 回退到元素点击
      if (event.target.id) {
        try {
          await page.click(`#${event.target.id}`);
          console.log(`✅ 浏览器 ${browserIndex} 元素点击成功: #${event.target.id}`);
        } catch (fallbackError) {
          console.error(`❌ 浏览器 ${browserIndex} 元素点击也失败:`, fallbackError.message);
        }
      }
    }
  }

  // 同步键盘事件
  async syncKeydown(page, event, browserIndex) {
    try {
      const options = {
        key: event.key
      };
      
      if (event.ctrlKey) options.modifiers = ['Control'];
      if (event.shiftKey) options.modifiers = (options.modifiers || []).concat(['Shift']);
      if (event.altKey) options.modifiers = (options.modifiers || []).concat(['Alt']);
      
      await page.keyboard.press(event.key);
      console.log(`✅ 浏览器 ${browserIndex} 按键同步成功: ${event.key}`);
      
    } catch (error) {
      console.error(`❌ 浏览器 ${browserIndex} 按键同步失败:`, error.message);
    }
  }

  // 同步输入事件
  async syncInput(page, event, browserIndex) {
    try {
      // 方法1: 在坐标位置聚焦并输入
      await page.mouse.click(event.x, event.y);
      await page.keyboard.type(event.value, { delay: 20 });
      
      console.log(`✅ 浏览器 ${browserIndex} 坐标输入成功: "${event.value}"`);
      
    } catch (error) {
      console.error(`❌ 浏览器 ${browserIndex} 坐标输入失败:`, error.message);
      
      // 方法2: 回退到元素输入
      if (event.target.id) {
        try {
          await page.focus(`#${event.target.id}`);
          await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) el.value = '';
          }, `#${event.target.id}`);
          await page.type(`#${event.target.id}`, event.value);
          console.log(`✅ 浏览器 ${browserIndex} 元素输入成功: #${event.target.id}`);
        } catch (fallbackError) {
          console.error(`❌ 浏览器 ${browserIndex} 元素输入也失败:`, fallbackError.message);
        }
      }
    }
  }

  // 同步滚动事件
  async syncScroll(page, event, browserIndex) {
    try {
      await page.evaluate((scrollX, scrollY) => {
        window.scrollTo(scrollX, scrollY);
      }, event.scrollX, event.scrollY);
      
      console.log(`✅ 浏览器 ${browserIndex} 滚动同步成功: (${event.scrollX}, ${event.scrollY})`);
      
    } catch (error) {
      console.error(`❌ 浏览器 ${browserIndex} 滚动同步失败:`, error.message);
    }
  }

  // 停止监听
  async stopMonitoring() {
    console.log('🛑 停止坐标监听...');
    this.isMonitoring = false;
  }

  // 断开所有连接
  async disconnect() {
    console.log('🔌 断开所有浏览器连接...');
    
    this.isMonitoring = false;
    
    if (this.masterBrowser) {
      try {
        await this.masterBrowser.disconnect();
      } catch (error) {
        console.error('断开主控浏览器失败:', error.message);
      }
    }
    
    for (const browser of this.targetBrowsers) {
      try {
        await browser.disconnect();
      } catch (error) {
        console.error('断开目标浏览器失败:', error.message);
      }
    }
    
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    
    console.log('✅ 所有连接已断开');
  }

  // 获取主控浏览器的当前页面信息
  async getMasterPageInfo() {
    if (!this.masterPage) return null;
    
    try {
      const info = await this.masterPage.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          viewportSize: {
            width: window.innerWidth,
            height: window.innerHeight
          },
          scrollPosition: {
            x: window.scrollX,
            y: window.scrollY
          }
        };
      });
      
      return info;
    } catch (error) {
      console.error('获取页面信息失败:', error.message);
      return null;
    }
  }
}

// 测试示例
async function testCoordinateSync() {
  const tester = new CoordinateSyncTester();
  
  try {
    // 连接浏览器 (替换为实际端口)
    await tester.connectToBrowsers(9222, [9223]); // 主控端口9222，目标端口9223
    
    // 开始坐标监听
    await tester.startMonitoring();
    
    console.log('🎯 坐标同步已启动！');
    console.log('📋 现在您可以在主控浏览器中进行操作:');
    console.log('   - 点击任意位置');
    console.log('   - 在输入框中输入文字');
    console.log('   - 按键盘按键');
    console.log('   - 滚动页面');
    console.log('   所有操作都会精确同步到其他浏览器！');
    
    // 保持运行 (实际使用时可以根据需要调整)
    console.log('⏰ 监听将运行60秒，然后自动停止...');
    setTimeout(async () => {
      await tester.stopMonitoring();
      await tester.disconnect();
      console.log('🎉 坐标同步测试完成！');
      process.exit(0);
    }, 60000); // 60秒后自动停止
    
  } catch (error) {
    console.error('❌ 坐标同步测试失败:', error.message);
    await tester.disconnect();
    process.exit(1);
  }
}

// 导出类供其他文件使用
module.exports = { CoordinateSyncTester };

// 如果直接运行此文件，执行测试
if (require.main === module) {
  console.log('🚀 启动基于坐标的精确浏览器同步...');
  testCoordinateSync().catch(console.error);
} 