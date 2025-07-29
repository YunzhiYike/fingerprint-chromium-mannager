const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);

class ChromeExtensionManager {
  constructor(userDataDir = null) {
    // 使用传入的用户数据目录，避免Windows打包后的asar路径问题
    const baseDir = userDataDir || __dirname;
    this.extensionsDir = path.join(baseDir, 'chrome-extensions');
    this.initializeExtensionsDir();
  }

  // 初始化扩展目录
  async initializeExtensionsDir() {
    try {
      await fs.mkdir(this.extensionsDir, { recursive: true });
      console.log(`📁 扩展目录已创建: ${this.extensionsDir}`);
      console.log(`🔍 扩展目录平台检查: ${process.platform === 'win32' ? 'Windows' : 'Unix-like'}`);
      console.log(`📂 目录路径类型: ${this.extensionsDir.includes('app.asar') ? '❌ asar包内(错误)' : '✅ 用户数据目录(正确)'}`);
      console.log(`🗂️ 路径格式: ${process.platform === 'win32' ? 'Windows (反斜杠)' : 'Unix (正斜杠)'}`);
      
      // 验证目录权限
      try {
        await fs.access(this.extensionsDir, fs.constants.W_OK);
        console.log(`✅ 扩展目录可写权限验证通过`);
      } catch (permError) {
        console.warn(`⚠️ 扩展目录可能没有写权限: ${permError.message}`);
      }
    } catch (error) {
      console.error('❌ 创建扩展目录失败:', error.message);
      throw error;
    }
  }

  // 从CRX文件中提取ZIP数据
  async extractZipFromCrx(crxPath) {
    try {
      const crxData = await fs.readFile(crxPath);
      
      // 检查CRX魔数 "Cr24"
      const magic = crxData.toString('ascii', 0, 4);
      if (magic !== 'Cr24') {
        throw new Error('不是有效的CRX文件格式');
      }
      
      // 读取版本号（4字节）
      const version = crxData.readUInt32LE(4);
      console.log(`🔍 CRX版本: ${version}`);
      
      let headerSize = 16; // 默认头部大小
      
      if (version === 2) {
        // CRX2格式
        const publicKeyLength = crxData.readUInt32LE(8);
        const signatureLength = crxData.readUInt32LE(12);
        headerSize = 16 + publicKeyLength + signatureLength;
        
        console.log(`📋 CRX2格式 - 公钥长度: ${publicKeyLength}, 签名长度: ${signatureLength}`);
        
      } else if (version === 3) {
        // CRX3格式
        const headerLength = crxData.readUInt32LE(8);
        headerSize = 12 + headerLength;
        
        console.log(`📋 CRX3格式 - 头部长度: ${headerLength}`);
        
      } else {
        throw new Error(`不支持的CRX版本: ${version}`);
      }
      
      // 提取ZIP数据（跳过CRX头部）
      const zipData = crxData.slice(headerSize);
      
      // 验证ZIP魔数
      const zipMagic = zipData.toString('hex', 0, 4);
      if (zipMagic !== '504b0304' && zipMagic !== '504b0506') {
        console.warn(`⚠️ ZIP魔数不匹配: ${zipMagic}, 尝试继续处理...`);
      }
      
      console.log(`✅ 成功提取ZIP数据: ${zipData.length} 字节`);
      return zipData;
      
    } catch (error) {
      console.error(`❌ 解析CRX文件失败:`, error.message);
      throw error;
    }
  }

  // 从Chrome Web Store下载扩展
  async downloadExtension(extensionId, extensionName = null) {
    try {
      console.log(`🔽 开始下载扩展: ${extensionId}`);
      
      // Chrome Web Store下载链接
      const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=91.0.4472.124&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc`;
      
      // 始终使用扩展ID作为文件名，确保与安装时一致
      const filename = `${extensionId}.crx`;
      const filePath = path.join(this.extensionsDir, filename);
      
      await this.downloadFile(downloadUrl, filePath);
      
      console.log(`✅ 扩展下载完成: ${filename} (${extensionName || extensionId})`);
      return { 
        success: true, 
        filename, 
        path: filePath, 
        extensionId, 
        extensionName: extensionName || extensionId 
      };
      
    } catch (error) {
      console.error(`❌ 下载扩展失败 ${extensionId}:`, error.message);
      return { success: false, extensionId, error: error.message };
    }
  }

  // 下载文件（支持重定向）
  async downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          return this.downloadFile(response.headers.location, filePath)
            .then(resolve)
            .catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`));
          return;
        }
        
        const fileStream = require('fs').createWriteStream(filePath);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        
        fileStream.on('error', (error) => {
          // 🗑️ 文件删除日志
          console.warn(`🗑️ [文件删除] 清理部分下载的文件: ${filePath}`);
          console.warn(`🔍 [删除原因] 下载过程中发生错误: ${error.message}`);
          console.warn(`📚 [调用栈] ${new Error().stack}`);
          
          require('fs').unlink(filePath, () => {}); // 清理部分下载的文件
          reject(error);
        });
      });
      
      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.abort();
        reject(new Error('下载超时'));
      });
    });
  }

  // 批量下载扩展
  async batchDownloadExtensions(extensionList, onProgress = null) {
    console.log(`🚀 开始批量下载 ${extensionList.length} 个扩展...`);
    
    const results = [];
    let successful = 0;
    let failed = 0;
    
    for (let i = 0; i < extensionList.length; i++) {
      const extension = extensionList[i];
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: extensionList.length,
          currentExtension: extension
        });
      }
      
      const result = await this.downloadExtension(extension.id, extension.name);
      results.push(result);
      
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }
    
    console.log(`📊 批量下载完成: 成功 ${successful}，失败 ${failed}`);
    
    return {
      success: failed === 0,
      results: results,
      summary: { total: extensionList.length, successful, failed }
    };
  }

  // 为浏览器配置安装扩展
  async installExtensionsToConfig(configId, userDataDir, extensionIds = [], forceReinstall = false) {
    try {
      const extensionsPath = path.join(userDataDir, 'Default', 'Extensions');
      await fs.mkdir(extensionsPath, { recursive: true });
      
      console.log(`🔧 为配置 ${configId} 安装扩展 (强制重装: ${forceReinstall})...`);
      
      const installResults = [];
      
      for (const extensionId of extensionIds) {
        const crxPath = path.join(this.extensionsDir, `${extensionId}.crx`);
        
        try {
          // 检查CRX文件是否存在
          await fs.access(crxPath);
          
          // 解压并安装扩展（传递强制重装参数）
          const result = await this.installSingleExtension(crxPath, extensionsPath, extensionId, forceReinstall);
          installResults.push(result);
          
        } catch (error) {
          console.error(`❌ 安装扩展失败 ${extensionId}:`, error.message);
          installResults.push({
            success: false,
            extensionId,
            error: error.message
          });
        }
      }
      
      return {
        success: installResults.every(r => r.success),
        results: installResults
      };
      
    } catch (error) {
      console.error(`❌ 扩展安装失败:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // 安装单个扩展 (Chrome标准目录结构)
  async installSingleExtension(crxPath, extensionsPath, extensionId, forceReinstall = false) {
    try {
      // Chrome标准扩展目录结构: Extensions/extensionId/version/
      const extensionBaseDir = path.join(extensionsPath, extensionId);
      
      // 🔍 检查扩展是否已存在且完整
      let extensionExists = false;
      try {
        await fs.access(extensionBaseDir);
        
        // 检查是否有版本目录
        const versionDirs = await fs.readdir(extensionBaseDir);
        const validVersions = [];
        
        for (const versionDir of versionDirs) {
          const versionPath = path.join(extensionBaseDir, versionDir);
          const manifestPath = path.join(versionPath, 'manifest.json');
          
          try {
            await fs.access(manifestPath);
            validVersions.push(versionDir);
          } catch (error) {
            // manifest.json 不存在，版本目录无效
          }
        }
        
        if (validVersions.length > 0) {
          extensionExists = true;
          console.log(`✅ 扩展 ${extensionId} 已存在，版本: ${validVersions.join(', ')}`);
          
          if (!forceReinstall) {
            console.log(`📦 跳过重复安装，扩展已存在: ${extensionBaseDir}`);
            return { 
              success: true, 
              extensionId, 
              path: path.join(extensionBaseDir, validVersions[0]), 
              version: validVersions[0],
              skipped: true,
              reason: '扩展已存在且完整'
            };
          } else {
            // 🗑️ 扩展目录删除日志
            console.warn(`🗑️ [扩展删除] 强制重新安装，删除扩展目录: ${extensionBaseDir}`);
            console.warn(`🔍 [删除原因] 用户选择强制重装扩展 (forceReinstall=true)`);
            console.warn(`📚 [调用栈] ${new Error().stack}`);
            console.warn(`⚠️ [影响范围] 扩展ID=${extensionId} 的所有版本将被删除`);
            
            await fs.rm(extensionBaseDir, { recursive: true, force: true });
            extensionExists = false;
            
            console.warn(`✅ [删除完成] 扩展目录已删除: ${extensionBaseDir}`);
          }
        } else {
          // 🗑️ 扩展目录删除日志
          console.warn(`🗑️ [扩展删除] 扩展目录存在但无有效版本，删除: ${extensionBaseDir}`);
          console.warn(`🔍 [删除原因] 扩展目录结构损坏或无有效manifest.json文件`);
          console.warn(`📚 [调用栈] ${new Error().stack}`);
          console.warn(`⚠️ [影响范围] 扩展ID=${extensionId} 的损坏目录将被删除`);
          
          await fs.rm(extensionBaseDir, { recursive: true, force: true });
          
          console.warn(`✅ [删除完成] 损坏的扩展目录已删除: ${extensionBaseDir}`);
        }
      } catch (error) {
        // 目录不存在，正常继续安装
        console.log(`📁 扩展目录不存在，准备新安装: ${extensionBaseDir}`);
      }
      
      // 解析CRX文件并提取ZIP内容
      const zipData = await this.extractZipFromCrx(crxPath);
      
      // 将ZIP数据写入临时文件
      const tempZipPath = path.join(this.extensionsDir, `temp_${extensionId}.zip`);
      await fs.writeFile(tempZipPath, zipData);
      
      // 临时解压到temp目录获取manifest版本信息
      const tempExtractDir = path.join(this.extensionsDir, `temp_extract_${extensionId}`);
      await fs.mkdir(tempExtractDir, { recursive: true });
      
      let version = '1.0.0';
      let extensionVersionDir;
      
      try {
        console.log(`🔄 开始解压扩展 ${extensionId}，平台: ${process.platform}`);
        
        // 跨平台解压到临时目录读取manifest
        if (process.platform === 'win32') {
          // Windows: 使用PowerShell
          const tempCommand = `powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${tempExtractDir}' -Force"`;
          console.log(`🖥️ Windows解压命令: ${tempCommand}`);
          await execAsync(tempCommand);
        } else {
          // Unix/Linux/macOS: 使用unzip
          const tempCommand = `unzip -q "${tempZipPath}" -d "${tempExtractDir}"`;
          console.log(`🐧 Unix解压命令: ${tempCommand}`);
          await execAsync(tempCommand);
        }
        
        // 读取manifest获取版本
        const manifestPath = path.join(tempExtractDir, 'manifest.json');
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        version = manifest.version || '1.0.0';
        
        console.log(`📋 扩展版本: ${version}`);
        
        // 创建符合Chrome标准的目录结构: Extensions/extensionId/version/
        extensionVersionDir = path.join(extensionBaseDir, version);
        
        // 确保父目录存在
        await fs.mkdir(path.dirname(extensionVersionDir), { recursive: true });
        await fs.mkdir(extensionVersionDir, { recursive: true });
        
        console.log(`📁 已创建目录: ${extensionVersionDir}`);
        
        // 跨平台解压扩展到最终目录
        if (process.platform === 'win32') {
          // Windows: 使用PowerShell
          const finalCommand = `powershell -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${extensionVersionDir}' -Force"`;
          console.log(`🔄 Windows最终解压命令: ${finalCommand}`);
          const { stdout, stderr } = await execAsync(finalCommand);
          console.log(`📋 Windows解压结果: stdout=${stdout || '(空)'}, stderr=${stderr || '(空)'}`);
        } else {
          // Unix/Linux/macOS: 使用unzip
          const finalCommand = `unzip -q "${tempZipPath}" -d "${extensionVersionDir}"`;
          console.log(`🔄 Unix最终解压命令: ${finalCommand}`);
          const { stdout, stderr } = await execAsync(finalCommand);
          console.log(`📋 Unix解压结果: stdout=${stdout || '(空)'}, stderr=${stderr || '(空)'}`);
          
          if (stderr && !stderr.includes('warning')) {
            console.warn(`⚠️ 解压时出现警告: ${stderr}`);
          }
        }
        
        // 验证目录中是否有文件
        const files = await fs.readdir(extensionVersionDir);
        console.log(`📂 解压后文件数量: ${files.length}`);
        console.log(`📂 解压后文件列表: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
        
        console.log(`📂 解压目标: ${extensionVersionDir}`);
        
        // 验证解压结果
        const finalManifestPath = path.join(extensionVersionDir, 'manifest.json');
        await fs.access(finalManifestPath);
        
        console.log(`✅ 扩展安装成功: ${extensionId}`);
        console.log(`📁 安装路径: ${extensionVersionDir}`);
        console.log(`📋 manifest.json 验证通过`);
        
        return { success: true, extensionId, path: extensionVersionDir, version };
        
      } catch (error) {
        console.error(`❌ 扩展安装失败 ${extensionId}:`, error.message);
        console.error(`🐛 详细错误:`, error);
        
        // 清理失败的安装
        try {
          // 🗑️ 扩展目录删除日志
          console.error(`🗑️ [扩展删除] 清理安装失败的扩展目录: ${extensionBaseDir}`);
          console.error(`🔍 [删除原因] 扩展安装过程失败: ${error.message}`);
          console.error(`📚 [调用栈] ${new Error().stack}`);
          console.error(`⚠️ [影响范围] 扩展ID=${extensionId} 的失败安装将被清理`);
          
          await fs.rm(extensionBaseDir, { recursive: true, force: true });
          
          console.error(`✅ [删除完成] 失败的安装目录已清理: ${extensionBaseDir}`);
        } catch (cleanupError) {
          console.error(`❌ [删除失败] 清理失败目录时出错: ${cleanupError.message}`);
          console.error(`📚 [错误调用栈] ${new Error().stack}`);
        }
        
        return { success: false, extensionId, error: error.message };
      } finally {
        // 🐛 暂时保留临时文件用于调试
        console.log(`🐛 临时文件保留用于调试: ${tempZipPath}`);
        // 只清理临时解压目录
        try {
          // 🗑️ 临时目录删除日志
          console.log(`🗑️ [临时删除] 清理临时解压目录: ${tempExtractDir}`);
          console.log(`🔍 [删除原因] 扩展安装完成，清理临时文件`);
          console.log(`📚 [调用栈] ${new Error().stack}`);
          
          await fs.rm(tempExtractDir, { recursive: true, force: true });
          
          console.log(`✅ [删除完成] 临时解压目录已清理: ${tempExtractDir}`);
        } catch (cleanupError) {
          console.warn(`❌ [删除失败] 清理临时解压目录失败: ${cleanupError.message}`);
          console.warn(`📚 [错误调用栈] ${new Error().stack}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ 解压扩展失败 ${extensionId}:`, error.message);
      
      // Windows特定错误处理
      if (process.platform === 'win32') {
        if (error.message.includes('Access is denied')) {
          console.error(`🛡️ Windows权限错误: 请确保运行时具有管理员权限或目标目录可写`);
        } else if (error.message.includes('unzip') && error.message.includes('not found')) {
          console.error(`📦 Windows缺少unzip工具: 请安装Git Bash或使用Windows内置解压功能`);
        }
      }
      
      // 清理失败的安装
      try {
        // 🗑️ 扩展目录删除日志
        console.error(`🗑️ [扩展删除] 清理安装失败的扩展目录: ${extensionDir}`);
        console.error(`🔍 [删除原因] 扩展解压失败，清理残留文件`);
        console.error(`📚 [调用栈] ${new Error().stack}`);
        console.error(`⚠️ [影响范围] 扩展ID=${extensionId} 的失败安装将被清理`);
        
        await fs.rm(extensionDir, { recursive: true, force: true });
        
        console.error(`✅ [删除完成] 失败的安装目录已清理: ${extensionDir}`);
      } catch (cleanupError) {
        console.error(`❌ [删除失败] 清理失败目录时出错: ${cleanupError.message}`);
        console.error(`📚 [错误调用栈] ${new Error().stack}`);
      }
      
      return { success: false, extensionId, error: error.message };
    }
  }

  // 获取推荐扩展列表
  getRecommendedExtensions() {
    return [
      {
        id: 'bpoadfkcbjbfhfodiogcnhhhpibjhbnh',
        name: '翻译插件',
        description: '网页翻译工具',
        category: 'productivity',
        rating: 4.5,
        users: '1M+'
      },
      {
        id: 'gighmmpiobklfepjocnamgkkbiglidom',
        name: 'AdBlock',
        description: '广告拦截器',
        category: 'productivity',
        rating: 4.7,
        users: '10M+'
      },
      {
        id: 'nkbihfbeogaeaoehlefnkodbefgpgknn',
        name: 'MetaMask',
        description: '以太坊钱包',
        category: 'finance',
        rating: 4.2,
        users: '5M+'
      },
      {
        id: 'fhbjgbiflinjbdggehcddcbncdddomop',
        name: 'Proxy SwitchyOmega',
        description: '代理管理工具',
        category: 'developer',
        rating: 4.6,
        users: '2M+'
      },
      {
        id: 'oldceeleldhonbafppcapldpdifcinji',
        name: 'LanguageTool',
        description: '语法检查工具',
        category: 'productivity',
        rating: 4.4,
        users: '3M+'
      }
    ];
  }

  // 按分类获取扩展
  getExtensionsByCategory(category) {
    const allExtensions = this.getRecommendedExtensions();
    if (category === 'all') {
      return allExtensions;
    }
    return allExtensions.filter(ext => ext.category === category);
  }

  // 跨平台解压ZIP文件中的特定文件
  async extractFileFromZip(zipPath, fileName) {
    // 恢复正常功能
    try {
      if (process.platform === 'win32') {
        // Windows: 使用PowerShell的Expand-Archive
        const tempDir = path.join(this.extensionsDir, `temp_extract_${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });
        
        console.log(`🖥️ Windows平台，使用PowerShell解压: ${zipPath}`);
        const command = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`;
        await execAsync(command);
        
        const filePath = path.join(tempDir, fileName);
        const content = await fs.readFile(filePath, 'utf8');
        
        // 清理临时目录
        // 🗑️ 临时目录删除日志
        console.log(`🗑️ [临时删除] 清理Windows解压临时目录: ${tempDir}`);
        console.log(`🔍 [删除原因] ZIP文件解压完成，清理临时文件`);
        console.log(`📚 [调用栈] ${new Error().stack}`);
        
        await fs.rm(tempDir, { recursive: true, force: true });
        
        console.log(`✅ [删除完成] Windows解压临时目录已清理: ${tempDir}`);
        
        return content;
      } else {
        // Unix/Linux/macOS: 使用unzip
        console.log(`🐧 Unix平台，使用unzip: ${zipPath}`);
        const { stdout } = await execAsync(`unzip -p "${zipPath}" "${fileName}"`);
        return stdout;
      }
    } catch (error) {
      throw new Error(`无法提取文件 ${fileName}: ${error.message}`);
    }
  }

  // 获取已下载的扩展
  async getDownloadedExtensions() {
    try {
      const files = await fs.readdir(this.extensionsDir);
      const crxFiles = files.filter(file => file.endsWith('.crx') && !file.startsWith('temp_'));
      
      const recommendedExtensions = this.getRecommendedExtensions();
      
      const extensionsPromises = crxFiles.map(async file => {
        const extensionId = path.basename(file, '.crx');
        const filePath = path.join(this.extensionsDir, file);
        
        // 尝试从推荐扩展中找到对应的信息
        let extensionInfo = recommendedExtensions.find(ext => ext.id === extensionId);
        
        // 如果推荐列表中没有，就从CRX文件中读取manifest.json
        if (!extensionInfo) {
          try {
            console.log(`📋 正在读取扩展 ${extensionId} 的manifest信息...`);
            
            const zipData = await this.extractZipFromCrx(filePath);
            const tempZipPath = path.join(this.extensionsDir, `temp_manifest_${extensionId}.zip`);
            await fs.writeFile(tempZipPath, zipData);
            
            // 跨平台提取manifest.json
            const manifestContent = await this.extractFileFromZip(tempZipPath, 'manifest.json');
            const manifest = JSON.parse(manifestContent);
            
            console.log(`📋 成功读取manifest: ${manifest.name || extensionId}`);
            
            // 处理国际化消息
            let displayName = manifest.name || extensionId;
            if (displayName.startsWith('__MSG_') && displayName.endsWith('__')) {
              // 尝试读取默认语言的消息
              try {
                const defaultLocale = manifest.default_locale || 'en';
                const messagesPath = `_locales/${defaultLocale}/messages.json`;
                console.log(`📋 尝试读取国际化消息: ${messagesPath}`);
                
                const messagesContent = await this.extractFileFromZip(tempZipPath, messagesPath);
                const messages = JSON.parse(messagesContent);
                const messageKey = displayName.slice(6, -2); // 移除 __MSG_ 和 __
                if (messages[messageKey] && messages[messageKey].message) {
                  displayName = messages[messageKey].message;
                  console.log(`📋 成功解析国际化名称: ${displayName}`);
                }
              } catch (i18nError) {
                console.log(`📋 无法解析国际化消息 ${displayName}，使用原始名称: ${i18nError.message}`);
              }
            }
            
            extensionInfo = {
              name: displayName,
              description: manifest.description || '从扩展文件读取',
              version: manifest.version
            };
            
            console.log(`✅ 扩展信息解析完成: ${displayName} (${manifest.version})`);
            
                    // 清理临时文件
        // 🗑️ 临时文件删除日志
        console.log(`🗑️ [临时删除] 清理临时ZIP文件: ${tempZipPath}`);
        console.log(`🔍 [删除原因] 扩展信息提取完成，清理临时ZIP文件`);
        console.log(`📚 [调用栈] ${new Error().stack}`);
        
        await fs.unlink(tempZipPath).catch((error) => {
          console.warn(`❌ [删除失败] 清理临时ZIP文件失败: ${error.message}`);
          console.warn(`📚 [错误调用栈] ${new Error().stack}`);
        });
        
        console.log(`✅ [删除完成] 临时ZIP文件已清理: ${tempZipPath}`);
            
          } catch (manifestError) {
            console.warn(`⚠️ 无法读取扩展 ${extensionId} 的manifest:`, manifestError.message);
            extensionInfo = null;
          }
        }
        
        return {
          filename: file,
          extensionId: extensionId,  // 使用extensionId字段名
          fileName: file,
          displayName: extensionInfo ? extensionInfo.name : extensionId,
          description: extensionInfo ? extensionInfo.description : '未知扩展',
          version: extensionInfo ? extensionInfo.version : '',
          path: filePath,
          size: 0 // 可以添加文件大小信息
        };
      });
      
      return await Promise.all(extensionsPromises);
    } catch (error) {
      console.error('获取已下载扩展失败:', error);
      return [];
    }
  }

  // 删除已下载的扩展
  async deleteExtension(extensionId) {
    try {
      const crxFilePath = path.join(this.extensionsDir, `${extensionId}.crx`);
      
      // 检查文件是否存在
      try {
        await fs.access(crxFilePath);
      } catch (error) {
        return {
          success: false,
          error: '扩展文件不存在'
        };
      }
      
      // 删除CRX文件
      // 🗑️ CRX文件删除日志
      console.warn(`🗑️ [扩展删除] 删除扩展CRX文件: ${crxFilePath}`);
      console.warn(`🔍 [删除原因] 用户主动删除扩展`);
      console.warn(`📚 [调用栈] ${new Error().stack}`);
      console.warn(`⚠️ [影响范围] 扩展ID=${extensionId} 的源文件将被删除`);
      
      await fs.unlink(crxFilePath);
      
      console.warn(`✅ [删除完成] 扩展CRX文件已删除: ${crxFilePath}`);
      
      // 清理可能存在的临时文件
      const tempFiles = [
        path.join(this.extensionsDir, `temp_${extensionId}.zip`),
        path.join(this.extensionsDir, `temp_manifest_${extensionId}.zip`)
      ];
      
      for (const tempFile of tempFiles) {
        try {
          // 🗑️ 临时文件删除日志
          console.log(`🗑️ [临时删除] 清理扩展临时文件: ${tempFile}`);
          console.log(`🔍 [删除原因] 扩展删除，清理相关临时文件`);
          console.log(`📚 [调用栈] ${new Error().stack}`);
          
          await fs.unlink(tempFile);
          
          console.log(`✅ [删除完成] 临时文件已清理: ${tempFile}`);
        } catch (error) {
          // 忽略临时文件删除失败，它们可能不存在
          console.log(`📝 [删除跳过] 临时文件不存在或已删除: ${tempFile}`);
        }
      }
      
      console.log(`✅ 扩展删除成功: ${extensionId}`);
      return {
        success: true,
        extensionId: extensionId
      };
      
    } catch (error) {
      console.error('删除扩展失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 注意: 不再使用 --load-extension 参数
  // 扩展现在通过Chrome标准的Preferences文件启用
}

module.exports = ChromeExtensionManager; 