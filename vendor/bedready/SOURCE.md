# vendor/bedready —— 第三方转换引擎

这个目录里的代码**不是本项目写的**，它是 [BedReady](https://github.com/BedReady/bedready) 的编译产物。
拿出来单列，是为了以后换版本时能一眼看出「哪些是我们的、哪些是别人的」。

## 来源

| 项 | 值 |
| --- | --- |
| 上游 | https://github.com/BedReady/bedready |
| 分支 | `main` |
| 取得时间 | 2026-11-13 |
| 许可证 | MIT（见同目录 `LICENSE`，原文未改动） |
| 产物 | `bedready-node.cjs`（CommonJS，244 KB） |

## 怎么重新生成

上游是 TypeScript + Next.js，转换逻辑本身是纯 TS，只有 `fflate` 一个运行时依赖。
官方仓库自带 `esbuild`，所以直接打包给 Node 用：

```bash
curl -sL https://codeload.github.com/BedReady/bedready/tar.gz/refs/heads/main -o bedready.tgz
tar xzf bedready.tgz && cd bedready-main
npm install fflate esbuild --no-audit --no-fund

# 1) 把内部函数改为可导出，并把两个「浏览器护栏」改成可注入
#    否则 Node 侧无法调用，且 800 MB 解压上限会挡掉一半真实模型
#    MAX_ZIP_COMPRESSED / MAX_ZIP_INFLATED → 读 globalThis.__BEDREADY_CAP_*__
#    function retargetThreeMF → export function retargetThreeMF

# 2) Node 入口
cat > src/lib/node-entry.ts <<'EOF'
export { cleanThreeMF, normalizeHex, dropRangeLayerHeights } from "./convert.patched";
export { U1, MACHINES, getMachine, u1NozzleVariant, configFamily } from "./targets";
EOF

# 3) 打包
npx esbuild src/lib/node-entry.ts --bundle --platform=node --format=cjs \
  --target=node18 --outfile=dist/bedready-node.cjs
```

## 我们改了什么

只有两处，且都不改变转换逻辑本身：

1. **`MAX_ZIP_COMPRESSED` / `MAX_ZIP_INFLATED` 改为从 `globalThis` 读取**，默认值不变。
   上游这两个值是给浏览器标签页用的防 zip 炸弹护栏（800 MB）。桌面主进程内存宽裕得多，
   而用户库里 180 MB 级的 3MF 解压后普遍在 850 MB ~ 1.2 GB，原值会直接判失败。
   调用方在 `src/core/u1convert.js` 里设置上限。

2. **`retargetThreeMF` 加到导出表**（2026-11-24）：排查 A1 mini 错位时需要在 Node 侧做「同族换机」实测，
   esbuild 产物默认不导出它，这里在 `__export(node_entry_exports, {...})` 里补一行。
   注意：它的入参是 `entries`（路径 → Uint8Array），返回 `{ blob, ... }`，不是 Buffer。
   目前只用于走查脚本，正式转换流程没有调用；生产路径的床位补偿在我们自己的 `src/core/u1bedshift.js`。

## 已知缺陷（我们在调用侧补齐，未改上游）

上游 `preserve` 模式（保留原作者设置）不会改写 `print_compatible_printers` 与
`upward_compatible_machine`，导致拓竹源转换出的文件被快造 Orca 2.4 判为
`process not compatible with printer`。上游自带的 `u1-profile.json`（`stamp` 模式用的样板）
里这两个键是正确的，所以本项目一律用 `stamp` 模式，并在 `u1convert.js` 里再兜一层保险。

细节见 `docs/06-快造U1转换调研与计划.md`。
