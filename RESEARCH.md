# PrintShelf 局域网打印设备调研

> 结论先行：本项目的“设备”模块按**协议族**而不是按品牌写代码。Bambu 走 MQTT + FTPS，Snapmaker / 部分 Creality 走 Moonraker，Anycubic 有原生 18910→9883 局域网握手，也有 Kobra 2 的 OctoPrint 兼容口，FlashForge 走 8898 HTTP。所有非拓竹/快造品牌按要求标 BETA，并写明“未经过实机验证”。

## 1. 范围与判定口径

- 只做**纯局域网**，不依赖厂商云账号；云通道继续保留在旧打印机面板里，不作为新设备页的默认路径。
- “已实现”指代码可跑、协议请求/解析有 mock 或已知响应验证；“实机验证”单列，不用跑通 mock 冒充真机。
- 端口和路径只写有来源的。厂商固件差异用“可能/部分固件”标注，不写成所有型号都支持。

## 2. Bambu Lab（拓竹）

| 项目 | 结论 |
| --- | --- |
| 连接类型 | 局域网 MQTT over TLS + 隐式 FTPS |
| 端口 | MQTT 8883；FTPS 990；摄像头 TCP 6000（A1/P1 系列）；部分机型 RTSPS 322 |
| 认证 | 用户名固定 `bblp`，密码为打印机屏幕上的 **访问码 / Access Code**；需开启“仅局域网模式”，X1 系列还需开发者模式 |
| 发现 | SSDP，组播 239.255.255.250，端口 2021（旧实现也用 1990），ST `urn:bambulab-com:device:3dprinter:1`；响应头含 `DevModel`、`DevName`、`DevVersion`、`DevConnect` |
| 状态 | MQTT 主题 `device/<serial>/report`，推送 `print` 对象：`gcode_state`、`mc_percent`、`mc_remaining_time`、`nozzle_temper/target`、`bed_temper/target`、`layer_num/total_layer_num` 等 |
| 控制 | 同主题发布 JSON：`print.pause`、`print.resume`、`print.stop`；温度用 `gcode_line` 发 `M104/M140`；开始打印用 `project_file` 指令（需先把文件传到 FTPS） |
| 摄像头 | A1/P1：TCP 6000 的 JPEG 帧流；X1：RTSPS 322，需要认证 |
| 能力边界 | 局域网模式必须由用户在打印机上开启；访问码错误会 TLS/MQTT 认证失败；FTPS 是**隐式 TLS**，普通 FTP 库直接连会失败 |
| 参考 | BambuStudio 源码仓库 <https://github.com/bambulab/BambuStudio>；OrcaSlicer 的 Bambu 网络实现 <https://github.com/SoftFever/OrcaSlicer>；Bambu 局域网模式说明 <https://wiki.bambulab.com/en/x1/manual/X1-Firmware-Version-01.05.01> |

**实现选择**：保留项目已有的 Bambu MQTT 客户端（已经支持证书 CN 取序列号、从 BambuStudio.conf 读访问码、IP 漂移自动纠正），新增 SSDP 发现和状态归一化；发送任务用 `basic-ftp` 走隐式 FTPS，失败时明确提示“文件已连接但未上传”，不伪装成功。

## 3. Snapmaker（快造）

| 项目 | 结论 |
| --- | --- |
| 连接类型 | 修改版 Klipper + Moonraker REST |
| 端口 | 7125（Moonraker）；部分固件 80 也可访问 |
| 认证 | 同网段通常无需 API Key；Moonraker 默认无鉴权 |
| 发现 | mDNS/DNS-SD 宣告 `_moonraker._tcp`，主机名常见 `u1.local`；也可端口探测 7125 |
| 状态 | `GET /printer/objects/query?print_stats&heater_bed&extruder&extruder1..3&virtual_sdcard&print_task_config` |
| 控制 | `POST /printer/print/pause|resume|cancel`；温度 `POST /printer/gcode/script` 发 `M104/M140`；任务 `POST /server/files/upload` 后 `POST /printer/print/start?filename=...` |
| 摄像头 | Moonraker `webcam` 配置，或 `camera/monitor.jpg` 快照；项目已有取帧适配 |
| 能力边界 | U1 四工具头要分别取 `extruder`、`extruder1..3`；没有统一 ETA，剩余时间只能用文件时长/进度估算（项目已有逻辑） |
| 参考 | Moonraker 外部 API 文档 <https://moonraker.readthedocs.io/en/latest/external_api/>；Snapmaker U1 配置仓库 <https://github.com/Snapmaker/SnapmakerU1>；项目内 `docs/` 的 U1 实机记录 |

**非 BETA**：按需求，快造不标 BETA；项目已有 U1 实机通道继续沿用。

## 4. Anycubic（纵维立方）

Anycubic 有两代/两套局域网能力，不能混成一个端口：

### 4.1 Kobra 3 / Kobra 4 / Kobra X / Kobra S1 原生 LAN

| 项目 | 结论 |
| --- | --- |
| 连接类型 | 私有 HTTP 握手 + MQTT over mutual TLS |
| 端口 | 握手 18910；MQTT 9883；文件上传也是 18910 的 `fileUploadurl`；摄像头常见 18088 |
| 认证 | 无需账号密码。`GET /info` 取 `token`、`ctrlInfoUrl`、`modelId`；按 `md5(md5(token[:16]) + ts + nonce)` 签名 POST 到 `/ctrl`，返回 AES-CBC 加密的 broker 账号、设备证书和私钥；MQTT 用双向证书 |
| 发现 | 端口探测 18910 的 `/info`（返回 JSON 含 `modelId`、`ctrlType`）；部分网络会响应 mDNS/SSDP，但**不作为唯一依据** |
| 状态 | MQTT 订阅 `anycubic/anycubicCloud/v1/printer/public/{modelId}/{deviceId}/#`，`info/report`、`print/report`、`tempature/report` |
| 控制 | `print` 主题：`pause` / `resume` / `stop` / `update`（`target_nozzle_temp`、`target_hotbed_temp`）；开始打印：先 `POST fileUploadurl` 上传 `gcode` 表单，再发 `print/start`（`filename`、`filesize`、`md5`、`taskid`） |
| 摄像头 | `info` 返回 `urls.rtspUrl`（常见 `http://ip:18088/flv`），不是 JPEG 快照；界面只在有可渲染流时显示 |
| 能力边界 | 需要 LAN Mode；`devicecrt/devicepk` 是双向 TLS 必需；Marlin 时代的老 Kobra 不走这套 |
| 参考 | 开源客户端 kobra-connect <https://github.com/rvanderp3/kobra-connect>；HA 本地集成 anycubic_ha_local <https://github.com/chrisfore/anycubic_ha_local>；其 `PROTOCOL-VALIDATED.md` 与 `docs/mqtt-commands.md`；Anycubic 官方 LAN Mode 文档 <https://wiki.anycubic.com/> |

### 4.2 Kobra 2 / 早期机型 OctoPrint 兼容

| 项目 | 结论 |
| --- | --- |
| 连接类型 | OctoPrint REST 兼容 |
| 端口 | 71（OrcaSlicer 的 Anycubic 配置里作为 OctoPrint 主机端口）；也见过 80 |
| 认证 | 通常无 API Key；有则填 |
| 发现 | `/api/version` 返回 OctoPrint 版本 JSON |
| 控制 | `POST /api/job`（pause/resume/cancel）、`POST /api/printer/tool`、`POST /api/printer/bed`、`POST /api/files/local` |
| 参考 | OctoPrint REST API <https://docs.octoprint.org/en/master/api/>；OrcaSlicer Anycubic 配置目录 <https://github.com/SoftFever/OrcaSlicer/tree/main/resources/profiles/Anycubic> |

**BETA**。原生 4.1 协议有社区实机记录，但本项目未实机验证；4.2 端口/鉴权随机型/固件差异较大。

## 5. Creality（创想三维）

| 项目 | 结论 |
| --- | --- |
| 连接类型 | 多数 K1/K2 的 stock 固件暴露 Moonraker/Klipper REST；部分机型/固件只开 CrealityPrint 私有 HTTP + WebSocket |
| 端口 | Moonraker 7125；Fluidd 4408；Mainsail 4409；Web UI 80；Creality WebSocket 9999 |
| 认证 | Moonraker 默认无鉴权；CrealityPrint 私有接口需要本机凭据/会话，本项目不猜 |
| 发现 | mDNS/DNS-SD（K 系列会宣告 HTTP/打印机服务）；端口探测 7125、4408、9999、80 |
| 状态 | Moonraker 对象查询，字段与 Klipper 一致；`print_stats.state`、`virtual_sdcard.progress`、`heater_bed`、`extruder` |
| 控制 | Moonraker `print/pause|resume|cancel`；`gcode/script` 设温度；`server/files/upload` + `print/start` |
| 能力边界 | 不是所有 stock 固件都开 7125；K1C 2025 等新固件可能只跑 80 上的私有 API，本版只检测并提示，不假装能控制 |
| 参考 | OrcaSlicer Creality 配置（含 K1/K1C 2025 的 host_type 注释）<https://github.com/SoftFever/OrcaSlicer/tree/main/resources/profiles/Creality>；Moonraker API <https://moonraker.readthedocs.io/en/latest/external_api/>；Klipper 文档 <https://www.klipper3d.org/> |

**BETA**。走 Moonraker 的机型可控制；私有 CrealityPrint 机型只做发现和“协议未实现”提示。

## 6. FlashForge（闪铸）

| 项目 | 结论 |
| --- | --- |
| 连接类型 | 现代机型 HTTP JSON API；老机型 TCP 8899 文本协议 |
| 端口 | HTTP 8898；老 TCP 8899；摄像头 8080（MJPEG） |
| 认证 | 现代 API 每个请求带 `serialNumber` + `checkCode`（JSON body 或上传时 header）；老 TCP 无认证 |
| 发现 | 端口探测 8898/8899；`/detail` 需要凭据，发现阶段只用端口 + 首页 Server 头/型号提示；也支持手动 IP |
| 状态 | `POST /detail` 返回 `status`、`printProgress`（0~1）、`estimatedTime`（剩余秒）、`printDuration`（已打秒）、`rightTemp/rightTargetTemp`、`platTemp/platTargetTemp`、`cameraStreamUrl` |
| 控制 | `POST /control`，`payload.cmd`：`jobCtl_cmd`（pause/continue/cancel）、`temperatureCtl_cmd`（`rightNozzle`/`platform`）、`printerCtl_cmd`（speed/fan） |
| 发送任务 | `POST /uploadGcode` multipart，header 带 serialNumber/checkCode/fileSize/printNow；或先传后 `POST /printGcode` |
| 摄像头 | 部分机型 `cameraStreamUrl` 直接给 MJPEG（常见 `http://ip:8080/?action=stream`） |
| 能力边界 | 5M/5M Pro/AD5X 是 HTTP 8898；老 Finder/Guider 是 TCP 8899，命令集不同；`checkCode` 在打印机屏幕上，无法零配置自动连 |
| 参考 | FlashForge HTTP API 文档 <https://github.com/Parallel-7/flashforge-api-docs/wiki/HTTP-REST-API>；TCP 协议文档同仓库 <https://github.com/Parallel-7/flashforge-api-docs> |

**BETA**。现代 HTTP 已实现；旧 TCP 只做发现/识别，控制不冒充支持。

## 7. OrcaSlicer 的局域网连接方式与覆盖

OrcaSlicer 的物理打印机 host type 覆盖 OctoPrint/Klipper、Moonraker、PrusaLink、Duet、FlashForge、CrealityPrint、Bambu 等（具体枚举随版本变化）。本项目不照搬全部枚举，而是覆盖这五家实际会走的协议族：

| Orca 协议族 | 本项目适配器 | 覆盖品牌 |
| --- | --- | --- |
| Bambu LAN | `BambuAdapter`（复用现有 MQTT） | 拓竹 |
| Moonraker / Klipper | `MoonrakerAdapter` | 快造、Creality K1/K2、Anycubic Rinkhals/Fluidd、通用 Klipper |
| OctoPrint REST | `OctoPrintAdapter` | Anycubic Kobra 2 端口 71、通用 OctoPrint |
| FlashForge HTTP | `FlashForgeAdapter` | 闪铸 5M/AD5X |
| Anycubic LAN | `AnycubicAdapter` | Kobra 3/4/X/S1 |
| PrusaLink / Duet | 不在本任务五家范围，发现层只识别不连接 | — |

参考：OrcaSlicer 源码 <https://github.com/SoftFever/OrcaSlicer>；网络主机类型定义 <https://github.com/SoftFever/OrcaSlicer/tree/main/src/slic3r/Utils>。

## 8. 发现策略结论

1. **mDNS/DNS-SD**：浏览 `_moonraker._tcp`、`_octoprint._tcp`、`_printer._tcp`、`_http._tcp`；TXT/实例名用于品牌推断。
2. **SSDP**：Bambu 专用 2021（兼容 1990），通用 1900 只做补充。
3. **HTTP 指纹**：`/server/info`（Moonraker）、`/api/version`（OctoPrint）、`/info`（Anycubic）、`/detail` 端口（FlashForge）。
4. **端口兜底**：7125/4408/4409/80/71/8898/8899/9999/9883/8883/990/18910。
5. **子网扫描**：对每个非回环 IPv4 的 /24 做并发探测，默认 64 并发、350ms 超时，限制总时长。
6. **去重**：优先序列号/MAC，其次 host；同 host 多协议时按“品牌专用 > Moonraker > OctoPrint > 裸端口”保留主记录，其余记入 `also`。

## 9. 明确不做/不猜的部分

- 不实现需要厂商云 token 的云打印。
- 不实现 CrealityPrint 私有加密接口；只识别 80/9999 并提示“固件使用私有协议”。
- 不实现 FlashForge 旧 TCP 8899 的完整控制；现代 HTTP 之外只做识别。
- 不把 Anycubic 的 RTSP/FLV 流硬塞进 `<img>`；没有可渲染帧就显示“该机型摄像头需外部播放器”。
- 不用“端口开着”直接判定品牌；必须至少有一个 HTTP/SSDP/mDNS 指纹。
