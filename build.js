#!/usr/bin/env node

/**
 * 跨平台打包脚本
 * 支持 Windows 和 macOS 平台
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function execCommand(command, options = {}) {
    try {
        log(`执行命令: ${command}`, 'cyan');
        
        // 使用当前环境变量 (通过.npmrc配置)
        const env = {
            ...process.env,
            ...options.env
        };
        
        const result = execSync(command, { 
            stdio: 'inherit', 
            encoding: 'utf8',
            env,
            ...options 
        });
        return result;
    } catch (error) {
        log(`命令执行失败: ${error.message}`, 'red');
        process.exit(1);
    }
}

function checkDependencies() {
    log('检查依赖...', 'yellow');
    
    // 检查 Node.js 版本
    const nodeVersion = process.version;
    log(`Node.js 版本: ${nodeVersion}`, 'blue');
    
    // 检查是否安装了 electron-builder
    try {
        require('electron-builder');
        log('✓ electron-builder 已安装', 'green');
    } catch (error) {
        log('✗ electron-builder 未安装，正在安装...', 'yellow');
        execCommand('npm install electron-builder --save-dev');
    }
}

function createBuildResources() {
    log('创建打包资源...', 'yellow');
    
    const buildDir = path.join(__dirname, 'build');
    
    // 确保 build 目录存在
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }
    
    // 创建 Mac entitlements 文件
    const entitlementsPath = path.join(buildDir, 'entitlements.mac.plist');
    if (!fs.existsSync(entitlementsPath)) {
        const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
  </dict>
</plist>`;
        fs.writeFileSync(entitlementsPath, entitlements);
        log('✓ 创建 Mac entitlements 文件', 'green');
    }
    
    // 创建许可证文件
    const licensePath = path.join(buildDir, 'license.txt');
    if (!fs.existsSync(licensePath)) {
        const license = `指纹浏览器管理器 软件许可协议

版权所有 (c) 2024 云知易客

本软件及其相关文档文件（以下简称"软件"）仅供学习和研究使用。

使用条款：
1. 用户可以自由使用本软件进行个人学习和研究
2. 禁止将本软件用于任何商业用途
3. 禁止逆向工程、反编译或反汇编本软件
4. 用户承担使用本软件的所有风险

免责声明：
本软件按"现状"提供，不提供任何明示或暗示的保证。在任何情况下，
作者或版权持有人均不对任何索赔、损害或其他责任负责。

联系方式：
邮箱：wuaiyiyun2022@163.com`;
        fs.writeFileSync(licensePath, license, 'utf8');
        log('✓ 创建许可证文件', 'green');
    }
    
    log('✓ 打包资源创建完成', 'green');
}

function getCurrentPlatform() {
    const platform = os.platform();
    switch (platform) {
        case 'win32':
            return 'Windows';
        case 'darwin':
            return 'macOS';
        case 'linux':
            return 'Linux';
        default:
            return platform;
    }
}

function buildForPlatform(platform) {
    log(`开始构建 ${platform} 平台...`, 'yellow');
    
    switch (platform.toLowerCase()) {
        case 'windows':
        case 'win':
            execCommand('npm run build-win');
            break;
        case 'macos':
        case 'mac':
            execCommand('npm run build-mac');
            break;
        case 'all':
            execCommand('npm run build-all');
            break;
        default:
            log(`不支持的平台: ${platform}`, 'red');
            process.exit(1);
    }
    
    log(`✓ ${platform} 平台构建完成`, 'green');
}

function showHelp() {
    log('指纹浏览器管理器 - 打包脚本', 'bright');
    log('');
    log('用法:', 'yellow');
    log('  node build.js [平台]', 'cyan');
    log('');
    log('支持的平台:', 'yellow');
    log('  windows, win    构建 Windows 版本', 'cyan');
    log('  macos, mac      构建 macOS 版本', 'cyan');
    log('  all             构建所有平台版本', 'cyan');
    log('');
    log('示例:', 'yellow');
    log('  node build.js windows     # 仅构建 Windows 版本', 'cyan');
    log('  node build.js mac         # 仅构建 macOS 版本', 'cyan');
    log('  node build.js all         # 构建所有版本', 'cyan');
    log('');
    log('当前平台:', 'yellow');
    log(`  ${getCurrentPlatform()}`, 'cyan');
}

function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        return;
    }
    
    log('指纹浏览器管理器 - 跨平台打包工具', 'bright');
    log('================================', 'bright');
    
    // 检查依赖
    checkDependencies();
    
    // 创建构建资源
    createBuildResources();
    
    // 获取目标平台
    const targetPlatform = args[0] || 'current';
    
    if (targetPlatform === 'current') {
        const currentPlatform = getCurrentPlatform();
        log(`未指定平台，将为当前平台 (${currentPlatform}) 构建`, 'yellow');
        
        if (currentPlatform === 'macOS') {
            buildForPlatform('mac');
        } else if (currentPlatform === 'Windows') {
            buildForPlatform('windows');
        } else {
            log('当前平台不支持自动检测，请手动指定平台', 'red');
            showHelp();
            process.exit(1);
        }
    } else {
        buildForPlatform(targetPlatform);
    }
    
    log('');
    log('🎉 打包完成！', 'green');
    log('构建文件位置: ./dist/', 'cyan');
    log('');
    
    // 显示构建结果
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
        log('构建产物:', 'yellow');
        const files = fs.readdirSync(distDir);
        files.forEach(file => {
            const filePath = path.join(distDir, file);
            const stats = fs.statSync(filePath);
            const size = (stats.size / 1024 / 1024).toFixed(2);
            log(`  📦 ${file} (${size} MB)`, 'cyan');
        });
    }
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    log(`未捕获的异常: ${error.message}`, 'red');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`未处理的 Promise 拒绝: ${reason}`, 'red');
    process.exit(1);
});

// 运行主函数
if (require.main === module) {
    main();
}

module.exports = {
    buildForPlatform,
    checkDependencies,
    createBuildResources
}; 