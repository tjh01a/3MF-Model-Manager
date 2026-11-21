# 图标资源声明（NOTICE）

本项目 PrintShelf 使用开源图标资源 **lucide-static**，相关信息如下：

- **资源名**：lucide-static
- **版本**：1.73.0
- **许可**：ISC License（ISC 许可）
- **来源**：https://github.com/lucide-icons/lucide
- **取用范围**：本项目只取用包内 `package/icons/*.svg` 的**路径数据**（即 `<symbol>` 内部的子元素及其属性）。生成时剥离每个文件的根 `<svg ...>` / `</svg>` 标签与文件顶部的 license 注释，未使用包内其它任何资源。
- **生成脚本位置**：`tools/icons/build-sprite.js`（纯 Node CJS，读取 `lucide-static-1.73.0.tgz`，产出 `tools/icons/sprite-lucide.html` 片段与 `tools/icons/map.json` 映射表）。
- **图标数量**：共 **57 个**（改造前原有 54 个 + 本次替换补齐 `i-wrench` / `i-gear` + 后续卡片来源按钮新增 `i-globe`；原有 `<symbol id="i-xxx">` 的 id 保持不变，仅替换路径数据）。
- **日期**：2026-11-15

> ISC 许可要求保留版权与许可声明，故随项目分发 LICENSE 原文。

许可原文见同目录 `LUCIDE-LICENSE.txt`（从 tarball 内 `package/LICENSE` 原文逐字节复制，含 ISC 正文及 Feather 衍生图标的 MIT 声明）。

## 补充说明

- 语义映射表与「实际采用的 lucide 文件名」记录在 `tools/icons/map.json`。
- 校验结果：`i-dice` 原拟用 `dice`，该名称在 1.73.0 中不存在，实际采用官方图标 `dices`（最接近的官方替代）；其余映射名称在包内均存在。
- `i-box` / `i-cube` 分别取 `package` / `box`（分别用于拓竹 / 快造，路径不同）；`i-close` / `i-x` 为两个独立 symbol（分别用于弹窗 / 窗口按钮）。
- 静态检查脚本：`tools/probe-icons.js`（断言 57 个 id 齐全、引用无孤儿、无重复 id、viewBox 与内容合法）。
