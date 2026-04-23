# 智能标签 — 图标与颜色系统

## 概述

智能标签（自定义过滤器）支持为每个标签设置图标和颜色。图标来源于 [Lucide Icons](https://lucide.dev/)（ISC 协议），采用 stroke 线框风格。

## 架构

```
lib/lucide.min.js          ← Lucide 完整库（仅构建时使用，不打包）
    ↓ node scripts/build-icons.js
lib/lucide-icons.js        ← 构建产物：精简的图标映射表（运行时使用）
    ↓ <script> 引入
iconPicker.js              ← 图标选择器组件（读取 LUCIDE_ICONS）
    ↓ IconPicker.getIconSvg()
settings.js / popup.js     ← 消费方：标签列表、popup 分组视图
```

### 文件职责

| 文件 | 职责 |
|------|------|
| `lib/lucide.min.js` | Lucide 完整库，构建时数据源，**不随扩展打包** |
| `scripts/build-icons.js` | 构建脚本，从完整库中提取指定图标 |
| `lib/lucide-icons.js` | 构建产物，包含图标数据映射表和默认图标 key |
| `iconPicker.js` | 图标/颜色选择器 UI 组件 |

### 数据格式

`LUCIDE_ICONS` 保持 Lucide 原始数据结构：

```javascript
{
  "Tag": [
    ["path", {"d": "M12.586 2.586A2 2 0 0 0..."}],
    ["circle", {"cx": "7.5", "cy": "7.5", "r": ".5", "fill": "currentColor"}]
  ]
}
```

图标 key 使用 Lucide 的 PascalCase 命名（如 `Folder`、`BarChart3`、`GraduationCap`）。

### 存储与同步

图标和颜色作为 `icon` / `color` 字段保存在自定义过滤器规则中，存储于 `chrome.storage.sync`，并通过 WebDAV 同步（走 `customFilter.getExportData()` / `importFilters()`）。

## 新增/修改图标工作流

1. 打开 `scripts/build-icons.js`，在 `ICON_KEYS` 数组中添加 Lucide PascalCase 图标名

2. 运行构建脚本：
   ```bash
   node scripts/build-icons.js
   ```

3. 验证生成的 `lib/lucide-icons.js` 已更新

可用图标名称参考 [Lucide 图标库](https://lucide.dev/icons)。

### 升级 Lucide 版本

1. 从 [npm](https://www.npmjs.com/package/lucide) 下载新版本的 UMD 文件，替换 `lib/lucide.min.js`
2. 重新运行 `node scripts/build-icons.js`
3. 检查是否有图标被移除或重命名（脚本会报错提示）

## 当前预设图标列表（32 个）

Folder, Bookmark, Star, Heart, Flag, Tag, Pin, Code, Terminal, Briefcase, Building, BarChart3, BookOpen, GraduationCap, Lightbulb, Pencil, Music, Camera, Film, Palette, Gamepad, Home, ShoppingCart, Utensils, Plane, Globe, Car, Wrench, Shield, Clock, Search, Link
