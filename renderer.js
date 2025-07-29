const { ipcRenderer } = require('electron');
const { v4: uuidv4 } = require('uuid');

class BrowserConfigManager {
    constructor() {
        this.configs = [];
        this.currentConfig = null;
        this.runningBrowsers = [];
        this.browserListRefreshTimer = null;
        this.init();
    }

    async init() {
        await this.loadConfigs();
        await this.loadRunningBrowsers();
        this.bindEvents();
        this.checkChromiumStatus();
        this.updateUI();
        
        // 监听进程状态更新
        ipcRenderer.on('browser-process-updated', async () => {
            await this.loadRunningBrowsers();
            
            // 如果当前在批量任务页面，也更新浏览器列表
            const batchTaskPage = document.getElementById('batchTaskPage');
            if (batchTaskPage && batchTaskPage.style.display !== 'none') {
                await this.updateRunningBrowsersList();
            }
        });
    }

    async loadConfigs() {
        try {
            this.configs = await ipcRenderer.invoke('load-configs');
            
            console.log('📋 loadConfigs调试信息:');
            console.log('  - 加载的配置数量:', this.configs.length);
            
            // 验证和修复配置中缺失的randomFolder字段
            let hasChanges = false;
            for (let config of this.configs) {
                console.log(`  - 配置 "${config.name}" (${config.id}) randomFolder:`, config.randomFolder);
                
                if (!config.randomFolder) {
                    // 为缺失randomFolder的配置生成一个新的
                    config.randomFolder = await ipcRenderer.invoke('generate-random-folder');
                    hasChanges = true;
                    console.log(`  ⚠️ 为配置 "${config.name}" 生成新的randomFolder:`, config.randomFolder);
                }
            }
            
            // 如果有修复，保存配置
            if (hasChanges) {
                console.log('🔧 检测到缺失的randomFolder字段，已自动修复并保存');
                await ipcRenderer.invoke('save-configs', this.configs);
                this.showStatus('已自动修复配置中缺失的目录信息', 'success');
            }
            
            this.updateConfigList();
            this.updateConfigCount();
            
            console.log('✅ 配置加载完成');
        } catch (error) {
            this.showStatus('加载配置失败: ' + error.message, 'error');
        }
    }

    async loadRunningBrowsers() {
        try {
            this.runningBrowsers = await ipcRenderer.invoke('get-running-browsers');
            this.updateConfigList();
            this.updateRunningCount();
        } catch (error) {
            console.error('加载运行中浏览器失败:', error);
        }
    }

    updateRunningCount() {
        const count = this.runningBrowsers.length;
        document.getElementById('runningCount').innerHTML = `<i class="fas fa-play"></i> 运行中: ${count}`;
        
        // 更新头部统计信息
        const headerRunningCount = document.getElementById('headerRunningCount');
        if (headerRunningCount) {
            headerRunningCount.textContent = count;
        }
    }

    async saveConfigs() {
        try {
            const result = await ipcRenderer.invoke('save-configs', this.configs);
            if (result.success) {
                this.showStatus('配置保存成功', 'success');
            } else {
                this.showStatus('保存失败: ' + result.error, 'error');
            }
        } catch (error) {
            this.showStatus('保存配置失败: ' + error.message, 'error');
        }
    }

    bindEvents() {
        document.getElementById('addConfigBtn').addEventListener('click', () => {
            this.showConfigForm();
        });

        document.getElementById('refreshBtn').addEventListener('click', async () => {
            await this.loadConfigs();
            await this.loadRunningBrowsers();
        });

        document.getElementById('saveConfigBtn').addEventListener('click', () => {
            this.saveCurrentConfig();
        });

        document.getElementById('launchBrowserBtn').addEventListener('click', () => {
            this.launchBrowser();
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.hideConfigForm();
        });

        document.getElementById('generateFingerprintBtn').addEventListener('click', () => {
            this.generateRandomFingerprint();
        });

        document.getElementById('language').addEventListener('change', (e) => {
            this.updateAcceptLanguage(e.target.value);
        });

        // 根目录选择
        document.getElementById('browseRootBtn').addEventListener('click', async () => {
            await this.showRootFolderDialog();
        });

        // 重置根目录
        document.getElementById('resetRootBtn').addEventListener('click', () => {
            document.getElementById('userDataRoot').value = '';
            this.updatePathPreview();
        });

        // 配置名称输入监听
        document.getElementById('configName').addEventListener('input', (e) => {
            this.updatePathPreview();
        });

        // 新增按钮事件
        const quickStartBtn = document.getElementById('quickStartBtn');
        if (quickStartBtn) {
            quickStartBtn.addEventListener('click', () => {
                this.showConfigForm();
            });
        }

        const previewBtn = document.getElementById('previewBtn');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => {
                this.previewConfig();
            });
        }

        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.showSettings();
            });
        }

        const batchTaskBtn = document.getElementById('batchTaskBtn');
        if (batchTaskBtn) {
            batchTaskBtn.addEventListener('click', () => {
                this.showBatchTask();
            });
        }

        // 设置页面按钮事件
        document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
            this.saveSettings();
        });

        document.getElementById('resetSettingsBtn')?.addEventListener('click', () => {
            this.resetSettings();
        });

        document.getElementById('closeSettingsBtn')?.addEventListener('click', () => {
            this.hideSettings();
        });

        document.getElementById('browseChromiumBtn')?.addEventListener('click', () => {
            this.browseChromiumPath();
        });

        document.getElementById('browseDataRootBtn')?.addEventListener('click', () => {
            this.browseDataRoot();
        });

        // 浏览器下载相关事件
        document.getElementById('downloadBrowserBtn')?.addEventListener('click', () => {
            this.downloadBrowser();
        });

        document.getElementById('customInstallPathBtn')?.addEventListener('click', () => {
            this.selectCustomInstallPath();
        });

        // 批量任务页面按钮事件
        document.getElementById('closeBatchTaskBtn')?.addEventListener('click', () => {
            this.hideBatchTask();
        });

        document.getElementById('addTaskBtn')?.addEventListener('click', () => {
            this.addTask();
        });

        document.getElementById('executeTaskBtn')?.addEventListener('click', () => {
            this.executeTask();
        });

        document.getElementById('stopTaskBtn')?.addEventListener('click', () => {
            this.stopTask();
        });

        document.getElementById('clearLogBtn')?.addEventListener('click', () => {
            this.clearTaskLog();
        });

        document.getElementById('taskType')?.addEventListener('change', (e) => {
            this.updateTaskFormByType(e.target.value);
        });

        // 搜索功能
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterConfigs(e.target.value);
            });
        }

        // 过滤标签
        const filterTabs = document.querySelectorAll('.filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                filterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.filterByStatus(tab.dataset.filter);
            });
        });

        // 启动时间显示
        this.startClock();

        // 内存使用监控
        this.startMemoryMonitoring();

        // 批量操作按钮
        const startAllBtn = document.getElementById('startAllBtn');
        const stopAllBtn = document.getElementById('stopAllBtn');
        
        if (startAllBtn) {
            startAllBtn.addEventListener('click', () => {
                this.startAllBrowsers();
            });
        }
        
        if (stopAllBtn) {
            stopAllBtn.addEventListener('click', () => {
                this.stopAllBrowsers();
            });
        }

        // 监听应用退出事件
        ipcRenderer.on('app-will-quit', () => {
            this.handleAppWillQuit();
        });

        // 监听浏览器下载进度
        ipcRenderer.on('browser-download-progress', (event, data) => {
            this.updateDownloadProgress(data);
        });

        // 监听浏览器安装完成
        ipcRenderer.on('browser-install-complete', (event, data) => {
            this.onBrowserInstallComplete(data);
        });

    }

    updateConfigList() {
        const configList = document.getElementById('configList');
        configList.innerHTML = '';

        this.configs.forEach(config => {
            const configItem = this.createConfigItem(config);
            configList.appendChild(configItem);
        });
    }

    createConfigItem(config) {
        const item = document.createElement('div');
        item.className = 'config-item';
        item.dataset.configId = config.id;

        const platformInfo = config.platform ? config.platform : '未设置';
        const brandInfo = config.brand ? config.brand : '默认';
        let proxyInfo = '直连';
        if (config.proxyServer) {
            if (config.proxyUsername && config.proxyPassword) {
                proxyInfo = '🔐 认证代理';
            } else {
                proxyInfo = '🔒 代理';
            }
        }
        
        // 检查是否正在运行
        const runningBrowser = this.runningBrowsers.find(b => b.configId === config.id);
        const isRunning = !!runningBrowser;
        
        let statusHtml = '';
        if (isRunning) {
            const startTime = new Date(runningBrowser.startTime).toLocaleTimeString();
            statusHtml = `
                <div class="config-status">
                    <span class="status-running">运行中 (PID: ${runningBrowser.pid})</span>
                    <button class="btn-activate" data-action="activate" data-config-id="${config.id}" title="激活窗口">激活</button>
                    <button class="btn-terminate" data-action="terminate" data-config-id="${config.id}" title="终止进程">终止</button>
                </div>
            `;
        }

        item.innerHTML = `
            <div class="config-item-header">
                <div class="config-name">${config.name}</div>
                <div class="config-actions">
                    <button data-action="edit" data-config-id="${config.id}" title="编辑">✏️</button>
                    <button data-action="clone" data-config-id="${config.id}" title="克隆">📋</button>
                    <button data-action="delete" data-config-id="${config.id}" title="删除">🗑️</button>
                </div>
            </div>
            <div class="config-info">
                <div>平台: ${platformInfo} | 浏览器: ${brandInfo}</div>
                <div>${proxyInfo} | 指纹: ${config.fingerprint || '随机'}</div>
                ${statusHtml}
            </div>
        `;

        // 添加事件监听器处理异步操作
        const actionButtons = item.querySelectorAll('[data-action]');
        actionButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = button.dataset.action;
                const configId = button.dataset.configId;
                
                switch (action) {
                    case 'edit':
                        this.editConfig(configId);
                        break;
                    case 'clone':
                        await this.cloneConfig(configId);
                        break;
                    case 'delete':
                        await this.deleteConfig(configId);
                        break;
                    case 'activate':
                        await this.activateBrowser(configId);
                        break;
                    case 'terminate':
                        await this.terminateBrowser(configId);
                        break;
                }
            });
        });

        item.addEventListener('click', (e) => {
            if (!e.target.closest('.config-actions') && !e.target.closest('.config-status')) {
                this.selectConfig(config.id);
            }
        });

        return item;
    }

    selectConfig(configId) {
        this.currentConfig = this.configs.find(c => c.id === configId);
        
        console.log('🔍 selectConfig调试信息:');
        console.log('  - 选择的configId:', configId);
        console.log('  - 找到的配置:', this.currentConfig);
        console.log('  - 配置的randomFolder:', this.currentConfig?.randomFolder);
        
        this.highlightConfigItem(configId);
        this.showConfigForm(this.currentConfig);
    }

    highlightConfigItem(configId) {
        document.querySelectorAll('.config-item').forEach(item => {
            item.classList.remove('active');
        });
        const selectedItem = document.querySelector(`[data-config-id="${configId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('active');
        }
    }

    showConfigForm(config = null) {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('configForm').style.display = 'flex';

        if (config) {
            this.populateForm(config);
            document.getElementById('formTitle').textContent = '编辑配置 - ' + config.name;
        } else {
            this.clearForm();
            document.getElementById('formTitle').textContent = '新建配置';
            this.currentConfig = null;
            // 显示默认路径预览
            setTimeout(() => this.updatePathPreview(), 100);
        }
    }

    hideConfigForm() {
        document.getElementById('configForm').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'block';
        this.currentConfig = null;
        
        document.querySelectorAll('.config-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    populateForm(config) {
        console.log('📝 populateForm调试信息:');
        console.log('  - 填充的配置:', config);
        console.log('  - 配置的randomFolder:', config.randomFolder);
        
        document.getElementById('configName').value = config.name || '';
        document.getElementById('fingerprint').value = config.fingerprint || '';
        document.getElementById('platform').value = config.platform || '';
        document.getElementById('platformVersion').value = config.platformVersion || '';
        document.getElementById('brand').value = config.brand || '';
        document.getElementById('brandVersion').value = config.brandVersion || '';
        document.getElementById('hardwareConcurrency').value = config.hardwareConcurrency || '';
        document.getElementById('disableNonProxiedUdp').checked = config.disableNonProxiedUdp !== false;
        document.getElementById('language').value = config.language || '';
        document.getElementById('acceptLanguage').value = config.acceptLanguage || '';
        document.getElementById('timezone').value = config.timezone || '';
        document.getElementById('proxyServer').value = config.proxyServer || '';
        document.getElementById('proxyUsername').value = config.proxyUsername || '';
        document.getElementById('proxyPassword').value = config.proxyPassword || '';
        document.getElementById('userDataRoot').value = config.userDataRoot || '';
        
        // 更新路径预览
        setTimeout(() => this.updatePathPreview(config.randomFolder), 100);
        
        console.log('  - 表单填充完成，randomFolder传递给updatePathPreview:', config.randomFolder);
    }

    clearForm() {
        document.querySelectorAll('#configForm input, #configForm select').forEach(field => {
            if (field.type === 'checkbox') {
                field.checked = field.id === 'disableNonProxiedUdp';
            } else {
                field.value = '';
            }
        });
        // 隐藏路径预览
        document.getElementById('pathPreview').style.display = 'none';
    }

    async saveCurrentConfig() {
        const formData = await this.getFormData();
        
        console.log('💾 saveCurrentConfig调试信息:');
        console.log('  - formData:', formData);
        console.log('  - formData.randomFolder:', formData.randomFolder);
        
        if (!formData.name.trim()) {
            this.showStatus('请输入配置名称', 'error');
            return;
        }

        if (this.currentConfig) {
            console.log('  - 编辑现有配置，ID:', this.currentConfig.id);
            console.log('  - 当前配置的randomFolder:', this.currentConfig.randomFolder);
            
            const index = this.configs.findIndex(c => c.id === this.currentConfig.id);
            if (index !== -1) {
                // 确保保留所有重要字段，特别是randomFolder
                const updatedConfig = { 
                    ...this.currentConfig, 
                    ...formData,
                    // 明确保留一些关键字段
                    id: this.currentConfig.id,
                    createdAt: this.currentConfig.createdAt || new Date().toISOString(),
                    randomFolder: formData.randomFolder // 确保使用formData中的randomFolder
                };
                
                console.log('  - 更新后的配置:', updatedConfig);
                console.log('  - 更新后的randomFolder:', updatedConfig.randomFolder);
                
                this.configs[index] = updatedConfig;
            }
        } else {
            console.log('  - 创建新配置');
            const newConfig = {
                id: uuidv4(),
                ...formData,
                createdAt: new Date().toISOString()
            };
            console.log('  - 新配置:', newConfig);
            console.log('  - 新配置的randomFolder:', newConfig.randomFolder);
            
            this.configs.push(newConfig);
        }

        this.saveConfigs();
        this.updateConfigList();
        this.updateConfigCount();
        this.hideConfigForm();
        
        console.log('✅ 配置保存完成');
    }

    async getFormData() {
        // 如果是新配置，生成随机文件夹名
        let randomFolder = this.currentConfig?.randomFolder;
        
        // 添加调试信息
        console.log('🔍 getFormData调试信息:');
        console.log('  - currentConfig:', this.currentConfig);
        console.log('  - 现有randomFolder:', randomFolder);
        
        if (!randomFolder) {
            randomFolder = await ipcRenderer.invoke('generate-random-folder');
            console.log('  - 生成新randomFolder:', randomFolder);
        } else {
            console.log('  - 保留现有randomFolder:', randomFolder);
        }
        
        const formData = {
            name: document.getElementById('configName').value.trim(),
            fingerprint: document.getElementById('fingerprint').value,
            platform: document.getElementById('platform').value,
            platformVersion: document.getElementById('platformVersion').value,
            brand: document.getElementById('brand').value,
            brandVersion: document.getElementById('brandVersion').value,
            hardwareConcurrency: document.getElementById('hardwareConcurrency').value,
            disableNonProxiedUdp: document.getElementById('disableNonProxiedUdp').checked,
            language: document.getElementById('language').value,
            acceptLanguage: document.getElementById('acceptLanguage').value,
            timezone: document.getElementById('timezone').value,
            proxyServer: document.getElementById('proxyServer').value,
            proxyUsername: document.getElementById('proxyUsername').value,
            proxyPassword: document.getElementById('proxyPassword').value,
            userDataRoot: document.getElementById('userDataRoot').value,
            randomFolder: randomFolder
        };
        
        console.log('  - 最终formData.randomFolder:', formData.randomFolder);
        return formData;
    }

    async launchBrowser() {
        const formData = await this.getFormData();
        if (!this.currentConfig && !formData.name) {
            this.showStatus('请先选择或创建一个配置', 'error');
            return;
        }

        const config = this.currentConfig || formData;
        
        this.showStatus('正在启动浏览器...', 'info');
        
        try {
            const result = await ipcRenderer.invoke('launch-browser', config);
            if (result.success) {
                this.showStatus(`浏览器启动成功 (PID: ${result.pid})`, 'success');
                // 刷新运行状态
                await this.loadRunningBrowsers();
            } else {
                this.showStatus('启动失败: ' + result.error, 'error');
            }
        } catch (error) {
            this.showStatus('启动浏览器失败: ' + error.message, 'error');
        }
    }

    async activateBrowser(configId) {
        try {
            const result = await ipcRenderer.invoke('activate-browser', configId);
            if (result.success) {
                this.showStatus('窗口已激活', 'success');
            } else {
                this.showStatus('激活失败: ' + result.error, 'error');
            }
        } catch (error) {
            this.showStatus('激活失败: ' + error.message, 'error');
        }
    }

    async terminateBrowser(configId) {
        if (!confirm('确定要终止这个浏览器进程吗？')) {
            return;
        }
        
        try {
            const result = await ipcRenderer.invoke('terminate-browser', configId);
            if (result.success) {
                this.showStatus('浏览器进程已终止', 'success');
                await this.loadRunningBrowsers();
            } else {
                this.showStatus('终止失败: ' + result.error, 'error');
            }
        } catch (error) {
            this.showStatus('终止失败: ' + error.message, 'error');
        }
    }

    editConfig(configId) {
        this.selectConfig(configId);
    }

    async cloneConfig(configId) {
        const config = this.configs.find(c => c.id === configId);
        if (config) {
            // 为克隆的配置生成新的随机文件夹
            const newRandomFolder = await ipcRenderer.invoke('generate-random-folder');
            const clonedConfig = {
                ...config,
                id: uuidv4(),
                name: config.name + ' (副本)',
                randomFolder: newRandomFolder,
                createdAt: new Date().toISOString()
            };
            this.configs.push(clonedConfig);
            this.saveConfigs();
            this.updateConfigList();
            this.updateConfigCount();
            this.showStatus('配置克隆成功', 'success');
        }
    }

    async deleteConfig(configId) {
        // 检查是否有运行中的实例
        const runningBrowser = this.runningBrowsers.find(b => b.configId === configId);
        if (runningBrowser) {
            if (!confirm('该配置有正在运行的浏览器实例，确定要删除配置并终止进程吗？')) {
                return;
            }
            // 先终止浏览器进程
            await this.terminateBrowser(configId);
        } else if (!confirm('确定要删除这个配置吗？')) {
            return;
        }
        
        this.configs = this.configs.filter(c => c.id !== configId);
        this.saveConfigs();
        this.updateConfigList();
        this.updateConfigCount();
        
        if (this.currentConfig && this.currentConfig.id === configId) {
            this.hideConfigForm();
        }
        
        this.showStatus('配置删除成功', 'success');
    }

    generateRandomFingerprint() {
        const randomFingerprint = Math.floor(Math.random() * 4294967295);
        document.getElementById('fingerprint').value = randomFingerprint;
    }

    updateAcceptLanguage(language) {
        const acceptLangMap = {
            'zh-CN': 'zh-CN,zh;q=0.9,en;q=0.8',
            'zh-TW': 'zh-TW,zh;q=0.9,en;q=0.8',
            'en-US': 'en-US,en;q=0.9',
            'en-GB': 'en-GB,en;q=0.9',
            'ja-JP': 'ja-JP,ja;q=0.9,en;q=0.8',
            'ko-KR': 'ko-KR,ko;q=0.9,en;q=0.8'
        };
        
        if (acceptLangMap[language]) {
            document.getElementById('acceptLanguage').value = acceptLangMap[language];
        }
    }

    async checkChromiumStatus() {
        try {
            const result = await ipcRenderer.invoke('check-chromium-path');
            const statusIndicator = document.getElementById('chromiumStatus');
            
            if (result.exists) {
                statusIndicator.textContent = 'Chromium 已连接';
                statusIndicator.classList.add('connected');
            } else {
                statusIndicator.textContent = 'Chromium 未找到';
                statusIndicator.classList.remove('connected');
            }
        } catch (error) {
            console.error('检查 Chromium 状态失败:', error);
        }
    }

    updateConfigCount() {
        document.getElementById('configCount').textContent = this.configs.length;
        // 更新头部统计信息
        const headerConfigCount = document.getElementById('headerConfigCount');
        if (headerConfigCount) {
            headerConfigCount.textContent = this.configs.length;
        }
    }

    updateUI() {
        if (this.configs.length === 0) {
            this.hideConfigForm();
        }
    }

    showStatus(message, type = 'info') {
        const statusText = document.getElementById('statusText');
        statusText.textContent = message;
        
        statusText.className = '';
        
        if (type === 'error') {
            statusText.style.color = '#dc3545';
        } else if (type === 'success') {
            statusText.style.color = '#28a745';
        } else {
            statusText.style.color = '#6c757d';
        }
        
        setTimeout(() => {
            statusText.textContent = '就绪';
            statusText.style.color = '#6c757d';
        }, 3000);
    }

    // 添加任务日志
    addTaskLog(level, message) {
        const taskLog = document.getElementById('taskLog');
        if (!taskLog) {
            // 如果没有taskLog元素，则使用showStatus
            this.showStatus(message, level);
            return;
        }

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${level}`;
        
        let icon = '';
        let color = '';
        
        switch (level) {
            case 'error':
                icon = '❌';
                color = '#dc3545';
                break;
            case 'success':
                icon = '✅';
                color = '#28a745';
                break;
            case 'warning':
                icon = '⚠️';
                color = '#ffc107';
                break;
            case 'info':
            default:
                icon = '📋';
                color = '#17a2b8';
                break;
        }
        
        logEntry.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span>
            <span class="log-icon" style="color: ${color}">${icon}</span>
            <span class="log-message">${message}</span>
        `;
        
        taskLog.appendChild(logEntry);
        
        // 自动滚动到底部
        taskLog.scrollTop = taskLog.scrollHeight;
        
        // 限制日志条数，超过100条时删除旧的日志
        const logEntries = taskLog.querySelectorAll('.log-entry');
        if (logEntries.length > 100) {
            for (let i = 0; i < logEntries.length - 100; i++) {
                logEntries[i].remove();
            }
        }
    }

    // 清空任务日志
    clearTaskLog() {
        const taskLog = document.getElementById('taskLog');
        if (taskLog) {
            taskLog.innerHTML = '';
            this.addTaskLog('info', '📝 日志已清空');
        }
    }

    async showRootFolderDialog() {
        try {
            const result = await ipcRenderer.invoke('show-root-folder-dialog');
            if (result.success && result.path) {
                document.getElementById('userDataRoot').value = result.path;
                this.updatePathPreview();
                this.showStatus('根目录选择成功', 'success');
            }
        } catch (error) {
            this.showStatus('选择根目录失败: ' + error.message, 'error');
        }
    }

    async updatePathPreview(existingRandomFolder = null) {
        try {
            const defaultRoot = await ipcRenderer.invoke('get-default-data-root');
            const userDataRoot = document.getElementById('userDataRoot').value.trim();
            const configName = document.getElementById('configName').value.trim();
            
            const actualRoot = userDataRoot || defaultRoot;
            
            // 如果是编辑现有配置，使用现有的随机文件夹名
            let randomFolder = existingRandomFolder;
            if (!randomFolder) {
                if (configName) {
                    // 为预览生成一个示例随机文件夹名
                    const timestamp = Date.now().toString(36);
                    const random = Math.random().toString(36).substring(2, 6);
                    randomFolder = `browser-${timestamp}-${random}`;
                } else {
                    randomFolder = 'browser-xxxxxx-xxxx';
                }
            }
            
            const fullPath = `${actualRoot}/${randomFolder}`;
            
            const pathPreview = document.getElementById('pathPreview');
            if (configName || userDataRoot || existingRandomFolder) {
                pathPreview.innerHTML = `
                    <strong>数据将保存到:</strong><br>
                    ${fullPath}
                    ${!existingRandomFolder ? '<br><small style="color: #6c757d; font-style: italic;">*文件夹名将在保存时自动生成</small>' : ''}
                `;
                pathPreview.style.display = 'block';
            } else {
                pathPreview.style.display = 'none';
            }
        } catch (error) {
            console.error('更新路径预览失败:', error);
        }
    }

    async previewConfig() {
        const formData = await this.getFormData();
        if (!formData) return;

        let proxyDisplay = formData.proxyServer || '无';
        if (formData.proxyServer && formData.proxyUsername && formData.proxyPassword) {
            proxyDisplay += ` (认证: ${formData.proxyUsername}/****)`;
        }

        const previewContent = `
            <div style="font-family: monospace; white-space: pre-line;">
配置名称: ${formData.name || '未设置'}
指纹种子: ${formData.fingerprint || '随机生成'}
操作系统: ${formData.platform || '未设置'}
系统版本: ${formData.platformVersion || '默认'}
浏览器品牌: ${formData.brand || '默认'}
浏览器版本: ${formData.brandVersion || '默认'}
CPU核心数: ${formData.hardwareConcurrency || '自动'}
UDP连接: ${formData.disableNonProxiedUdp ? '已禁用' : '已启用'}
语言设置: ${formData.language || '默认'}
时区设置: ${formData.timezone || '默认'}
代理服务器: ${proxyDisplay}
存储根目录: ${formData.userDataRoot || '默认位置'}
            </div>
        `;

        // 显示预览对话框（简化版）
        if (confirm('配置预览:\n\n' + previewContent.replace(/<[^>]*>/g, ''))) {
            this.saveCurrentConfig();
        }
    }

    async showSettings() {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('configForm').style.display = 'none';
        document.getElementById('settingsPage').style.display = 'flex';
        
        // 加载当前设置
        await this.loadSettings();
        
        // 加载系统信息
        this.loadSystemInfo();
    }

    hideSettings() {
        document.getElementById('settingsPage').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'block';
    }

    async loadSettings() {
        try {
            const settings = await ipcRenderer.invoke('get-app-settings');
            
            document.getElementById('chromiumPath').value = settings.chromiumPath || '';
            document.getElementById('defaultUserDataRoot').value = settings.defaultUserDataRoot || '';
            document.getElementById('maxRunningBrowsers').value = settings.maxRunningBrowsers || 10;
            document.getElementById('autoCleanup').checked = settings.autoCleanup !== false;
            
            // 加载浏览器下载信息
            await this.loadBrowserDownloadInfo();
            
        } catch (error) {
            console.error('加载设置失败:', error);
            this.showStatus('加载设置失败');
        }
    }

    async saveSettings() {
        try {
            const newSettings = {
                chromiumPath: document.getElementById('chromiumPath').value.trim(),
                defaultUserDataRoot: document.getElementById('defaultUserDataRoot').value.trim(),
                maxRunningBrowsers: parseInt(document.getElementById('maxRunningBrowsers').value) || 10,
                autoCleanup: document.getElementById('autoCleanup').checked
            };

            const result = await ipcRenderer.invoke('save-app-settings', newSettings);
            
            if (result.success) {
                this.showStatus('设置保存成功');
                // 刷新 Chromium 状态检查
                this.checkChromiumStatus();
            } else {
                this.showStatus('设置保存失败: ' + result.error);
            }
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showStatus('保存设置失败');
        }
    }

    async resetSettings() {
        if (confirm('确定要重置所有设置为默认值吗？')) {
            try {
                const result = await ipcRenderer.invoke('reset-app-settings');
                
                if (result.success) {
                    this.showStatus('设置已重置为默认值');
                    await this.loadSettings();
                    this.checkChromiumStatus();
                } else {
                    this.showStatus('重置设置失败: ' + result.error);
                }
            } catch (error) {
                console.error('重置设置失败:', error);
                this.showStatus('重置设置失败');
            }
        }
    }

    async browseChromiumPath() {
        try {
            const result = await ipcRenderer.invoke('browse-chromium-path');
            
            if (result.success) {
                document.getElementById('chromiumPath').value = result.path;
                this.showStatus('Chromium 路径已选择');
            } else if (!result.canceled) {
                this.showStatus('选择路径失败: ' + result.error);
            }
        } catch (error) {
            console.error('浏览 Chromium 路径失败:', error);
            this.showStatus('浏览路径失败');
        }
    }

    async browseDataRoot() {
        try {
            const result = await ipcRenderer.invoke('show-root-folder-dialog');
            
            if (result.success) {
                document.getElementById('defaultUserDataRoot').value = result.path;
                this.showStatus('数据根目录已选择');
            } else if (!result.canceled) {
                this.showStatus('选择目录失败: ' + result.error);
            }
        } catch (error) {
            console.error('浏览数据根目录失败:', error);
            this.showStatus('浏览目录失败');
        }
    }

    loadSystemInfo() {
        // 加载系统版本信息
        document.getElementById('electronVersion').textContent = process.versions.electron || '--';
        document.getElementById('nodeVersion').textContent = process.versions.node || '--';
        document.getElementById('chromeVersion').textContent = process.versions.chrome || '--';
        document.getElementById('osInfo').textContent = `${process.platform} ${process.arch}`;
    }

    filterConfigs(searchTerm) {
        const items = document.querySelectorAll('.config-item');
        items.forEach(item => {
            const name = item.querySelector('.config-name').textContent;
            const isVisible = name.toLowerCase().includes(searchTerm.toLowerCase());
            item.style.display = isVisible ? 'block' : 'none';
        });
    }

    filterByStatus(status) {
        const items = document.querySelectorAll('.config-item');
        items.forEach(item => {
            const configId = item.dataset.configId;
            const isRunning = this.runningBrowsers.some(b => b.configId === configId);
            
            let shouldShow = true;
            if (status === 'running') {
                shouldShow = isRunning;
            } else if (status === 'stopped') {
                shouldShow = !isRunning;
            }
            
            item.style.display = shouldShow ? 'block' : 'none';
        });
    }

    startClock() {
        const updateTime = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString();
            const timeElement = document.getElementById('currentTime');
            if (timeElement) {
                timeElement.textContent = timeString;
            }
        };
        
        updateTime();
        setInterval(updateTime, 1000);
    }

    startMemoryMonitoring() {
        const updateMemory = () => {
            // 模拟内存使用情况（在真实应用中可以通过IPC获取实际内存信息）
            const memoryElement = document.getElementById('memoryUsage');
            if (memoryElement) {
                const usage = (Math.random() * 200 + 50).toFixed(1);
                memoryElement.textContent = `${usage}MB`;
            }
        };
        
        updateMemory();
        setInterval(updateMemory, 5000);
    }

    async startAllBrowsers() {
        const startAllBtn = document.getElementById('startAllBtn');
        if (!startAllBtn) return;

        // 检查是否有配置
        if (this.configs.length === 0) {
            this.showStatus('没有可启动的配置');
            alert('没有可启动的配置，请先创建浏览器配置');
            return;
        }

        // 禁用按钮，显示加载状态
        startAllBtn.disabled = true;
        startAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>启动中...</span>';
        
        try {
            this.showStatus('正在批量启动浏览器...');
            
            const result = await ipcRenderer.invoke('start-all-browsers');

            
            if (result.success) {
                let successCount = 0;
                let failCount = 0;
                
                result.results.forEach(r => {
                    if (r.success) {
                        successCount++;
                    } else {
                        failCount++;
                        console.warn(`配置 ${r.configId} 启动失败:`, r.error);
                    }
                });
                
                this.showStatus(`批量启动完成：成功 ${successCount} 个，失败 ${failCount} 个`);
                
                // 刷新进程列表
                await this.loadRunningBrowsers();
            } else {
                this.showStatus(`批量启动失败: ${result.error}`);
            }
        } catch (error) {
        
            console.error('批量启动浏览器失败:', error);
            this.showStatus('批量启动失败');
        } finally {
            // 恢复按钮状态
            startAllBtn.disabled = false;
            startAllBtn.innerHTML = '<i class="fas fa-play-circle"></i><span>启动全部</span>';
        }
    }

    async stopAllBrowsers() {
        const stopAllBtn = document.getElementById('stopAllBtn');
        if (!stopAllBtn) return;

        // 检查是否有运行中的浏览器
        if (this.runningBrowsers.length === 0) {
            this.showStatus('没有运行中的浏览器');
            return;
        }

        // 确认对话框
        if (!confirm(`确定要关闭所有 ${this.runningBrowsers.length} 个运行中的浏览器吗？`)) {
            return;
        }

        // 禁用按钮，显示加载状态
        stopAllBtn.disabled = true;
        stopAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>关闭中...</span>';
        
        try {
            this.showStatus('正在批量关闭浏览器...');
            
            const result = await ipcRenderer.invoke('stop-all-browsers');
            
            if (result.success) {
                let successCount = 0;
                let failCount = 0;
                
                result.results.forEach(r => {
                    if (r.success) {
                        successCount++;
                    } else {
                        failCount++;
                        console.warn(`配置 ${r.configId} 关闭失败:`, r.error);
                    }
                });
                
                this.showStatus(`批量关闭完成：成功 ${successCount} 个，失败 ${failCount} 个`);
                
                // 刷新进程列表
                await this.loadRunningBrowsers();
            } else {
                this.showStatus(`批量关闭失败: ${result.error}`);
            }
        } catch (error) {
            console.error('批量关闭浏览器失败:', error);
            this.showStatus('批量关闭失败');
        } finally {
            // 恢复按钮状态
            stopAllBtn.disabled = false;
            stopAllBtn.innerHTML = '<i class="fas fa-stop-circle"></i><span>关闭全部</span>';
        }
    }

    handleAppWillQuit() {
        console.log('应用即将退出，准备清理浏览器进程...');
        
        // 停止定期刷新
        this.stopBrowserListRefresh();
        
        // 更新状态
        this.showStatus('应用退出中，正在关闭所有浏览器...');
        
        // 尝试优雅关闭所有浏览器
        if (this.runningBrowsers.length > 0) {
            this.stopAllBrowsers().catch(error => {
                console.error('清理浏览器进程时出错:', error);
            });
        }
    }

    // 批量任务相关方法
    async showBatchTask() {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('configForm').style.display = 'none';
        document.getElementById('settingsPage').style.display = 'none';
        document.getElementById('batchTaskPage').style.display = 'flex';
        
        // 刷新运行中的浏览器列表
        await this.updateRunningBrowsersList();
        
        // 初始化任务表单
        this.initTaskForm();
        
        // 初始化窗口同步控制
        this.initWindowSyncControls();
        
        // 开始定期刷新浏览器列表
        this.startBrowserListRefresh();
    }

    hideBatchTask() {
        document.getElementById('batchTaskPage').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'block';
        
        // 停止定期刷新
        this.stopBrowserListRefresh();
    }

    async updateRunningBrowsersList() {
        await this.loadRunningBrowsers();
        
        const listContainer = document.getElementById('runningBrowsersList');
        listContainer.innerHTML = '';
        
        if (this.runningBrowsers.length === 0) {
            listContainer.innerHTML = `
                <div class="no-browsers">
                    <i class="fas fa-browser"></i>
                    <p>没有运行中的浏览器</p>
                    <p class="hint">请先启动一些浏览器配置</p>
                </div>
            `;
            return;
        }

        this.runningBrowsers.forEach(browser => {
            const item = document.createElement('div');
            item.className = 'browser-item';
            item.dataset.configId = browser.configId;
            
            const startTime = new Date(browser.startTime).toLocaleTimeString();
            
            // 检查是否是主控浏览器
            const masterSelect = document.getElementById('masterBrowser');
            const isMaster = masterSelect && masterSelect.value === browser.configId;
            
            item.innerHTML = `
                <div class="browser-info">
                    <div class="browser-name">
                        <i class="fas fa-globe"></i>
                        ${browser.configName}
                        ${isMaster ? '<span class="master-badge"><i class="fas fa-crown"></i>主控</span>' : ''}
                        ${this.syncEnabled ? '<span class="sync-indicator active"><i class="fas fa-link"></i>同步中</span>' : ''}
                    </div>
                    <div class="browser-details">
                        <span class="pid">PID: ${browser.pid}</span>
                        <span class="start-time">启动: ${startTime}</span>
                    </div>
                    <div class="debug-info">
                        <span class="debug-port">调试端口: ${browser.debugPort}</span>
                        <a href="${browser.debugUrl}" target="_blank" class="debug-link">
                            <i class="fas fa-external-link-alt"></i>
                            打开调试界面
                        </a>
                    </div>
                </div>
                <div class="browser-actions">
                    <label class="browser-checkbox">
                        <input type="checkbox" class="browser-select" value="${browser.configId}" checked>
                        <span class="checkmark"></span>
                    </label>
                </div>
            `;
            
            listContainer.appendChild(item);
        });
        
        // 更新主控浏览器选择器
        this.updateMasterBrowserSelect();
    }

    initTaskForm() {
        document.getElementById('taskName').value = '';
        document.getElementById('taskType').value = 'navigate';
        document.getElementById('targetUrl').value = '';
        document.getElementById('taskDelay').value = '2';
        document.getElementById('taskScript').value = '';
        document.getElementById('waitForLoad').checked = true;
        document.getElementById('parallelExecution').checked = false;
        
        this.updateTaskFormByType('navigate');
    }

    updateTaskFormByType(type) {
        const urlSection = document.getElementById('urlSection');
        const scriptSection = document.getElementById('scriptSection');
        
        switch (type) {
            case 'navigate':
                urlSection.style.display = 'block';
                scriptSection.style.display = 'none';
                break;
            case 'script':
                urlSection.style.display = 'none';
                scriptSection.style.display = 'block';
                break;
            case 'combined':
                urlSection.style.display = 'block';
                scriptSection.style.display = 'block';
                break;
        }
    }

    addTask() {
        const taskData = this.getTaskFormData();
        if (!this.validateTask(taskData)) {
            return;
        }
        
        this.logTask('info', `任务已添加: ${taskData.name}`);
        this.showStatus('任务添加成功', 'success');
    }

    getTaskFormData() {
        return {
            name: document.getElementById('taskName').value.trim(),
            type: document.getElementById('taskType').value,
            url: document.getElementById('targetUrl').value.trim(),
            delay: parseInt(document.getElementById('taskDelay').value) || 2,
            script: document.getElementById('taskScript').value.trim(),
            waitForLoad: document.getElementById('waitForLoad').checked,
            parallel: document.getElementById('parallelExecution').checked
        };
    }

    validateTask(taskData) {
        if (!taskData.name) {
            this.showStatus('请输入任务名称', 'error');
            return false;
        }
        
        if (taskData.type === 'navigate' || taskData.type === 'combined') {
            if (!taskData.url) {
                this.showStatus('请输入目标网址', 'error');
                return false;
            }
            
            try {
                new URL(taskData.url);
            } catch {
                this.showStatus('请输入有效的网址', 'error');
                return false;
            }
        }
        
        if (taskData.type === 'script' || taskData.type === 'combined') {
            if (!taskData.script) {
                this.showStatus('请输入JavaScript脚本', 'error');
                return false;
            }
        }
        
        return true;
    }

    async executeTask() {
        const taskData = this.getTaskFormData();
        if (!this.validateTask(taskData)) {
            return;
        }

        const selectedBrowsers = this.getSelectedBrowsers();
        if (selectedBrowsers.length === 0) {
            this.showStatus('请选择要执行任务的浏览器', 'error');
            return;
        }

        this.setTaskExecutionState(true);
        this.logTask('info', `开始执行任务: ${taskData.name}`);
        this.logTask('info', `目标浏览器数量: ${selectedBrowsers.length}`);

        try {
            if (taskData.parallel) {
                await this.executeTaskParallel(taskData, selectedBrowsers);
            } else {
                await this.executeTaskSequential(taskData, selectedBrowsers);
            }
            
            this.logTask('success', '所有任务执行完成');
            this.showStatus('任务执行完成', 'success');
        } catch (error) {
            this.logTask('error', `任务执行失败: ${error.message}`);
            this.showStatus('任务执行失败', 'error');
        } finally {
            this.setTaskExecutionState(false);
        }
    }

    getSelectedBrowsers() {
        const checkboxes = document.querySelectorAll('.browser-select:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    setTaskExecutionState(executing) {
        document.getElementById('executeTaskBtn').disabled = executing;
        document.getElementById('stopTaskBtn').disabled = !executing;
        
        if (executing) {
            document.getElementById('executeTaskBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>执行中...</span>';
        } else {
            document.getElementById('executeTaskBtn').innerHTML = '<i class="fas fa-play"></i><span>执行任务</span>';
        }
    }

    async executeTaskParallel(taskData, selectedBrowsers) {
        const promises = selectedBrowsers.map(configId => 
            this.executeTaskOnBrowser(taskData, configId)
        );
        
        await Promise.allSettled(promises);
    }

    async executeTaskSequential(taskData, selectedBrowsers) {
        for (const configId of selectedBrowsers) {
            await this.executeTaskOnBrowser(taskData, configId);
            if (taskData.delay > 0) {
                await this.sleep(taskData.delay * 1000);
            }
        }
    }

    async executeTaskOnBrowser(taskData, configId) {
        const browser = this.runningBrowsers.find(b => b.configId === configId);
        if (!browser) {
            this.logTask('error', `浏览器 ${configId} 未找到`);
            return;
        }

        this.logTask('info', `在浏览器 ${browser.configName} 中执行任务...`);

        try {
            const result = await ipcRenderer.invoke('execute-browser-task', {
                configId,
                debugPort: browser.debugPort,
                task: taskData
            });

            if (result.success) {
                this.logTask('success', `${browser.configName}: 任务执行成功`);
            } else {
                this.logTask('error', `${browser.configName}: ${result.error}`);
            }
        } catch (error) {
            this.logTask('error', `${browser.configName}: ${error.message}`);
        }
    }

    stopTask() {
        this.setTaskExecutionState(false);
        this.logTask('warning', '任务执行已停止');
        this.showStatus('任务已停止', 'warning');
    }

    clearTaskLog() {
        document.getElementById('taskLog').innerHTML = '';
    }

    logTask(type, message) {
        const logContainer = document.getElementById('taskLog');
        const timestamp = new Date().toLocaleTimeString();
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        
        let icon = '';
        switch (type) {
            case 'info':
                icon = 'fas fa-info-circle';
                break;
            case 'success':
                icon = 'fas fa-check-circle';
                break;
            case 'warning':
                icon = 'fas fa-exclamation-triangle';
                break;
            case 'error':
                icon = 'fas fa-times-circle';
                break;
        }
        
        logEntry.innerHTML = `
            <span class="log-time">${timestamp}</span>
            <i class="${icon}"></i>
            <span class="log-message">${message}</span>
        `;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 定期刷新浏览器列表
    startBrowserListRefresh() {
        // 停止现有的刷新定时器
        this.stopBrowserListRefresh();
        
        // 每5秒刷新一次浏览器列表
        this.browserListRefreshTimer = setInterval(async () => {
            const batchTaskPage = document.getElementById('batchTaskPage');
            if (batchTaskPage && batchTaskPage.style.display !== 'none') {
                try {
                    await this.updateRunningBrowsersList();
                } catch (error) {
                    console.error('定期刷新浏览器列表失败:', error);
                }
            } else {
                // 如果批量任务页面不再显示，停止刷新
                this.stopBrowserListRefresh();
            }
        }, 5000);
    }

    stopBrowserListRefresh() {
        if (this.browserListRefreshTimer) {
            clearInterval(this.browserListRefreshTimer);
            this.browserListRefreshTimer = null;
        }
    }

    // 浏览器下载相关方法
    async loadBrowserDownloadInfo() {
        try {
            // 检查浏览器安装状态
            const installStatus = await ipcRenderer.invoke('check-browser-installation');
            
            if (installStatus.installed) {
                this.showBrowserInstalled(installStatus.path);
            } else {
                // 获取下载信息
                const downloadInfo = await ipcRenderer.invoke('get-browser-download-info');
                
                if (downloadInfo.success) {
                    this.showBrowserDownloadInfo(downloadInfo);
                } else {
                    this.showBrowserError(downloadInfo.error);
                }
            }
            
        } catch (error) {
            console.error('加载浏览器下载信息失败:', error);
            this.showBrowserError(error.message);
        }
    }

    showBrowserInstalled(path) {
        const statusInfo = document.getElementById('browserStatusInfo');
        statusInfo.className = 'el-alert el-alert--success';
        statusInfo.innerHTML = `
            <div class="el-alert__content">
                <span class="el-alert__title">
                    <i class="fas fa-check-circle"></i>
                    浏览器已安装并配置
                </span>
                <p class="el-alert__description">路径: ${path}</p>
            </div>
        `;
        
        document.getElementById('browserDownloadControls').style.display = 'none';
    }

    showBrowserDownloadInfo(info) {
        const statusInfo = document.getElementById('browserStatusInfo');
        statusInfo.className = 'el-alert el-alert--warning';
        statusInfo.innerHTML = `
            <div class="el-alert__content">
                <span class="el-alert__title">
                    <i class="fas fa-exclamation-triangle"></i>
                    未检测到浏览器安装
                </span>
                <p class="el-alert__description">点击下方按钮自动下载安装</p>
            </div>
        `;
        
        // 显示下载信息
        document.getElementById('detectedPlatform').textContent = `${info.platform.platform}-${info.platform.arch}`;
        document.getElementById('latestVersion').textContent = info.latestVersion.version || '最新版';
        document.getElementById('installPath').textContent = info.defaultInstallPath;
        
        document.getElementById('browserDownloadControls').style.display = 'block';
    }

    showBrowserError(error) {
        const statusInfo = document.getElementById('browserStatusInfo');
        statusInfo.className = 'el-alert el-alert--error';
        statusInfo.innerHTML = `
            <div class="el-alert__content">
                <span class="el-alert__title">
                    <i class="fas fa-times-circle"></i>
                    检测浏览器状态失败
                </span>
                <p class="el-alert__description">${error}</p>
            </div>
        `;
        
        document.getElementById('browserDownloadControls').style.display = 'none';
    }

    async downloadBrowser() {
        try {
            const downloadBtn = document.getElementById('downloadBrowserBtn');
            const progressDiv = document.getElementById('downloadProgress');
            
            // 禁用按钮，显示进度
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>准备下载...</span>';
            progressDiv.style.display = 'block';
            
            // 开始下载
            const result = await ipcRenderer.invoke('download-install-browser');
            
            if (result.success) {
                this.showStatus('浏览器下载安装成功！', 'success');
            } else {
                this.showStatus('下载安装失败: ' + result.error, 'error');
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<i class="fas fa-download"></i><span>重试下载</span>';
                progressDiv.style.display = 'none';
            }
            
        } catch (error) {
            console.error('下载浏览器失败:', error);
            this.showStatus('下载失败: ' + error.message, 'error');
        }
    }

    async selectCustomInstallPath() {
        try {
            const result = await ipcRenderer.invoke('show-root-folder-dialog');
            
            if (result.success) {
                document.getElementById('installPath').textContent = result.path;
                this.showStatus('自定义安装路径已选择', 'success');
            }
        } catch (error) {
            this.showStatus('选择路径失败: ' + error.message, 'error');
        }
    }

    updateDownloadProgress(data) {
        const progressText = document.getElementById('progressText');
        const progressPercent = document.getElementById('progressPercent');
        const progressBarFill = document.getElementById('progressBarFill');
        const downloadedSize = document.getElementById('downloadedSize');
        const totalSize = document.getElementById('totalSize');
        
        if (progressText && progressPercent && progressBarFill) {
            progressText.textContent = '正在下载...';
            progressPercent.textContent = `${data.progress}%`;
            progressBarFill.style.width = `${data.progress}%`;
            
            const downloadedMB = (data.downloaded / 1024 / 1024).toFixed(1);
            const totalMB = (data.total / 1024 / 1024).toFixed(1);
            
            if (downloadedSize) downloadedSize.textContent = `${downloadedMB} MB`;
            if (totalSize) totalSize.textContent = `${totalMB} MB`;
        }
    }

    onBrowserInstallComplete(data) {
        const downloadBtn = document.getElementById('downloadBrowserBtn');
        const progressDiv = document.getElementById('downloadProgress');
        
        if (data.success) {
            // 更新UI显示安装成功
            this.showBrowserInstalled(data.executablePath);
            
            // 更新浏览器路径输入框
            document.getElementById('chromiumPath').value = data.executablePath;
            
            this.showStatus('浏览器安装成功，路径已自动配置！', 'success');
        } else {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fas fa-download"></i><span>重试下载</span>';
            this.showStatus('安装失败: ' + (data.error || '未知错误'), 'error');
        }
        
        progressDiv.style.display = 'none';
    }

    // 窗口同步控制方法
    initWindowSyncControls() {
        // 窗口布局控制事件
        const tileBtn = document.getElementById('tileWindowsBtn');
        const cascadeBtn = document.getElementById('cascadeWindowsBtn');
        const restoreBtn = document.getElementById('restoreWindowsBtn');
        
        if (tileBtn) tileBtn.addEventListener('click', () => this.arrangeWindows('tile'));
        if (cascadeBtn) cascadeBtn.addEventListener('click', () => this.arrangeWindows('cascade'));
        if (restoreBtn) restoreBtn.addEventListener('click', () => this.arrangeWindows('restore'));

        // 同步控制事件
        const enableSyncCheckbox = document.getElementById('enableSync');
        const syncNowBtn = document.getElementById('syncNowBtn');
        const masterSelect = document.getElementById('masterBrowser');

        if (enableSyncCheckbox) {
            enableSyncCheckbox.addEventListener('change', (e) => {
                this.toggleBrowserSync(e.target.checked);
            });
        }

        // 浏览器UI控制开关
        const enableBrowserUICheckbox = document.getElementById('enableBrowserUI');
        if (enableBrowserUICheckbox) {
            enableBrowserUICheckbox.addEventListener('change', (e) => {
                this.toggleBrowserUIMode(e.target.checked);
            });
        }

        // 同步模式选择器
        const syncModeSelect = document.getElementById('syncModeSelect');
        if (syncModeSelect) {
            syncModeSelect.addEventListener('change', (e) => {
                this.switchSyncMode(e.target.value);
            });
            
            // 加载当前同步模式
            this.loadCurrentSyncMode();
        }

        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', () => {
                this.syncNow();
            });
        }

        const debugSyncBtn = document.getElementById('debugSyncBtn');
        if (debugSyncBtn) {
            debugSyncBtn.addEventListener('click', () => {
                this.debugSync();
            });
        }

        const refreshWindowInfoBtn = document.getElementById('refreshWindowInfoBtn');
        if (refreshWindowInfoBtn) {
            refreshWindowInfoBtn.addEventListener('click', () => {
                this.refreshWindowInfo();
            });
        }

        const syncWindowSizesBtn = document.getElementById('syncWindowSizesBtn');
        if (syncWindowSizesBtn) {
            syncWindowSizesBtn.addEventListener('click', () => {
                this.syncWindowSizes();
            });
        }

        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => {
                this.clearTaskLog();
            });
        }

        if (masterSelect) {
            masterSelect.addEventListener('change', (e) => {
                this.onMasterBrowserChange(e.target.value);
            });
        }

        this.initSyncState();
    }

    // 窗口布局排列 - 应用于所有浏览器窗口
    async arrangeWindows(layoutType) {
        const layoutNames = {
            'tile': '平铺',
            'cascade': '重叠',
            'restore': '还原'
        };

        this.addTaskLog(`info`, `开始${layoutNames[layoutType]}布局所有浏览器窗口...`);

        try {
            const result = await ipcRenderer.invoke('arrange-windows', {
                configIds: [], // 不再使用选中的配置，后端会自动获取所有浏览器
                layoutType: layoutType
            });

            if (result.success) {
                this.addTaskLog('success', `所有浏览器窗口${result.message}`);
                this.showStatus(`所有浏览器窗口已${layoutNames[layoutType]}`, 'success');
                
                // 更新布局状态显示
                this.updateLayoutStatus(layoutType);
            } else {
                this.addTaskLog('error', `窗口${layoutNames[layoutType]}失败: ${result.error}`);
                this.showStatus(`窗口${layoutNames[layoutType]}失败: ${result.error}`, 'error');
            }
        } catch (error) {
            this.addTaskLog('error', `窗口${layoutNames[layoutType]}出错: ${error.message}`);
            this.showStatus(`窗口${layoutNames[layoutType]}出错: ${error.message}`, 'error');
        }
    }

    // 切换浏览器同步
    async toggleBrowserSync(enabled) {
        const syncNowBtn = document.getElementById('syncNowBtn');
        const masterSelect = document.getElementById('masterBrowser');

        if (enabled) {
            const masterConfigId = masterSelect.value;
            
            if (!masterConfigId) {
                this.showStatus('请先选择主控浏览器', 'warning');
                document.getElementById('enableSync').checked = false;
                return;
            }

            const targetConfigIds = this.getSelectedBrowsers();
            
            if (targetConfigIds.length < 2) {
                this.showStatus('至少需要2个浏览器才能启用同步', 'warning');
                document.getElementById('enableSync').checked = false;
                return;
            }

            this.addTaskLog('info', `启用浏览器同步，主控: ${this.getBrowserName(masterConfigId)}`);

            try {
                const result = await ipcRenderer.invoke('toggle-browser-sync', {
                    enabled: true,
                    masterConfigId: masterConfigId,
                    targetConfigIds: targetConfigIds
                });

                if (result.success) {
                    this.syncEnabled = true;
                    this.addTaskLog('success', result.message);
                    this.showStatus(result.message, 'success');
                    
                    if (syncNowBtn) syncNowBtn.disabled = false;
                    
                    // 更新浏览器列表显示
                    this.updateRunningBrowsersList();
                } else {
                    this.addTaskLog('error', `启用同步失败: ${result.error}`);
                    this.showStatus(`启用同步失败: ${result.error}`, 'error');
                    document.getElementById('enableSync').checked = false;
                }
            } catch (error) {
                this.addTaskLog('error', `同步功能出错: ${error.message}`);
                this.showStatus(`同步功能出错: ${error.message}`, 'error');
                document.getElementById('enableSync').checked = false;
            }
        } else {
            this.addTaskLog('info', '禁用浏览器同步');

            try {
                const result = await ipcRenderer.invoke('toggle-browser-sync', {
                    enabled: false
                });

                this.syncEnabled = false;
                if (syncNowBtn) syncNowBtn.disabled = true;
                
                this.addTaskLog('success', result.message || '浏览器同步已禁用');
                this.showStatus('浏览器同步已禁用', 'info');
                
                // 更新浏览器列表显示
                this.updateRunningBrowsersList();
            } catch (error) {
                this.addTaskLog('error', `禁用同步失败: ${error.message}`);
                this.showStatus(`禁用同步失败: ${error.message}`, 'error');
            }
        }
    }

    // 切换浏览器UI控制模式
    async toggleBrowserUIMode(enabled) {
        try {
            const result = await ipcRenderer.invoke('toggle-browser-ui-mode', { enabled });
            
            if (result.success) {
                this.addTaskLog('info', `浏览器UI控制模式: ${enabled ? '启用' : '禁用'}`);
                this.showStatus(`浏览器UI控制模式已${enabled ? '启用' : '禁用'}`, 'success');
                
                if (enabled) {
                    this.addTaskLog('info', '现在可以控制浏览器地址栏、刷新按钮、扩展等UI元素');
                } else {
                    this.addTaskLog('info', '仅同步网页内容，不控制浏览器UI');
                }
            } else {
                this.addTaskLog('error', `UI模式切换失败: ${result.error}`);
                this.showStatus(`UI模式切换失败: ${result.error}`, 'error');
                document.getElementById('enableBrowserUI').checked = !enabled;
            }
        } catch (error) {
            this.addTaskLog('error', `UI模式切换出错: ${error.message}`);
            this.showStatus(`UI模式切换出错: ${error.message}`, 'error');
            document.getElementById('enableBrowserUI').checked = !enabled;
        }
    }

    // 切换同步模式
    async switchSyncMode(mode) {
        try {
            const result = await ipcRenderer.invoke('switch-sync-mode', { mode });
            
            if (result.success) {
                const modeNames = {
                    'ultimate': '混合事件控制',
                    'native': '原生句柄控制'
                };
                
                this.addTaskLog('info', `同步模式已切换到: ${modeNames[mode]}`);
                this.showStatus(`同步模式已切换到: ${modeNames[mode]}`, 'success');
                this.updateSyncModeDescription(mode);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('切换同步模式失败:', error);
            this.showStatus('切换同步模式失败: ' + error.message, 'error');
            
            // 恢复之前的选择
            this.loadCurrentSyncMode();
        }
    }

    // 加载当前同步模式
    async loadCurrentSyncMode() {
        try {
            const result = await ipcRenderer.invoke('get-sync-mode');
            const syncModeSelect = document.getElementById('syncModeSelect');
            
            if (syncModeSelect && result.mode) {
                syncModeSelect.value = result.mode;
                this.updateSyncModeDescription(result.mode);
            }
        } catch (error) {
            console.error('加载同步模式失败:', error);
        }
    }

    // 更新同步模式描述
    updateSyncModeDescription(mode) {
        const descriptionElement = document.getElementById('syncModeDescription');
        if (descriptionElement) {
            const descriptions = {
                'ultimate': '网页内容 + 浏览器UI混合控制，适合大多数场景',
                'native': '完全基于系统句柄的原生控制，精确度更高但需要系统权限'
            };
            
            descriptionElement.textContent = descriptions[mode] || descriptions['ultimate'];
        }
    }

    // 刷新浏览器窗口信息
    async refreshWindowInfo() {
        try {
            this.addTaskLog('info', '正在刷新浏览器窗口信息...');
            
            const result = await ipcRenderer.invoke('refresh-window-info');
            
            if (result.success) {
                this.addTaskLog('success', result.message);
                this.showStatus('浏览器窗口信息已刷新', 'success');
                
                if (result.windowCount) {
                    this.addTaskLog('info', `已缓存 ${result.windowCount} 个浏览器窗口信息`);
                }
            } else {
                this.addTaskLog('error', `刷新窗口信息失败: ${result.error}`);
                this.showStatus(`刷新窗口信息失败: ${result.error}`, 'error');
            }
        } catch (error) {
            this.addTaskLog('error', `刷新窗口信息出错: ${error.message}`);
            this.showStatus(`刷新窗口信息出错: ${error.message}`, 'error');
        }
    }

    // 立即同步
    async syncNow() {
        const masterSelect = document.getElementById('masterBrowser');
        const masterConfigId = masterSelect.value;
        
        if (!masterConfigId) {
            this.showStatus('请先选择主控浏览器', 'warning');
            return;
        }

        const targetConfigIds = this.getSelectedBrowsers().filter(id => id !== masterConfigId);
        
        if (targetConfigIds.length === 0) {
            this.showStatus('没有可同步的目标浏览器', 'warning');
            return;
        }

        const targetUrl = document.getElementById('targetUrl').value;
        
        if (!targetUrl) {
            this.showStatus('请输入要同步的网址', 'warning');
            return;
        }

        this.addTaskLog('info', `立即同步到: ${targetUrl}`);

        try {
            const result = await ipcRenderer.invoke('sync-browser-action', {
                masterConfigId: masterConfigId,
                targetConfigIds: targetConfigIds,
                action: {
                    type: 'navigate',
                    url: targetUrl
                }
            });

            if (result.success) {
                this.addTaskLog('success', result.message);
                this.showStatus(result.message, 'success');
            } else {
                this.addTaskLog('error', `同步失败: ${result.error}`);
                this.showStatus(`同步失败: ${result.error}`, 'error');
            }
        } catch (error) {
            this.addTaskLog('error', `同步出错: ${error.message}`);
            this.showStatus(`同步出错: ${error.message}`, 'error');
        }
    }

    // 主控浏览器变更
    onMasterBrowserChange(configId) {
        if (configId) {
            this.addTaskLog('info', `主控浏览器已切换: ${this.getBrowserName(configId)}`);
            
            // 如果同步已启用，需要重新启动同步
            if (this.syncEnabled) {
                const enableSyncCheckbox = document.getElementById('enableSync');
                if (enableSyncCheckbox && enableSyncCheckbox.checked) {
                    this.toggleBrowserSync(false);
                    setTimeout(() => {
                        this.toggleBrowserSync(true);
                    }, 500);
                }
            }
        }
        
        // 更新浏览器列表显示
        this.updateRunningBrowsersList();
    }

    // 更新主控浏览器选择器
    updateMasterBrowserSelect() {
        const masterSelect = document.getElementById('masterBrowser');
        if (!masterSelect) return;

        const currentValue = masterSelect.value;
        masterSelect.innerHTML = '<option value="">选择主控浏览器</option>';

        this.runningBrowsers.forEach(browser => {
            const option = document.createElement('option');
            option.value = browser.configId;
            option.textContent = browser.configName;
            
            if (browser.configId === currentValue) {
                option.selected = true;
            }
            
            masterSelect.appendChild(option);
        });
    }

    // 获取选中的浏览器
    getSelectedBrowsers() {
        const checkboxes = document.querySelectorAll('.browser-select:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    // 获取浏览器名称
    getBrowserName(configId) {
        const browser = this.runningBrowsers.find(b => b.configId === configId);
        return browser ? browser.configName : configId;
    }

    // 更新布局状态显示
    updateLayoutStatus(layoutType) {
        const items = document.querySelectorAll('.browser-item');
        items.forEach(item => {
            // 移除旧的布局状态
            const oldStatus = item.querySelector('.layout-status');
            if (oldStatus) {
                oldStatus.remove();
            }
            
            // 添加新的布局状态
            const browserName = item.querySelector('.browser-name');
            if (browserName) {
                const statusSpan = document.createElement('span');
                statusSpan.className = `layout-status ${layoutType}`;
                
                const statusText = {
                    'tile': '已平铺',
                    'cascade': '已重叠',
                    'restore': '已还原'
                };
                
                statusSpan.innerHTML = `<i class="fas fa-window-restore"></i>${statusText[layoutType]}`;
                browserName.appendChild(statusSpan);
            }
        });
    }

    // 初始化同步状态
    initSyncState() {
        this.syncEnabled = false;
        const syncNowBtn = document.getElementById('syncNowBtn');
        if (syncNowBtn) {
            syncNowBtn.disabled = true;
        }
    }

    // 调试同步功能
    async debugSync() {
        this.addTaskLog('info', '🔍 开始调试同步功能...');
        
        try {
            // 获取同步状态
            const status = await ipcRenderer.invoke('get-sync-status');
            
            this.addTaskLog('info', '📊 同步状态信息:');
            this.addTaskLog('info', `  - 启用状态: ${status.enabled ? '✅ 已启用' : '❌ 未启用'}`);
            
            if (status.enabled) {
                this.addTaskLog('info', `  - 主控浏览器: ${status.masterBrowser?.configName} (端口: ${status.masterBrowser?.debugPort})`);
                this.addTaskLog('info', `  - 目标浏览器数量: ${status.targetCount}`);
                this.addTaskLog('info', `  - 连接状态: ${status.connected ? '✅ 已连接' : '❌ 未连接'}`);
                this.addTaskLog('info', `  - 脚本注入: ${status.injectedScript ? '✅ 已注入' : '❌ 未注入'}`);
                
                if (status.targetConfigIds && status.targetConfigIds.length > 0) {
                    this.addTaskLog('info', `  - 目标浏览器ID: ${status.targetConfigIds.join(', ')}`);
                }
            }
            
            if (status.error) {
                this.addTaskLog('error', `❌ 同步状态错误: ${status.error}`);
            }
            
            // 获取运行中的浏览器信息
            const runningBrowsers = await ipcRenderer.invoke('get-running-browsers');
            this.addTaskLog('info', `📋 运行中的浏览器数量: ${runningBrowsers.length}`);
            
            runningBrowsers.forEach((browser, index) => {
                this.addTaskLog('info', `  ${index + 1}. ${browser.configName} (ID: ${browser.configId}, 端口: ${browser.debugPort})`);
            });
            
            // 检查选中的浏览器
            const selectedBrowsers = this.getSelectedBrowsers();
            this.addTaskLog('info', `✅ 当前选中的浏览器: ${selectedBrowsers.length} 个`);
            this.addTaskLog('info', `  - 选中ID: ${selectedBrowsers.join(', ')}`);
            
            // 检查主控浏览器设置
            const masterSelect = document.getElementById('masterBrowser');
            const masterConfigId = masterSelect ? masterSelect.value : '';
            this.addTaskLog('info', `👑 主控浏览器设置: ${masterConfigId || '未设置'}`);
            
            // 检查同步开关状态
            const enableSync = document.getElementById('enableSync');
            const syncChecked = enableSync ? enableSync.checked : false;
            this.addTaskLog('info', `🔘 同步开关状态: ${syncChecked ? '✅ 已勾选' : '❌ 未勾选'}`);
            
            // 提供故障排除建议
            this.addTaskLog('info', '💡 故障排除建议:');
            
            if (!status.enabled) {
                this.addTaskLog('warning', '  1. 请确保已勾选"启用同步"复选框');
                this.addTaskLog('warning', '  2. 请选择主控浏览器');
                this.addTaskLog('warning', '  3. 请确保至少选中2个浏览器');
            } else if (!status.connected) {
                this.addTaskLog('warning', '  1. 主控浏览器可能已关闭，请检查');
                this.addTaskLog('warning', '  2. 调试端口可能被占用');
                this.addTaskLog('warning', '  3. 尝试重新启动同步功能');
            } else if (!status.injectedScript) {
                this.addTaskLog('warning', '  1. 事件监听器尚未注入，请等待页面加载完成');
                this.addTaskLog('warning', '  2. 尝试在主控浏览器中刷新页面');
                this.addTaskLog('warning', '  3. 检查主控浏览器的控制台是否有错误');
            } else {
                this.addTaskLog('success', '  ✅ 同步功能状态正常，可以开始测试');
                this.addTaskLog('info', '  💻 在主控浏览器中按F12打开控制台，查看详细日志');
                this.addTaskLog('info', '  🌐 尝试在主控浏览器地址栏输入网址并按回车');
                this.addTaskLog('info', '  🖱️ 或者在页面中点击链接、按钮等元素');
            }
            
        } catch (error) {
            this.addTaskLog('error', `❌ 调试同步功能失败: ${error.message}`);
        }
    }

    // 同步窗口大小
    async syncWindowSizes() {
        this.addTaskLog('info', '🖥️ 开始同步窗口大小...');
        
        try {
            const result = await ipcRenderer.invoke('sync-window-sizes');
            
            if (result.success) {
                this.addTaskLog('success', `✅ ${result.message}`);
                
                if (result.data && result.data.results) {
                    this.addTaskLog('info', '📊 同步结果详情:');
                    result.data.results.forEach((r, index) => {
                        if (r.success) {
                            this.addTaskLog('success', `  • ${r.browserName}: 同步成功`);
                        } else {
                            this.addTaskLog('error', `  • 浏览器 ${index + 1}: ${r.error}`);
                        }
                    });
                }
                
                this.addTaskLog('info', '💡 提示: 所有浏览器窗口已同步到主浏览器的大小，坐标同步现在应该更加准确！');
                this.showStatus('窗口大小同步成功', 'success');
            } else {
                this.addTaskLog('error', `❌ ${result.message}`);
                this.showStatus(`窗口大小同步失败: ${result.error}`, 'error');
            }
            
        } catch (error) {
            this.addTaskLog('error', `❌ 窗口大小同步失败: ${error.message}`);
            this.showStatus(`窗口大小同步失败: ${error.message}`, 'error');
        }
    }

    // 测试同步连接
    async testSyncConnection() {
        const masterSelect = document.getElementById('masterBrowser');
        const masterConfigId = masterSelect.value;
        
        if (!masterConfigId) {
            this.addTaskLog('warning', '请先选择主控浏览器');
            return;
        }
        
        const targetConfigIds = this.getSelectedBrowsers().filter(id => id !== masterConfigId);
        
        if (targetConfigIds.length === 0) {
            this.addTaskLog('warning', '请至少选择一个目标浏览器');
            return;
        }
        
        this.addTaskLog('info', '🔍 测试同步连接...');
        
        try {
            const result = await ipcRenderer.invoke('sync-browser-action', {
                masterConfigId: masterConfigId,
                targetConfigIds: targetConfigIds,
                action: {
                    type: 'script',
                    script: 'console.log("🎯 同步连接测试成功 - " + new Date().toLocaleTimeString())'
                }
            });
            
            if (result.success) {
                this.addTaskLog('success', `✅ 同步连接测试成功: ${result.message}`);
                this.addTaskLog('info', '💡 请在目标浏览器的控制台中查看测试消息');
            } else {
                this.addTaskLog('error', `❌ 同步连接测试失败: ${result.error}`);
            }
        } catch (error) {
            this.addTaskLog('error', `❌ 测试连接时出错: ${error.message}`);
        }
    }
}

// 确保类在全局可用
window.BrowserConfigManager = BrowserConfigManager;

// ========================== Chrome扩展管理器 ==========================

class ChromeExtensionManager {
    constructor() {
        this.recommendedExtensions = [];
        this.downloadedExtensions = [];
        this.customExtensions = [];
        this.selectedExtensions = new Set();
        this.selectedConfigs = new Set();
        this.runningBrowsers = [];
        this.selectedRunningBrowsers = new Set();
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadRecommendedExtensions();
        await this.loadDownloadedExtensions();
        await this.updateConfigSelectionList();
        await this.loadRunningBrowsers();
    }

    bindEvents() {
        // 扩展管理按钮
        document.getElementById('extensionsBtn').addEventListener('click', async () => {
            await this.showExtensionsPage();
        });

        document.getElementById('closeExtensionsBtn').addEventListener('click', () => {
            this.hideExtensionsPage();
        });

        // 选项卡切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.closest('.tab-btn').dataset.tab);
            });
        });

        // 批量操作按钮
        document.getElementById('downloadSelectedBtn').addEventListener('click', () => {
            this.downloadSelectedExtensions();
        });

        document.getElementById('installSelectedBtn').addEventListener('click', () => {
            this.installSelectedExtensions();
        });

        document.getElementById('refreshExtensionsBtn').addEventListener('click', async () => {
            await this.refreshExtensions();
        });

        // 筛选和选择
        document.getElementById('categoryFilter').addEventListener('change', (e) => {
            this.filterExtensions(e.target.value);
        });

        document.getElementById('selectAllExtensionsBtn').addEventListener('click', () => {
            this.selectAllExtensions();
        });

        document.getElementById('unselectAllExtensionsBtn').addEventListener('click', () => {
            this.unselectAllExtensions();
        });

        // 自定义扩展
        document.getElementById('addCustomExtensionBtn').addEventListener('click', () => {
            this.addCustomExtension();
        });

        // 批量安装
        document.getElementById('batchInstallBtn').addEventListener('click', () => {
            this.installSelectedExtensions();
        });

        // 安装选项卡切换
        document.querySelectorAll('.install-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchInstallTab(e.target.closest('.install-tab-btn').dataset.tab);
            });
        });

        // 安装到运行中浏览器
        document.getElementById('installToRunningBtn').addEventListener('click', () => {
            this.installToRunningBrowsers();
        });

        // 刷新运行中浏览器列表
        document.getElementById('refreshRunningBrowsersBtn').addEventListener('click', async () => {
            await this.loadRunningBrowsers();
        });

        // 清空日志
        document.getElementById('clearExtensionLogBtn').addEventListener('click', () => {
            this.clearLog();
        });

        // 监听下载进度
        ipcRenderer.on('extension-download-progress', (event, progress) => {
            this.updateDownloadProgress(progress);
        });

        ipcRenderer.on('extension-download-complete', (event, result) => {
            this.handleDownloadComplete(result);
        });
    }

    async showExtensionsPage() {
        document.getElementById('extensionsPage').style.display = 'block';
        await this.refreshExtensions();
    }

    hideExtensionsPage() {
        document.getElementById('extensionsPage').style.display = 'none';
        // 停止自动刷新
        this.stopAutoRefreshRunningBrowsers();
    }

    switchTab(tabName) {
        // 切换选项卡激活状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // 切换内容显示
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}Tab`).classList.add('active');
    }

    async loadRecommendedExtensions() {
        try {
            this.recommendedExtensions = await ipcRenderer.invoke('get-recommended-extensions');
            this.renderExtensionsList(this.recommendedExtensions);
        } catch (error) {
            this.addLog('error', `加载推荐扩展失败: ${error.message}`);
        }
    }

    async loadDownloadedExtensions() {
        try {
            this.downloadedExtensions = await ipcRenderer.invoke('get-downloaded-extensions');
            this.renderDownloadedExtensions();
            this.updateDownloadedCount();
        } catch (error) {
            this.addLog('error', `加载已下载扩展失败: ${error.message}`);
        }
    }

    renderExtensionsList(extensions) {
        const container = document.getElementById('extensionsList');
        container.innerHTML = '';

        extensions.forEach(ext => {
            const extCard = document.createElement('div');
            extCard.className = 'extension-card';
            extCard.innerHTML = `
                <div class="extension-header">
                    <input type="checkbox" class="extension-checkbox" data-id="${ext.id}" 
                           ${this.selectedExtensions.has(ext.id) ? 'checked' : ''}>
                    <div class="extension-info">
                        <h4 class="extension-name">${ext.name}</h4>
                        <span class="extension-category">${ext.category}</span>
                    </div>
                </div>
                <div class="extension-body">
                    <p class="extension-description">${ext.description}</p>
                    <div class="extension-id">ID: ${ext.id}</div>
                </div>
                <div class="extension-actions">
                    <button class="action-btn download" onclick="extensionManager.downloadSingleExtension('${ext.id}', '${ext.name}')">
                        <i class="fas fa-download"></i>
                        下载
                    </button>
                </div>
            `;

            // 绑定复选框事件
            const checkbox = extCard.querySelector('.extension-checkbox');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedExtensions.add(ext.id);
                } else {
                    this.selectedExtensions.delete(ext.id);
                }
            });

            container.appendChild(extCard);
        });
    }

    renderDownloadedExtensions() {
        const container = document.getElementById('downloadedExtensions');
        container.innerHTML = '';

        this.downloadedExtensions.forEach(ext => {
            const extCard = document.createElement('div');
            extCard.className = 'extension-card downloaded';
            extCard.innerHTML = `
                <div class="extension-header">
                    <input type="checkbox" class="extension-checkbox" data-id="${ext.extensionId}" 
                           ${this.selectedExtensions.has(ext.extensionId) ? 'checked' : ''}>
                    <div class="extension-info">
                        <h4 class="extension-name">${ext.displayName}</h4>
                        <div class="extension-meta">
                            <span class="extension-status">已下载</span>
                            ${ext.version ? `<span class="extension-version">v${ext.version}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="extension-body">
                    ${ext.description && ext.description !== '未知扩展' ? `<p class="extension-description">${ext.description}</p>` : ''}
                    <div class="extension-id">ID: ${ext.extensionId}</div>
                    <div class="extension-file">文件: ${ext.fileName}</div>
                </div>
                <div class="extension-actions">
                    <button class="action-btn install" onclick="extensionManager.installSingleExtension('${ext.extensionId}')">
                        <i class="fas fa-plus"></i>
                        安装
                    </button>
                    <button class="action-btn delete" onclick="extensionManager.deleteDownloadedExtension('${ext.extensionId}')">
                        <i class="fas fa-trash"></i>
                        删除
                    </button>
                </div>
            `;

            // 绑定复选框事件
            const checkbox = extCard.querySelector('.extension-checkbox');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedExtensions.add(ext.extensionId);
                } else {
                    this.selectedExtensions.delete(ext.extensionId);
                }
            });

            container.appendChild(extCard);
        });
    }

    async updateConfigSelectionList() {
        const container = document.getElementById('configSelectionList');
        container.innerHTML = '';

        try {
            // 通过IPC获取配置列表
            const configs = await ipcRenderer.invoke('load-configs');
            
            configs.forEach(config => {
                const configItem = document.createElement('div');
                configItem.className = 'config-checkbox-item';
                configItem.innerHTML = `
                    <label class="config-checkbox">
                        <input type="checkbox" data-config-id="${config.id}" 
                               ${this.selectedConfigs.has(config.id) ? 'checked' : ''}>
                        <span class="checkbox-mark"></span>
                        <span class="config-name">${config.name}</span>
                    </label>
                `;

                // 绑定复选框事件
                const checkbox = configItem.querySelector('input[type="checkbox"]');
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.selectedConfigs.add(config.id);
                    } else {
                        this.selectedConfigs.delete(config.id);
                    }
                    this.updateConfigCount();
                });

                container.appendChild(configItem);
            });
            
            this.updateConfigCount();
            this.addLog('info', `📋 已加载 ${configs.length} 个浏览器配置`);
        } catch (error) {
            this.addLog('error', `加载配置列表失败: ${error.message}`);
        }
    }

    updateConfigCount() {
        const totalConfigs = document.querySelectorAll('#configSelectionList .config-checkbox-item').length;
        const selectedConfigs = this.selectedConfigs.size;
        
        // 更新计数显示
        let countElement = document.querySelector('.config-count');
        if (!countElement) {
            countElement = document.createElement('div');
            countElement.className = 'config-count';
            countElement.style.cssText = `
                margin-top: 8px;
                font-size: 12px;
                color: #6c757d;
                text-align: center;
                padding: 8px;
                background: #f8f9fa;
                border-radius: 4px;
            `;
            document.getElementById('configSelectionList').parentNode.appendChild(countElement);
        }
        
        countElement.textContent = `已选择 ${selectedConfigs} / ${totalConfigs} 个配置`;
    }

    updateDownloadedCount() {
        document.getElementById('downloadedCount').textContent = this.downloadedExtensions.length;
    }

    filterExtensions(category) {
        const filtered = category 
            ? this.recommendedExtensions.filter(ext => ext.category === category)
            : this.recommendedExtensions;
        this.renderExtensionsList(filtered);
    }

    selectAllExtensions() {
        this.recommendedExtensions.forEach(ext => {
            this.selectedExtensions.add(ext.id);
        });
        this.renderExtensionsList(this.recommendedExtensions);
    }

    unselectAllExtensions() {
        this.selectedExtensions.clear();
        this.renderExtensionsList(this.recommendedExtensions);
    }

    async downloadSelectedExtensions() {
        if (this.selectedExtensions.size === 0) {
            this.addLog('warning', '请先选择要下载的扩展');
            return;
        }

        const extensionsToDownload = this.recommendedExtensions.filter(ext => 
            this.selectedExtensions.has(ext.id)
        );

        this.addLog('info', `开始下载 ${extensionsToDownload.length} 个扩展...`);
        this.showProgress('正在下载扩展...');

        try {
            const result = await ipcRenderer.invoke('batch-download-extensions', extensionsToDownload);
            this.handleDownloadComplete(result);
        } catch (error) {
            this.addLog('error', `批量下载失败: ${error.message}`);
            this.hideProgress();
        }
    }

    async downloadSingleExtension(extensionId, extensionName) {
        this.addLog('info', `开始下载扩展: ${extensionName}`);
        this.showProgress('正在下载扩展...');

        try {
            const result = await ipcRenderer.invoke('batch-download-extensions', [{
                id: extensionId,
                name: extensionName
            }]);
            this.handleDownloadComplete(result);
        } catch (error) {
            this.addLog('error', `下载扩展失败: ${error.message}`);
            this.hideProgress();
        }
    }

    async installSelectedExtensions() {
        if (this.selectedExtensions.size === 0) {
            this.addLog('warning', '请先选择要安装的扩展');
            return;
        }

        if (this.selectedConfigs.size === 0) {
            this.addLog('warning', '请先选择目标配置');
            return;
        }

        const extensionIds = Array.from(this.selectedExtensions);
        const configIds = Array.from(this.selectedConfigs);

        this.addLog('info', `开始为 ${configIds.length} 个配置安装 ${extensionIds.length} 个扩展...`);
        this.showProgress('正在安装扩展...');

        try {
            const result = await ipcRenderer.invoke('batch-install-extensions', {
                configIds: configIds,
                extensionIds: extensionIds
            });

            this.hideProgress();

            if (result.success) {
                this.addLog('success', `✅ 批量安装完成: 成功 ${result.summary.successful}，失败 ${result.summary.failed}`);
            } else {
                this.addLog('error', `❌ 批量安装失败: ${result.error}`);
            }

            // 显示详细结果
            result.results.forEach(res => {
                if (res.success) {
                    this.addLog('success', `✅ ${res.configName}: 安装成功`);
                } else {
                    this.addLog('error', `❌ ${res.configName}: ${res.error}`);
                }
            });

        } catch (error) {
            this.addLog('error', `安装扩展失败: ${error.message}`);
            this.hideProgress();
        }
    }

    async installSingleExtension(extensionId) {
        if (this.selectedConfigs.size === 0) {
            this.addLog('warning', '请先选择目标配置');
            return;
        }

        const configIds = Array.from(this.selectedConfigs);

        this.addLog('info', `开始为 ${configIds.length} 个配置安装扩展 ${extensionId}...`);

        try {
            const result = await ipcRenderer.invoke('batch-install-extensions', {
                configIds: configIds,
                extensionIds: [extensionId]
            });

            if (result.success) {
                this.addLog('success', `✅ 扩展安装完成`);
            } else {
                this.addLog('error', `❌ 扩展安装失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `安装扩展失败: ${error.message}`);
        }
    }

    addCustomExtension() {
        const idInput = document.getElementById('customExtensionId');
        const nameInput = document.getElementById('customExtensionName');

        const id = idInput.value.trim();
        const name = nameInput.value.trim();

        if (!id) {
            this.addLog('warning', '请输入扩展ID');
            return;
        }

        const customExt = {
            id: id,
            name: name || id,
            description: '自定义扩展',
            category: '自定义'
        };

        this.customExtensions.push(customExt);
        this.renderCustomExtensions();

        // 清空输入框
        idInput.value = '';
        nameInput.value = '';

        this.addLog('success', `✅ 已添加自定义扩展: ${customExt.name}`);
    }

    renderCustomExtensions() {
        const container = document.getElementById('customExtensionsList');
        container.innerHTML = '';

        this.customExtensions.forEach((ext, index) => {
            const extCard = document.createElement('div');
            extCard.className = 'extension-card custom';
            extCard.innerHTML = `
                <div class="extension-header">
                    <input type="checkbox" class="extension-checkbox" data-id="${ext.id}" 
                           ${this.selectedExtensions.has(ext.id) ? 'checked' : ''}>
                    <div class="extension-info">
                        <h4 class="extension-name">${ext.name}</h4>
                        <span class="extension-category">${ext.category}</span>
                    </div>
                </div>
                <div class="extension-body">
                    <div class="extension-id">ID: ${ext.id}</div>
                </div>
                <div class="extension-actions">
                    <button class="action-btn download" onclick="extensionManager.downloadSingleExtension('${ext.id}', '${ext.name}')">
                        <i class="fas fa-download"></i>
                        下载
                    </button>
                    <button class="action-btn remove" onclick="extensionManager.removeCustomExtension(${index})">
                        <i class="fas fa-trash"></i>
                        删除
                    </button>
                </div>
            `;

            // 绑定复选框事件
            const checkbox = extCard.querySelector('.extension-checkbox');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedExtensions.add(ext.id);
                } else {
                    this.selectedExtensions.delete(ext.id);
                }
            });

            container.appendChild(extCard);
        });
    }

    removeCustomExtension(index) {
        const ext = this.customExtensions[index];
        this.customExtensions.splice(index, 1);
        this.selectedExtensions.delete(ext.id);
        this.renderCustomExtensions();
        this.addLog('info', `已删除自定义扩展: ${ext.name}`);
    }

    async refreshExtensions() {
        this.addLog('info', '正在刷新扩展列表...');
        await this.loadRecommendedExtensions();
        await this.loadDownloadedExtensions();
        await this.updateConfigSelectionList();
        this.addLog('success', '✅ 扩展列表刷新完成');
    }

    updateDownloadProgress(progress) {
        this.showProgress(`正在下载: ${progress.currentExtension}`);
        
        const progressBar = document.getElementById('progressBarFill');
        const progressText = document.getElementById('progressText');
        const progressPercent = document.getElementById('progressPercent');
        const progressDetails = document.getElementById('progressDetails');

        if (progressBar) progressBar.style.width = `${progress.progress}%`;
        if (progressText) progressText.textContent = `下载进度: ${progress.current}/${progress.total}`;
        if (progressPercent) progressPercent.textContent = `${progress.progress}%`;
        if (progressDetails) progressDetails.textContent = `当前: ${progress.currentExtension}`;
    }

    handleDownloadComplete(result) {
        this.hideProgress();

        if (result.success) {
            this.addLog('success', `✅ 下载完成: 成功 ${result.summary.successful}，失败 ${result.summary.failed}`);
        } else {
            this.addLog('error', `❌ 下载失败`);
        }

        // 显示详细结果
        result.results.forEach(res => {
            if (res.success) {
                const extensionName = res.extensionName || res.fileName || res.extensionId;
                this.addLog('success', `✅ ${extensionName}: 下载成功`);
            } else {
                this.addLog('error', `❌ ${res.extensionId}: ${res.error}`);
            }
        });

        // 刷新已下载列表
        this.loadDownloadedExtensions();
    }

    showProgress(title) {
        const progressPanel = document.getElementById('extensionProgress');
        const progressTitle = document.getElementById('progressTitle');
        
        if (progressPanel) progressPanel.style.display = 'block';
        if (progressTitle) progressTitle.textContent = title;
    }

    hideProgress() {
        const progressPanel = document.getElementById('extensionProgress');
        if (progressPanel) progressPanel.style.display = 'none';
    }

    addLog(type, message) {
        const logContainer = document.getElementById('extensionLog');
        if (!logContainer) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `
            <span class="log-time">${timestamp}</span>
            <span class="log-message">${message}</span>
        `;

        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    clearLog() {
        const logContainer = document.getElementById('extensionLog');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

    // 切换安装选项卡
    switchInstallTab(tabName) {
        // 切换选项卡激活状态
        document.querySelectorAll('.install-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // 切换内容显示
        document.querySelectorAll('.install-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}InstallTab`).classList.add('active');

        // 处理运行中浏览器选项卡的自动刷新
        if (tabName === 'running') {
            // 切换到运行中浏览器标签，启动自动刷新
            this.loadRunningBrowsers();
            this.startAutoRefreshRunningBrowsers();
        } else {
            // 切换到其他标签，停止自动刷新
            this.stopAutoRefreshRunningBrowsers();
        }
    }

    // 加载运行中的浏览器列表
    async loadRunningBrowsers() {
        try {
            this.runningBrowsers = await ipcRenderer.invoke('get-running-browsers-for-extensions');
            this.renderRunningBrowsers();
            this.addLog('info', `🔄 已刷新运行中浏览器列表: ${this.runningBrowsers.length} 个`);
        } catch (error) {
            this.addLog('error', `加载运行中浏览器失败: ${error.message}`);
        }
    }

    // 开始自动刷新在线浏览器列表
    startAutoRefreshRunningBrowsers() {
        // 清除现有的定时器
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        
        // 每5秒自动刷新一次
        this.refreshTimer = setInterval(async () => {
            // 只有在运行中浏览器标签页激活时才刷新
            const runningTab = document.querySelector('.install-tab-btn[data-tab="runningBrowsersTab"]');
            if (runningTab && runningTab.classList.contains('active')) {
                await this.loadRunningBrowsers();
            }
        }, 5000);
        
        console.log('🔄 已启动自动刷新在线浏览器列表 (每5秒)');
    }

    // 停止自动刷新
    stopAutoRefreshRunningBrowsers() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
            console.log('⏹️ 已停止自动刷新在线浏览器列表');
        }
    }

    // 渲染运行中的浏览器列表
    renderRunningBrowsers() {
        const container = document.getElementById('runningBrowsersList');
        container.innerHTML = '';

        if (this.runningBrowsers.length === 0) {
            container.innerHTML = `
                <div class="no-running-browsers">
                    <div class="no-browsers-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="no-browsers-text">
                        <h4>暂无运行中的浏览器</h4>
                        <p>请先启动一些浏览器配置，然后刷新列表</p>
                    </div>
                </div>
            `;
            return;
        }

        this.runningBrowsers.forEach(browser => {
            const browserCard = document.createElement('div');
            browserCard.className = 'running-browser-card';
            
            const startTime = new Date(browser.startTime);
            const duration = this.getTimeDuration(startTime);
            
            browserCard.innerHTML = `
                <div class="browser-header">
                    <input type="checkbox" class="browser-checkbox" data-config-id="${browser.configId}" 
                           ${this.selectedRunningBrowsers.has(browser.configId) ? 'checked' : ''}>
                    <div class="browser-info">
                        <h4 class="browser-name">${browser.configName}</h4>
                        <div class="browser-status">
                            <span class="status-indicator running"></span>
                            运行中
                        </div>
                    </div>
                    <div class="browser-actions">
                        <span class="action-label">PID: ${browser.pid}</span>
                    </div>
                </div>
                <div class="browser-body">
                    <div class="browser-details">
                        <div class="detail-item">
                            <i class="fas fa-plug"></i>
                            调试端口: ${browser.debugPort}
                        </div>
                        <div class="detail-item">
                            <i class="fas fa-clock"></i>
                            运行时长: ${duration}
                        </div>
                        <div class="detail-item">
                            <i class="fas fa-calendar"></i>
                            启动时间: ${startTime.toLocaleString()}
                        </div>
                    </div>
                </div>
            `;

            // 绑定复选框事件
            const checkbox = browserCard.querySelector('.browser-checkbox');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedRunningBrowsers.add(browser.configId);
                } else {
                    this.selectedRunningBrowsers.delete(browser.configId);
                }
            });

            container.appendChild(browserCard);
        });
    }

    // 计算时间间隔
    getTimeDuration(startTime) {
        const now = new Date();
        const diff = now - startTime;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}天 ${hours % 24}小时`;
        } else if (hours > 0) {
            return `${hours}小时 ${minutes % 60}分钟`;
        } else {
            return `${minutes}分钟`;
        }
    }

    // 安装扩展到运行中的浏览器
    async installToRunningBrowsers() {
        if (this.selectedExtensions.size === 0) {
            this.addLog('warning', '请先选择要安装的扩展');
            return;
        }

        if (this.selectedRunningBrowsers.size === 0) {
            this.addLog('warning', '请先选择目标浏览器');
            return;
        }

        const extensionIds = Array.from(this.selectedExtensions);
        const browserConfigIds = Array.from(this.selectedRunningBrowsers);

        this.addLog('info', `🚀 开始为 ${browserConfigIds.length} 个运行中浏览器安装 ${extensionIds.length} 个扩展...`);
        this.showProgress('正在安装扩展到运行中浏览器...');

        try {
            const result = await ipcRenderer.invoke('install-extensions-to-running-browsers', {
                browserConfigIds: browserConfigIds,
                extensionIds: extensionIds
            });

            this.hideProgress();

            if (result.success) {
                this.addLog('success', `✅ 动态安装完成: 成功 ${result.summary.successful}，失败 ${result.summary.failed}`);
            } else {
                this.addLog('error', `❌ 动态安装失败`);
            }

            // 显示详细结果
            result.results.forEach(res => {
                if (res.success) {
                    this.addLog('success', `✅ ${res.configName}: 安装成功 (${res.summary.successful}/${res.summary.total})`);
                    
                    // 显示每个扩展的安装结果
                    if (res.installResults) {
                        res.installResults.forEach(extResult => {
                            if (extResult.success) {
                                this.addLog('info', `  📦 ${extResult.extensionId}: ${extResult.method}`);
                            } else {
                                this.addLog('warning', `  ❌ ${extResult.extensionId}: ${extResult.error}`);
                            }
                        });
                    }
                } else {
                    this.addLog('error', `❌ ${res.configName}: ${res.error}`);
                }
            });

        } catch (error) {
            this.addLog('error', `安装扩展到运行中浏览器失败: ${error.message}`);
            this.hideProgress();
        }
    }

    async deleteDownloadedExtension(extensionId) {
        // 获取扩展信息用于显示
        const extension = this.downloadedExtensions.find(ext => ext.extensionId === extensionId);
        const extensionName = extension ? extension.displayName : extensionId;

        // 确认删除
        if (!confirm(`确定要删除扩展 "${extensionName}" 吗？\n\n此操作将删除已下载的CRX文件，无法撤销。`)) {
            return;
        }

        this.addLog('info', `开始删除扩展: ${extensionName}`);

        try {
            const result = await ipcRenderer.invoke('delete-extension', extensionId);

            if (result.success) {
                this.addLog('success', `✅ 扩展删除成功: ${extensionName}`);
                
                // 从已下载列表中移除
                this.downloadedExtensions = this.downloadedExtensions.filter(
                    ext => ext.extensionId !== extensionId
                );
                
                // 从选中列表中移除
                this.selectedExtensions.delete(extensionId);
                
                // 重新渲染已下载扩展列表
                this.renderDownloadedExtensions();
                
                // 更新批量按钮状态
                this.updateBatchButtons();
            } else {
                this.addLog('error', `❌ 扩展删除失败: ${result.error}`);
            }
        } catch (error) {
            this.addLog('error', `删除扩展失败: ${error.message}`);
        }
    }
}

// 创建全局扩展管理器实例
window.extensionManager = new ChromeExtensionManager();
