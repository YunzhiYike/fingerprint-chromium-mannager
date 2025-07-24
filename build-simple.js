#!/usr/bin/env node

/**
 * 简化版跨平台打包脚本
 * 适用于快速打包，无需额外依赖
 */

const { spawn } = require('child_process');
const os = require('os');

// 获取当前平台
function getCurrentPlatform() {
    const platform = os.platform();
    switch (platform) {
        case 'win32': return 'Windows';
        case 'darwin': return 'macOS';
        case 'linux': return 'Linux';
        default: return platform;
    }
}

// 执行命令
function runCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        console.log(`\x1b[36m执行: ${command} ${args.join(' ')}\x1b[0m`);
        
        // 使用当前环境变量 (通过.npmrc配置)
        const env = {
            ...process.env
        };
        
        const childProcess = spawn(command, args, { 
            stdio: 'inherit',
            shell: true,
            env
        });
        
        childProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`命令执行失败，退出码: ${code}`));
            }
        });
        
        childProcess.on('error', (error) => {
            reject(error);
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    const platform = args[0] || 'current';
    
    console.log('\x1b[1m指纹浏览器管理器 - 快速打包\x1b[0m');
    console.log('============================');
    console.log(`当前平台: ${getCurrentPlatform()}`);
    
    try {
        // 安装依赖
        console.log('\x1b[33m检查依赖...\x1b[0m');
        await runCommand('npm', ['install']);
        
        // 执行打包
        let buildCommand;
        switch (platform.toLowerCase()) {
            case 'windows':
            case 'win':
                buildCommand = 'build-win';
                break;
            case 'macos':
            case 'mac':
                buildCommand = 'build-mac';
                break;
            case 'all':
                buildCommand = 'build-all';
                break;
            case 'current':
            default:
                const currentPlatform = getCurrentPlatform();
                if (currentPlatform === 'macOS') {
                    buildCommand = 'build-mac';
                } else if (currentPlatform === 'Windows') {
                    buildCommand = 'build-win';
                } else {
                    throw new Error('不支持的平台，请手动指定: windows, mac, 或 all');
                }
                break;
        }
        
        console.log(`\x1b[33m开始打包 (${buildCommand})...\x1b[0m`);
        await runCommand('npm', ['run', buildCommand]);
        
        console.log('\x1b[32m✓ 打包完成！\x1b[0m');
        console.log('\x1b[36m构建文件位置: ./dist/\x1b[0m');
        
    } catch (error) {
        console.error('\x1b[31m✗ 打包失败:', error.message, '\x1b[0m');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 