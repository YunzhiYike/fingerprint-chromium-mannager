const puppeteer = require('puppeteer-core');

// 优化版集群同步工具 - 解决输入重复问题
class OptimizedClusterSync {
  constructor() {
    this.masterBrowser = null;
    this.masterPage = null;
    this.targetBrowsers = [];
    this.targetPages = [];
    this.isRunning = false;
    this.eventCount = 0;
    this.lastInputTime = 0;
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

  // 启动优化集群同步
  async startOptimizedSync() {
    if (!this.masterPage) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动优化集群同步...');
    this.isRunning = true;
    
    // 注入优化的事件捕获
    await this.injectOptimizedCapture();
    
    // 开始优化的事件循环
    this.startOptimizedEventLoop();
    
    console.log('');
    console.log('✅ 🌟 优化集群同步已启动！🌟');
    console.log('');
    console.log('🎯 ===== 现在可以测试优化后的集群操作 =====');
    console.log('');
    console.log('🔧 优化内容：');
    console.log('   • 🚫 避免重复输入事件');
    console.log('   • ⚡ 智能事件去重');
    console.log('   • 🎯 精确输入框定位');
    console.log('   • ⏱️ 优化同步频率');
    console.log('');
    console.log('📋 请在主控浏览器中测试：');
    console.log('   1. 🖱️ 点击页面任意位置');
    console.log('   2. 📝 在输入框中输入邮箱地址');
    console.log('   3. ⌨️ 按回车键提交');
    console.log('');
    console.log('👀 观察：子浏览器应该准确同步，无重复！');
    console.log('⏹️  按 Ctrl+C 停止同步');
    console.log('');
  }

  // 注入优化的事件捕获
  async injectOptimizedCapture() {
    try {
      console.log('📡 注入优化事件捕获器...');
      
      await this.masterPage.evaluate(() => {
        if (window.__OPTIMIZED_SYNC__) {
          console.log('🔄 优化捕获器已激活');
          return;
        }
        
        window.__OPTIMIZED_SYNC__ = true;
        window.__SYNC_EVENTS__ = [];
        window.__lastInputValue__ = '';
        window.__lastInputElement__ = null;
        
        console.log('🌟 激活优化集群同步事件捕获');
        
        // 优化的鼠标事件捕获 - 只捕获点击，不捕获移动
        const captureMouseEvent = (type, e) => {
          // 只捕获重要的鼠标事件
          if (!['click', 'dblclick', 'contextmenu'].includes(type)) {
            return;
          }
          
          const event = {
            type: 'mouse',
            action: type,
            x: e.clientX,
            y: e.clientY,
            button: e.button,
            timestamp: Date.now(),
            id: Math.random().toString(36).substr(2, 9)
          };
          
          window.__SYNC_EVENTS__.push(event);
          console.log(`🖱️ [MASTER] ${type}:`, e.clientX, e.clientY);
          
          // 清理旧事件
          if (window.__SYNC_EVENTS__.length > 10) {
            window.__SYNC_EVENTS__ = window.__SYNC_EVENTS__.slice(-5);
          }
        };
        
        // 优化的输入事件捕获 - 去重和防抖
        const captureInputEvent = (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const currentValue = e.target.value;
            const currentElement = e.target;
            
            // 防止重复捕获相同输入
            if (currentValue === window.__lastInputValue__ && 
                currentElement === window.__lastInputElement__) {
              return;
            }
            
            window.__lastInputValue__ = currentValue;
            window.__lastInputElement__ = currentElement;
            
            const rect = e.target.getBoundingClientRect();
            const event = {
              type: 'input_complete',
              action: 'input_replace',
              value: currentValue,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              timestamp: Date.now(),
              id: Math.random().toString(36).substr(2, 9)
            };
            
            window.__SYNC_EVENTS__.push(event);
            console.log(`📝 [MASTER] 完整输入:`, currentValue?.substring(0, 20));
            
            if (window.__SYNC_EVENTS__.length > 10) {
              window.__SYNC_EVENTS__ = window.__SYNC_EVENTS__.slice(-5);
            }
          }
        };
        
        // 优化的键盘事件捕获 - 只捕获特殊键
        const captureKeyEvent = (type, e) => {
          // 只捕获特殊功能键，不捕获普通字符
          const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'];
          
          if (type === 'keydown' && specialKeys.includes(e.key)) {
            const event = {
              type: 'keyboard',
              action: type,
              key: e.key,
              timestamp: Date.now(),
              id: Math.random().toString(36).substr(2, 9)
            };
            
            window.__SYNC_EVENTS__.push(event);
            console.log(`⌨️ [MASTER] 特殊键:`, e.key);
            
            if (window.__SYNC_EVENTS__.length > 10) {
              window.__SYNC_EVENTS__ = window.__SYNC_EVENTS__.slice(-5);
            }
          }
        };
        
        // 滚轮事件捕获 - 防抖处理
        let wheelTimeout = null;
        const captureWheelEvent = (e) => {
          // 防抖：100ms内只捕获一次滚轮事件
          if (wheelTimeout) {
            clearTimeout(wheelTimeout);
          }
          
          wheelTimeout = setTimeout(() => {
            const event = {
              type: 'wheel',
              action: 'wheel',
              x: e.clientX,
              y: e.clientY,
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              timestamp: Date.now(),
              id: Math.random().toString(36).substr(2, 9)
            };
            
            window.__SYNC_EVENTS__.push(event);
            console.log(`📜 [MASTER] 滚轮:`, e.deltaX, e.deltaY);
            
            if (window.__SYNC_EVENTS__.length > 10) {
              window.__SYNC_EVENTS__ = window.__SYNC_EVENTS__.slice(-5);
            }
          }, 100);
        };
        
        // 注册事件监听
        ['click', 'dblclick', 'contextmenu'].forEach(eventType => {
          document.addEventListener(eventType, (e) => captureMouseEvent(eventType, e), true);
        });
        
        // 使用input事件而不是keydown，避免重复
        document.addEventListener('input', captureInputEvent, true);
        
        // 只监听特殊键的keydown
        document.addEventListener('keydown', (e) => captureKeyEvent('keydown', e), true);
        
        // 防抖滚轮事件
        document.addEventListener('wheel', captureWheelEvent, true);
        
        console.log('✅ 优化事件捕获器激活完成');
      });
      
    } catch (error) {
      console.error('❌ 注入优化捕获器失败:', error.message);
    }
  }

  // 优化的事件循环
  async startOptimizedEventLoop() {
    const processEvents = async () => {
      if (!this.isRunning) return;
      
      try {
        // 获取事件队列
        const events = await this.masterPage.evaluate(() => {
          const events = window.__SYNC_EVENTS__ || [];
          window.__SYNC_EVENTS__ = [];
          return events;
        });
        
        // 去重处理
        const uniqueEvents = this.deduplicateEvents(events);
        
        // 处理每个事件
        for (const event of uniqueEvents) {
          await this.syncEventToCluster(event);
          this.eventCount++;
        }
        
      } catch (error) {
        if (!error.message.includes('detached') && !error.message.includes('closed')) {
          // 静默处理大部分错误
        }
      }
      
      // 优化的循环频率 - 150ms降低CPU占用
      if (this.isRunning) {
        setTimeout(processEvents, 150);
      }
    };
    
    processEvents();
    
    // 状态报告
    this.startStatusReport();
  }

  // 事件去重
  deduplicateEvents(events) {
    const seen = new Set();
    return events.filter(event => {
      const key = `${event.type}_${event.action}_${event.timestamp}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  // 状态报告
  startStatusReport() {
    const reportStatus = () => {
      if (!this.isRunning) return;
      
      console.log(`📊 [状态] 已优化同步 ${this.eventCount} 个事件 | 集群: 1主控+${this.targetPages.length}目标`);
      
      if (this.isRunning) {
        setTimeout(reportStatus, 15000); // 每15秒报告一次
      }
    };
    
    setTimeout(reportStatus, 15000);
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
          case 'input_complete':
            await this.syncCompleteInput(page, event, index + 1);
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

  // 同步键盘事件 - 只处理特殊键
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
        case 'Delete':
          await page.keyboard.press('Delete');
          console.log(`✅ [浏览器${browserIndex}] 同步删除`);
          break;
        case 'Escape':
          await page.keyboard.press('Escape');
          console.log(`✅ [浏览器${browserIndex}] 同步Esc`);
          break;
      }
    }
  }

  // 同步滚轮事件
  async syncWheelEvent(page, event, browserIndex) {
    await page.mouse.wheel({ deltaX: event.deltaX, deltaY: event.deltaY });
    console.log(`✅ [浏览器${browserIndex}] 同步滚轮`);
  }

  // 同步完整输入 - 避免重复
  async syncCompleteInput(page, event, browserIndex) {
    try {
      // 点击输入框位置
      await page.mouse.click(event.x, event.y);
      
      // 等待一小段时间确保焦点设置
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 全选当前内容
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      
      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 输入新内容（一次性完整输入）
      if (event.value) {
        await page.keyboard.type(event.value, { delay: 0 }); // 无延迟快速输入
      }
      
      console.log(`✅ [浏览器${browserIndex}] 同步完整输入: "${event.value}"`);
      
    } catch (error) {
      console.error(`❌ [浏览器${browserIndex}] 输入同步失败:`, error.message);
    }
  }

  // 停止同步
  async stop() {
    console.log('');
    console.log('🛑 正在停止优化集群同步...');
    this.isRunning = false;
    
    console.log(`📊 总计优化同步了 ${this.eventCount} 个事件`);
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
async function startOptimizedClusterSync() {
  const cluster = new OptimizedClusterSync();
  
  try {
    console.log('🌟 启动优化版集群同步...');
    console.log('');
    
    // 连接集群
    await cluster.connectCluster(9222, [9223]);
    
    // 启动优化同步
    await cluster.startOptimizedSync();
    
    // 优雅退出处理
    process.on('SIGINT', async () => {
      console.log('');
      console.log('🔴 接收到退出信号...');
      await cluster.stop();
      await cluster.disconnect();
      console.log('🎉 优化集群同步已安全停止！');
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
module.exports = { OptimizedClusterSync };

// 直接运行
if (require.main === module) {
  startOptimizedClusterSync().catch(console.error);
} 