#!/bin/bash

# 指纹浏览器管理器 - Unix 打包工具
# 支持 macOS 和 Linux

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 打印函数
print_header() {
    echo -e "${BOLD}===================================="
    echo -e "  指纹浏览器管理器 - Unix 打包工具"
    echo -e "====================================${NC}"
    echo
}

print_info() {
    echo -e "${BLUE}[信息]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[成功]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

print_error() {
    echo -e "${RED}[错误]${NC} $1"
}

# 检查命令是否存在
check_command() {
    if ! command -v $1 &> /dev/null; then
        print_error "$1 未安装，请先安装 $1"
        case $1 in
            "node")
                echo "下载地址: https://nodejs.org/"
                ;;
            "npm")
                echo "Node.js 安装包通常包含 npm"
                ;;
        esac
        exit 1
    fi
}

# 获取当前平台
get_current_platform() {
    case "$(uname -s)" in
        Darwin*)
            echo "macOS"
            ;;
        Linux*)
            echo "Linux"
            ;;
        CYGWIN*|MINGW32*|MSYS*|MINGW*)
            echo "Windows"
            ;;
        *)
            echo "Unknown"
            ;;
    esac
}

# 显示菜单
show_menu() {
    echo "请选择打包平台:"
    echo "  1. Windows"
    echo "  2. macOS"
    echo "  3. 所有平台"
    echo "  4. 当前平台 (推荐)"
    echo
}

# 主函数
main() {
    print_header
    
    # 检查依赖
    check_command "node"
    check_command "npm"
    
    # 显示环境信息
    print_info "Node.js 版本: $(node --version)"
    print_info "当前平台: $(get_current_platform)"
    echo
    
    # 获取平台参数
    PLATFORM="$1"
    
    if [ -z "$PLATFORM" ]; then
        show_menu
        read -p "请输入选项 (1-4, 默认为4): " choice
        
        case "${choice:-4}" in
            1)
                PLATFORM="windows"
                ;;
            2)
                PLATFORM="mac"
                ;;
            3)
                PLATFORM="all"
                ;;
            4)
                PLATFORM="current"
                ;;
            *)
                print_error "无效选项: $choice"
                exit 1
                ;;
        esac
    fi
    
    print_info "开始为 $PLATFORM 平台打包..."
    echo
    
    # 执行打包 (使用.npmrc配置)
    if node build-simple.js "$PLATFORM"; then
        echo
        print_success "打包完成！"
        print_info "构建文件位置: ./dist/"
        echo
        
        # 询问是否打开构建目录
        if [ -d "dist" ]; then
            read -p "是否打开构建目录? (y/N): " open_dir
            if [[ "$open_dir" =~ ^[Yy]$ ]]; then
                case "$(get_current_platform)" in
                    "macOS")
                        open dist
                        ;;
                    "Linux")
                        if command -v xdg-open &> /dev/null; then
                            xdg-open dist
                        elif command -v nautilus &> /dev/null; then
                            nautilus dist
                        else
                            print_warning "无法自动打开文件管理器，请手动查看 dist 目录"
                        fi
                        ;;
                esac
            fi
        else
            print_warning "构建目录不存在"
        fi
    else
        echo
        print_error "打包失败！"
        echo "请检查上方的错误信息"
        exit 1
    fi
}

# 脚本入口
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 