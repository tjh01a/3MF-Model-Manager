# 23 · 交接文档：整理功能 B / C / A（写于 2026-11-26）

> 状态：**核心层 + 服务层 + IPC + 测试已完成并通过；界面层未接入（有一份写了一半的视图代码）**。
> 本文档写给下一个继续开发的会话：做完「还差什么」一节即可发版。
> 分支：`wip/bca-organize`（本地，未推送）。`main` 停在已发布的 `2f06055`（v1.2.0），干净未动。
> 计划书见 `docs/22-整理与体验增强计划书.md`（A–I 九个功能的完整设计，本文只覆盖已开工的 B、C、A）。

## 1. 一句话现状

在 Node 与 Electron 里，B（损坏隔离区）、C（重复智能合并）、A（几何指纹）的**后端全部可用且验证过**：扫描会把坏文件归类、能隔离 / 移回 / 修复 / 重试；重复组能按打分推荐主记录、合并为别名、移入回收站并报释放空间；几何指纹能算 191 个真实模型、发现同款变体并在扫描后自动分组。**但用户在界面上看不到这些**：侧栏没有入口、三个视图没接渲染、详情页没有副本小节。

## 2. 完成度

| 部分 | B 隔离区 | C 智能合并 | A 几何指纹 |
|---|---|---|---|
| 核心模块（纯 Node） | ✅ `quarantine.js` | ✅ `merge.js` | ✅ `shapeprint.js` |
| 查询 / 统计语义 | ✅ `status=quarantined`、`smart=broken` | ✅ 别名隐藏、`includeAliases` | ✅ `smart=variants` |
| 扫描器联动 | ✅ 失败归类 + 坏文件重试 | ✅ 别名保持 / 恢复 / 不判失效 | ✅ 扫描后自动重算分组 |
| 主进程服务 | ✅ `services.js` broken* | ✅ mergePreview / mergeApply / aliasesOf / aliasDetach | ✅ shapeStatus / shapeRun / shapeStop + 后台补算 |
| IPC + preload + api | ✅ 6 个方法 | ✅ 4 个方法 | ✅ 3 个方法（契约检查通过，144 个方法） |
| 单测 | ✅ 39 项 | ✅ 53 项 | ✅ 57 项（已加入 `npm run selftest`） |
| 服务层冒烟 | ✅ `tools/smoke-organize.js` 全过 | ✅ 同左 | ✅ 同左 |
| **界面** | ❌ 未接入 | ❌ 未接入（有一份 WIP） | ❌ 未接入 |
| i18n 词条 | ❌ | ❌（WIP 里已用 `tr()`） | ❌ |
| 文档（09/18/README） | ❌ | ❌ | ❌ |

## 3. 已落地的文件

**新增**

- `src/core/quarantine.js` —— 错误归类（7 类）、完整诊断、修复（输出新文件，绝不覆盖原文件）、本地文件头抢救、隔离目录移动、`brokenItems` 列表。关键导出：`classifyParseError / diagnose3mf / repair3mf / moveFile / brokenItems / brokenKindOf / BROKEN_MESSAGES / KINDS`。
- `src/core/merge.js` —— 打分（`scoreMember`，理由会显示在界面）、分组（exact / similar / variant 三种）、`planMerge`（校验 + 释放字节）、`applyMergeInLibrary`（写回 + 失败逐条回滚 + 自动重算重复标记）、`summarize`。
- `src/core/shapeprint.js` —— 形状指纹（D1/D2/D3/D4/A3 直方图 + 二面角直方图 + 棱长比 lp + 均方根半径），`ShapeIndex`（存 `数据目录/shapeprints.json`，按文件哈希判断过期，`annotate()` 写回 variantGroup/Role/Score/Scale），`candidatePairs`（>1500 条时分桶）。
- `tests/quarantine-tests.js`（39）、`tests/merge-tests.js`（53）、`tests/shapeprint-tests.js`（57）—— 已挂进 `package.json` 的 `selftest`。
- `tools/smoke-organize.js` —— 服务层冒烟（临时目录，跑完即删，9 项断言）。
- `docs/wip/duplicates.view.wip.js` —— **写了一半的重复文件视图**（见第 5 节）。

**修改**

- `src/core/model3mf.js` —— `parse3mf` 结果新增 `core = { contentTypes, rels, model, gcode, mesh }`；`mesh` 只有在主模型文件里没有 `<mesh>` 时才去翻其它 `.model` 条目（正常文件不多读任何东西）。
- `src/core/scanner.js` —— 解析失败 → `parseErrorKind`；结构异常（无网格无 G-code / 缺核心条目）→ 归类；`parseError` 非空的文件每轮扫描自动重试（用户替换过文件就能自愈）；别名存根：文件消失不判失效、文件回来解除别名；扫描 mutator 末尾若有指纹索引则重算变体；`report.broken`；`_selfDirs` 加入 `quarantine/`。
- `src/core/library.js` —— `UPDATABLE_FIELDS` 加 9 个字段；`SMART_KEYS` 加 `broken` / `variants`；`query()` 隐藏别名与已隔离；`stats()` 加 `quarantined/broken/aliases`；`smartCounts()` 同口径；`roulette()` 排除别名；`remove()` 时主记录被删则别名自动恢复；`aliasesOf()` / `detachAliases()`；`relink()` 清隔离字段。
- `src/core/duplicates.js` —— `annotate()` 排除别名参与分组（否则合并完的组会复活）。
- `src/core/constants.js` —— `settings.scan.shapePrint: true`、`settings.quarantine.dir: ''`；`SMART_VIEWS` 加 `broken`（损坏文件）与 `variants`（同款变体）。
- `electron/services.js` —— `trashIds`（回收站统一出口）、`brokenList/Retry/Repair/Quarantine/Restore/Forget`、`shapeStatus/Run/Stop` + `scheduleShapeRun`（启动后 4s、扫描新增后 8s 自动补算，完成弹 toast）、`_annotateVariants`、`mergePreview/Apply`、`aliasesOf/aliasDetach`、`_liveModels()`（回执匹配排除别名——合并后同名副本不再破坏「唯一匹配」）。**`trash` IPC 已改走 `services.trashIds`**（行为不变，返回值多了 `bytes`）。
- `electron/ipc/index.js`、`electron/preload.js`、`src/renderer/js/api.js` —— 新增 13 个方法（`broken*` 6、`shape*` 3、`dup*` 3、`aliasDetach` 1）。

## 4. 已验证的事实（不用重新验证）

1. `npm run selftest` 全绿（新增 3 套 149 项断言 + 既有 15 套零回归）；`tools/check-ipc-contract.js` 一致（144 方法）；`launch.js --smoke` 在 Electron 里正常。
2. `tools/smoke-organize.js` 在 Node 里驱动真实 Services 全过：扫描归类 → 重试 → 隔离（文件真实移动、记录隐藏）→ 移回 → 修复（生成 `.repaired.3mf`）→ 替换（原文件留 `.broken.bak`）→ 移出索引 → 合并（shadow 别名、查询/统计/重复计数正确）→ 解除别名 → 指纹计算 → 变体分组 → toast。
3. **真实库校准（191 个模型，只读）得出的阈值已写死在 `shapeprint.js`**：`SAME_DIST = 0.70`、`MAYBE_DIST = 1.30`。真同款（同一文件的多副本、原版与 `.u1` 转换版）0.28–0.65；无关模型从 0.70 起出现；真实「另一版本」（v2、带/不带 AMS）0.72–0.93；0.98–1.3 几乎全是无关手办部件；1.3 以上上千对全部无关。**不要凭感觉调回更松的阈值**。
4. 校准发现的两个坑已在实现里处理：直方图用 Uint8 计数会溢出（先计数再按最大值缩放）；二面角 90° 正好落在格子边界（软分箱：按到相邻格中心的距离线性分摊）。
5. 191 个模型里 82 个是切片盘文件（`3dmodel.model` 是 1KB 空壳、几何只剩 G-code）→ `parse3mf` 返回 `core.mesh=false` 但不算坏文件（有 G-code 就是合法可打印文件），指纹计算跳过（`failed: 'no-mesh'`），后台重试不会反复重算它们（`_shapeTargets` 排除已失败的，除非手动 force）。
6. 性能：单文件指纹中位数 56ms、p95 317ms；索引每条约 1KB；1 万条以内 `annotate` 走全配对，更多走分桶。
7. `electron/services.js` 里 `shell` 是惰性 `require('electron').shell`（Node 下为 null）——只有 `trashIds` / `mergeApply(trash:true)` 用到，都在 Electron 主进程里跑，测试别在 Node 里调这两个。

## 5. 还差什么（按顺序做）

### 5.1 把界面接上（最大的一块）

1. **把 `docs/wip/duplicates.view.wip.js` 移回 `src/renderer/js/views/duplicates.js`**（它 import 了 `./quarantine.js` 的 `renderBroken / onBrokenClick / leaveBroken`，所以先做第 2 步）。它已经实现：合并分组卡片（单选主记录 + 推荐理由）、`sp-merge` / `sp-merge-trash` / `sp-merge-all`（确认对话框含释放空间与撤销说明）、变体视图（`sp-shape-run` / `sp-shape-stop` + 2.5s 轮询计算状态）、`missing` 视图原样保留。**注意它把渲染改成了 async**（`renderDuplicates` 先拉 `api.dupMergePreview()`），`renderSpecialView` 里相应分支已适配。
2. **新建 `src/renderer/js/views/quarantine.js`**：数据 `api.brokenList()`；行 = 缩略图 / 文件名 / 错误类型徽标（`kindLabel`）+ `hint` 人话 / 路径 / 大小；操作：重试解析（`brokenRetry`）、尝试修复（先 `selectDialog` 选「替换原文件（原文件留 .broken.bak）」或「保留两个文件」→ `brokenRepair(id, {replace})`）、移入隔离区（`brokenQuarantine`）、移回（`brokenRestore`）、移入回收站（`api.trash`）、移出索引（`brokenForget`）；顶部全选 + 批量操作；空状态文案「没有损坏的文件」。导出 `renderBroken(content)`、`onBrokenClick(e)`（处理 `bq-` 前缀动作）、`leaveBroken()`（如需清理轮询）。
3. **`src/renderer/js/app.js`** `doRefresh()` 的 mode 映射加两个：`smart === 'broken' → 'broken'`、`smart === 'variants' → 'variants'`（现在只认 duplicates / missing / receipts）。
4. **`src/renderer/js/views/sidebar.js`**：`SMART_VIEWS` 数组加 `{ key:'broken', label:tr('损坏文件'), icon:'i-alert', group:'quality' }` 和 `{ key:'variants', label:tr('同款变体'), icon:'i-layers', group:'quality' }`；`onClick` 里进入这两个视图时也要清掉会挡住结果的筛选（照抄 duplicates/missing 的那段）。计数用 `state.smartCounts.broken / .variants`（后端已返回）。
5. **`src/renderer/js/views/detail.js`**：「副本」小节——打开详情时 `api.dupAliases(id)`（可按 id 缓存，`lib:changed` 后失效），有别名就在「内容相同的文件」区块后渲染：缩略图 / 文件名 / 路径 / 徽标（`文件已进回收站` 或 `文件保留`）/ 「解除别名」按钮（`data-act="alias-detach"`，走 `api.aliasDetach([id])` 后 `emitRefresh`）。
6. **CSS**（`styles/views.css` 末尾追加即可）：`.dup-radio`（自定义单选圆点）、`.dup-item.is-keeper`（左侧 accent 描边）、`.badge-ok`（绿色）、`.dup-note`、`.dup-reasons`、`.empty-extra`。参考现有 `.dup-item` / `.badge` 体系。
7. **坏文件 toast 入口**：`app.js` 监听 `scan:done` 的地方（`onboarding.js` 里也有）若 `report.broken > 0`，toast 加「查看」按钮跳 `smart:'broken'`（现有 toast 支持 actionLabel，参考 `api.emitToast` 的用法）。

### 5.2 收尾清单

- i18n：WIP 视图里的中文都已包 `tr()`，但 `src/renderer/locales/en-US.js` 还没有对应词条（追加到文件末尾即可，注意该文件是 `tools/i18n-build-dict.js` 生成的——只追加、别重跑生成）；跑 `tools/i18n-missing.js` 查漏。
- 旧探针：`tools/probe-dup-cleanup.js` / `probe-dup-cleanup-exec.js` / `make-dup-fixture.js` 针对已删除的 `sp-clean-all` 流程，改成验证新合并流程（或删除）。新探针建议：`probe-merge.js`（用 `make-dup-fixture` 思路造 4 记录 2 组 → 点「一键合并」→ 断言 query 总数、toast、释放字节数）、`probe-broken.js`、`probe-variants.js`（照 `tools/probe-i18n.js` 的写法，`PRINTSHELF_DATA_DIR` 指向临时库 + 预置 library.json）。
- 文档：`docs/09-实现说明书.md` 加 A.24（B/C/A 实现）、`docs/18-交互与UIUX白皮书.md` 加变更行、`docs/22` 状态改为「已实施」、README 更新说明 + 截图。
- 版本：建议 `1.3.0`；`settings.js` 里可加两个开关（`scan.shapePrint`、隔离区目录），不加也能用（默认值已合理）。
- 发布前跑：`npm run selftest` → `node tools/smoke-organize.js` → 三个 `--capture` 探针 → 真实库上手动走一遍「一键合并」前先备份 `data/`（合并会真移文件进回收站）。

### 5.3 明确不做的（防止范围膨胀）

- 不做把 `.repaired.3mf` 自动替换之外的一键批量修复；不做从回收站程序化还原（Windows 没有可靠接口，合并确认框里已写明）；不做把切片盘文件关联回源模型的几何匹配（它们没有网格，留给现有的文件名匹配）；不做非等比拉伸的精确识别。

## 6. 关键设计决定（改动前先读）

1. **别名不删记录**：合并只把别名 `aliasOf` 指向主记录并从视图隐藏；文件进回收站后记录保留为存根（`aliasState:'trashed'`），备注 / 打印记录 / 路径都在。撤销（Ctrl+Z 快照）只解除别名关系，**不能**把文件从回收站拿回——确认框里已明确告知。
2. **`mergeScannedRecord` 以当前库记录为底叠加**：所以扫描器里「文件回来了要解除别名」必须**显式写 null**，只 `delete` 会被旧值顶回来（merge-tests 第 8 节专门测了这个）。
3. **指纹与库分离**：`shapeprints.json` 独立存，以 `record.hash` 判断过期；`annotate()` 每次先清空全部 variant 字段再算，幂等。组成员必须和**基准**相似（不是只和某个成员相似），防止 A~B~C 弱关联把无关模型串成一组。
4. **坏文件的可见性**：未隔离的坏文件仍出现在普通网格（无缩略图占位），只有 `quarantined` 像 `missing` 一样只在维护视图可见；别在任何地方把 `parseErrorKind` 当成「从普通视图隐藏」的理由。
5. **修复永不覆盖原文件**：输出 `<名>.repaired.3mf`；「替换」= 原文件改名 `.broken.bak`（非 .3mf 后缀，不会被重新扫描）+ 修复版顶上 + 立即重解析验证，失败自动回滚。
6. **合并主记录打分**（`merge.scoreMember`）：缩略图 +3、信息完整每项 +1、打印次数 +2×min(n,2)、收藏/备注/分类 +2、标签 +1；同分路径短的优先、再同最早入库优先。理由数组直接显示在界面上。

## 7. 验证命令速查

```bash
npm run selftest                    # 全量（含新增 3 套）
node tools/smoke-organize.js        # 服务层冒烟（临时目录，无界面）
node launch.js --smoke              # Electron 无头自检
node tools/check-ipc-contract.js    # IPC 契约
node tests/shapeprint-tests.js --verbose   # 打印合成网格两两距离（调阈值用）
```

真实库校准脚本已删除（当时的结论都写进了阈值注释与本文）；要复跑，照 `git show` 里被删的 `tools/_calib-real.js` 思路重建即可——记得**只读**，别往用户库里写。

## 8. 任务看板对应

- #220 B 隔离区：核心 / 服务 / 测试完成，界面未接 → 保持进行中
- #221 C 智能合并：同上
- #222 A 几何指纹：同上
