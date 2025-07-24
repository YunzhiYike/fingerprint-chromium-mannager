# 指纹浏览器管理器 - 打包说明

## 📦 打包脚本使用指南

本项目提供了两种打包方式：完整版和简化版。

### 🚀 快速开始

#### 方式一：使用简化版打包脚本（推荐）

```bash
# 为当前平台打包
node build-simple.js

# 为 Windows 打包
node build-simple.js windows

# 为 macOS 打包
node build-simple.js mac

# 为所有平台打包
node build-simple.js all
```

#### 方式二：使用完整版打包脚本

```bash
# 安装依赖（首次使用）
npm install

# 为当前平台打包
node build.js

# 为特定平台打包
node build.js windows    # Windows
node build.js mac        # macOS
node build.js all        # 所有平台
```

#### 方式三：直接使用 npm 脚本

```bash
# 安装依赖
npm install

# 打包命令
npm run build           # 使用 electron-builder 默认配置
npm run build-win       # 仅 Windows
npm run build-mac       # 仅 macOS
npm run build-all       # 所有平台
npm run pack            # 打包但不生成安装包
npm run dist            # 等同于 build-all
```

### 📋 系统要求

#### 通用要求
- Node.js 16.0 或更高版本
- npm 8.0 或更高版本

#### Windows 打包要求
- Windows 10 或更高版本
- 或者在 macOS/Linux 上使用 Docker/VM

#### macOS 打包要求
- macOS 10.15 或更高版本
- Xcode Command Line Tools
- 或者在其他平台上使用 macOS VM

### 📁 构建产物

打包完成后，构建文件将位于 `dist/` 目录中：

#### Windows 构建产物
- `指纹浏览器管理器 Setup 1.0.0.exe` - NSIS 安装包
- `指纹浏览器管理器 1.0.0.exe` - 便携版

#### macOS 构建产物
- `指纹浏览器管理器-1.0.0.dmg` - macOS 磁盘映像
- `指纹浏览器管理器-1.0.0-mac.zip` - macOS 压缩包

### ⚙️ 高级配置

#### 自定义图标
将图标文件放置在 `build/` 目录中：
- `icon.ico` - Windows 图标 (256x256)
- `icon.icns` - macOS 图标 (512x512)
- `icon.png` - Linux 图标 (512x512)

#### 修改应用信息
编辑 `package.json` 中的以下字段：
```json
{
  "name": "chromium-manager",
  "version": "1.0.0",
  "description": "您的应用描述",
  "author": "您的名字",
  "build": {
    "productName": "您的产品名称",
    "appId": "com.yourcompany.yourapp"
  }
}
```

### 🔧 故障排除

#### 常见问题

**1. electron-builder 安装失败**
```bash
# 清除缓存
npm cache clean --force
# 重新安装
npm install
```

**2. Windows 打包在 macOS 上失败**
```bash
# 安装 wine (需要 Homebrew)
brew install wine
```

**3. macOS 打包在其他平台失败**
- macOS 打包通常只能在 macOS 系统上进行
- 考虑使用 GitHub Actions 或其他 CI/CD 服务

**4. 构建时间过长**
- 首次构建会下载 Electron 二进制文件，需要较长时间
- 后续构建会使用缓存，速度较快

#### 依赖问题
如果遇到 native 模块编译问题：
```bash
# 重新构建 native 模块
npm run postinstall
# 或者
npm rebuild
```

### 📝 构建选项说明

#### 打包目标
- **NSIS**: Windows 安装程序，支持自定义安装路径
- **Portable**: Windows 便携版，无需安装直接运行
- **DMG**: macOS 磁盘映像，标准的 macOS 分发格式
- **ZIP**: 压缩包格式，跨平台通用

#### 架构支持
- **x64**: 64位系统（推荐）
- **ia32**: 32位系统（Windows）
- **arm64**: Apple Silicon（macOS）

### 🚀 持续集成

可以使用 GitHub Actions 自动化构建：

```yaml
# .github/workflows/build.yml
name: Build
on: [push, pull_request]
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
```

### 📞 支持

如有问题，请联系：
- 邮箱：wuaiyiyun2022@163.com
- 或在项目仓库中提交 Issue

---

© 2024 云知易客. 保留所有权利。 