const { ipcRenderer } = require('electron');
const { v4: uuidv4 } = require('uuid');

class BrowserConfigManager {
    constructor() {
        this.configs = [];
        this.currentConfig = null;
        this.runningBrowsers = [];
        this.init();
    }

    async init() {
        await this.loadConfigs();
        await this.loadRunningBrowsers();
        this.bindEvents();
        this.checkChromiumStatus();
        this.updateUI();
        
        // 监听进程状态更新
        ipcRenderer.on('browser-process-updated', () => {
            this.loadRunningBrowsers();
        });
    }

    async loadConfigs() {
        try {
            this.configs = await ipcRenderer.invoke('load-configs');
            this.updateConfigList();
            this.updateConfigCount();
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
        document.getElementById('startAllBtn')?.addEventListener('click', () => {
            this.startAllBrowsers();
        });

        document.getElementById('stopAllBtn')?.addEventListener('click', () => {
            this.stopAllBrowsers();
        });

        // 监听应用退出事件
        ipcRenderer.on('app-will-quit', () => {
            this.handleAppWillQuit();
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
        const proxyInfo = config.proxyServer ? '🔒 代理' : '直连';
        
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
        document.getElementById('userDataRoot').value = config.userDataRoot || '';
        
        // 更新路径预览
        setTimeout(() => this.updatePathPreview(config.randomFolder), 100);
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
        
        if (!formData.name.trim()) {
            this.showStatus('请输入配置名称', 'error');
            return;
        }

        if (this.currentConfig) {
            const index = this.configs.findIndex(c => c.id === this.currentConfig.id);
            if (index !== -1) {
                this.configs[index] = { ...this.currentConfig, ...formData };
            }
        } else {
            const newConfig = {
                id: uuidv4(),
                ...formData,
                createdAt: new Date().toISOString()
            };
            this.configs.push(newConfig);
        }

        this.saveConfigs();
        this.updateConfigList();
        this.updateConfigCount();
        this.hideConfigForm();
    }

    async getFormData() {
        // 如果是新配置，生成随机文件夹名
        let randomFolder = this.currentConfig?.randomFolder;
        if (!randomFolder) {
            randomFolder = await ipcRenderer.invoke('generate-random-folder');
        }
        
        return {
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
            userDataRoot: document.getElementById('userDataRoot').value,
            randomFolder: randomFolder
        };
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

    previewConfig() {
        const formData = this.getFormData();
        if (!formData) return;

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
代理服务器: ${formData.proxyServer || '无'}
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
            
        } catch (error) {
            console.error('加载设置失败:', error);
            this.updateStatus('加载设置失败');
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
                this.updateStatus('设置保存成功');
                // 刷新 Chromium 状态检查
                this.checkChromiumStatus();
            } else {
                this.updateStatus('设置保存失败: ' + result.error);
            }
        } catch (error) {
            console.error('保存设置失败:', error);
            this.updateStatus('保存设置失败');
        }
    }

    async resetSettings() {
        if (confirm('确定要重置所有设置为默认值吗？')) {
            try {
                const result = await ipcRenderer.invoke('reset-app-settings');
                
                if (result.success) {
                    this.updateStatus('设置已重置为默认值');
                    await this.loadSettings();
                    this.checkChromiumStatus();
                } else {
                    this.updateStatus('重置设置失败: ' + result.error);
                }
            } catch (error) {
                console.error('重置设置失败:', error);
                this.updateStatus('重置设置失败');
            }
        }
    }

    async browseChromiumPath() {
        try {
            const result = await ipcRenderer.invoke('browse-chromium-path');
            
            if (result.success) {
                document.getElementById('chromiumPath').value = result.path;
                this.updateStatus('Chromium 路径已选择');
            } else if (!result.canceled) {
                this.updateStatus('选择路径失败: ' + result.error);
            }
        } catch (error) {
            console.error('浏览 Chromium 路径失败:', error);
            this.updateStatus('浏览路径失败');
        }
    }

    async browseDataRoot() {
        try {
            const result = await ipcRenderer.invoke('show-root-folder-dialog');
            
            if (result.success) {
                document.getElementById('defaultUserDataRoot').value = result.path;
                this.updateStatus('数据根目录已选择');
            } else if (!result.canceled) {
                this.updateStatus('选择目录失败: ' + result.error);
            }
        } catch (error) {
            console.error('浏览数据根目录失败:', error);
            this.updateStatus('浏览目录失败');
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
        console.log('=== 启动全部浏览器 ===');
        const startAllBtn = document.getElementById('startAllBtn');
        if (!startAllBtn) return;

        console.log('当前配置数量:', this.configs.length);
        console.log('配置列表:', this.configs);

        // 检查是否有配置
        if (this.configs.length === 0) {
            this.updateStatus('没有可启动的配置');
            console.warn('没有找到任何配置');
            return;
        }

        // 禁用按钮，显示加载状态
        startAllBtn.disabled = true;
        startAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>启动中...</span>';
        
        try {
            this.updateStatus('正在批量启动浏览器...');
            console.log('开始调用 IPC: start-all-browsers');
            
            const result = await ipcRenderer.invoke('start-all-browsers');
            console.log('IPC调用结果:', result);
            
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
                
                this.updateStatus(`批量启动完成：成功 ${successCount} 个，失败 ${failCount} 个`);
                
                // 刷新进程列表
                await this.refreshRunningProcesses();
            } else {
                this.updateStatus(`批量启动失败: ${result.error}`);
            }
        } catch (error) {
            console.error('批量启动浏览器失败:', error);
            this.updateStatus('批量启动失败');
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
            this.updateStatus('没有运行中的浏览器');
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
            this.updateStatus('正在批量关闭浏览器...');
            
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
                
                this.updateStatus(`批量关闭完成：成功 ${successCount} 个，失败 ${failCount} 个`);
                
                // 刷新进程列表
                await this.refreshRunningProcesses();
            } else {
                this.updateStatus(`批量关闭失败: ${result.error}`);
            }
        } catch (error) {
            console.error('批量关闭浏览器失败:', error);
            this.updateStatus('批量关闭失败');
        } finally {
            // 恢复按钮状态
            stopAllBtn.disabled = false;
            stopAllBtn.innerHTML = '<i class="fas fa-stop-circle"></i><span>关闭全部</span>';
        }
    }

    handleAppWillQuit() {
        console.log('应用即将退出，准备清理浏览器进程...');
        
        // 更新状态
        this.updateStatus('应用退出中，正在关闭所有浏览器...');
        
        // 尝试优雅关闭所有浏览器
        if (this.runningBrowsers.length > 0) {
            this.stopAllBrowsers().catch(error => {
                console.error('清理浏览器进程时出错:', error);
            });
        }
    }
}

// 确保类在全局可用
window.BrowserConfigManager = BrowserConfigManager;
