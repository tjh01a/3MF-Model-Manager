# 23 · 交接文档：整理功能 B / C / A 开发进度

> 交接时间：2026-11-26 13:35　基线：v1.2.0（`main` @ `2f06055`）　计划书：`docs/22-整理与体验增强计划书.md`
> **一句话状态：三个功能的核心逻辑、主进程服务、IPC 全部做完并测过；界面只写了一半（未接入，已移出加载路径）。应用当前可正常运行。**

## 1. 现在能不能直接用

- 能。`npm run selftest` 全绿（既有 15 套零回归 + 新增 3 套），Electron 无头自检通过，IPC 契约一致（144 个方法）。
- 用户可见的变化只有一处：启动几秒后后台计算一次几何指纹，弹一条提示「几何指纹已计算 N 个模型，发现 M 组同款变体」。首次约 10 秒（中位 56ms/文件），大文件可达 0.5 秒，会轻微占用主进程。
- 隔离区、合并、同款变体三个界面**还没有入口**，所以这些功能暂时只能通过 IPC / 测试调用。
- 代码在分支 `wip/bca-organize` 上的一个本地提交里，**没有推送**；`main` 仍是发布版。

## 2. 已完成

| 层 | 文件 | 内容 |
|---|---|---|
| 核心 B | `src/core/quarantine.js` | 错误归类 7 类、完整诊断、修复（永远输出新文件）、按本地文件头抢救截断 zip、CRC 校验、文件移动、列表生成 |
| 核心 C | `src/core/merge.js` | 主记录打分（带理由）、三种分组、计划生成、写回别名、概览 |
| 核心 A | `src/core/shapeprint.js` | 几何指纹（D1/D2/D3/D4/A3/二面角/棱长比 7 个特征）、相似度、分桶、`ShapeIndex` 索引与分组 |
| 联动 | `library.js` `scanner.js` `duplicates.js` `model3mf.js` `constants.js` | 别名默认隐藏、隔离状态、`broken`/`variants` 智能视图、扫描器写坏文件类型、别名存根不判失效 |
| 服务 | `electron/services.js` | `trashIds`、`broken*` 6 个、`shape*` 4 个、`mergeApply`、`aliasesOf`、`aliasDetach`、后台自动补算 |
| IPC | `electron/ipc/index.js` `preload.js` `api.js` | 新增 13 个方法，契约一致 |
| 测试 | `tests/quarantine-tests.js`(39) `tests/merge-tests.js`(53) `tests/shapeprint-tests.js`(57) | 已加入 `npm run selftest` |
| 冒烟 | `tools/smoke-organize.js` | 不开界面，在 Node 里把服务层实际跑一遍 |

## 3. 未完成（按建议顺序）

1. **界面 · 损坏文件隔离区**：新建 `src/renderer/js/views/quarantine.js`，导出 `renderBroken(content)`、`onBrokenClick(e)`、`leaveBroken()`（重写的重复文件视图已按这三个名字 import）。数据来自 `api.brokenList()`，动作用 `brokenRetry / brokenRepair(id,{replace}) / brokenQuarantine / brokenRestore / brokenTrash(=api.trash) / brokenForget`。
2. **界面 · 重复文件视图（已写完未接入）**：成品在 `docs/wip/duplicates.view.wip.js`，放回 `src/renderer/js/views/duplicates.js` 即可。它已经包含：合并流程、一键合并、手动改选主记录、同款变体视图。**放回去之前必须先有第 1 步的文件**，否则渲染层加载失败。
3. **侧栏与路由**：`views/sidebar.js` 的 `SMART_VIEWS` 加 `broken`（损坏文件）和 `variants`（同款变体），点击时清筛选的条件里加上这两个 key；`app.js` 的 `doRefresh` 里把 `smart === 'broken' / 'variants'` 映射到同名特殊视图。
4. **详情页「副本」小节**：`views/detail.js` 加一个异步小节，调 `api.dupAliases(id)` 列出副本，按钮走 `aliasDetach`。
5. **样式**：新视图用到的类还没写：`.dup-pick` `.dup-radio` `.dup-reasons` `.dup-note` `.spacer` `.empty-extra` `.badge-ok`。
6. **多语言**：新界面的文案都用 `tr()` 包了，但 `src/renderer/locales/en-US.js` 里**还没有对应英文词条**，需要补。
7. **设置页**：隔离目录（`settings.quarantine.dir`）和几何指纹开关（`settings.scan.shapePrint`）已有默认值，但没有界面。
8. **探针**：计划中的 `probe-broken / probe-merge / probe-variants` 未写。旧的 `tools/probe-dup-cleanup.js`、`probe-dup-cleanup-exec.js` 断言的是已被替换的「一键清除」按钮（`sp-clean-all`），接入新视图后会失效，需要改写或删除。
9. **文档**：`docs/09`、`docs/18`、README 未更新；版本号未动。

## 4. 必须知道的坑（都踩过了）

- **几何指纹的阈值是按真实模型库定的，别按合成样本改回去**：同一模型 ≤ 0.70，疑似 ≤ 1.30。在 191 个真实模型上，真同款落在 0.28–0.65，无关模型从 0.70 开始，0.98–1.3 几乎全是无关的手办部件。
- **全局形状分布分不出「方」和「圆」，也分不出轮廓不同的薄板**。后来加的两个特征解决了大部分：二面角直方图（立方体棱全是 90°）和「棱边总长 ÷ 尺寸」（区分单件平板和多拼块版画）。
- **直方图不能用 `Uint8Array` 直接计数**（6000 个点对 256 取模会溢出，所有距离变成 4）；要先计数再缩放到 0–255。
- **二面角必须软分箱**：立方体的棱正好 90°，硬分箱会让同一个模型换个姿势就判成不像。
- **尺寸用均方根半径，不能用轴对齐包围盒**（旋转后会变，2 倍缩放会算成 3.18）。
- **分组成员必须和「基准」相似**，否则并查集会把「A~B、B~C 都疑似」的无关模型串成一组。
- **切片盘文件（plate_1.3mf）没有网格**，`3dmodel.model` 只是 1KB 的壳。它们是合法文件、不算损坏，但做不了几何指纹，真实库里 191 个有 82 个属于这种。`parse3mf` 现在返回 `core.mesh` 来区分「有网格」和「只有壳」。
- **扫描器写回以「当前库记录」为底叠加**：想让字段清空必须显式写 `null`，只 `delete` 会把旧值留下来（别名恢复就栽在这）。
- **合并后的「撤销」只能解除副本关系**，不能把文件从回收站取回。确认对话框文案要如实写。
- **`contextBridge` 暴露的对象是冻结的**，渲染层打桩 `window.shelf.win` 无效。
- **别名必须从回执匹配里排除**，否则合并后同名副本会让「唯一匹配」失效（`services._liveModels()`）。

## 5. 如何验证

```bash
npm run selftest                 # 全量：既有 15 套 + 新增 3 套 + IPC 契约
node tools/smoke-organize.js     # 服务层冒烟：隔离→移回→修复→替换→合并→指纹，末尾打印「全部通过」
```

界面接入后的走查用隔离数据目录，不要碰真实库：

```bash
PRINTSHELF_DATA_DIR=<临时目录> node launch.js --capture=<临时 png> --ui-script=tools/<探针>.js
```

## 6. 计划书与实现的差异

- 阈值可调的设置项没做（阈值写在 `shapeprint.js` 顶部常量里，校准成本高，不建议暴露给用户）。
- 「疑似」区间（0.70–1.30）在真实库里本来就混有无关模型，这是算法上限；界面上要把「同一模型」和「疑似」分开标，合并「疑似」必须逐组确认。
- 几何指纹只在启动后和每次扫描结束后后台补算，没有做实时进度事件，界面靠轮询 `shapeStatus`。
