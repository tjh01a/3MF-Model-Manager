'use strict';
/**
 * 适配器工厂。kind 既可以是品牌（anycubic/creality/flashforge），
 * 也可以是协议族（moonraker/octoprint）；品牌决定展示和 BETA，协议决定怎么说话。
 */
const catalog = require('../device-catalog');
const MoonrakerAdapter = require('./moonraker');
const OctoPrintAdapter = require('./octoprint');
const FlashForgeAdapter = require('./flashforge');
const AnycubicAdapter = require('./anycubic');
const BambuAdapter = require('./bambu');

const ADAPTERS = {
  moonraker: MoonrakerAdapter,
  octoprint: OctoPrintAdapter,
  flashforge: FlashForgeAdapter,
  anycubic: AnycubicAdapter,
  bambu: BambuAdapter,
};

function adapterTypeOf(kind, override) {
  if (override) return catalog.normalizeKind(override);
  const brand = catalog.brandOf(kind);
  return brand ? brand.adapter : catalog.normalizeKind(kind);
}

function createAdapter(config = {}) {
  const kind = catalog.normalizeKind(config.kind);
  const type = adapterTypeOf(kind, config.adapter);
  const Ctor = ADAPTERS[type];
  if (!Ctor) throw new Error('暂不支持这种打印机协议：' + (type || '未知'));
  return new Ctor({ ...config, kind });
}

module.exports = { createAdapter, adapterTypeOf, ADAPTERS };
