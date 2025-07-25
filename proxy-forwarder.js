const http = require('http');
const net = require('net');
const url = require('url');
const { HttpProxyAgent } = require('http-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

class ProxyForwarder {
    constructor() {
        this.servers = new Map(); // configId -> server info
        this.nextPort = 8990; // 起始端口
    }

    // 为配置创建本地代理转发器
    async createForwarder(config) {
        try {
            const localPort = this.getAvailablePort();
            
            // 解析目标代理
            const targetProxy = this.parseProxyConfig(config);
            
            // 测试代理连接
            const connectionTest = await this.testProxyConnection(targetProxy, config);
            if (!connectionTest.success) {
                console.warn(`代理连接测试失败: ${connectionTest.error}`);
                console.warn('将创建转发器但可能无法正常工作');
            } else {
                console.log('✅ 代理连接测试成功');
            }
            
            // 创建本地HTTP代理服务器
            const server = http.createServer();
            
            // 处理HTTP请求
            server.on('request', (req, res) => {
                this.handleHttpRequest(req, res, targetProxy);
            });
            
            // 处理HTTPS隧道请求
            server.on('connect', (req, socket, head) => {
                this.handleConnectRequest(req, socket, head, targetProxy);
            });
            
            // 启动服务器
            return new Promise((resolve, reject) => {
                server.listen(localPort, '127.0.0.1', (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    
                    const serverInfo = {
                        server: server,
                        port: localPort,
                        targetProxy: targetProxy,
                        configId: config.id
                    };
                    
                    this.servers.set(config.id, serverInfo);
                    
                    console.log(`代理转发器已启动: 127.0.0.1:${localPort} -> ${config.proxyServer}`);
                    resolve({
                        success: true,
                        localPort: localPort,
                        localProxyUrl: `http://127.0.0.1:${localPort}`
                    });
                });
                
                server.on('error', (error) => {
                    console.warn(`代理转发器服务器错误:`, error.message);
                    // 不要让服务器错误导致整个应用崩溃
                });
                
                // 处理未捕获的错误
                server.on('clientError', (error, socket) => {
                    console.warn('客户端连接错误:', error.message);
                    try {
                        if (!socket.destroyed) {
                            socket.destroy();
                        }
                    } catch (destroyError) {
                        console.warn('销毁Socket失败:', destroyError.message);
                    }
                });
            });
            
        } catch (error) {
            console.error('创建代理转发器失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 解析代理配置
    parseProxyConfig(config) {
        const proxyUrl = config.proxyServer;
        const parsed = url.parse(proxyUrl);
        
        let agent;
        let proxyOptions = {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            auth: null
        };
        
        // 如果有认证信息，添加到配置中
        if (config.proxyUsername && config.proxyPassword) {
            proxyOptions.auth = `${config.proxyUsername}:${config.proxyPassword}`;
        }
        
        // 构建带认证的代理URL
        let authProxyUrl;
        if (proxyOptions.auth) {
            authProxyUrl = `${proxyOptions.protocol}//${proxyOptions.auth}@${proxyOptions.hostname}:${proxyOptions.port}`;
        } else {
            authProxyUrl = proxyUrl;
        }
        
        // 根据协议类型创建代理客户端
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            agent = new HttpProxyAgent(authProxyUrl);
        } else if (parsed.protocol === 'socks4:' || parsed.protocol === 'socks5:') {
            agent = new SocksProxyAgent(authProxyUrl);
        } else {
            throw new Error(`不支持的代理协议: ${parsed.protocol}`);
        }
        
        return {
            agent: agent,
            url: authProxyUrl,
            options: proxyOptions
        };
    }

    // 处理HTTP请求
    handleHttpRequest(req, res, targetProxy) {
        try {
            const options = {
                method: req.method,
                headers: req.headers,
                agent: targetProxy.agent,
                timeout: 30000 // 30秒超时
            };
            
            // 创建到目标服务器的请求
            const proxyReq = http.request(req.url, options, (proxyRes) => {
                try {
                    // 复制响应头
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    // 转发响应数据
                    proxyRes.pipe(res);
                    
                    proxyRes.on('error', (error) => {
                        console.warn('代理响应流错误:', error.message);
                        if (!res.headersSent) {
                            res.writeHead(500);
                            res.end('代理响应错误');
                        }
                    });
                } catch (error) {
                    console.warn('处理代理响应时出错:', error.message);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('处理响应错误');
                    }
                }
            });
            
            // 转发请求数据
            req.on('error', (error) => {
                console.warn('客户端请求错误:', error.message);
                proxyReq.destroy();
            });
            
            req.pipe(proxyReq);
            
            // 错误处理
            proxyReq.on('error', (error) => {
                console.warn('代理请求错误:', error.message);
                if (!res.headersSent) {
                    res.writeHead(502);
                    res.end('代理服务器不可达');
                }
            });
            
            // 超时处理
            proxyReq.on('timeout', () => {
                console.warn('代理请求超时');
                proxyReq.destroy();
                if (!res.headersSent) {
                    res.writeHead(504);
                    res.end('代理服务器超时');
                }
            });
            
        } catch (error) {
            console.warn('创建代理请求时出错:', error.message);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end('内部错误');
            }
        }
    }

    // 处理HTTPS隧道请求
    handleConnectRequest(req, socket, head, targetProxy) {
        try {
            // 通过代理建立隧道连接
            const options = {
                method: 'CONNECT',
                agent: targetProxy.agent,
                path: req.url,
                timeout: 30000, // 30秒超时
                headers: {
                    'Host': req.url,
                    'Proxy-Connection': 'keep-alive'
                }
            };
            
            if (targetProxy.options.auth) {
                options.headers['Proxy-Authorization'] = `Basic ${Buffer.from(targetProxy.options.auth).toString('base64')}`;
            }
            
            const proxyReq = http.request(options);
            
            // 成功建立连接
            proxyReq.on('connect', (proxyRes, proxySocket, proxyHead) => {
                try {
                    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    
                    // 设置错误处理
                    proxySocket.on('error', (error) => {
                        console.warn('代理Socket错误:', error.message);
                        socket.destroy();
                    });
                    
                    socket.on('error', (error) => {
                        console.warn('客户端Socket错误:', error.message);
                        proxySocket.destroy();
                    });
                    
                    // 双向数据转发
                    proxySocket.pipe(socket);
                    socket.pipe(proxySocket);
                    
                } catch (error) {
                    console.warn('建立隧道时出错:', error.message);
                    socket.destroy();
                }
            });
            
            // 连接错误处理
            proxyReq.on('error', (error) => {
                console.warn('隧道连接错误:', error.message);
                try {
                    if (!socket.destroyed) {
                        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                        socket.end();
                    }
                } catch (writeError) {
                    console.warn('写入错误响应失败:', writeError.message);
                    socket.destroy();
                }
            });
            
            // 客户端Socket错误处理
            socket.on('error', (error) => {
                console.warn('客户端连接错误:', error.message);
                proxyReq.destroy();
            });
            
            // 超时处理
            proxyReq.on('timeout', () => {
                console.warn('隧道连接超时');
                proxyReq.destroy();
                try {
                    if (!socket.destroyed) {
                        socket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
                        socket.end();
                    }
                } catch (writeError) {
                    console.warn('写入超时响应失败:', writeError.message);
                    socket.destroy();
                }
            });
            
            proxyReq.end();
            
        } catch (error) {
            console.warn('处理CONNECT请求时出错:', error.message);
            try {
                if (!socket.destroyed) {
                    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
                    socket.end();
                }
            } catch (writeError) {
                console.warn('写入错误响应失败:', writeError.message);
                socket.destroy();
            }
        }
    }

    // 获取可用端口
    getAvailablePort() {
        let port = this.nextPort;
        
        // 检查端口是否被占用
        while (this.isPortInUse(port)) {
            port++;
        }
        
        this.nextPort = port + 1;
        return port;
    }

    // 检查端口是否被占用
    isPortInUse(port) {
        const existingPorts = Array.from(this.servers.values()).map(info => info.port);
        return existingPorts.includes(port);
    }

    // 停止指定配置的转发器
    stopForwarder(configId) {
        const serverInfo = this.servers.get(configId);
        if (serverInfo) {
            try {
                serverInfo.server.close();
                this.servers.delete(configId);
                console.log(`代理转发器已停止: 配置 ${configId} 端口 ${serverInfo.port}`);
                return { success: true };
            } catch (error) {
                console.error(`停止代理转发器失败:`, error);
                return { success: false, error: error.message };
            }
        }
        return { success: false, error: '转发器未找到' };
    }

    // 停止所有转发器
    stopAllForwarders() {
        const results = [];
        for (const configId of this.servers.keys()) {
            results.push(this.stopForwarder(configId));
        }
        return results;
    }

    // 获取转发器状态
    getForwarderStatus(configId) {
        const serverInfo = this.servers.get(configId);
        if (serverInfo) {
            return {
                active: true,
                localPort: serverInfo.port,
                targetProxy: serverInfo.targetProxy.url
            };
        }
        return { active: false };
    }

    // 获取所有转发器状态
    getAllForwarderStatus() {
        const status = {};
        for (const [configId, serverInfo] of this.servers.entries()) {
            status[configId] = {
                active: true,
                localPort: serverInfo.port,
                targetProxy: serverInfo.targetProxy.url
            };
        }
        return status;
    }

    // 测试代理连接
    async testProxyConnection(targetProxy, config) {
        return new Promise((resolve) => {
            try {
                // 创建一个简单的测试请求
                const testOptions = {
                    method: 'GET',
                    agent: targetProxy.agent,
                    timeout: 10000, // 10秒超时
                    headers: {
                        'User-Agent': 'ChromiumManager/1.0.0'
                    }
                };

                // 测试HTTP连接到一个简单的网站
                const testReq = http.request('http://httpbin.org/ip', testOptions, (testRes) => {
                    resolve({ 
                        success: true, 
                        statusCode: testRes.statusCode,
                        message: '代理连接正常'
                    });
                });

                testReq.on('error', (error) => {
                    resolve({ 
                        success: false, 
                        error: error.message,
                        code: error.code
                    });
                });

                testReq.on('timeout', () => {
                    testReq.destroy();
                    resolve({ 
                        success: false, 
                        error: '连接超时'
                    });
                });

                testReq.end();

            } catch (error) {
                resolve({ 
                    success: false, 
                    error: error.message
                });
            }
        });
    }
}

module.exports = ProxyForwarder; 