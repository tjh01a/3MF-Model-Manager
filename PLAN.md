# 设备模块实施计划（PLAN）

## 1. 目标与边界

把“连接打印机”从只支持 IP 手填的弹窗，升级为独立的**设备中心**：侧栏入口、局域网多策略发现、统一适配器、设备监控与基础控制。保留原有打印机面板和拓竹云通道，不删除旧入口。

## 2. 技术选型

| 能力 | 选型 | 理由 |
| --- | --- | --- |
| mDNS/DNS-SD | `multicast-dns` | 纯 JS、无原生编译，能自己发 PTR/SRV/TXT 查询，打包简单 |
| SSDP | Node `dgram` | 只需发 M-SEARCH、收 UDP 响应，不值得引库 |
| HTTP | Node `http/https` | 打印机多为明文 HTTP；自己控制超时/证书跳过 |
| MQTT（Bambu） | 项目已有 `BambuMqtt` | 已有实机验证、证书 CN 取序列号、访问码读取 |
| MQTT（Anycubic） | 新 `AnycubicMqtt`（TLS + 客户端证书） | Anycubic 需要 mTLS，现有客户端不支持证书 |
| FTPS（Bambu 上传） | `basic-ftp` 的 implicit TLS | 避免手写隐式 FTPS 状态机 |
| 文件上传 | Node 流式 multipart | 大 3MF 不整文件进内存 |

新增依赖：`multicast-dns`、`basic-ftp`。均为运行期依赖，`build-portable.js` 会按 `package.json` 递归收集。

## 3. 目录与模块

```
src/core/
  device-catalog.js        # 品牌注册表、Beta/能力/默认端口/展示名
  discovery.js             # mDNS + SSDP + HTTP 指纹 + 端口/子网扫描 + 合并去重
  adapters/
    base.js                # PrinterAdapter 接口与状态归一化工具
    moonraker.js           # 快造 / Creality / 通用 Klipper
    octoprint.js           # Anycubic Kobra 2、通用 OctoPrint
    flashforge.js          # 闪铸 8898 HTTP
    anycubic.js            # 纵维 18910 握手 + 9883 mTLS MQTT
    bambu.js               # 拓竹适配器（包装现有 MQTT + FTPS 上传）
    http.js                # JSON / multipart 小工具
  printers.js              # 服务层：配置、轮询、控制、发现、广播（改造）
```

### 3.1 统一接口

```js
class PrinterAdapter {
  constructor(config)
  async connect()                       // 建立长连接/校验凭据
  async disconnect()
  async getStatus()                     // 返回统一 status
  async pause() / resume() / stop()
  async setTemperature(nozzle, bed)
  async sendJob(filePath, { start })    // 上传并可选立即打印
  async getCameraStream()               // { url, kind } 或 null
}
```

统一 status（在现有字段上扩展，不破坏旧 UI）：

```js
{
  id, kind, brand, adapter, beta, name, model, ip,
  online, state, stateText,
  job: { name, percent, remainingMin, elapsedMin, layer, layers },
  temps: { nozzle:{cur,target}, bed:{cur,target}, chamber, heads },
  fan, speed, materials,
  camera: { streamUrl, snapshotUrl, kind } | null,
  capabilities: { pause, resume, stop, temp, sendJob, camera },
  updatedAt, error
}
```

## 4. 发现架构

`discover({ timeout, deep })` 并发四路，统一进 `Map<dedupeKey, record>`：

1. **mDNS**（3.5s）：向 224.0.0.251:5353 查询 `_moonraker._tcp`、`_octoprint._tcp`、`_printer._tcp`、`_http._tcp`；解析 PTR→SRV→A/TXT。
2. **SSDP**（3s）：Bambu 2021/1990 的 `urn:bambulab-com:device:3dprinter:1`；通用 1900 的 `ssdp:all` 只作补充。
3. **HTTP 指纹**（端口并发）：对已发现 host 和本网段候选 host 请求 `/server/info`、`/api/version`、`/info`、`/detail`、`/`。
4. **端口/子网兜底**：7125、4408、4409、80、71、8898、8899、9999、9883、8883、990、18910；每网段 254 个地址，64 并发，350ms 超时。

合并规则：

- 有 serial/MAC 用 `serial:<id>`，否则 `host:<ip>`。
- 同 key 合并 `sources`、`ports`、`also`；品牌优先级 `bambu=anycubic=flashforge=creality=snapmaker > moonraker-generic > octoprint-generic > unknown`。
- 只有端口开放、没有任何协议指纹的记录标 `confidence:'low'`，不自动连接。
- 去重后按 `online/connected/brand/name` 排序。

## 5. 服务层改造

- `add/update/remove` 接受 `bambu|snapmaker|anycubic|creality|flashforge|moonraker|octoprint`。
- `tick()`：
  - Bambu 走现有 `_ensureBambu`；
  - Snapmaker 走现有 `_pollMoonraker`（实机验证过，不动）；
  - 其余走 `_adapterFor(p).getStatus()`，连续 2 次失败才离线。
- 新方法：`setTemp(id,{nozzle,bed})`、`sendJob(id,filePath,{start})`、`cameraInfo(id)`。
- `printerAction` 统一转发到 adapter。
- `printersDiscover` 改为调用 `discovery.discover()`。
- 发现结果含 `needs`（需要哪些凭据）、`autoConnect`（无凭据可直连）、`beta`、`brand`、`protocol`。

## 6. UI 改动

### 6.1 侧栏

- 新增独立分组“设备”，入口“设备中心”（图标打印机），不替换模型库/质量/耗材的任何入口。
- 打开时 `#main` 进入设备模式，隐藏模型工具栏/网格，显示 `#device-hub`。
- 顶栏原有打印机按钮保留，点击同样进入设备中心；旧 `devices.js` 弹窗代码保留但不再默认打开。

### 6.2 设备中心布局

```
┌ 设备中心   [扫描局域网] [添加 IP]        已连接 2 / 发现 3 ┐
├───────────────┬───────────────────────────────────────────┤
│ 设备列表       │ 选中设备监控                              │
│ · 已连接卡片   │ 头部：名称 · 品牌 BETA · IP · 状态点       │
│ · 发现卡片     │ 一级：状态 / 大进度 / 剩余时间 / 文件名     │
│ · 需配置卡片   │ 二级：喷嘴 / 热床 / 腔温 / 风扇 / 速度      │
│               │ 摄像头（若可用）                           │
│               │ 操作：暂停 继续 停止 | 温度设定 | 发送任务   │
│               │ 详情：层数 / 已打 / 固件 / 协议 / 最后更新   │
└───────────────┴───────────────────────────────────────────┘
```

- Beta：品牌名旁 + 设备卡右上角 + 监控头部都放 `BETA` 徽标；tooltip 固定文案“未经过实机验证，协议基于公开资料/社区实现”。
- 连接弹窗字段按品牌动态显示：拓竹访问码、闪铸序列号+校验码、OctoPrint API Key；Moonraker/Anycubic 原生无需凭据。
- 扫描后对 `autoConnect` 且无凭据的设备自动连接，其余显示“需配置”；自动连接失败不阻塞列表。
- 发送任务：调用 `printerPickFile` 选 `.gcode/.3mf/.gco`，再 `printerSendJob`；上传中显示按钮进度，失败保留原因。
- 状态刷新：沿用服务层 `printer:update` 事件，页面按 id 局部更新，不整页重建导致输入框失焦。

## 7. 分阶段执行

1. `RESEARCH.md` + 本计划。
2. `device-catalog.js`、`discovery.js`、`adapters/http.js`、`base.js`。
3. Moonraker → OctoPrint → FlashForge → Anycubic → Bambu 适配器。
4. 服务层接线 + IPC + `api.js` 方法表。
5. 设备中心 UI + CSS + 侧栏/路由。
6. 测试：发现合并、类型推断、五品牌解析、控制状态机、Anycubic 握手解密（固定向量）、Bambu FTPS mock（不真连）。
7. 自检、UI 探针、文档、提交。

## 8. 验收标准（逐条可复现）

| # | 标准 | 验证方式 |
| --- | --- | --- |
| A1 | 侧栏有“设备”独立入口，原模型库入口仍在 | 启动截图 / DOM 查询 |
| A2 | 点击入口打开设备中心，模型网格隐藏，关闭后恢复 | UI 探针点击 |
| A3 | 扫描同时跑 mDNS/SSDP/HTTP/端口，结果去重 | `tests/discovery-tests.js` 固定响应 |
| A4 | 同 host 的 Moonraker+OctoPrint 记录合并为一条，保留 `also` | 单测 |
| A5 | 品牌推断正确：Bambu SSDP、Anycubic /info、Creality 9999、FlashForge 8898、Snapmaker mDNS | 单测 |
| A6 | 五个品牌状态解析字段正确 | `tests/device-adapter-tests.js` mock |
| A7 | 暂停/继续/停止命令对四种协议生成正确请求 | 单测拦截 http/mqtt |
| A8 | 温度设定生成正确请求 | 单测 |
| A9 | 发送任务 multipart 字段正确，start 标志正确 | 单测 |
| A10 | 非拓竹/快造的设备卡片、品牌名、监控头部都有 BETA + tooltip | DOM 探针 |
| A11 | 监控页一级/二级/操作分区清晰，窄窗口不溢出 | 截图 + 1440/1100 宽检查 |
| A12 | 扫描无结果时有空态和“手动添加 IP” | UI 探针 |
| A13 | 旧 `printersList/Add/Test/Action` 仍可用 | 现有 printer-tests |
| A14 | `npm run selftest` 全绿 | 命令 |
| A15 | 断网/凭据错误有可读错误，不白屏 | 单测 + UI |

## 9. 风险与降级

- **Bambu FTPS 上传**：若固件拒绝隐式 TLS/被动模式，降级为“仅监控 + 控制”，发送任务按钮提示用切片软件；不伪造成功。
- **Anycubic 固件差异**：握手字段缺失时提示“该机型不是 18910 代协议”，引导走 OctoPrint 端口 71。
- **Creality 私有固件**：只发现不控制，卡片显示“协议未实现（BETA）”。
- **FlashForge 老 TCP**：只识别 8899，控制走 8898；没有 8898 的机型提示不支持。
- **多网卡**：只扫非回环 IPv4；VPN/虚拟网卡可能增加扫描时间，限制每网段 254 地址、总并发 64。
