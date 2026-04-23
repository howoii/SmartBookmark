# 文档目录说明

这个目录用于集中管理项目文档，目标是让文档能按用途快速归类、长期维护，并且便于新同学检索。

## 推荐目录结构

```text
docs/
  README.md                # 文档总索引与维护约定
  architecture/            # 系统设计、模块边界、关键技术方案
  features/                # 功能级文档，按功能单独建目录
  testing/                 # 回归测试清单、测试策略、验收用例
  operations/              # 发布、迁移、同步、排障、值班手册
  references/              # 外部协议、数据格式、术语表、兼容性记录
```

## 当前落地建议

- `architecture/`
  - 放全局架构、数据流、模块职责、存储模型、事件通信约定
- `features/`
  - 每个功能独立目录，例如 `directory-view/`、`quick-search/`
  - 目录内优先使用统一文件名：
    - `SPEC.md`：需求与行为规范
    - `DESIGN.md`：实现设计与取舍
    - `CHANGELOG.md`：功能级变更记录，可选
- `testing/`
  - 放回归测试清单、测试矩阵、验收步骤
- `operations/`
  - 放发布流程、导入导出、同步排障、线上问题处理手册
- `references/`
  - 放不直接属于某个功能，但会被反复引用的资料

## 当前文档索引

- [项目架构总览](./architecture/PROJECT_ARCHITECTURE.md)
- [目录视图规范](./features/directory-view/SPEC.md)
- [智能标签图标系统设计](./features/smart-tags/DESIGN.md)
- [ESC 回归测试清单](./testing/ESC_REGRESSION_CHECKLIST.md)
- [浏览器书签目标回归测试清单](./testing/BROWSER_BOOKMARK_TARGET_REGRESSION_CHECKLIST.md)

## 新增文档时的放置规则

1. 如果文档描述某个具体功能，放到 `features/<feature-name>/`
2. 如果文档描述跨功能的系统方案，放到 `architecture/`
3. 如果文档主要用于验证行为，放到 `testing/`
4. 如果文档主要用于发布、同步、排障或运维动作，放到 `operations/`
5. 如果文档是词汇、协议、格式或兼容性参考，放到 `references/`

## 命名约定

- 目录名使用 kebab-case，例如 `directory-view`
- 文档名优先使用固定职责名：`SPEC.md`、`DESIGN.md`、`README.md`
- 回归清单使用全大写且带语义前缀，例如 `ESC_REGRESSION_CHECKLIST.md`

## 维护约定

- 代码行为变化时，同步更新对应功能目录下的文档
- 新增 UI 交互或快捷键时，优先补充 `testing/` 中的回归清单
- 文档引用代码时，尽量写清涉及模块和页面，避免只写模糊描述
- 功能已废弃时，不直接删除历史文档；先标注状态或迁移到更合适的目录
