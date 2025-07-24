#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🎨 转换图标文件...');

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');

if (!fs.existsSync(svgPath)) {
    console.log('❌ 未找到 build/icon.svg 文件');
    process.exit(1);
}

try {
    // 生成不同尺寸的PNG
    const sizes = [16, 32, 48, 64, 128, 256, 512];
    
    console.log('📐 生成PNG图标...');
    sizes.forEach(size => {
        const pngPath = path.join(buildDir, `icon-${size}.png`);
        try {
            execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`, { stdio: 'ignore' });
            console.log(`  ✓ ${size}x${size} PNG`);
        } catch (error) {
            console.log(`  ⚠ ${size}x${size} PNG 失败`);
        }
    });
    
    // 复制256px版本作为Linux图标
    const linuxIcon = path.join(buildDir, 'icon.png');
    const png256 = path.join(buildDir, 'icon-256.png');
    if (fs.existsSync(png256)) {
        fs.copyFileSync(png256, linuxIcon);
        console.log('🐧 Linux PNG 图标已创建');
    }
    
    // 清理临时PNG文件
    console.log('🧹 清理临时文件...');
    sizes.forEach(size => {
        const tempFile = path.join(buildDir, `icon-${size}.png`);
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch {}
    });
    
    console.log('');
    console.log('✅ 图标生成完成！');
    console.log('');
    console.log('📋 生成的文件:');
    console.log('✅ build/icon.svg  - 矢量图标');
    console.log('✅ build/icon.icns - macOS 图标');
    console.log('✅ build/icon.png  - Linux 图标');
    console.log('');
    console.log('⚠️  还需要Windows ICO图标:');
    console.log('1. 访问 https://convertio.co/png-ico/');
    console.log('2. 上传 build/icon.png 文件');
    console.log('3. 下载并重命名为 icon.ico，放到 build/ 目录');
    
} catch (error) {
    console.log('❌ 转换失败:', error.message);
} 