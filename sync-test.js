const puppeteer = require('puppeteer-core');

// 浏览器同步测试工具
class BrowserSyncTester {
  constructor() {
    this.browsers = [];
    this.pages = [];
  }

  // 连接到多个浏览器
  async connectToBrowsers(debugPorts) {
    console.log('🔗 连接到浏览器...');
    
    for (const port of debugPorts) {
      try {
        console.log(`📡 尝试连接端口: ${port}`);
        
        const browser = await puppeteer.connect({
          browserURL: `http://localhost:${port}`,
          defaultViewport: null
        });
        
        const pages = await browser.pages();
        const page = pages[0];
        
        this.browsers.push(browser);
        this.pages.push(page);
        
        console.log(`✅ 成功连接到端口 ${port}`);
      } catch (error) {
        console.error(`❌ 连接端口 ${port} 失败:`, error.message);
      }
    }
    
    console.log(`📊 总共连接了 ${this.pages.length} 个浏览器`);
  }

  // 同步导航
  async syncNavigate(url) {
    console.log(`🌐 同步导航到: ${url}`);
    
    const promises = this.pages.map(async (page, index) => {
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 10000 
        });
        console.log(`✅ 浏览器 ${index + 1} 导航成功`);
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 导航失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
    console.log(`🎯 导航同步完成`);
  }

  // 同步点击
  async syncClick(selector) {
    console.log(`🖱️ 同步点击: ${selector}`);
    
    const promises = this.pages.map(async (page, index) => {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        console.log(`✅ 浏览器 ${index + 1} 点击成功`);
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 点击失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
    console.log(`🎯 点击同步完成`);
  }

  // 同步输入
  async syncType(selector, text) {
    console.log(`⌨️ 同步输入: ${text}`);
    
    const promises = this.pages.map(async (page, index) => {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.focus(selector);
        await page.evaluate(sel => {
          const el = document.querySelector(sel);
          if (el) el.value = '';
        }, selector);
        await page.type(selector, text, { delay: 50 });
        console.log(`✅ 浏览器 ${index + 1} 输入成功`);
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 输入失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
    console.log(`🎯 输入同步完成`);
  }

  // 同步按键
  async syncKeyPress(key) {
    console.log(`⌨️ 同步按键: ${key}`);
    
    const promises = this.pages.map(async (page, index) => {
      try {
        await page.keyboard.press(key);
        console.log(`✅ 浏览器 ${index + 1} 按键成功`);
      } catch (error) {
        console.error(`❌ 浏览器 ${index + 1} 按键失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
    console.log(`🎯 按键同步完成`);
  }

  // 等待
  async wait(ms) {
    console.log(`⏰ 等待 ${ms}ms...`);
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  // 断开连接
  async disconnect() {
    console.log('🔌 断开所有浏览器连接...');
    
    for (const browser of this.browsers) {
      try {
        await browser.disconnect();
      } catch (error) {
        console.error('断开连接失败:', error.message);
      }
    }
    
    this.browsers = [];
    this.pages = [];
    console.log('✅ 所有连接已断开');
  }
}

// 测试示例
async function testSync() {
  const tester = new BrowserSyncTester();
  
  try {
    // 连接到运行中的浏览器（替换为实际的调试端口）
    await tester.connectToBrowsers([9222, 9223, 9224]); // 示例端口
    
    // 测试导航
    await tester.syncNavigate('https://www.baidu.com');
    await tester.wait(2000);
    
    // 测试输入
    await tester.syncType('#kw', '测试同步输入');
    await tester.wait(1000);
    
    // 测试点击
    await tester.syncClick('#su');
    await tester.wait(3000);
    
    console.log('🎉 同步测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await tester.disconnect();
  }
}

// 导出类供其他文件使用
module.exports = { BrowserSyncTester };

// 如果直接运行此文件，执行测试
if (require.main === module) {
  console.log('🚀 开始浏览器同步测试...');
  testSync().catch(console.error);
} 