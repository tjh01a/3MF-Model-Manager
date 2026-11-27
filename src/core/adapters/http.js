'use strict';
/** 打印机局域网 HTTP 小工具：明文/自签名 TLS、JSON、流式 multipart。 */
const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');

function requestRaw(opts = {}) {
  const {
    host, port, path: reqPath = '/', method = 'GET', body = null,
    headers = {}, timeout = 4000, tls: useTls = false, servername,
  } = opts;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; fn(v); };
    const mod = useTls ? https : http;
    const req = mod.request({
      host, port, path: reqPath, method,
      headers: Object.assign({ 'User-Agent': 'PrintShelf/1.2', Connection: 'close' }, headers),
      timeout, rejectUnauthorized: false, servername: servername || (net.isIP(host) ? undefined : host),
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (buf.length < 1024 * 1024) buf += c; });
      res.on('end', () => finish(resolve, { status: res.statusCode || 0, headers: res.headers || {}, body: buf }));
      res.on('error', (e) => finish(reject, e));
    });
    req.on('timeout', () => { req.destroy(new Error('连接超时')); });
    req.on('error', (e) => finish(reject, e));
    if (body != null) req.write(body);
    req.end();
  });
}

async function requestJson(opts = {}) {
  const r = await requestRaw(opts);
  let json = null;
  try { json = JSON.parse(r.body); } catch (_) { /* 不是 JSON 就留 null */ }
  return { ...r, json };
}

function probeTcp(host, port, timeout = 350) {
  return new Promise((resolve) => {
    let done = false;
    const s = new net.Socket();
    const finish = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(timeout);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, host);
  });
}

function tlsSerial(host, port = 8883, timeout = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    let sock;
    try {
      sock = tls.connect({ host, port, rejectUnauthorized: false, timeout }, () => {
        const c = sock.getPeerCertificate() || {};
        const cn = String((c.subject && c.subject.CN) || '');
        try { sock.destroy(); } catch (_) { /* 忽略 */ }
        finish(/^[0-9A-Z]{8,24}$/i.test(cn) ? cn : '');
      });
    } catch (_) { finish(''); return; }
    sock.on('error', () => finish(''));
    sock.on('timeout', () => { try { sock.destroy(); } catch (_) { /* 忽略 */ } finish(''); });
    setTimeout(() => finish(''), timeout + 300);
  });
}

function mimeFor(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext === '.3mf' || ext === '.zip') return 'application/zip';
  if (ext === '.gcode' || ext === '.gco') return 'text/plain';
  return 'application/octet-stream';
}

/**
 * 流式 multipart 上传。fields 里的字符串按普通表单字段发送；文件固定在 fileField。
 * 传大 3MF 不把文件读进内存。
 */
async function uploadMultipart(opts = {}) {
  const {
    host, port, path: reqPath, method = 'POST', fields = {}, filePath,
    fileField = 'file', fileName = path.basename(filePath || ''), headers = {},
    timeout = 300000, tls: useTls = false,
  } = opts;
  const stat = fs.statSync(filePath);
  const boundary = '----PrintShelf' + crypto.randomBytes(10).toString('hex');
  let head = '';
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${String(fileName).replace(/"/g, '')}"\r\n` +
    `Content-Type: ${mimeFor(fileName)}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const headBuf = Buffer.from(head, 'utf8');
  const tailBuf = Buffer.from(tail, 'utf8');
  const total = headBuf.length + stat.size + tailBuf.length;

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; fn(v); };
    const mod = useTls ? https : http;
    const req = mod.request({
      host, port, path: reqPath, method,
      headers: Object.assign({
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(total),
        'User-Agent': 'PrintShelf/1.2',
      }, headers),
      timeout, rejectUnauthorized: false,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (buf.length < 1024 * 1024) buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) { /* 非 JSON */ }
        finish(resolve, { status: res.statusCode || 0, headers: res.headers || {}, body: buf, json });
      });
      res.on('error', (e) => finish(reject, e));
    });
    req.on('timeout', () => req.destroy(new Error('上传超时')));
    req.on('error', (e) => finish(reject, e));

    (async () => {
      req.write(headBuf);
      const rs = fs.createReadStream(filePath);
      for await (const chunk of rs) {
        if (!req.write(chunk)) await once(req, 'drain');
      }
      req.write(tailBuf);
      req.end();
    })().catch((e) => { try { req.destroy(); } catch (_) { /* 忽略 */ } finish(reject, e); });
  });
}

module.exports = { requestRaw, requestJson, probeTcp, tlsSerial, uploadMultipart };
