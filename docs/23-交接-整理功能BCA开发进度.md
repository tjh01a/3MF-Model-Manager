# 23 · 交接文档：整理功能 B / C / A 开发进度

> 交接时间：2026-11-26 13:35　基线：v1.2.0（`main` @ `2f06055`）　计划书：`docs/22-整理与体验增强计划书.md`
> **状态更新（2026-11-26 16:30）：界面已全部接通，B/C/A 三个视图可从侧栏进入；走查探针三个全绿；`npm run selftest` 全绿。见 §7。**

## 1. 现在能不能直接用

- 能，而且界面已经能点了：侧栏「质量检查」下的**重复文件 / 同款变体 / 损坏文件**三个入口都已接通。
- `npm run selftest` 全绿；`electron:smoke` 启动正常（144 个 IPC）；三个走查探针全绿。
- 首次启动几秒后仍会在后台计算几何指纹，但界面里能看到「已计算 / 待计算 / 失败（无网格）」进度，也能手动暂停/重算。
- 代码仍在分支 `wip/bca-organize` 上，未推送；`main` 仍是发布版。版本号未动（README 标为「1.2.1 开发中」）。

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

## 3. 界面接入清单（2026-11-26 已完成）

1. ✅ **损坏文件隔离区**：`src/renderer/js/views/quarantine.js` 已建，导出 `renderBroken / onBrokenClick / leaveBroken`。
   数据来自 `api.brokenList()`，动作 `br-retry / br-repair / br-quarantine / br-restore / br-trash / br-forget`，
   每行先确认再执行；修复是两段式（先产出 `.repaired.3mf`，再问是否替换，替换前备份 `.broken.bak`）。
2. ✅ **重复文件视图**：`docs/wip/duplicates.view.wip.js` 已落位到 `views/duplicates.js`，原 wip 文件删除。
   落位时修了文件里 6 处括号缺失（语法哨兵直接挡下），并补了头部「共 N 组 · M 个文件 · 可释放」汇总。
3. ✅ **侧栏与路由**：`SMART_VIEWS` 加 `broken` / `variants`，进这四个体检视图都清筛选；`app.js` 的 `doRefresh` 映射到
   同名 `contentMode`；`views/toolbar.js` 的 `SMART_LABELS` 也补了标题（漏这处标题栏会一直显示「全部模型」）。
4. ✅ **详情页「副本」小节**：`detail.js` 用 `api.dupAliases(id)` 异步填 `#detail-aliases`，行内标注
   `aliasState`（仍在原处 / 已进回收站），按钮走 `aliasDetach`。注意该接口返回**数组**，不是 `{items}`。
5. ✅ **样式**：补齐 `.dup-pick .dup-radio .dup-reasons .dup-note .empty-extra .badge-ok`，另加隔离区行样式 `.br-*`；
   顺手补了 `.badge.warn / .danger / .badge-warn / .badge-dup` 的语义底色（原来一直没样式）。
6. ✅ **英文词条**：新增 150 条（含动态数量片段），`tools/i18n-missing.js` 里 B/C/A 相关 key 清零。
7. ✅ **设置页**：加「后台计算几何指纹」开关（`scan.shapePrint`）和「隔离目录」（`quarantine.dir`，留空 = 数据目录下 quarantine）。
8. ✅ **探针**：新增 `probe-bca-seed.js` / `probe-bca-prepare.js` / `probe-broken.js` / `probe-merge.js` / `probe-variants.js`；
   旧的 `probe-dup-cleanup*.js`（断言已删除的 `sp-clean-all`）已删。
9. ✅ **文档**：`docs/09` 加 §15 三件套与 5 条新坑、`docs/03` 补 13 个 IPC、`docs/18` 加变更记录、README 中英同步（标为 1.2.1 开发中）。

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
npm run selftest                 # 全量：17 套 + IPC 契约
node tools/smoke-organize.js     # 服务层冒烟：隔离→移回→修复→替换→合并→指纹，末尾打印「全部通过」
```

界面走查（隔离数据目录，不碰真实库）：

```bash
node tools/probe-bca-prepare.js %TEMP%/ps-probe-bca
set PRINTSHELF_DATA_DIR=%TEMP%/ps-probe-bca
node launch.js --capture=%TEMP%/probe-broken.png   --ui-script=tools/probe-broken.js
node launch.js --capture=%TEMP%/probe-merge.png    --ui-script=tools/probe-merge.js
node launch.js --capture=%TEMP%/probe-variants.png --ui-script=tools/probe-variants.js
```

## 6. 计划书与实现的差异

- 阈值可调的设置项没做（阈值写在 `shapeprint.js` 顶部常量里，校准成本高，不建议暴露给用户）。
- 「疑似」区间（0.70–1.30）在真实库里本来就混有无关模型，这是算法上限；界面上要把「同一模型」和「疑似」分开标，合并「疑似」必须逐组确认。
- 几何指纹只在启动后和每次扫描结束后后台补算，没有做实时进度事件，界面靠轮询 `shapeStatus`。

## 7. 2026-11-26 收尾记录

- 界面：`quarantine.js` 新建；`duplicates.js` 用 wip 成品替换（修了 6 处语法括号）；详情页副本小节；侧栏/工具栏/路由；设置页两项；CSS 徽标与行样式。
- 修掉的隐性 bug：`dupAliases` 返回数组却被当成 `{items}`（详情小节永远空白）；`SMART_LABELS` 缺 variants/broken（标题永远「全部模型」）；重复页头部把同款变体成员重复计数（「2 组却 6 个文件」）。
- 探针：`probe-broken` 18 条断言、`probe-merge` 20 条、`probe-variants` 13 条，全绿；截图在 `%TEMP%/probe-*.png`（样本缩略图是 1x1 红点，卡片大红块是夹具现象，不是回归）。
- 文档：`09` §15 + §12.2，`03` IPC 表，`18` 变更记录，README 中英。
- 还没做：GitHub 推送 / 打包 1.2.1 / 真实库跑一遍三视图（建议先备份 `data/`）。
