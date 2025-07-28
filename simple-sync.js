const puppeteer = require('puppeteer-core');

// 简化的坐标同步工具 - 无需重新加载页面
class SimpleSyncTester {
  constructor() {
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    this.isMonitoring = false;
  }

  // 连接到浏览器
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

  // 开始监听 - 简化版本，无需重新加载页面
  async startMonitoring() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器');
    }
    
    console.log('🎯 开始实时监听主控浏览器操作...');
    this.isMonitoring = true;
    
    // 直接注入监听脚本，不重新加载页面
    console.log('📝 注入事件监听脚本...');
    await this.injectListeners();
    
    console.log('✅ 实时监听已启动');
    console.log('📋 现在您可以在主控浏览器中进行以下操作:');
    console.log('   🖱️ 点击任意位置');
    console.log('   ⌨️ 在输入框中输入文字');
    console.log('   📜 滚动页面');
    console.log('   🔄 所有操作将实时同步到其他浏览器！');
  }

  // 注入监听器 - 不重新加载页面
  async injectListeners() {
    try {
      await this.masterPage.evaluate(() => {
        // 避免重复注入
        if (window.__SIMPLE_SYNC_INJECTED__) {
          console.log('📍 监听器已存在，跳过注入');
          return;
        }
        
        window.__SIMPLE_SYNC_INJECTED__ = true;
        window.__syncEvents__ = [];
        
        console.log('🔧 开始注入事件监听器...');
        
        // 点击监听
        document.addEventListener('click', (e) => {
          const event = {
            type: 'click',
            x: e.clientX,
            y: e.clientY,
            timestamp: Date.now()
          };
          
          window.__syncEvents__.push(event);
          console.log('🖱️ 捕获点击:', event.x, event.y);
          
          // 限制事件队列长度
          if (window.__syncEvents__.length > 50) {
            window.__syncEvents__ = window.__syncEvents__.slice(-25);
          }
        }, true);
        
        // 输入监听
        document.addEventListener('input', (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const rect = e.target.getBoundingClientRect();
            const event = {
              type: 'input',
              value: e.target.value,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              timestamp: Date.now()
            };
            
            window.__syncEvents__.push(event);
            console.log('📝 捕获输入:', event.value?.substring(0, 20));
            
            if (window.__syncEvents__.length > 50) {
              window.__syncEvents__ = window.__syncEvents__.slice(-25);
            }
          }
        }, true);
        
        // 滚动监听
        document.addEventListener('scroll', (e) => {
          const event = {
            type: 'scroll',
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            timestamp: Date.now()
          };
          
          window.__syncEvents__.push(event);
          console.log('📜 捕获滚动:', event.scrollX, event.scrollY);
          
          if (window.__syncEvents__.length > 50) {
            window.__syncEvents__ = window.__syncEvents__.slice(-25);
          }
        }, true);
        
        console.log('✅ 事件监听器注入完成');
      });
      
      // 开始轮询事件
      this.startPolling();
      
    } catch (error) {
      console.error('❌ 注入监听器失败:', error.message);
    }
  }

  // 轮询事件
  async startPolling() {
    const poll = async () => {
      if (!this.isMonitoring) return;
      
      try {
        // 获取事件
        const events = await this.masterPage.evaluate(() => {
          const events = window.__syncEvents__ || [];
          window.__syncEvents__ = []; // 清空队列
          return events;
        });
        
        // 同步事件
        for (const event of events) {
          await this.syncEventToTargets(event);
        }
        
      } catch (error) {
        // 静默处理错误，避免日志过多
        if (!error.message.includes('detached')) {
          console.error('轮询失败:', error.message);
        }
      }
      
      // 继续轮询
      if (this.isMonitoring) {
        setTimeout(poll, 200); // 200ms间隔
      }
    };
    
    poll();
  }

  // 同步事件到目标浏览器
  async syncEventToTargets(event) {
    if (this.targetPages.length === 0) return;
    
    const promises = this.targetPages.map(async (page, index) => {
      try {
        switch (event.type) {
          case 'click':
            await page.mouse.click(event.x, event.y);
            console.log(`✅ 浏览器 ${index + 1} 同步点击: (${event.x}, ${event.y})`);
            break;
            
          case 'input':
            // 先点击位置，然后清空并输入
            await page.mouse.click(event.x, event.y);
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.type(event.value);
            console.log(`✅ 浏览器 ${index + 1} 同步输入: "${event.value?.substring(0, 10)}..."`);
            break;
            
          case 'scroll':
            await page.evaluate((scrollX, scrollY) => {
              window.scrollTo(scrollX, scrollY);
            }, event.scrollX, event.scrollY);
            console.log(`✅ 浏览器 ${index + 1} 同步滚动: (${event.scrollX}, ${event.scrollY})`);
            break;
        }
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 同步失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
  }

  // 手动测试同步
  async testSync() {
    if (!this.masterPage || this.targetPages.length === 0) {
      console.error('❌ 请先连接浏览器');
      return;
    }
    
    console.log('🧪 开始手动测试同步...');
    
    // 测试点击
    console.log('1. 测试点击同步...');
    await this.syncEventToTargets({
      type: 'click',
      x: 400,
      y: 300,
      timestamp: Date.now()
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 测试输入
    console.log('2. 测试输入同步...');
    await this.syncEventToTargets({
      type: 'input',
      value: 'TEST_SYNC_INPUT',
      x: 400,
      y: 300,
      timestamp: Date.now()
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ 手动测试完成');
  }

  // 停止监听
  async stopMonitoring() {
    console.log('🛑 停止监听...');
    this.isMonitoring = false;
  }

  // 断开连接
  async disconnect() {
    console.log('🔌 断开所有连接...');
    
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
}

// 测试函数
async function testSimpleSync() {
  const tester = new SimpleSyncTester();
  
  try {
    // 连接浏览器
    await tester.connectToBrowsers(9222, [9223]);
    
    // 开始监听
    await tester.startMonitoring();
    
    console.log('');
    console.log('🎯 简化坐标同步已启动！');
    console.log('📍 在主控浏览器中进行操作，会实时同步到其他浏览器');
    console.log('⏰ 将运行30秒后自动停止...');
    console.log('');
    
    // 5秒后进行手动测试
    setTimeout(async () => {
      await tester.testSync();
    }, 5000);
    
    // 30秒后自动停止
    setTimeout(async () => {
      await tester.stopMonitoring();
      await tester.disconnect();
      console.log('🎉 简化同步测试完成！');
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    await tester.disconnect();
    process.exit(1);
  }
}

// 导出类
module.exports = { SimpleSyncTester };

// 如果直接运行此文件，执行测试
if (require.main === module) {
  console.log('🚀 启动简化坐标同步测试...');
  testSimpleSync().catch(console.error);
} 