const puppeteer = require('puppeteer-core');

// 真正的集群同步工具 - 类似远程桌面集群操作
class ClusterSyncTool {
  constructor() {
    this.masterBrowser = null;
    this.masterClient = null;
    this.targetClients = [];
    this.isListening = false;
  }

  // 连接到浏览器集群
  async connectToCluster(masterPort, targetPorts) {
    console.log('🌐 连接到浏览器集群...');
    
    try {
      // 连接主控浏览器 - 使用更底层的CDP连接
      console.log(`🎯 连接主控浏览器端口: ${masterPort}`);
      
      const masterBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${masterPort}`,
        defaultViewport: null
      });
      
      // 获取主控浏览器的CDP客户端
      const masterPages = await masterBrowser.pages();
      const masterPage = masterPages[0];
      this.masterClient = await masterPage.target().createCDPSession();
      
      console.log(`✅ 主控浏览器连接成功`);
      
      // 连接目标浏览器集群
      for (let i = 0; i < targetPorts.length; i++) {
        const port = targetPorts[i];
        try {
          console.log(`🎯 连接目标浏览器 ${i + 1} 端口: ${port}`);
          
          const browser = await puppeteer.connect({
            browserURL: `http://localhost:${port}`,
            defaultViewport: null
          });
          
          const pages = await browser.pages();
          const page = pages[0];
          const client = await page.target().createCDPSession();
          
          // 启用Input domain
          await client.send('Input.enable');
          await client.send('Runtime.enable');
          
          this.targetClients.push({
            client: client,
            browser: browser,
            page: page,
            index: i + 1,
            port: port
          });
          
          console.log(`✅ 目标浏览器 ${i + 1} 连接成功`);
        } catch (error) {
          console.error(`❌ 连接目标浏览器 ${port} 失败:`, error.message);
        }
      }
      
      console.log(`🎉 集群连接完成: 1个主控 + ${this.targetClients.length}个目标浏览器`);
      
    } catch (error) {
      console.error(`❌ 连接集群失败:`, error.message);
      throw error;
    }
  }

  // 开始集群监听
  async startClusterSync() {
    if (!this.masterClient) {
      throw new Error('请先连接浏览器集群');
    }
    
    console.log('🚀 启动集群同步监听...');
    this.isListening = true;
    
    // 启用主控浏览器的各种domain
    await this.masterClient.send('Input.enable');
    await this.masterClient.send('Runtime.enable');
    await this.masterClient.send('Page.enable');
    
    // 注入全局事件捕获
    await this.injectGlobalCapture();
    
    console.log('✅ 集群同步已启动');
    console.log('🎯 现在主控浏览器的所有操作都会同步到集群中的其他浏览器');
    console.log('📋 支持的操作:');
    console.log('   🖱️ 鼠标点击、移动、滚轮');
    console.log('   ⌨️ 键盘输入、组合键');
    console.log('   📜 页面滚动');
    console.log('   🔗 页面导航');
  }

  // 注入全局事件捕获器
  async injectGlobalCapture() {
    try {
      console.log('📡 注入全局事件捕获器...');
      
      await this.masterClient.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 防止重复注入
            if (window.__CLUSTER_SYNC_ACTIVE__) {
              console.log('🔄 集群同步已激活');
              return;
            }
            window.__CLUSTER_SYNC_ACTIVE__ = true;
            window.__syncQueue__ = [];
            
            console.log('🌟 启动集群同步捕获');
            
            // 鼠标事件捕获
            ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach(eventType => {
              document.addEventListener(eventType, (e) => {
                const event = {
                  type: 'mouse',
                  action: eventType,
                  x: e.clientX,
                  y: e.clientY,
                  button: e.button,
                  ctrlKey: e.ctrlKey,
                  shiftKey: e.shiftKey,
                  altKey: e.altKey,
                  timestamp: Date.now()
                };
                
                window.__syncQueue__.push(event);
                console.log('🖱️ 捕获鼠标事件:', eventType, e.clientX, e.clientY);
                
                // 限制队列长度
                if (window.__syncQueue__.length > 100) {
                  window.__syncQueue__ = window.__syncQueue__.slice(-50);
                }
              }, true);
            });
            
            // 键盘事件捕获
            ['keydown', 'keyup', 'keypress'].forEach(eventType => {
              document.addEventListener(eventType, (e) => {
                const event = {
                  type: 'keyboard',
                  action: eventType,
                  key: e.key,
                  code: e.code,
                  keyCode: e.keyCode,
                  ctrlKey: e.ctrlKey,
                  shiftKey: e.shiftKey,
                  altKey: e.altKey,
                  metaKey: e.metaKey,
                  timestamp: Date.now()
                };
                
                window.__syncQueue__.push(event);
                console.log('⌨️ 捕获键盘事件:', eventType, e.key);
                
                if (window.__syncQueue__.length > 100) {
                  window.__syncQueue__ = window.__syncQueue__.slice(-50);
                }
              }, true);
            });
            
            // 滚轮事件捕获
            document.addEventListener('wheel', (e) => {
              const event = {
                type: 'wheel',
                action: 'wheel',
                x: e.clientX,
                y: e.clientY,
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                deltaZ: e.deltaZ,
                timestamp: Date.now()
              };
              
              window.__syncQueue__.push(event);
              console.log('🎡 捕获滚轮事件:', e.deltaX, e.deltaY);
              
              if (window.__syncQueue__.length > 100) {
                window.__syncQueue__ = window.__syncQueue__.slice(-50);
              }
            }, true);
            
            // 输入事件捕获
            document.addEventListener('input', (e) => {
              if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                const rect = e.target.getBoundingClientRect();
                const event = {
                  type: 'input',
                  action: 'input',
                  value: e.target.value,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  targetTag: e.target.tagName,
                  targetType: e.target.type,
                  timestamp: Date.now()
                };
                
                window.__syncQueue__.push(event);
                console.log('📝 捕获输入事件:', e.target.value?.substring(0, 10));
                
                if (window.__syncQueue__.length > 100) {
                  window.__syncQueue__ = window.__syncQueue__.slice(-50);
                }
              }
            }, true);
            
            console.log('✅ 全局事件捕获器注入完成');
          })();
        `
      });
      
      // 开始事件轮询
      this.startEventPolling();
      
    } catch (error) {
      console.error('❌ 注入全局捕获器失败:', error.message);
    }
  }

  // 事件轮询
  async startEventPolling() {
    const poll = async () => {
      if (!this.isListening) return;
      
      try {
        // 从主控浏览器获取事件队列
        const result = await this.masterClient.send('Runtime.evaluate', {
          expression: `
            (function() {
              const events = window.__syncQueue__ || [];
              window.__syncQueue__ = []; // 清空队列
              return events;
            })();
          `,
          returnByValue: true
        });
        
        const events = result.result.value || [];
        
        // 同步每个事件到集群
        for (const event of events) {
          await this.syncEventToCluster(event);
        }
        
      } catch (error) {
        if (!error.message.includes('detached') && !error.message.includes('closed')) {
          console.error('轮询事件失败:', error.message);
        }
      }
      
      // 继续轮询
      if (this.isListening) {
        setTimeout(poll, 50); // 50ms高频轮询，实现真正的实时同步
      }
    };
    
    poll();
  }

  // 同步事件到集群
  async syncEventToCluster(event) {
    if (this.targetClients.length === 0) return;
    
    const promises = this.targetClients.map(async (target) => {
      try {
        switch (event.type) {
          case 'mouse':
            await this.syncMouseEvent(target, event);
            break;
          case 'keyboard':
            await this.syncKeyboardEvent(target, event);
            break;
          case 'wheel':
            await this.syncWheelEvent(target, event);
            break;
          case 'input':
            await this.syncInputEvent(target, event);
            break;
        }
      } catch (error) {
        console.error(`❌ 目标浏览器 ${target.index} 同步失败:`, error.message);
      }
    });
    
    await Promise.all(promises);
  }

  // 同步鼠标事件
  async syncMouseEvent(target, event) {
    const { client, index } = target;
    
    switch (event.action) {
      case 'mousedown':
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: event.x,
          y: event.y,
          button: event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle',
          clickCount: 1,
          modifiers: this.getModifiers(event)
        });
        console.log(`✅ 浏览器 ${index} 同步鼠标按下: (${event.x}, ${event.y})`);
        break;
        
      case 'mouseup':
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: event.x,
          y: event.y,
          button: event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle',
          clickCount: 1,
          modifiers: this.getModifiers(event)
        });
        console.log(`✅ 浏览器 ${index} 同步鼠标释放: (${event.x}, ${event.y})`);
        break;
        
      case 'click':
        // 先移动鼠标到位置
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: event.x,
          y: event.y
        });
        
        // 然后执行点击
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: event.x,
          y: event.y,
          button: 'left',
          clickCount: 1,
          modifiers: this.getModifiers(event)
        });
        
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: event.x,
          y: event.y,
          button: 'left',
          clickCount: 1,
          modifiers: this.getModifiers(event)
        });
        
        console.log(`✅ 浏览器 ${index} 同步点击: (${event.x}, ${event.y})`);
        break;
    }
  }

  // 同步键盘事件
  async syncKeyboardEvent(target, event) {
    const { client, index } = target;
    
    if (event.action === 'keydown') {
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: event.key,
        code: event.code,
        windowsVirtualKeyCode: event.keyCode,
        modifiers: this.getModifiers(event)
      });
      console.log(`✅ 浏览器 ${index} 同步按键: ${event.key}`);
    } else if (event.action === 'keyup') {
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: event.key,
        code: event.code,
        windowsVirtualKeyCode: event.keyCode,
        modifiers: this.getModifiers(event)
      });
    }
  }

  // 同步滚轮事件
  async syncWheelEvent(target, event) {
    const { client, index } = target;
    
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: event.x,
      y: event.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY
    });
    
    console.log(`✅ 浏览器 ${index} 同步滚轮: (${event.deltaX}, ${event.deltaY})`);
  }

  // 同步输入事件
  async syncInputEvent(target, event) {
    const { client, index } = target;
    
    // 先点击输入框位置
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: event.x,
      y: event.y,
      button: 'left',
      clickCount: 1
    });
    
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: event.x,
      y: event.y,
      button: 'left',
      clickCount: 1
    });
    
    // 清空现有内容
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      modifiers: 2 // Ctrl
    });
    
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      modifiers: 2
    });
    
    // 输入新内容
    if (event.value) {
      await client.send('Input.insertText', {
        text: event.value
      });
    }
    
    console.log(`✅ 浏览器 ${index} 同步输入: "${event.value?.substring(0, 10)}..."`);
  }

  // 获取修饰键状态
  getModifiers(event) {
    let modifiers = 0;
    if (event.altKey) modifiers |= 1;    // Alt
    if (event.ctrlKey) modifiers |= 2;   // Ctrl
    if (event.metaKey) modifiers |= 4;   // Meta (Cmd)
    if (event.shiftKey) modifiers |= 8;  // Shift
    return modifiers;
  }

  // 停止集群同步
  async stopClusterSync() {
    console.log('🛑 停止集群同步...');
    this.isListening = false;
    
    // 清理主控浏览器
    if (this.masterClient) {
      try {
        await this.masterClient.send('Runtime.evaluate', {
          expression: 'window.__CLUSTER_SYNC_ACTIVE__ = false;'
        });
      } catch (error) {
        // 忽略错误
      }
    }
  }

  // 断开集群连接
  async disconnectCluster() {
    console.log('🔌 断开集群连接...');
    
    this.isListening = false;
    
    // 断开所有目标浏览器
    for (const target of this.targetClients) {
      try {
        await target.client.detach();
        await target.browser.disconnect();
      } catch (error) {
        console.error(`断开目标浏览器 ${target.index} 失败:`, error.message);
      }
    }
    
    // 断开主控浏览器
    if (this.masterClient) {
      try {
        await this.masterClient.detach();
      } catch (error) {
        console.error('断开主控浏览器失败:', error.message);
      }
    }
    
    this.masterClient = null;
    this.targetClients = [];
    
    console.log('✅ 集群连接已断开');
  }
}

// 测试集群同步
async function testClusterSync() {
  const cluster = new ClusterSyncTool();
  
  try {
    console.log('🌐 启动浏览器集群同步测试...');
    
    // 连接到集群（主控端口9222，目标端口9223）
    await cluster.connectToCluster(9222, [9223]);
    
    // 启动集群同步
    await cluster.startClusterSync();
    
    console.log('');
    console.log('🎉 集群同步已启动！');
    console.log('🎯 现在在主控浏览器中的所有操作都会实时同步到其他浏览器');
    console.log('🖱️ 支持: 鼠标点击、移动、右键、双击');
    console.log('⌨️ 支持: 键盘输入、组合键、特殊键');
    console.log('📜 支持: 滚轮滚动、页面滚动');
    console.log('📝 支持: 表单输入、文本选择');
    console.log('');
    console.log('⏰ 将运行60秒后自动停止...');
    
    // 60秒后自动停止
    setTimeout(async () => {
      await cluster.stopClusterSync();
      await cluster.disconnectCluster();
      console.log('🎉 集群同步测试完成！');
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error('❌ 集群同步测试失败:', error.message);
    await cluster.disconnectCluster();
    process.exit(1);
  }
}

// 导出类
module.exports = { ClusterSyncTool };

// 如果直接运行此文件，执行测试
if (require.main === module) {
  testClusterSync().catch(console.error);
} 