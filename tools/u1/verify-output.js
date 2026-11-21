'use strict';
/**
 * 校验「普通 3MF → 快造 U1 专用 3MF」的产物是否真的符合 U1 规范。
 * 用法：node tools/u1/verify-output.js <输出.3mf> [源.3mf]
 *
 * 判定逻辑与单元测试共用 tools/u1/verify-lib.js，避免两套标准漂移。
 * 退出码 0 = 全通过，1 = 有问题（JSON 里 checks 会指出哪一项）。
 */
const fs = require('fs');
const { verifyOutput } = require('./verify-lib');

const outPath = process.argv[2];
const srcPath = process.argv[3] || null;

if (!outPath) {
  console.error('用法：node tools/u1/verify-output.js <输出.3mf> [源.3mf]');
  process.exit(2);
}

const res = verifyOutput(outPath, srcPath);
process.stdout.write(JSON.stringify(res, null, 2) + '\n');
process.exit(res.ok ? 0 : 1);
