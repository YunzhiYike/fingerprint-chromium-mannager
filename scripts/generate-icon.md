# 图标生成指导

## 已完成的工作

✅ **SVG图标** - `build/icon.svg` 
✅ **macOS ICNS** - `build/icon.icns` (343KB)
✅ **Linux PNG** - `build/icon.png` (27KB, 256x256)

## 需要手动完成

❌ **Windows ICO** - `build/icon.ico`

### 创建Windows ICO文件

1. 访问在线转换工具: https://convertio.co/png-ico/
2. 上传 `build/icon.png` 文件
3. 下载生成的ICO文件
4. 将下载的文件重命名为 `icon.ico` 并放到 `build/` 目录

### 或者使用其他在线工具

- https://icoconvert.com/
- https://cloudconvert.com/png-to-ico
- https://onlineconvertfree.com/convert-format/png-to-ico/

## 图标设计说明

我们的软件图标包含以下元素：
- 🔒 **盾牌形状** - 代表安全和隐私保护
- 🖱️ **指纹图案** - 象征指纹浏览器的核心功能
- 🖥️ **浏览器窗口** - 表示浏览器管理功能
- 🎨 **蓝紫渐变** - 现代科技感配色

## 使用的文件格式

- `.svg` - 矢量图标，用于生成其他格式
- `.icns` - macOS应用图标 (512x512)
- `.ico` - Windows应用图标 (256x256)  
- `.png` - Linux应用图标 (256x256)

## 自动化脚本

运行以下命令生成PNG和ICNS文件：
```bash
node scripts/convert-icon.js
``` 