<div align="center">

# 🔖 Smart Bookmark

**AI-Powered Intelligent Bookmark Manager for Chrome & Edge**

[![Version](https://img.shields.io/badge/version-1.2.5-blue.svg)](https://github.com/howoii/SmartBookmark/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-orange.svg)](https://chromewebstore.google.com/detail/smart-bookmark/nlboajobccgidfcdoedphgfaklelifoa)
[![Edge Add-ons](https://img.shields.io/badge/Edge-Add--ons-0078D7.svg)](https://microsoftedge.microsoft.com/addons/detail/smart-bookmark/dohicooegjedllghbfapbmbhjopnkbad)

[安装插件](#-快速开始) · [功能介绍](#-功能特性) · [使用文档](#-使用文档) · [开发指南](#-开发指南) · [FAQ](#-faq)

</div>

---

## 📖 项目介绍

Smart Bookmark 是一款基于 AI 的智能书签管理插件，专注于解决书签收藏和搜索的痛点。插件简洁高效，让书签管理变得更加智能和省心！

**核心优势：**
- 🤖 AI 驱动的智能标签生成和分类
- 🔍 语义化搜索，告别精确匹配
- 📁 自动归类，无需手动管理文件夹
- ☁️ WebDAV 跨设备同步
- 💰 使用成本极低（1元/月）

---

## ✨ 功能特性

### 🎯 核心功能

- **AI 自动生成标签**
  收藏网页时，智能生成相关标签，无需手动归类，彻底告别繁琐的文件夹管理

- **语义化搜索**
  基于向量嵌入的语义搜索，记不住关键词也不用担心，用自然语言描述内容即可快速找到目标书签

- **AI 生成摘要**
  自动为书签生成内容摘要，快速了解网页主要内容

- **多级标签与智能分类**
  支持层级化标签组织，AI 自动将标签归类到合适的层级

### 🛠️ 高级功能

- **层级书签展示视图**
  全新的树形结构视图，以层级标签树展示所有书签，支持点击标签筛选、拖拽调整宽度，让书签管理更加直观高效

- **自定义筛选规则**
  支持按标题、标签、网址等筛选规则，轻松实现书签自动归类

- **WebDAV 同步**
  支持 WebDAV 协议，轻松实现多设备同步，保护数据隐私

- **批量操作**
  支持批量选择、编辑和删除书签，管理更加便捷

- **导入导出**
  支持书签数据的导入导出，方便备份和迁移

- **快捷键支持**
  - `Ctrl/Cmd + K`：快速搜索
  - `Ctrl/Cmd + B`：快速收藏当前页面

- **主题切换**
  支持浅色/深色主题，适应不同使用场景

### 🔌 AI 模型支持

- OpenAI（GPT-3.5/GPT-4）
- 通义千问
- 智谱 GLM
- Ollama 本地模型
- 自定义 API 接口

---

## 📸 截图演示

<div align="center">

### 主界面
![主界面](pic/view-4.png)

### 语义搜索
![语义搜索](pic/view-3.png)

### AI 标签生成
![AI 标签生成](pic/view-5.png)

</div>

---

## 🚀 快速开始

### 安装插件

- **Chrome 浏览器：** [Chrome 应用商店](https://chromewebstore.google.com/detail/smart-bookmark/nlboajobccgidfcdoedphgfaklelifoa)
- **Edge 浏览器：** [Edge 扩展商店](https://microsoftedge.microsoft.com/addons/detail/smart-bookmark/dohicooegjedllghbfapbmbhjopnkbad)

### 基本配置

1. **安装后首次配置**
   - 点击浏览器工具栏中的 Smart Bookmark 图标
   - 点击「设置」按钮进入配置页面

2. **配置 AI 服务**
   - 选择 AI 服务提供商（OpenAI / 通义千问 / 智谱 GLM / Ollama / 自定义）
   - 输入对应的 API Key
   - 选择模型（推荐 GPT-3.5-turbo 或 qwen-turbo，成本低速度快）

3. **开始使用**
   - 浏览任意网页，按 `Ctrl/Cmd + B` 快速收藏
   - AI 会自动生成标签和摘要
   - 按 `Ctrl/Cmd + K` 打开快速搜索

### 使用成本

插件完全免费开源！用户只需提供自己的 AI API Key。

**经过实际测试，1 元的 Token 足够使用一个多月**，高效又实惠！

---

## 📖 使用文档

### 书签管理

#### 视图模式
Smart Bookmark 提供三种视图模式，满足不同的使用场景：

1. **列表视图**：传统的扁平化列表，支持筛选和排序
2. **分组视图**：按自定义规则分组显示书签
3. **层级视图**：树形结构展示层级标签，点击标签筛选书签
   - 左侧显示标签树，右侧显示书签列表
   - 支持展开/折叠子标签
   - 支持拖拽调整标签树宽度（140px-400px）
   - 点击标签可筛选该标签及其子标签下的所有书签
   - 展开状态和宽度设置自动保存

#### 添加书签
1. **快捷键添加：** 在任意网页按 `Ctrl/Cmd + B`
2. **插件图标：** 点击工具栏图标，在弹出窗口中点击「收藏」
3. **自动生成：** AI 会自动为书签生成标签和摘要

#### 搜索书签
1. **快捷键搜索：** 按 `Ctrl/Cmd + K` 打开快速搜索
2. **地址栏搜索：** 输入 `sb` + 空格 + 搜索词
3. **语义搜索：** 用自然语言描述内容，如「Python 教程」「机器学习入门」

#### 批量操作
1. 在书签列表中勾选多个书签
2. 点击顶部操作栏的批量编辑或删除按钮
3. 支持批量添加/删除标签

### AI 功能

#### 标签生成
- 新增书签时自动生成
- 可在书签详情中点击「重新生成」
- 支持手动编辑和添加自定义标签

#### 摘要生成
- 在书签详情页点击「生成摘要」
- AI 会提取网页核心内容生成摘要
- 摘要可手动编辑

#### 层级标签
- 标签支持多级分类（如：`技术/前端/React`）
- AI 会自动将标签归类到合适的层级
- 支持在筛选器中按层级浏览

### 同步设置

#### WebDAV 同步
1. 进入「设置」→「同步设置」
2. 选择 WebDAV 同步方式
3. 填写服务器地址、用户名、密码
4. 点击「测试连接」确认配置正确
5. 开启自动同步或手动同步

**推荐 WebDAV 服务：**
- 坚果云（国内推荐）
- Nextcloud（自建）
- Synology NAS

### 自定义过滤器

1. 进入「设置」→「自定义过滤器」
2. 点击「新建过滤器」
3. 设置筛选规则：
   - 标题包含/不包含
   - 网址匹配
   - 标签包含
4. 保存后在主界面侧边栏查看过滤结果

---

## 🛠️ 技术栈

### 核心技术
- **Manifest V3** - Chrome 扩展最新标准
- **原生 JavaScript** - 无框架依赖，轻量高效
- **Chrome Extensions API** - 完整利用浏览器能力

### 主要功能模块
- **向量嵌入搜索** - 语义化书签检索
- **WebDAV 同步** - 跨设备数据同步
- **AI API 集成** - 多平台 AI 服务支持
- **本地存储** - Chrome Storage API 数据持久化

### 代码结构
```
SmartBookmark/
├── manifest.json          # 扩展清单文件
├── background.js          # Service Worker
├── popup.html/js          # 主界面
├── quickSave.html/js      # 快速保存弹窗
├── quickSearch.html/js    # 快速搜索
├── settings.html/js       # 设置页面
├── api.js                 # AI API 抽象层
├── models.js              # 数据模型
├── storageManager.js      # 存储管理
├── webdavClient.js        # WebDAV 同步
├── search.js              # 搜索引擎
└── _locales/              # 国际化文件
```

---

## 👨‍💻 开发指南

### 环境准备

```bash
# 克隆项目
git clone https://github.com/howoii/SmartBookmark.git
cd SmartBookmark

# 项目使用原生 JavaScript，无需安装依赖
```

### 本地开发

1. **加载扩展到浏览器**
   - 打开 Chrome/Edge 浏览器
   - 访问 `chrome://extensions/` 或 `edge://extensions/`
   - 开启「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选择项目根目录

2. **修改代码**
   - 编辑代码后，点击扩展管理页面的「刷新」按钮
   - Service Worker 修改需要重新加载扩展

3. **调试**
   - Popup 页面：右键点击图标 → 检查
   - Background：扩展管理页面 → Service Worker → 检查
   - 使用 `logger.debug()` 输出调试信息

### 配置开发环境

1. 复制 `env.json` 配置本地 API Key（不要提交到 Git）
2. 修改 `manifest.json` 中的 `externally_connectable` 配置本地测试域名

### 构建打包

```bash
# 手动打包
# 1. 删除 env.json（包含敏感信息）
# 2. 将项目文件夹打包为 zip
# 3. 上传到 Chrome Web Store 或 Edge Add-ons
```

### 代码规范

- 使用 camelCase 命名函数和变量
- 使用 PascalCase 命名类
- 为复杂逻辑添加中文注释
- 使用 `logger.debug/info/error` 进行日志记录
- 所有存储操作通过 `storageManager.js` 进行

### 如何贡献

我们欢迎任何形式的贡献！

1. **报告问题**
   - 在 [Issues](https://github.com/howoii/SmartBookmark/issues) 中描述问题
   - 提供复现步骤和截图

2. **提交代码**
   ```bash
   # Fork 项目
   # 创建特性分支
   git checkout -b feature/your-feature

   # 提交更改
   git commit -m "feat: 添加新功能"

   # 推送到分支
   git push origin feature/your-feature

   # 创建 Pull Request
   ```

3. **提交规范**
   - `feat:` 新功能
   - `fix:` 修复问题
   - `docs:` 文档更新
   - `refactor:` 代码重构
   - `style:` 代码格式调整
   - `test:` 测试相关

---

## 🗺️ 开发路线图

### 已完成 ✅
- [x] 支持更多 API，增加自定义 API 支持
- [x] 支持导入浏览器书签
- [x] 支持书签收藏、搜索快捷键
- [x] 增加深色模式
- [x] 支持书签导入导出功能
- [x] 支持 Ollama 本地模型
- [x] 增加 WebDAV 同步功能
- [x] 增加书签批量选择和删除功能
- [x] 支持 AI 生成书签摘要
- [x] 上架 Edge 浏览器商店
- [x] 支持多级标签和 AI 自动分类
- [x] 层级书签展示视图（树形结构，支持拖拽调整宽度）

### 计划中 📋
- [ ] 支持智能推荐标签
- [ ] 支持自定义提示词
- [ ] 增加多语言支持（英文、日文等）
- [ ] 书签历史记录功能
- [ ] Firefox 版本支持
- [ ] 移动端版本（iOS/Android）

### 欢迎建议 💡
如果你有好的想法，欢迎在 [Issues](https://github.com/howoii/SmartBookmark/issues) 中提出！

---

## ❓ FAQ

### 如何接入 Ollama 本地模型？

<details>
<summary>点击查看详细步骤</summary>

1. **安装 Ollama**
   访问 [Ollama 官网](https://ollama.com/) 下载安装

2. **设置允许跨域并启动**

   **macOS：**
   ```bash
   launchctl setenv OLLAMA_ORIGINS "*"
   # 然后启动 Ollama App
   ```

   **Windows：**
   - 打开「控制面板」→「系统属性」→「环境变量」
   - 在用户环境变量中新建：
     - 变量名：`OLLAMA_HOST`，变量值：`0.0.0.0`
     - 变量名：`OLLAMA_ORIGINS`，变量值：`*`
   - 启动 Ollama App

   **Linux：**
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```

3. **在 Smart Bookmark 中配置**
   - 进入「设置」→「AI 服务配置」
   - 选择「自定义 API」
   - API 接口地址：`http://localhost:11434/v1`
   - API Key：`ollama`
   - 模型：选择你本地安装的模型（如 `llama2`）

</details>

### 支持哪些 AI 模型？

目前支持：
- **OpenAI**：GPT-3.5-turbo, GPT-4, GPT-4-turbo 等
- **通义千问**：qwen-turbo, qwen-plus, qwen-max
- **智谱 GLM**：glm-3-turbo, glm-4
- **Ollama**：支持所有本地模型（llama2, mistral, codellama 等）
- **自定义 API**：任何兼容 OpenAI API 格式的服务

推荐使用 **GPT-3.5-turbo** 或 **qwen-turbo**，性价比最高。

### 数据存储在哪里？安全吗？

- 所有书签数据存储在 **浏览器本地**（Chrome Storage API）
- 不会上传到任何第三方服务器
- 使用 WebDAV 同步时，数据仅在你的设备和你指定的 WebDAV 服务器之间传输
- AI 处理时会发送网页标题和 URL 到 AI 服务商，不会发送完整内容

### 为什么语义搜索需要 API Key？

语义搜索基于向量嵌入（Vector Embedding）技术，需要调用 AI 模型的 Embedding API 将文本转换为向量。这个过程需要 API Key 来访问 AI 服务。

你也可以：
- 使用 **Ollama 本地模型**，完全离线运行
- 使用成本极低的 **Embedding 模型**（如 text-embedding-ada-002），每次调用成本不到 0.001 元

### 如何导出书签数据？

1. 点击主界面右上角「⋮」菜单
2. 选择「导出书签」
3. 选择导出格式：
   - **JSON 格式**：包含完整数据（标签、摘要、向量等）
   - **HTML 格式**：标准浏览器书签格式，可导入其他浏览器

### 插件占用多少存储空间？

- 插件本身：约 2MB
- 书签数据：取决于你的书签数量
  - 1000 个书签（含向量）：约 10-20MB
  - Chrome 扩展默认存储上限：无限制（已申请 `unlimitedStorage` 权限）

### 遇到问题怎么办？

1. 查看 [FAQ](#-faq) 是否有解决方案
2. 在 [Issues](https://github.com/howoii/SmartBookmark/issues) 中搜索类似问题
3. 如果没有找到，欢迎提交新的 Issue，我们会尽快回复

---

## 📬 联系方式

### 问题反馈

- **GitHub Issues：** [提交问题](https://github.com/howoii/SmartBookmark/issues)
- **Email：** yz0917@foxmail.com

### 交流讨论

- **微信：**
  <img width="200" src="pic/wechat2.JPG" alt="微信二维码" />

- EMail：yz0917@foxmail.com
---

## 🙏 致谢

- 感谢 [Cursor](https://www.cursor.com/) 提供的强大 AI 编程能力
- 感谢所有为项目贡献代码和建议的开发者
- 感谢所有使用和支持 Smart Bookmark 的用户

---

## 📄 License

本项目基于 [MIT 协议](LICENSE) 开源。

欢迎自由使用、修改和分发，但请保留原作者信息。

---

<div align="center">

**如果这个项目对你有帮助，欢迎 ⭐ Star 支持一下！**

[⬆ 回到顶部](#-smart-bookmark)

</div>
