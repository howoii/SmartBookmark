---
name: docs-maintenance
description: >-
  Maintain and organize project documentation. Use when adding docs, moving docs
  into a clearer taxonomy, updating feature specs, writing regression checklists,
  or keeping docs in sync with behavior changes.
---

# Documentation Maintenance

这个 skill 负责文档归类、增量维护和回归清单编写，不承载通用写作建议。

## Workflow

1. 先查看 `docs/README.md`，确认现有分类和索引。
2. 如果文档涉及系统级实现、数据流、存储或同步，先查看 `docs/architecture/PROJECT_ARCHITECTURE.md`，避免写出与现状冲突的描述。
3. 判断文档归属：
   - 功能文档：`docs/features/<feature-name>/`
   - 架构文档：`docs/architecture/`
   - 测试清单：`docs/testing/`
   - 运维/排障：`docs/operations/`
   - 参考资料：`docs/references/`
4. 如果是已有功能，优先补到该功能目录，不在 `docs/` 根目录平铺新增文件。
5. 新增或迁移文档后，更新 `docs/README.md`。
6. 代码行为变化时，同步检查对应 `SPEC.md`、`DESIGN.md` 或回归清单是否需要更新。

## Naming Rules

- 目录名使用 kebab-case。
- 功能目录内优先使用固定职责文件名：
  - `SPEC.md`
  - `DESIGN.md`
  - `README.md`
- 回归清单使用语义化名称，例如 `ESC_REGRESSION_CHECKLIST.md`。

## Writing Rules

- 行为文档按“前置条件 / 操作步骤 / 预期结果”组织。
- 需求、设计、测试尽量分文件，不要混成一份大而全文档。
- 涉及交互层级时，写清优先级和退出顺序。

## Project Notes

- 这个项目的文档常涉及 `popup`、`quickSearch`、`settings`、`background`，建议在文档中明确点名页面或模块。
- 快捷键、弹窗、编辑模式、搜索模式相关改动，优先补回归测试清单。
