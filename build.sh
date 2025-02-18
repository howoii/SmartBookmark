#!/bin/bash

# 获取当前日期
DATE=$(date +"%Y%m%d_%H%M%S")

# 从 manifest.json 读取版本号
VERSION=$(grep -o '"version": *"[^"]*"' manifest.json | cut -d'"' -f4)
echo "VERSION: $VERSION"

# 检查版本号是否成功读取
if [ -z "$VERSION" ]; then
    echo "错误：无法从 manifest.json 读取版本号"
    exit 1
fi

# 创建构建目录
mkdir -p build

# 执行 Python 构建脚本
python3 build.py production

# 创建临时目录用于存放要打包的文件
TMP_DIR="tmp_build"
mkdir -p $TMP_DIR

# 使用排除文件列表进行文件复制
rsync -av --exclude-from='exclude_list.txt' . $TMP_DIR/

# 创建 ZIP 包
cd $TMP_DIR
zip -r "../build/smart_bookmark_${VERSION}_${DATE}.zip" .

# 清理临时目录
cd ..
rm -rf $TMP_DIR

# 切换回开发环境
python3 build.py development

echo "打包完成: build/smart_bookmark_${VERSION}_${DATE}.zip"
