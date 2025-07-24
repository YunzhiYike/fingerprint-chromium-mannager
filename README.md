# 指纹浏览器管理器

> 专业的浏览器指纹管理解决方案

## ✨ 功能特性

- 🛡️ **指纹伪装** - 完整的浏览器指纹伪装，包括硬件信息、系统版本、浏览器特征等
- 🌐 **代理管理** - 支持HTTP、SOCKS代理，灵活配置网络环境
- 🌍 **多语言环境** - 模拟不同地区的语言和时区设置
- 💾 **数据隔离** - 每个配置独立的数据存储，确保隐私安全
- ⚡ **批量任务** - 支持批量网页跳转和脚本执行
- 🎯 **调试支持** - 内置Chrome DevTools调试端口
- 🖥️ **跨平台** - 支持Windows、macOS、Linux

## 🚀 快速开始

### 系统要求

- Node.js 16.0 或更高版本
- npm 8.0 或更高版本

### 启动应用

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产模式
npm start
```

## 📦 打包分发

### 🎯 推荐方式（跨平台）

```bash
# Windows 用户
build.bat

# macOS/Linux 用户
./build.sh

# 或者使用 Node.js 脚本
node build-simple.js
```

### 📋 详细打包选项

```bash
# 为当前平台打包
npm run build

# 为特定平台打包
npm run build-win     # Windows
npm run build-mac     # macOS
npm run build-all     # 所有平台

# 高级打包脚本
node build.js windows  # Windows
node build.js mac      # macOS
node build.js all      # 所有平台
```

## 🎮 使用指南

### 创建浏览器配置

1. 点击 **"新建配置"** 按钮
2. 填写配置名称和指纹参数
3. 设置代理、语言、时区等选项
4. 保存配置

### 批量任务

1. 确保有运行中的浏览器
2. 点击 **"批量任务"** 按钮
3. 选择任务类型：页面跳转、脚本执行、组合任务
4. 配置任务参数并执行

详细说明请查看 [BUILD.md](BUILD.md)

## 📞 联系支持

- 📧 邮箱：wuaiyiyun2022@163.com

---

Made with ❤️ by 云知易客 