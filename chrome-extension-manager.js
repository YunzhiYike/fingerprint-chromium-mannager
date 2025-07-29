const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);

class ChromeExtensionManager {
  constructor() {
    this.extensionsDir = path.join(__dirname, 'chrome-extensions');
    this.initializeExtensionsDir();
  }

  // 初始化扩展目录
  async initializeExtensionsDir() {
    try {
      await fs.mkdir(this.extensionsDir, { recursive: true });
      console.log(`📁 扩展目录已创建: ${this.extensionsDir}`);
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
  async installExtensionsToConfig(configId, userDataDir, extensionIds = []) {
    try {
      const extensionsPath = path.join(userDataDir, 'Default', 'Extensions');
      await fs.mkdir(extensionsPath, { recursive: true });
      
      console.log(`🔧 为配置 ${configId} 安装扩展...`);
      
      const installResults = [];
      
      for (const extensionId of extensionIds) {
        const crxPath = path.join(this.extensionsDir, `${extensionId}.crx`);
        
        try {
          // 检查CRX文件是否存在
          await fs.access(crxPath);
          
          // 解压并安装扩展
          const result = await this.installSingleExtension(crxPath, extensionsPath, extensionId);
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

  // 安装单个扩展
  async installSingleExtension(crxPath, extensionsPath, extensionId) {
    try {
      const extensionDir = path.join(extensionsPath, extensionId);
      
      // 🗑️ 先清理现有扩展目录（防止文件冲突）
      try {
        await fs.access(extensionDir);
        console.log(`🗑️ 清理现有扩展目录: ${extensionDir}`);
        await fs.rm(extensionDir, { recursive: true, force: true });
      } catch (error) {
        // 目录不存在，忽略错误
      }
      
      // 重新创建扩展目录
      await fs.mkdir(extensionDir, { recursive: true });
      
      // 解析CRX文件并提取ZIP内容
      const zipData = await this.extractZipFromCrx(crxPath);
      
      // 将ZIP数据写入临时文件
      const tempZipPath = path.join(this.extensionsDir, `temp_${extensionId}.zip`);
      await fs.writeFile(tempZipPath, zipData);
      
      try {
        // 解压ZIP文件
        const command = `unzip -q "${tempZipPath}" -d "${extensionDir}"`;
        console.log(`🔄 执行解压命令: ${command}`);
        
        const { stdout, stderr } = await execAsync(command);
        
        // 验证解压结果
        const manifestPath = path.join(extensionDir, 'manifest.json');
        await fs.access(manifestPath);
        
        console.log(`✅ 扩展安装成功: ${extensionId}`);
        console.log(`📁 安装路径: ${extensionDir}`);
        
        return { success: true, extensionId, path: extensionDir };
        
      } finally {
        // 清理临时ZIP文件
        try {
          await fs.unlink(tempZipPath);
        } catch (cleanupError) {
          console.warn(`⚠️ 清理临时文件失败: ${cleanupError.message}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ 解压扩展失败 ${extensionId}:`, error.message);
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

  // 获取已下载的扩展
  async getDownloadedExtensions() {
    try {
      const files = await fs.readdir(this.extensionsDir);
      const crxFiles = files.filter(file => file.endsWith('.crx') && !file.startsWith('temp_'));
      
      const recommendedExtensions = this.getRecommendedExtensions();
      
      return crxFiles.map(file => {
        const extensionId = path.basename(file, '.crx');
        
        // 尝试从推荐扩展中找到对应的信息
        const extensionInfo = recommendedExtensions.find(ext => ext.id === extensionId);
        
        return {
          filename: file,
          extensionId: extensionId,  // 使用extensionId字段名
          fileName: file,
          displayName: extensionInfo ? extensionInfo.name : extensionId,
          description: extensionInfo ? extensionInfo.description : '未知扩展',
          path: path.join(this.extensionsDir, file),
          size: 0 // 可以添加文件大小信息
        };
      });
    } catch (error) {
      console.error('获取已下载扩展失败:', error);
      return [];
    }
  }

  // 生成启动参数
  generateExtensionArgs(userDataDir, extensionIds) {
    if (!extensionIds || extensionIds.length === 0) {
      return [];
    }
    
    const extensionPaths = extensionIds.map(id => {
      return path.join(userDataDir, 'Default', 'Extensions', id);
    });
    
    return [`--load-extension=${extensionPaths.join(',')}`];
  }
}

module.exports = ChromeExtensionManager; 