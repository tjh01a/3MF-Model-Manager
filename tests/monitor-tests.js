'use strict';
/**
 * 打印监控的单元测试（docs/09 A.14）：采样节流、session 分段、落盘、通知去重、曲线模型。
 * 纯内存 + 系统临时目录，不碰真实库、不启 Electron。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PrinterMonitor, buildChartModel, MAX_POINTS } = require('../src/core/monitor');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'printshelf-monitor-'));
const dir = (n) => path.join(tmp, n);

let T = 1700000000000;
const now = () => T;
const advance = (ms) => { T += ms; };

function makeStore(settings) {
  return { getSettings: () => settings || {} };
}
function status(over) {
  return Object.assign({
    id: 'p1', name: 'A1', online: true, state: 'printing', stateText: '打印中',
    job: { name: 'benchy', percent: 10, remainingMin: 30, layer: 5, layers: 100 },
    temps: { nozzle: { cur: 220, target: 220 }, bed: { cur: 60, target: 60 }, chamber: null },
  }, over || {});
}
function mk(o = {}) {
  return new PrinterMonitor(Object.assign({
    store: makeStore(), dataDir: dir('m' + Math.random().toString(36).slice(2, 8)), now,
  }, o));
}

(async () => {
  // ---------- 1. 配置 ----------
  section('1. 配置读取与边界');
  {
    const m = mk();
    const c = m.config();
    ok('默认开启采样，间隔 15 秒', c.monitor.enabled === true && c.monitor.intervalSec === 15);
    ok('默认开启四类通知', c.notify.onFinished && c.notify.onError && c.notify.onPaused && c.notify.system);
    const c2 = mk({ store: makeStore({ monitor: { enabled: false, intervalSec: 1, keepSessions: 999 },
      notify: { onFinished: false } }) }).config();
    ok('采样可关闭', c2.monitor.enabled === false);
    ok('间隔下限 5 秒', c2.monitor.intervalSec === 5, String(c2.monitor.intervalSec));
    ok('保留任务数上限 100', c2.monitor.keepSessions === 100, String(c2.monitor.keepSessions));
    ok('分项通知可单独关', c2.notify.onFinished === false && c2.notify.onError === true);
  }

  // ---------- 2. 采样节流与 session ----------
  section('2. 采样节流 / 任务分段');
  {
    const m = mk(); m.start();
    m.onStatus(status());
    ok('第一个采样点立刻写入', m.latest('p1').points.length === 1);
    ok('点结构 [t,%,喷嘴,喷嘴目标,热床,热床目标]',
      JSON.stringify(m.latest('p1').points[0]) === JSON.stringify([T, 10, 220, 220, 60, 60]));
    for (let i = 0; i < 8; i++) { advance(1000); m.onStatus(status({ job: { name: 'benchy', percent: 20 } })); }
    ok('15 秒内的密集 MQTT 推送被节流', m.latest('p1').points.length === 1,
      String(m.latest('p1').points.length));
    advance(15000);
    m.onStatus(status({ job: { name: 'benchy', percent: 30 } }));
    ok('超过间隔后补一个点', m.latest('p1').points.length === 2);
    ok('进度跟着状态走', m.latest('p1').points[1][1] === 30);

    advance(1000);
    m.onStatus(status({ job: { name: '另一个模型', percent: 0 } }));
    ok('换个任务名立刻开新 session', m.history('p1', 10).length === 2);
    ok('新 session 不受上一个任务节流影响', m.latest('p1').points.length === 1);

    m.onStatus(status({ state: 'idle', stateText: '空闲', job: null }));
    ok('回到空闲就收尾 session', m.latest('p1').endedAt > 0 && m.status().active.length === 0);
    advance(20000);
    m.onStatus(status({ state: 'idle', stateText: '空闲', job: null }));
    ok('空闲状态不采样', m.history('p1', 10)[0].points.length === 1);
    m.stop();
  }

  // ---------- 3. 上限与裁剪 ----------
  section('3. 点数 / session 数上限');
  {
    const m = mk({ store: makeStore({ monitor: { keepSessions: 3, intervalSec: 5 } }) }); m.start();
    for (let i = 0; i < 5; i++) {
      m.onStatus(status({ job: { name: 'job-' + i, percent: i } }));
      advance(6000);
    }
    ok('只保留最近 3 个任务', m.history(null, 100).length === 3, String(m.history(null, 100).length));
    ok('保留的是最后 3 个（history 按时间倒序）',
      m.history(null, 100).map((s) => s.jobName).join(',') === 'job-4,job-3,job-2');
    m.stop();
  }
  {
    const m = mk({ store: makeStore({ monitor: { intervalSec: 5 } }) }); m.start();
    for (let i = 0; i < MAX_POINTS + 3; i++) {
      m.onStatus(status({ job: { name: 'long', percent: i % 100 } }));
      advance(6000);
      if (i % 500 === 0) m.flush(true);
    }
    ok('单任务点数不超过上限', m.latest('p1').points.length === MAX_POINTS,
      String(m.latest('p1').points.length));
    ok('丢的是最旧的点', m.latest('p1').points[0][0] > T - MAX_POINTS * 6000 - 6000);
    m.stop();
  }

  // ---------- 4. 落盘与恢复 ----------
  section('4. 落盘 / 重启读回');
  {
    const d = dir('persist');
    const m1 = new PrinterMonitor({ store: makeStore(), dataDir: d, now }); m1.start();
    for (let i = 0; i < 3; i++) { m1.onStatus(status({ job: { name: 'persist', percent: i * 10 } })); advance(16000); }
    m1.onStatus(status({ state: 'finished', stateText: '已完成', job: { name: 'persist', percent: 100 } }));
    m1.stop();
    const file = path.join(d, 'history.json');
    ok('历史文件已写出', fs.existsSync(file));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok('文件里带版本与 session', raw.version === 1 && raw.sessions.length === 1);
    ok('文件里确实有采样点', raw.sessions[0].points.length === 3, String(raw.sessions[0].points.length));

    const m2 = new PrinterMonitor({ store: makeStore(), dataDir: d, now }); m2.start();
    ok('重启后能读回历史', m2.status().sessions === 1 && m2.status().points === 3);
    ok('读回的 session 被标成已结束', m2.latest('p1').endedAt > 0);
    m2.stop();

    fs.writeFileSync(path.join(d, 'history.json'), '{坏掉的 JSON', 'utf8');
    const m3 = new PrinterMonitor({ store: makeStore(), dataDir: d, now }); m3.start();
    ok('损坏文件不会让启动崩掉', m3.status().sessions === 0 && !!m3.status().loadError);
    m3.stop();
  }

  // ---------- 5. 通知判定 ----------
  section('5. 完成 / 异常 / 暂停通知');
  {
    const m = mk(); m.start();
    const notes = [];
    m.on('notify', (n) => notes.push(n));

    m.onStatus(status());                       // 首见：只是建立 lastState
    ok('刚连上不发历史通知', notes.length === 0);
    m.onStatus(status({ state: 'finished', stateText: '已完成', job: { name: 'benchy', percent: 100 } }));
    ok('打印完成触发通知', notes.length === 1 && notes[0].kind === 'finished');
    ok('通知带设备名与任务名', notes[0].printerName === 'A1' && /benchy/.test(notes[0].body));
    ok('通知带 system 标记', notes[0].system === true);

    m.onStatus(status({ state: 'finished', stateText: '已完成', job: { name: 'benchy', percent: 100 } }));
    m.onStatus(status({ state: 'offline', online: false, stateText: '离线' }));
    m.onStatus(status({ state: 'finished', stateText: '已完成', job: { name: 'benchy', percent: 100 } }));
    ok('同任务重复推送 + 离线重连都不重复通知', notes.length === 1, String(notes.length));

    // 紧接着发生的「完成 → 报错」不能互相冷却：早年按 60 秒统一去重的实现会吞掉这条
    m.onStatus(status({ state: 'error', stateText: '出错' }));
    ok('不同类型通知不被冷却互相挡住', notes.length === 2 && notes[1].kind === 'error');

    m.onStatus(status({ state: 'printing', stateText: '打印中' }));
    advance(61000);
    m.onStatus(status({ state: 'paused', stateText: '已暂停' }));
    ok('打印中突然暂停会提醒（断料）', notes.length === 3 && notes[2].kind === 'paused');

    m.onStatus(status({ state: 'printing', stateText: '打印中' }));
    m.onStatus(status({ state: 'paused', stateText: '已暂停' }));
    ok('1 分钟内的第二次暂停被冷却挡住', notes.length === 3, String(notes.length));
    m.stop();
  }
  {
    const m = mk({ store: makeStore({ notify: { onPaused: false, system: false } }) }); m.start();
    const notes = []; m.on('notify', (n) => notes.push(n));
    m.onStatus(status());
    advance(61000);
    m.onStatus(status({ state: 'paused', stateText: '已暂停' }));
    ok('分项开关能关掉暂停提醒', notes.length === 0);
    m.onStatus(status({ state: 'printing', stateText: '打印中' }));
    advance(61000);
    m.onStatus(status({ state: 'finished', stateText: '已完成' }));
    ok('其它类型仍会通知', notes.length === 1);
    ok('关掉系统通知时标记 system=false', notes[0].system === false);
    const t = m.testNotify();
    ok('测试通知走同一出口', notes.length === 2 && t.kind === 'test');
    m.stop();
  }

  // ---------- 6. 通过 EventEmitter 自动订阅 + 清空 ----------
  section('6. 事件订阅 / 清空历史');
  {
    const printers = new EventEmitter();
    const m = mk({ printers }); m.start();
    printers.emit('update', status());
    printers.emit('update', status({ state: 'idle', stateText: '空闲', job: null }));
    ok('传入 PrinterService 时自动订阅 update', m.status().sessions >= 1);
    const before = m.status().sessions;
    const r = m.clear('p1');
    ok('按设备清空返回条数', r.cleared === before && m.status().sessions === 0);
    printers.emit('update', status());
    ok('清空后新打印会重新记录', m.status().sessions === 1);
    m.stop();
    ok('stop 后不再订阅', printers.listenerCount('update') === 0);
  }

  // ---------- 7. 曲线模型 ----------
  section('7. 温度 / 进度曲线模型');
  {
    const empty = buildChartModel(null);
    ok('空 session 不炸且标 empty', empty.empty === true && empty.stats.count === 0);
    const ses = {
      points: [
        [T, 0, 25, 0, 25, 0],
        [T + 60000, 20, 215, 220, 60, 60],
        [T + 120000, 55, 220, 220, 60, 60],
        [T + 180000, 100, 218, 220, 58, 60],
      ],
    };
    const m = buildChartModel(ses);
    ok('4 条曲线（喷嘴/目标/热床/进度）', m.series.length === 4);
    ok('虚线只给目标温度', m.series.filter((s) => s.dashed).length === 1);
    ok('温度轴上限向上取整到 50℃', m.tempMax === 250, String(m.tempMax));
    ok('所有坐标都在画布内', m.series.every((s) => s.points.every((c) =>
      c.x >= m.plot.x - 1 && c.x <= m.plot.x + m.plot.w + 1 &&
      c.y >= m.plot.y - 1 && c.y <= m.plot.y + m.plot.h + 1)));
    ok('路径是合法 M/L 指令', m.series.every((s) => /^M [\d.,\- L]+$/.test(s.path)));
    ok('进度从 0 走到 100', m.series.find((s) => s.key === 'progress').last === 100);
    ok('统计里有时长与峰值', m.stats.durationMin === 3 && m.stats.nozzleMax === 220 && m.stats.percent === 100,
      JSON.stringify(m.stats));
    ok('时间轴有 5 个刻度', m.ticks.length === 5);
    ok('温度网格 5 条', m.grid.length === 5);
  }

  console.log('\n' + '─'.repeat(30));
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 临时目录清不掉不影响结果 */ }
  if (fail > 0) process.exitCode = 1;
})();
