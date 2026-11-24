"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/node-entry.ts
var node_entry_exports = {};
__export(node_entry_exports, {
  MACHINES: () => MACHINES,
  U1: () => U1,
  cleanThreeMF: () => cleanThreeMF,
  configFamily: () => configFamily,
  dropRangeLayerHeights: () => dropRangeLayerHeights,
  getMachine: () => getMachine,
  normalizeHex: () => normalizeHex2,
  u1NozzleVariant: () => u1NozzleVariant,
  // PrintShelf 追加：同族换机（拓竹→拓竹）用它先重排盘位，见 SOURCE.md
  retargetThreeMF: () => retargetThreeMF
});
module.exports = __toCommonJS(node_entry_exports);

// node_modules/fflate/esm/index.mjs
var import_module = require("module");
var require2 = (0, import_module.createRequire)("/");
var _a;
var Worker;
var isMarkedAsUntransferable;
try {
  _a = require2("worker_threads"), Worker = _a.Worker, isMarkedAsUntransferable = _a.isMarkedAsUntransferable;
} catch (e) {
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = function(cd, mb, r) {
  var s = cd.length;
  var i = 0;
  var l = new u16(mb);
  for (; i < s; ++i) {
    if (cd[i])
      ++l[cd[i] - 1];
  }
  var le = new u16(mb);
  for (i = 1; i < mb; ++i) {
    le[i] = le[i - 1] + l[i - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        var sv = i << 4 | cd[i];
        var r_1 = mb - cd[i];
        var v = le[cd[i] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i = 0; i < s; ++i) {
      if (cd[i]) {
        co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
      }
    }
  }
  return co;
};
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i = 1; i < a.length; ++i) {
    if (a[i] > m)
      m = a[i];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i = 0; i < hcLen; ++i) {
          clt[clim[i]] = bits(dat, pos + i * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i = 0; i < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i = sym - 257, b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i = 0; i < d.length; ++i) {
    if (d[i])
      t.push({ s: i, f: d[i] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i2].f ? i0++ : i2++];
    r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i = 1; i < s; ++i) {
    if (t2[i].s > maxSym)
      maxSym = t2[i].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i < s; ++i) {
      var i2_1 = t2[i].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i;
    }
    for (; i >= 0 && dt; --i) {
      var i2_3 = t2[i].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i = 1; i <= s; ++i) {
    if (c[i] == cln && i != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i = 0; i < cl.length; ++i)
    l += cf[i] * cl[i];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i = 0; i < s; ++i)
    out[o + i + 4] = dat[i];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i = 0; i < lclt.length; ++i)
    ++lcfreq[lclt[i] & 31];
  for (var i = 0; i < lcdt.length; ++i)
    ++lcfreq[lcdt[i] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i = 0; i < nlcc; ++i)
      wbits(out, p + 3 * i, lct[clim[i]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i = 0; i < clct.length; ++i) {
        var len = clct[i] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i = 0; i < li; ++i) {
    var sym = syms[i];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i2) {
      return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i + 2 < s; ++i) {
      var hv = hsh(i);
      var imod = i & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i) {
        var rem = s - i;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
          li = lc_1 = eb = 0, bs = i;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i + l] == dat[i + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i];
          ++lf[dat[i]];
        }
      }
    }
    for (i = Math.max(i, wi); i < s; ++i) {
      syms[li++] = dat[i];
      ++lf[dat[i]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i, st.w = wi;
    }
  } else {
    for (var i = st.w || 0; i < s + lst; i += 65535) {
      var e = i + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ function() {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
}();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i = 0; i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
var Inflate = /* @__PURE__ */ function() {
  function Inflate2(opts, cb) {
    if (typeof opts == "function")
      cb = opts, opts = {};
    this.ondata = cb;
    var dict = opts && opts.dictionary && opts.dictionary.subarray(-32768);
    this.s = { i: 0, b: dict ? dict.length : 0 };
    this.o = new u8(32768);
    this.p = new u8(0);
    if (dict)
      this.o.set(dict);
  }
  Inflate2.prototype.e = function(c) {
    if (!this.ondata)
      err(5);
    if (this.d)
      err(4);
    if (!this.p.length)
      this.p = c;
    else if (c.length) {
      var n = new u8(this.p.length + c.length);
      n.set(this.p), n.set(c, this.p.length), this.p = n;
    }
  };
  Inflate2.prototype.c = function(final) {
    this.s.i = +(this.d = final || false);
    var bts = this.s.b;
    var dt = inflt(this.p, this.s, this.o);
    this.ondata(slc(dt, bts, this.s.b), this.d);
    this.o = slc(dt, this.s.b - 32768), this.s.b = this.o.length;
    this.p = slc(this.p, this.s.p / 8 | 0), this.s.p &= 7;
  };
  Inflate2.prototype.push = function(chunk, final) {
    this.e(chunk), this.c(final);
  };
  return Inflate2;
}();
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i = 0; ; ) {
    var c = d[i++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i + eb > d.length)
      return { s: r, r: slc(d, i - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
  }
};
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i = 0; i < str.length; ++i)
      ar_1[i] = str.charCodeAt(i);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0; i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i = 0; i < dat.length; i += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (; b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
};
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i = 0; i < files.length; ++i) {
    var f = files[i];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
var UnzipPassThrough = /* @__PURE__ */ function() {
  function UnzipPassThrough2() {
  }
  UnzipPassThrough2.prototype.push = function(chunk, final) {
    this.ondata(null, chunk, final);
  };
  UnzipPassThrough2.compression = 0;
  return UnzipPassThrough2;
}();
var UnzipInflate = /* @__PURE__ */ function() {
  function UnzipInflate2() {
    var _this = this;
    this.i = new Inflate(function(dat, final) {
      _this.ondata(null, dat, final);
    });
  }
  UnzipInflate2.prototype.push = function(chunk, final) {
    try {
      this.i.push(chunk, final);
    } catch (e) {
      this.ondata(e, null, final);
    }
  };
  UnzipInflate2.compression = 8;
  return UnzipInflate2;
}();
var Unzip = /* @__PURE__ */ function() {
  function Unzip2(cb) {
    this.onfile = cb;
    this.k = [];
    this.o = {
      0: UnzipPassThrough
    };
    this.p = et;
  }
  Unzip2.prototype.push = function(chunk, final) {
    var _this = this;
    if (!this.onfile)
      err(5);
    if (!this.p)
      err(4);
    if (this.c > 0) {
      var len = Math.min(this.c, chunk.length);
      var toAdd = chunk.subarray(0, len);
      this.c -= len;
      if (this.d)
        this.d.push(toAdd, !this.c);
      else
        this.k[0].push(toAdd);
      chunk = chunk.subarray(len);
      if (chunk.length)
        return this.push(chunk, final);
    } else {
      var f = 0, i = 0, is = void 0, buf = void 0;
      if (!this.p.length)
        buf = chunk;
      else if (!chunk.length)
        buf = this.p;
      else {
        buf = new u8(this.p.length + chunk.length);
        buf.set(this.p), buf.set(chunk, this.p.length);
      }
      var l = buf.length, oc = this.c, add = oc && this.d;
      var _loop_2 = function() {
        var sig = b4(buf, i);
        if (sig == 67324752) {
          f = 1, is = i;
          this_1.d = null;
          this_1.c = 0;
          var bf = b2(buf, i + 6), cmp_1 = b2(buf, i + 8), u = bf & 2048, dd = bf & 8, fnl = b2(buf, i + 26), es = b2(buf, i + 28);
          if (l > i + 30 + fnl + es) {
            var chks_3 = [];
            this_1.k.unshift(chks_3);
            f = 2;
            var lsc = b4(buf, i + 18), lsu = b4(buf, i + 22);
            var fn_1 = strFromU8(buf.subarray(i + 30, i += 30 + fnl), !u);
            var _a2 = z64hs(buf, i, es, 2, lsc, lsu, 0), sc_1 = _a2[0], su_1 = _a2[1], z64 = _a2[3];
            if (dd)
              sc_1 = -1 - z64;
            i += es;
            this_1.c = sc_1;
            var d_1;
            var file_1 = {
              name: fn_1,
              compression: cmp_1,
              start: function() {
                if (!file_1.ondata)
                  err(5);
                if (!sc_1)
                  file_1.ondata(null, et, true);
                else {
                  var ctr = _this.o[cmp_1];
                  if (!ctr)
                    file_1.ondata(err(14, "unknown compression type " + cmp_1, 1), null, false);
                  d_1 = sc_1 < 0 ? new ctr(fn_1) : new ctr(fn_1, sc_1, su_1);
                  d_1.ondata = function(err2, dat3, final2) {
                    file_1.ondata(err2, dat3, final2);
                  };
                  for (var _i = 0, chks_4 = chks_3; _i < chks_4.length; _i++) {
                    var dat2 = chks_4[_i];
                    d_1.push(dat2, false);
                  }
                  if (_this.k[0] == chks_3 && _this.c)
                    _this.d = d_1;
                  else
                    d_1.push(et, true);
                }
              },
              terminate: function() {
                if (d_1 && d_1.terminate)
                  d_1.terminate();
              }
            };
            if (sc_1 >= 0)
              file_1.size = sc_1, file_1.originalSize = su_1;
            this_1.onfile(file_1);
          }
          return "break";
        } else if (oc) {
          if (sig == 134695760) {
            is = i += 12 + (oc == -2 && 8), f = 3, this_1.c = 0;
            return "break";
          } else if (sig == 33639248) {
            is = i -= 4, f = 3, this_1.c = 0;
            return "break";
          }
        }
      };
      var this_1 = this;
      for (; i < l - 4; ++i) {
        var state_1 = _loop_2();
        if (state_1 === "break")
          break;
      }
      this.p = et;
      if (oc < 0) {
        var dat = f ? buf.subarray(0, is - 12 - (oc == -2 && 8) - (b4(buf, is - 16) == 134695760 && 4)) : buf.subarray(0, i);
        if (add)
          add.push(dat, !!f);
        else
          this.k[+(f == 2)].push(dat);
      }
      if (f & 2)
        return this.push(buf.subarray(i), final);
      this.p = buf.subarray(i);
    }
    if (final) {
      if (this.c)
        err(13);
      this.p = null;
    }
  };
  Unzip2.prototype.register = function(decoder) {
    this.o[decoder.compression] = decoder;
  };
  return Unzip2;
}();

// src/lib/u1-profile.json
var u1_profile_default = {
  accel_to_decel_enable: "1",
  accel_to_decel_factor: "50%",
  activate_air_filtration: [
    "0",
    "0",
    "0",
    "0"
  ],
  activate_chamber_temp_control: [
    "0",
    "0",
    "0",
    "0"
  ],
  adaptive_bed_mesh_margin: "0",
  adaptive_pressure_advance: [
    "0",
    "0",
    "0",
    "0"
  ],
  adaptive_pressure_advance_bridges: [
    "0",
    "0",
    "0",
    "0"
  ],
  adaptive_pressure_advance_model: [
    "0,0,0\n0,0,0",
    "0,0,0\n0,0,0",
    "0,0,0\n0,0,0",
    "0,0,0\n0,0,0"
  ],
  adaptive_pressure_advance_overhangs: [
    "0",
    "0",
    "0",
    "0"
  ],
  additional_cooling_fan_speed: [
    "0",
    "0",
    "0",
    "0"
  ],
  align_infill_direction_to_model: "0",
  alternate_extra_wall: "0",
  auxiliary_fan: "1",
  bbl_calib_mark_logo: "1",
  bbl_use_printhost: "0",
  bed_custom_model: "",
  bed_custom_texture: "",
  bed_exclude_area: [
    "0x0"
  ],
  bed_mesh_max: "99999,99999",
  bed_mesh_min: "-99999,-99999",
  bed_mesh_probe_distance: "50,50",
  before_layer_change_gcode: ";BEFORE_LAYER_CHANGE\n;[layer_z]\nG92 E0\nTIMELAPSE_TAKE_FRAME\nDEFECT_DETECTION_DETECT",
  best_object_pos: "0.5,0.5",
  bottom_shell_layers: "3",
  bottom_shell_thickness: "0",
  bottom_solid_infill_flow_ratio: "1",
  bottom_surface_density: "100%",
  bottom_surface_pattern: "monotonic",
  bridge_acceleration: "50%",
  bridge_angle: "0",
  bridge_density: "80%",
  bridge_flow: "0.8",
  bridge_no_support: "0",
  bridge_speed: "50",
  brim_ears_detection_length: "1",
  brim_ears_max_angle: "125",
  brim_object_gap: "0.1",
  brim_type: "auto_brim",
  brim_width: "5",
  calib_flowrate_topinfill_special_order: "0",
  chamber_temperature: [
    "0",
    "0",
    "0",
    "0"
  ],
  change_extrusion_role_gcode: "",
  change_filament_gcode: ';===== date: 20251213=====================\n; Change Tool[previous_extruder] -> Tool[next_extruder] (layer [layer_num])\n{\nlocal max_speed_toolchange = 350.0;\nlocal wait_for_extruder_temp = true;\nposition[2] = position[2] + 2.0;\nlocal speed_toolchange = max_speed_toolchange;\nif travel_speed < max_speed_toolchange then\n      speed_toolchange = travel_speed;\nendif\n"G91\nG1 Z1.5 F1800\nG90\n";\n"G1 F" + (speed_toolchange * 60) + "\n";\nif wait_for_extruder_temp and not((layer_num < 0) and (next_extruder == initial_tool)) then\n      "\n";\n      "; " + layer_num + "\n";\n      if layer_num == 0 then\n            "M109 S" + first_layer_temperature[next_extruder] + " T" + next_extruder + "\n";\n      else\n            "M109 S" + temperature[next_extruder] + " T" + next_extruder + "\n";\n      endif\nendif\n"M400" + "\n";\n"T" + next_extruder + "\n";\nif filament_type[next_extruder] == "PVA" then\n"SET_VELOCITY_LIMIT ACCEL=3000\n";\nelse\nendif\nif previous_extruder != next_extruder and initial_extruder != next_extruder then\n"SM_PRINT_PREEXTRUDE_FILAMENT INDEX=" + next_extruder + "\n";\nendif\n"G90\n";\n}\n',
  close_fan_the_first_x_layers: [
    "3",
    "3",
    "3",
    "3"
  ],
  complete_print_exhaust_fan_speed: [
    "70",
    "70",
    "70",
    "70"
  ],
  cool_plate_temp: [
    "0",
    "0",
    "0",
    "0"
  ],
  cool_plate_temp_initial_layer: [
    "0",
    "0",
    "0",
    "0"
  ],
  cooling_tube_length: "5",
  cooling_tube_retraction: "91.5",
  counterbore_hole_bridging: "none",
  curr_bed_type: "Textured PEI Plate",
  default_acceleration: "10000",
  default_bed_type: "Textured PEI Plate",
  default_filament_colour: [
    "",
    "",
    "",
    ""
  ],
  default_filament_profile: [
    "Snapmaker PLA"
  ],
  default_jerk: "0",
  default_junction_deviation: "0",
  default_print_profile: "0.20 Standard @Snapmaker U1 (0.4 nozzle)",
  delta_temperature: "0",
  deretraction_speed: [
    "30",
    "30",
    "30",
    "30"
  ],
  detect_narrow_internal_solid_infill: "1",
  detect_overhang_wall: "1",
  detect_thin_wall: "0",
  disable_m73: "0",
  dithering_local_z_direct_multicolor: "0",
  dithering_local_z_infill: "0",
  dithering_local_z_mode: "0",
  dithering_local_z_whole_objects: "0",
  dithering_step_painted_zones_only: "1",
  dithering_z_step_size: "0",
  dont_filter_internal_bridges: "disabled",
  dont_slow_down_outer_wall: [
    "0",
    "0",
    "0",
    "0"
  ],
  draft_shield: "disabled",
  during_print_exhaust_fan_speed: [
    "70",
    "70",
    "70",
    "70"
  ],
  elefant_foot_compensation: "0.15",
  elefant_foot_compensation_layers: "1",
  emit_machine_limits_to_gcode: "1",
  enable_arc_fitting: "0",
  enable_change_pressure_when_wiping: "1",
  enable_extra_bridge_layer: "disabled",
  enable_filament_ramming: "0",
  enable_long_retraction_when_cut: "0",
  enable_overhang_bridge_fan: [
    "1",
    "1",
    "1",
    "1"
  ],
  enable_overhang_speed: "1",
  enable_pressure_advance: [
    "0",
    "0",
    "0",
    "0"
  ],
  enable_prime_tower: "1",
  enable_support: "0",
  enforce_support_layers: "0",
  eng_plate_temp: [
    "90",
    "90",
    "90",
    "90"
  ],
  eng_plate_temp_initial_layer: [
    "90",
    "90",
    "90",
    "90"
  ],
  ensure_vertical_shell_thickness: "ensure_all",
  exclude_object: "0",
  extra_loading_move: "-2",
  extra_perimeters_on_overhangs: "0",
  extra_solid_infills: "",
  extruder_clearance_height_to_lid: "140",
  extruder_clearance_height_to_rod: "27.5",
  extruder_clearance_radius: "72.5",
  extruder_colour: [
    "#FCE94F",
    "#FCE94F",
    "#FCE94F",
    "#FCE94F"
  ],
  extruder_offset: [
    "0x0",
    "0x0",
    "0x0",
    "0x0"
  ],
  extrusion_rate_smoothing_external_perimeter_only: "0",
  fan_cooling_layer_time: [
    "30",
    "30",
    "30",
    "30"
  ],
  fan_kickstart: "0",
  fan_max_speed: [
    "80",
    "80",
    "80",
    "80"
  ],
  fan_min_speed: [
    "10",
    "10",
    "10",
    "10"
  ],
  fan_speedup_overhangs: "1",
  fan_speedup_time: "0",
  filament_colour: [
    "#FF9016",
    "#00C1AE",
    "#F4E2C1",
    "#ED1C24"
  ],
  filament_cooling_final_speed: [
    "3.4",
    "3.4",
    "3.4",
    "3.4"
  ],
  filament_cooling_initial_speed: [
    "2.2",
    "2.2",
    "2.2",
    "2.2"
  ],
  filament_cooling_moves: [
    "4",
    "4",
    "4",
    "4"
  ],
  filament_cost: [
    "20",
    "20",
    "20",
    "20"
  ],
  filament_density: [
    "1.04",
    "1.04",
    "1.04",
    "1.04"
  ],
  filament_deretraction_speed: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_diameter: [
    "1.75",
    "1.75",
    "1.75",
    "1.75"
  ],
  filament_end_gcode: [
    "",
    "",
    "",
    ""
  ],
  filament_flow_ratio: [
    "0.95",
    "0.95",
    "0.95",
    "0.95"
  ],
  filament_ids: [
    "GFSB99",
    "GFSB99",
    "GFSB99",
    "GFSB99"
  ],
  filament_is_support: [
    "0",
    "0",
    "0",
    "0"
  ],
  filament_loading_speed: [
    "28",
    "28",
    "28",
    "28"
  ],
  filament_loading_speed_start: [
    "3",
    "3",
    "3",
    "3"
  ],
  filament_long_retractions_when_cut: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_max_volumetric_speed: [
    "15",
    "15",
    "15",
    "15"
  ],
  filament_minimal_purge_on_wipe_tower: [
    "15",
    "15",
    "15",
    "15"
  ],
  filament_multitool_ramming: [
    "1",
    "1",
    "1",
    "1"
  ],
  filament_multitool_ramming_flow: [
    "15",
    "15",
    "15",
    "15"
  ],
  filament_multitool_ramming_volume: [
    "0.5",
    "0.5",
    "0.5",
    "0.5"
  ],
  filament_notes: [
    "",
    "",
    "",
    ""
  ],
  filament_ramming_parameters: [
    "120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6",
    "120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6",
    "120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6",
    "120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6"
  ],
  filament_retract_before_wipe: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retract_length_toolchange: [
    "10",
    "10",
    "10",
    "10"
  ],
  filament_retract_lift_above: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retract_lift_below: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retract_lift_enforce: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retract_restart_extra: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retract_restart_extra_toolchange: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retract_when_changing_layer: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retraction_distances_when_cut: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retraction_length: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retraction_minimum_travel: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_retraction_speed: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_settings_id: [
    "Generic ABS",
    "Generic ABS",
    "Generic ABS",
    "Generic ABS"
  ],
  filament_shrink: [
    "100%",
    "100%",
    "100%",
    "100%"
  ],
  filament_shrinkage_compensation_z: [
    "100%",
    "100%",
    "100%",
    "100%"
  ],
  filament_soluble: [
    "0",
    "0",
    "0",
    "0"
  ],
  filament_stamping_distance: [
    "0",
    "0",
    "0",
    "0"
  ],
  filament_stamping_loading_speed: [
    "0",
    "0",
    "0",
    "0"
  ],
  filament_start_gcode: [
    "",
    "",
    "",
    ""
  ],
  filament_toolchange_delay: [
    "0",
    "0",
    "0",
    "0"
  ],
  filament_type: [
    "ABS",
    "ABS",
    "ABS",
    "ABS"
  ],
  filament_unloading_speed: [
    "90",
    "90",
    "90",
    "90"
  ],
  filament_unloading_speed_start: [
    "100",
    "100",
    "100",
    "100"
  ],
  filament_vendor: [
    "Generic",
    "Generic",
    "Generic",
    "Generic"
  ],
  filament_wipe: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_wipe_distance: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_z_hop: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filament_z_hop_types: [
    "nil",
    "nil",
    "nil",
    "nil"
  ],
  filename_format: "{input_filename_base}_{filament_type[0]}_{print_time}.gcode",
  fill_multiline: "1",
  filter_out_gap_fill: "0",
  first_layer_print_sequence: [
    "0"
  ],
  flush_into_infill: "0",
  flush_into_objects: "0",
  flush_into_support: "1",
  flush_multiplier: "0.3",
  flush_volumes_matrix: [
    "0",
    "492",
    "368",
    "233",
    "280",
    "280",
    "280",
    "377",
    "0",
    "681",
    "239",
    "280",
    "280",
    "280",
    "439",
    "395",
    "0",
    "276",
    "280",
    "280",
    "280",
    "551",
    "601",
    "765",
    "0",
    "280",
    "280",
    "280",
    "280",
    "280",
    "280",
    "280",
    "0",
    "280",
    "280",
    "280",
    "280",
    "280",
    "280",
    "280",
    "0",
    "280",
    "280",
    "280",
    "280",
    "280",
    "280",
    "280",
    "0"
  ],
  flush_volumes_vector: [
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140",
    "140"
  ],
  from: "project",
  full_fan_speed_layer: [
    "0",
    "0",
    "0",
    "0"
  ],
  fuzzy_skin: "none",
  fuzzy_skin_first_layer: "0",
  fuzzy_skin_mode: "displacement",
  fuzzy_skin_noise_type: "classic",
  fuzzy_skin_octaves: "4",
  fuzzy_skin_persistence: "0.5",
  fuzzy_skin_point_distance: "0.3",
  fuzzy_skin_scale: "1",
  fuzzy_skin_thickness: "0.2",
  gap_fill_target: "topbottom",
  gap_infill_speed: "250",
  gcode_add_line_number: "0",
  gcode_comments: "0",
  gcode_flavor: "klipper",
  gcode_label_objects: "1",
  graphic_effect_plate_temp: [
    "0",
    "0",
    "0",
    "0"
  ],
  graphic_effect_plate_temp_initial_layer: [
    "0",
    "0",
    "0",
    "0"
  ],
  has_scarf_joint_seam: "0",
  head_wrap_detect_zone: [],
  high_current_on_filament_swap: "0",
  hole_to_polyhole: "0",
  hole_to_polyhole_threshold: "0.01",
  hole_to_polyhole_twisted: "1",
  host_type: "octoprint",
  hot_plate_temp: [
    "90",
    "90",
    "90",
    "90"
  ],
  hot_plate_temp_initial_layer: [
    "90",
    "90",
    "90",
    "90"
  ],
  idle_temperature: [
    "0",
    "0",
    "0",
    "0"
  ],
  independent_support_layer_height: "1",
  infill_anchor: "400%",
  infill_anchor_max: "20",
  infill_combination: "0",
  infill_combination_max_layer_height: "100%",
  infill_direction: "45",
  infill_jerk: "9",
  infill_lock_depth: "1",
  infill_overhang_angle: "60",
  infill_shift_step: "0.4",
  infill_wall_overlap: "15%",
  initial_layer_acceleration: "500",
  initial_layer_infill_speed: "105",
  initial_layer_jerk: "9",
  initial_layer_line_width: "0.5",
  initial_layer_min_bead_width: "85%",
  initial_layer_print_height: "0.25",
  initial_layer_speed: "50",
  initial_layer_travel_speed: "100%",
  inner_wall_acceleration: "10000",
  inner_wall_jerk: "9",
  inner_wall_line_width: "0.45",
  inner_wall_speed: "300",
  interface_shells: "0",
  interlocking_beam: "0",
  interlocking_beam_layer_count: "2",
  interlocking_beam_width: "0.8",
  interlocking_boundary_avoidance: "2",
  interlocking_depth: "2",
  interlocking_orientation: "22.5",
  internal_bridge_angle: "0",
  internal_bridge_density: "100%",
  internal_bridge_fan_speed: [
    "-1",
    "-1",
    "-1",
    "-1"
  ],
  internal_bridge_flow: "1",
  internal_bridge_speed: "150%",
  internal_solid_infill_acceleration: "100%",
  internal_solid_infill_line_width: "0.42",
  internal_solid_infill_pattern: "rectilinear",
  internal_solid_infill_speed: "250",
  ironing_angle: "-1",
  ironing_fan_speed: [
    "-1",
    "-1",
    "-1",
    "-1"
  ],
  ironing_flow: "10%",
  ironing_inset: "0",
  ironing_pattern: "rectilinear",
  ironing_spacing: "0.15",
  ironing_speed: "30",
  ironing_type: "no ironing",
  is_infill_first: "0",
  lateral_lattice_angle_1: "-45",
  lateral_lattice_angle_2: "45",
  layer_change_gcode: ";AFTER_LAYER_CHANGE\n;[layer_z]\nSET_PRINT_STATS_INFO TOTAL_LAYER={total_layer_count} CURRENT_LAYER={layer_num+1}",
  layer_height: "0.2",
  line_width: "0.42",
  local_z_wipe_tower_purge_lines: "3",
  long_retractions_when_cut: [
    "0",
    "0",
    "0",
    "0"
  ],
  machine_end_gcode: '{if print_sequence == "by object"}\nG91\nG1 X2 Y2 Z1 F24000\nG90\nG1 Z{max_layer_z+2} F600\n{endif}\nPRINT_END\nTIMELAPSE_STOP',
  machine_load_filament_time: "0",
  machine_max_acceleration_e: [
    "5000",
    "5000"
  ],
  machine_max_acceleration_extruding: [
    "20000",
    "20000"
  ],
  machine_max_acceleration_retracting: [
    "5000",
    "5000"
  ],
  machine_max_acceleration_travel: [
    "20000",
    "20000"
  ],
  machine_max_acceleration_x: [
    "20000",
    "20000"
  ],
  machine_max_acceleration_y: [
    "20000",
    "20000"
  ],
  machine_max_acceleration_z: [
    "500",
    "200"
  ],
  machine_max_jerk_e: [
    "2.5",
    "2.5"
  ],
  machine_max_jerk_x: [
    "9",
    "9"
  ],
  machine_max_jerk_y: [
    "9",
    "9"
  ],
  machine_max_jerk_z: [
    "3",
    "0.4"
  ],
  machine_max_junction_deviation: [
    "0",
    "0"
  ],
  machine_max_speed_e: [
    "30",
    "25"
  ],
  machine_max_speed_x: [
    "500",
    "200"
  ],
  machine_max_speed_y: [
    "500",
    "200"
  ],
  machine_max_speed_z: [
    "20",
    "12"
  ],
  machine_min_extruding_rate: [
    "0",
    "0"
  ],
  machine_min_travel_rate: [
    "0",
    "0"
  ],
  machine_pause_gcode: "M600",
  machine_start_gcode: ';===== date: 20260128 =====================\n\nPRINT_START\nDEFECT_DETECTION_START\nSET_PRINT_STATS_INFO TOTAL_LAYER={total_layer_count} CURRENT_LAYER=0\nTIMELAPSE_START\nM140 S{bed_temperature_initial_layer_single}\nM104 T{initial_extruder} S140\nM204 S10000\n\nG28 X Y\nDEFECT_DETECT_NOODLE_FIRST\n;===== \u5E8A\u9762\u5F02\u7269\u68C0\u6D4B ========\nT{initial_extruder}\nG90\nDEFECT_DETECTION_DETECT_BED\n;===== \u53D6\u653E\u5934\u68C0\u6D4B =================\nSM_PRINT_CHECK_SWITCH_EXTRUDER\n\n;===== \u81EA\u52A8\u8FDB\u6599 & \u6324\u51FA\u6D41\u91CF & \u9884\u6324\u51FA ======================\nSM_PRINT_EXTRUDER_PREHEAT EXTRUDER=1 TEMP=140\nSM_PRINT_AUTO_FEED EXTRUDER=0\nSM_PRINT_FLOW_CALIBRATE EXTRUDER=0\nSM_PRINT_EXTRUDER_PREHEAT EXTRUDER=2 TEMP=140\nSM_PRINT_AUTO_FEED EXTRUDER=1\nSM_PRINT_FLOW_CALIBRATE EXTRUDER=1\nSM_PRINT_EXTRUDER_PREHEAT EXTRUDER=3 TEMP=140\nSM_PRINT_AUTO_FEED EXTRUDER=2\nSM_PRINT_FLOW_CALIBRATE EXTRUDER=2\nSM_PRINT_AUTO_FEED EXTRUDER=3\nSM_PRINT_FLOW_CALIBRATE EXTRUDER=3\nM104 S0 T0 A0\nM104 S0 T1 A0\nM104 S0 T2 A0\nM104 S0 T3 A0\nM104 T{initial_extruder} S{nozzle_temperature[initial_extruder] - 90}\n\n;===== \u7C97\u56DE\u96F6 =================\nT{initial_extruder}\nM106 S255\nM106 P2 S0\nMOVE_TO_DISCARD_FILAMENT_POSITION\nM109 T{initial_extruder} S{nozzle_temperature[initial_extruder] - 90}\nROUGHLY_CLEAN_NOZZLE_WITH_DISCARD\nMOVE_TO_XY_IDLE_POSITION_EXTRUDER\nG28 Z I140 J140\n\n;===== \u68C0\u6D4B\u94A2\u677F =================\nDETECT_BED_PLATE\n\n;===== \u6DF1\u5EA6\u6E05\u6D01\u55B7\u5634 =================\nG90\nG0 Z5 F10000\nMOVE_TO_DISCARD_FILAMENT_POSITION\nM109 S{nozzle_temperature[initial_extruder] - 50}\nROUGHLY_CLEAN_NOZZLE\nMOVE_TO_XY_IDLE_POSITION_EXTRUDER\nFINELY_CLEAN_NOZZLE_STAGE_1\nM104 S{nozzle_temperature[initial_extruder] - 90}\nG0 Z5 F10000\nMOVE_TO_DISCARD_FILAMENT_POSITION\nROUGHLY_CLEAN_NOZZLE\nMOVE_TO_XY_IDLE_POSITION_EXTRUDER\nFINELY_CLEAN_NOZZLE_STAGE_2\n\n;===== \u7CBE\u56DE\u96F6 =================\nM106 S255\nM109 S{nozzle_temperature[initial_extruder] - 90}\nM190 S{bed_temperature_initial_layer_single}\nM107 P2\nG90\nG0 Z5 F10000\n{if curr_bed_type=="High Temp Plate"}                                                                                                                                                                                                               \nG28 Z Z_OFFSET -0.07                                                                                                                                                                                                                                    \n{elsif curr_bed_type=="Graphic Effect Plate"}                                                                                                                                                                                                          \nG28 Z Z_OFFSET -0.07                                                                                                                                                                                                                                     \n{else}                                                                                                                                                                                                               \nG28 Z                                                                                                                                                                                                                                                                                                                                                                                                                                                                          \n{endif} \n\n\n;===== \u70ED\u5E8A\u8C03\u5E73 =================\n{if curr_bed_type=="High Temp Plate"}                                                                                                                                                                                                               \nBED_MESH_CALIBRATE PROBE_COUNT=11,11 Z_OFFSET=-0.07                                                                                                                                                                                                                                  \n{elsif curr_bed_type=="Graphic Effect Plate"}                                                                                                                                                                                                          \nBED_MESH_CALIBRATE PROBE_COUNT=11,11 Z_OFFSET=-0.07                                                                                                                                                                                                                                    \n{else}                                                                                                                                                                                                               \nBED_MESH_CALIBRATE PROBE_COUNT=11,11                                                                                                                                                                                                                                                                                                                                                                                                                                                                         \n{endif} \n\n\n;===== \u753B\u8D77\u59CB\u7EBF =================\nG90\nG1 Z1.5\nG0 X85 Y1 Z2 F18000\nM109 S{nozzle_temperature_initial_layer[initial_extruder]}\nG1 Z0.2\nM83\nG1 X185 E15 F360\nG1 Z1.5\n\nG90\nM106 S0',
  machine_tool_change_time: "5",
  machine_unload_filament_time: "0",
  make_overhang_printable: "0",
  make_overhang_printable_angle: "55",
  make_overhang_printable_hole_size: "0",
  manual_filament_change: "0",
  max_bridge_length: "10",
  max_layer_height: [
    "0.32",
    "0.32",
    "0.32",
    "0.32"
  ],
  max_resonance_avoidance_speed: "120",
  max_travel_detour_distance: "0",
  max_volumetric_extrusion_rate_slope: "0",
  max_volumetric_extrusion_rate_slope_segment_length: "3",
  min_bead_width: "85%",
  min_feature_size: "25%",
  min_layer_height: [
    "0.08",
    "0.08",
    "0.08",
    "0.08"
  ],
  min_length_factor: "0.5",
  min_resonance_avoidance_speed: "70",
  min_skirt_length: "0",
  min_width_top_surface: "200%",
  minimum_sparse_infill_area: "15",
  mixed_color_layer_height_a: "0",
  mixed_color_layer_height_b: "0",
  mixed_filament_advanced_dithering: "0",
  mixed_filament_component_bias_enabled: "0",
  mixed_filament_definitions: "",
  mixed_filament_gradient_mode: "0",
  mixed_filament_height_lower_bound: "0.04",
  mixed_filament_height_upper_bound: "0.16",
  mixed_filament_pointillism_line_gap: "0",
  mixed_filament_pointillism_pixel_size: "0",
  mixed_filament_region_collapse: "1",
  mixed_filament_surface_indentation: "0",
  mmu_segmented_region_interlocking_depth: "0",
  mmu_segmented_region_max_width: "0",
  name: "project_settings",
  notes: "",
  nozzle_diameter: [
    "0.4",
    "0.4",
    "0.4",
    "0.4"
  ],
  nozzle_height: "2.5",
  nozzle_hrc: "0",
  nozzle_temperature: [
    "270",
    "270",
    "270",
    "270"
  ],
  nozzle_temperature_initial_layer: [
    "270",
    "270",
    "270",
    "270"
  ],
  nozzle_temperature_range_high: [
    "280",
    "280",
    "280",
    "280"
  ],
  nozzle_temperature_range_low: [
    "240",
    "240",
    "240",
    "240"
  ],
  nozzle_type: "hardened_steel",
  nozzle_volume: "143",
  only_one_wall_first_layer: "0",
  only_one_wall_top: "1",
  ooze_prevention: "1",
  other_layers_print_sequence: [
    "0"
  ],
  other_layers_print_sequence_nums: "0",
  outer_wall_acceleration: "5000",
  outer_wall_jerk: "9",
  outer_wall_line_width: "0.42",
  outer_wall_speed: "200",
  overhang_1_4_speed: "0",
  overhang_2_4_speed: "50",
  overhang_3_4_speed: "30",
  overhang_4_4_speed: "10",
  overhang_fan_speed: [
    "80",
    "80",
    "80",
    "80"
  ],
  overhang_fan_threshold: [
    "25%",
    "25%",
    "25%",
    "25%"
  ],
  overhang_reverse: "0",
  overhang_reverse_internal_only: "0",
  overhang_reverse_threshold: "50%",
  parking_pos_retraction: "92",
  pellet_flow_coefficient: [
    "0.4157",
    "0.4157",
    "0.4157",
    "0.4157"
  ],
  pellet_modded_printer: "0",
  post_process: [],
  precise_outer_wall: "0",
  precise_z_height: "0",
  preferred_orientation: "0",
  preheat_steps: "1",
  preheat_time: "30",
  pressure_advance: [
    "0.02",
    "0.02",
    "0.02",
    "0.02"
  ],
  prime_tower_brim_chamfer: "1",
  prime_tower_brim_chamfer_max_width: "4",
  prime_tower_brim_width: "5",
  prime_tower_width: "30",
  prime_volume: "45",
  print_compatible_printers: [
    "Snapmaker U1 (0.4 nozzle)"
  ],
  print_flow_ratio: "1",
  print_order: "default",
  print_sequence: "by layer",
  print_settings_id: "0.20 Standard @Snapmaker U1 (0.4 nozzle)",
  printable_area: [
    "0.5x1",
    "270.5x1",
    "270.5x271",
    "0.5x271"
  ],
  printable_height: "270.05",
  printer_model: "Snapmaker U1",
  printer_notes: "",
  printer_settings_id: "Snapmaker U1 (0.4 nozzle)",
  printer_structure: "undefine",
  printer_technology: "FFF",
  printer_variant: "0.4",
  printhost_authorization_type: "key",
  printhost_ssl_ignore_revoke: "0",
  printing_by_object_gcode: "",
  purge_in_prime_tower: "0",
  raft_contact_distance: "0.1",
  raft_expansion: "1.5",
  raft_first_layer_density: "90%",
  raft_first_layer_expansion: "2",
  raft_layers: "0",
  ramming_line_width_ratio: "2",
  ramming_pressure_advance_value: "0.02",
  reduce_crossing_wall: "0",
  reduce_fan_stop_start_freq: [
    "1",
    "1",
    "1",
    "1"
  ],
  reduce_infill_retraction: "1",
  required_nozzle_HRC: [
    "3",
    "3",
    "3",
    "3"
  ],
  resolution: "0.012",
  resonance_avoidance: "0",
  retract_before_wipe: [
    "0%",
    "0%",
    "0%",
    "0%"
  ],
  retract_length_toolchange: [
    "10",
    "10",
    "10",
    "10"
  ],
  retract_lift_above: [
    "0",
    "0",
    "0",
    "0"
  ],
  retract_lift_below: [
    "269",
    "269",
    "269",
    "269"
  ],
  retract_lift_enforce: [
    "All Surfaces",
    "All Surfaces",
    "All Surfaces",
    "All Surfaces"
  ],
  retract_restart_extra: [
    "0",
    "0",
    "0",
    "0"
  ],
  retract_restart_extra_toolchange: [
    "0",
    "0",
    "0",
    "0"
  ],
  retract_when_changing_layer: [
    "1",
    "1",
    "1",
    "1"
  ],
  retraction_distances_when_cut: [
    "18",
    "18",
    "18",
    "18"
  ],
  retraction_length: [
    "1.5",
    "1.5",
    "1.5",
    "1.5"
  ],
  retraction_minimum_travel: [
    "1",
    "1",
    "1",
    "1"
  ],
  retraction_speed: [
    "30",
    "30",
    "30",
    "30"
  ],
  role_based_wipe_speed: "1",
  scan_first_layer: "0",
  scarf_angle_threshold: "155",
  scarf_joint_flow_ratio: "1",
  scarf_joint_speed: "100%",
  scarf_overhang_threshold: "40%",
  seam_gap: "15%",
  seam_position: "aligned",
  seam_slope_conditional: "0",
  seam_slope_entire_loop: "0",
  seam_slope_inner_walls: "0",
  seam_slope_min_length: "20",
  seam_slope_start_height: "0",
  seam_slope_steps: "10",
  seam_slope_type: "none",
  silent_mode: "0",
  single_extruder_multi_material: "0",
  single_extruder_multi_material_priming: "0",
  single_loop_draft_shield: "0",
  skeleton_infill_density: "25%",
  skeleton_infill_line_width: "100%",
  skin_infill_density: "25%",
  skin_infill_depth: "2",
  skin_infill_line_width: "100%",
  skirt_distance: "2",
  skirt_height: "1",
  skirt_loops: "0",
  skirt_speed: "50",
  skirt_start_angle: "-135",
  skirt_type: "combined",
  slice_closing_radius: "0.049",
  slicing_mode: "regular",
  slow_down_for_layer_cooling: [
    "1",
    "1",
    "1",
    "1"
  ],
  slow_down_layer_time: [
    "3",
    "3",
    "3",
    "3"
  ],
  slow_down_layers: "0",
  slow_down_min_speed: [
    "20",
    "20",
    "20",
    "20"
  ],
  slowdown_for_curled_perimeters: "0",
  small_area_infill_flow_compensation: "0",
  small_area_infill_flow_compensation_model: [],
  small_perimeter_speed: "50%",
  small_perimeter_threshold: "0",
  solid_infill_direction: "45",
  solid_infill_filament: "1",
  solid_infill_rotate_template: "",
  sparse_infill_acceleration: "100%",
  sparse_infill_density: "15%",
  sparse_infill_filament: "1",
  sparse_infill_line_width: "0.45",
  sparse_infill_pattern: "grid",
  sparse_infill_rotate_template: "",
  sparse_infill_speed: "270",
  spiral_finishing_flow_ratio: "0",
  spiral_mode: "0",
  spiral_mode_max_xy_smoothing: "200%",
  spiral_mode_smooth: "0",
  spiral_starting_flow_ratio: "0",
  staggered_inner_seams: "0",
  standby_temperature_delta: "-150",
  start_end_points: [
    "30x-3",
    "54x245"
  ],
  supertack_plate_temp: [
    "35",
    "35",
    "35",
    "35"
  ],
  supertack_plate_temp_initial_layer: [
    "35",
    "35",
    "35",
    "35"
  ],
  support_air_filtration: "1",
  support_angle: "0",
  support_base_pattern: "default",
  support_base_pattern_spacing: "2.5",
  support_bottom_interface_spacing: "0.5",
  support_bottom_z_distance: "0.2",
  support_chamber_temp_control: "1",
  support_critical_regions_only: "0",
  support_expansion: "0",
  support_filament: "0",
  support_interface_bottom_layers: "2",
  support_interface_filament: "0",
  support_interface_loop_pattern: "0",
  support_interface_not_for_body: "1",
  support_interface_pattern: "auto",
  support_interface_spacing: "0.5",
  support_interface_speed: "80",
  support_interface_top_layers: "2",
  support_ironing: "0",
  support_ironing_flow: "10%",
  support_ironing_pattern: "rectilinear",
  support_ironing_spacing: "0.1",
  support_line_width: "0.42",
  support_material_interface_fan_speed: [
    "-1",
    "-1",
    "-1",
    "-1"
  ],
  support_multi_bed_types: "0",
  support_object_first_layer_gap: "0.2",
  support_object_xy_distance: "0.35",
  support_on_build_plate_only: "0",
  support_remove_small_overhang: "1",
  support_speed: "150",
  support_style: "default",
  support_threshold_angle: "30",
  support_threshold_overlap: "50%",
  support_top_z_distance: "0.25",
  support_type: "tree(auto)",
  symmetric_infill_y_axis: "0",
  temperature_vitrification: [
    "100",
    "100",
    "100",
    "100"
  ],
  template_custom_gcode: "",
  textured_cool_plate_temp: [
    "40",
    "40",
    "40",
    "40"
  ],
  textured_cool_plate_temp_initial_layer: [
    "40",
    "40",
    "40",
    "40"
  ],
  textured_plate_temp: [
    "90",
    "90",
    "90",
    "90"
  ],
  textured_plate_temp_initial_layer: [
    "90",
    "90",
    "90",
    "90"
  ],
  thick_bridges: "0",
  thick_internal_bridges: "1",
  thumbnails: "48x48/PNG, 300x300/PNG",
  thumbnails_format: "PNG",
  time_cost: "0",
  time_lapse_gcode: "",
  timelapse_type: "0",
  tool_change_temprature_wait: "0",
  top_bottom_infill_wall_overlap: "25%",
  top_shell_layers: "5",
  top_shell_thickness: "1",
  top_solid_infill_flow_ratio: "1",
  top_surface_acceleration: "2000",
  top_surface_density: "100%",
  top_surface_jerk: "9",
  top_surface_line_width: "0.42",
  top_surface_pattern: "monotonicline",
  top_surface_speed: "200",
  travel_acceleration: "10000",
  travel_jerk: "12",
  travel_slope: [
    "3",
    "3",
    "3",
    "3"
  ],
  travel_speed: "500",
  travel_speed_z: "0",
  tree_support_adaptive_layer_height: "1",
  tree_support_angle_slow: "25",
  tree_support_auto_brim: "1",
  tree_support_branch_angle: "45",
  tree_support_branch_angle_organic: "40",
  tree_support_branch_diameter: "2",
  tree_support_branch_diameter_angle: "5",
  tree_support_branch_diameter_organic: "2",
  tree_support_branch_distance: "5",
  tree_support_branch_distance_organic: "1",
  tree_support_brim_width: "3",
  tree_support_tip_diameter: "0.8",
  tree_support_top_rate: "30%",
  tree_support_wall_count: "0",
  upward_compatible_machine: [],
  use_firmware_retraction: "0",
  use_relative_e_distances: "1",
  version: "2.3.4",
  wall_direction: "auto",
  wall_distribution_count: "1",
  wall_filament: "1",
  wall_generator: "classic",
  wall_loops: "2",
  wall_sequence: "inner wall/outer wall",
  wall_transition_angle: "10",
  wall_transition_filter_deviation: "25%",
  wall_transition_length: "100%",
  wipe: [
    "1",
    "1",
    "1",
    "1"
  ],
  wipe_before_external_loop: "0",
  wipe_distance: [
    "2",
    "2",
    "2",
    "2"
  ],
  wipe_on_loops: "0",
  wipe_speed: "50",
  wipe_tower_bridging: "10",
  wipe_tower_cone_angle: "15",
  wipe_tower_extra_flow: "100%",
  wipe_tower_extra_rib_length: "8",
  wipe_tower_extra_spacing: "120%",
  wipe_tower_filament: "0",
  wipe_tower_fillet_wall: "1",
  wipe_tower_max_purge_speed: "90",
  wipe_tower_no_sparse_layers: "0",
  wipe_tower_rib_width: "8",
  wipe_tower_rotation_angle: "0",
  wipe_tower_wall_type: "rib",
  wipe_tower_x: [
    "13"
  ],
  wipe_tower_y: [
    "214.5"
  ],
  wiping_volumes_extruders: [
    "70",
    "70",
    "70",
    "70",
    "70",
    "70",
    "70",
    "70",
    "70",
    "70"
  ],
  xy_contour_compensation: "0",
  xy_hole_compensation: "0",
  z_hop: [
    "0.4",
    "0.4",
    "0.4",
    "0.4"
  ],
  z_hop_types: [
    "Auto Lift",
    "Auto Lift",
    "Auto Lift",
    "Auto Lift"
  ],
  z_hop_when_prime: [
    "0",
    "0",
    "0",
    "0"
  ],
  z_offset: "0"
};

// src/lib/targets.ts
var U1 = {
  id: "u1",
  name: String(u1_profile_default.printer_settings_id ?? "Snapmaker U1 (0.4 nozzle)"),
  vendor: "Snapmaker",
  flavour: "orca",
  toolheads: 4,
  buildMM: 270,
  // 270×270 mm bed (source: app lib/printer-profiles.js snapmaker-u1 bed)
  buildZMM: 270,
  // 270 mm max Z (same source)
  bed: { x: 270, y: 270, z: 270 },
  nozzle: 0.4,
  printerModel: "Snapmaker U1",
  printerSettingsId: "Snapmaker U1 (0.4 nozzle)",
  supportsMixedFilament: true,
  // U1 hardware "Full Spectrum" mixing — gate the whole feature on this flag
  profile: u1_profile_default,
  testedProfile: true
  // the bundled profile is a real export from the owner's own U1
};
var U1_NOZZLES = [0.2, 0.4, 0.6, 0.8];
var U1_TESTED_NOZZLE = 0.4;
var NOZZLE_SCALED_KEYS = [
  "line_width",
  "initial_layer_line_width",
  "inner_wall_line_width",
  "outer_wall_line_width",
  "internal_solid_infill_line_width",
  "sparse_infill_line_width",
  "support_line_width",
  "top_surface_line_width",
  "layer_height",
  "initial_layer_print_height",
  "max_layer_height",
  "min_layer_height",
  "nozzle_diameter"
];
function scaleValue(v, ratio) {
  if (Array.isArray(v)) return v.map((x) => scaleValue(x, ratio));
  const s = String(v);
  if (s.includes("%")) return v;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return v;
  const scaled = Math.round(n * ratio * 100) / 100;
  return typeof v === "string" ? String(scaled) : scaled;
}
var variantCache = /* @__PURE__ */ new Map();
function u1NozzleVariant(nozzle) {
  if (!U1_NOZZLES.includes(nozzle) || nozzle === U1_TESTED_NOZZLE) return U1;
  const cached = variantCache.get(nozzle);
  if (cached) return cached;
  const ratio = nozzle / U1_TESTED_NOZZLE;
  const profile = JSON.parse(JSON.stringify(u1_profile_default));
  for (const k of NOZZLE_SCALED_KEYS) if (k in profile) profile[k] = scaleValue(profile[k], ratio);
  const settingsId = `Snapmaker U1 (${nozzle} nozzle)`;
  profile.printer_settings_id = settingsId;
  profile.printer_variant = String(nozzle);
  const m = {
    ...U1,
    id: `u1-${nozzle}`,
    name: settingsId,
    nozzle,
    printerSettingsId: settingsId,
    profile,
    testedProfile: false,
    derivedFromNozzle: U1_TESTED_NOZZLE
  };
  variantCache.set(nozzle, m);
  return m;
}
var RETARGET = [
  {
    id: "bambu-x1c",
    name: "Bambu Lab X1 Carbon",
    vendor: "Bambu Lab",
    flavour: "bambu",
    toolheads: 4,
    buildMM: 256,
    buildZMM: 256,
    bed: { x: 256, y: 256, z: 256 },
    nozzle: 0.4,
    printerModel: "Bambu Lab X1 Carbon",
    // source: app printer-profiles.js bambu-x1c
    printerSettingsId: "Bambu Lab X1 Carbon 0.4 nozzle",
    printerVariant: "0.4"
  },
  {
    id: "bambu-p1s",
    name: "Bambu Lab P1S",
    vendor: "Bambu Lab",
    flavour: "bambu",
    toolheads: 4,
    buildMM: 256,
    buildZMM: 256,
    bed: { x: 256, y: 256, z: 256 },
    nozzle: 0.4,
    printerModel: "Bambu Lab P1S",
    // source: app printer-profiles.js bambu-p1s
    printerSettingsId: "Bambu Lab P1S 0.4 nozzle",
    printerVariant: "0.4"
  },
  {
    id: "bambu-a1",
    name: "Bambu Lab A1",
    vendor: "Bambu Lab",
    flavour: "bambu",
    toolheads: 4,
    buildMM: 256,
    buildZMM: 256,
    bed: { x: 256, y: 256, z: 256 },
    nozzle: 0.4,
    printerModel: "Bambu Lab A1",
    // source: app printer-profiles.js bambu-a1
    printerSettingsId: "Bambu Lab A1 0.4 nozzle",
    printerVariant: "0.4"
  },
  // The MK4 with an MMU3. Its printer_model was "MK4IS" (ported from the app's printer-profiles.js),
  // which is Prusa's id for the SINGLE-extruder MK4: a retarget relabelled a 5-colour project as a
  // printer with one filament. Identity now from Prusa's PrusaResearch 2.5.10 bundle,
  // [printer_model:MK4ISMMU3|MK4SMMU3] and [printer:Original Prusa MK4(S) MMU3 0.4 nozzle].
  {
    id: "prusa-mk4-mmu3",
    name: "Prusa MK4 + MMU3",
    vendor: "Prusa Research",
    flavour: "prusa",
    toolheads: 5,
    buildMM: 250,
    buildZMM: 220,
    bed: { x: 250, y: 210, z: 220 },
    nozzle: 0.4,
    printerModel: "MK4ISMMU3",
    printerSettingsId: "Original Prusa MK4 MMU3 0.4 nozzle",
    printerVariant: "0.4"
  },
  {
    id: "prusa-mk4s-mmu3",
    name: "Prusa MK4S + MMU3",
    vendor: "Prusa Research",
    flavour: "prusa",
    toolheads: 5,
    buildMM: 250,
    buildZMM: 220,
    bed: { x: 250, y: 210, z: 220 },
    nozzle: 0.4,
    printerModel: "MK4SMMU3",
    printerSettingsId: "Original Prusa MK4S MMU3 0.4 nozzle",
    printerVariant: "0.4"
  },
  // The CORE One INDX toolchanger, in both its configurations. Every value is Prusa's own: printer
  // model ids, preset names, variant, bed and height are read from the PrusaResearch 2.5.10 profile
  // bundle (prusa3d/PrusaSlicer-settings-prusa-fff, min PrusaSlicer 2.9.6), sections
  // [printer_model:COREONE_INDX8T|4T] and [printer:*C1_INDX_8T_common*]. Bambu/Orca sources become a
  // real PrusaSlicer project for these (prusa-project.ts), not a Generic 3MF.
  {
    id: "prusa-core-one-indx-8t",
    name: "Prusa CORE One INDX 8T",
    vendor: "Prusa Research",
    flavour: "prusa",
    toolheads: 8,
    buildMM: 248,
    buildZMM: 270,
    bed: { x: 248, y: 205, z: 270 },
    nozzle: 0.4,
    printerModel: "COREONE_INDX8T",
    printerSettingsId: "Prusa CORE One INDX 8T HF0.4 nozzle",
    printerVariant: "HF0.4",
    prusaColorMix: true
    // a toolchanger: blending costs tool changes, not purge
  },
  {
    id: "prusa-core-one-indx-4t",
    name: "Prusa CORE One INDX 4T",
    vendor: "Prusa Research",
    flavour: "prusa",
    toolheads: 4,
    buildMM: 248,
    buildZMM: 270,
    bed: { x: 248, y: 205, z: 270 },
    nozzle: 0.4,
    printerModel: "COREONE_INDX4T",
    printerSettingsId: "Prusa CORE One INDX 4T HF0.4 nozzle",
    printerVariant: "HF0.4",
    prusaColorMix: true
  },
  {
    id: "creality-k2",
    name: "Creality K2 Plus",
    vendor: "Creality",
    flavour: "orca",
    toolheads: 4,
    buildMM: 350,
    buildZMM: 350,
    bed: { x: 350, y: 350, z: 350 },
    nozzle: 0.4,
    printerModel: "Creality K2 Plus",
    // source: app printer-profiles.js creality-k2
    printerSettingsId: "Creality K2 Plus 0.4 nozzle",
    printerVariant: "0.4"
  }
];
var MACHINES = {
  [U1.id]: U1,
  ...Object.fromEntries(RETARGET.map((m) => [m.id, m]))
};
function getMachine(id) {
  return id && MACHINES[id] || U1;
}
function configFamily(flavour) {
  if (flavour === "bambu" || flavour === "orca") return "bbl";
  if (flavour === "prusa") return "prusa";
  return "generic";
}

// src/lib/u1-filament-presets.ts
var U1_FILAMENT_PRESETS = {
  "ABS": {},
  "ASA": {
    "fan_cooling_layer_time": "35",
    "filament_max_volumetric_speed": "12",
    "filament_multitool_ramming_flow": "12",
    "nozzle_temperature": "260",
    "nozzle_temperature_initial_layer": "260"
  },
  "BVOH": {
    "additional_cooling_fan_speed": "70",
    "close_fan_the_first_x_layers": "1",
    "cool_plate_temp": "40",
    "cool_plate_temp_initial_layer": "40",
    "eng_plate_temp": "0",
    "eng_plate_temp_initial_layer": "0",
    "fan_cooling_layer_time": "100",
    "fan_max_speed": "100",
    "fan_min_speed": "100",
    "filament_cost": "69.99",
    "filament_density": "1.13",
    "filament_flow_ratio": "1",
    "filament_is_support": "1",
    "filament_max_volumetric_speed": "6",
    "filament_multitool_ramming_flow": "6",
    "filament_multitool_ramming_volume": "0.1",
    "filament_retract_length_toolchange": "3",
    "filament_soluble": "1",
    "graphic_effect_plate_temp": "65",
    "graphic_effect_plate_temp_initial_layer": "65",
    "hot_plate_temp": "65",
    "hot_plate_temp_initial_layer": "65",
    "nozzle_temperature": "240",
    "nozzle_temperature_initial_layer": "240",
    "nozzle_temperature_range_high": "250",
    "nozzle_temperature_range_low": "200",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "50%",
    "pressure_advance": "0.025",
    "slow_down_layer_time": "8",
    "temperature_vitrification": "45",
    "textured_plate_temp": "65",
    "textured_plate_temp_initial_layer": "65"
  },
  "PA": {
    "activate_air_filtration": "1",
    "eng_plate_temp": "100",
    "eng_plate_temp_initial_layer": "100",
    "fan_cooling_layer_time": "65",
    "fan_max_speed": "85",
    "fan_min_speed": "40",
    "filament_flow_ratio": "1",
    "filament_max_volumetric_speed": "12",
    "filament_multitool_ramming_flow": "12",
    "hot_plate_temp": "100",
    "hot_plate_temp_initial_layer": "100",
    "nozzle_temperature": "260",
    "nozzle_temperature_initial_layer": "260",
    "overhang_fan_speed": "95",
    "overhang_fan_threshold": "10%",
    "reduce_fan_stop_start_freq": "0",
    "slow_down_layer_time": "8",
    "slow_down_min_speed": "10",
    "temperature_vitrification": "108",
    "textured_plate_temp": "100",
    "textured_plate_temp_initial_layer": "100"
  },
  "PA-CF": {
    "activate_air_filtration": "1",
    "eng_plate_temp": "100",
    "eng_plate_temp_initial_layer": "100",
    "fan_cooling_layer_time": "5",
    "fan_max_speed": "30",
    "filament_flow_ratio": "1",
    "filament_max_volumetric_speed": "8",
    "filament_multitool_ramming_flow": "8",
    "full_fan_speed_layer": "2",
    "hot_plate_temp": "100",
    "hot_plate_temp_initial_layer": "100",
    "nozzle_temperature": "290",
    "nozzle_temperature_initial_layer": "290",
    "nozzle_temperature_range_high": "300",
    "nozzle_temperature_range_low": "260",
    "overhang_fan_speed": "40",
    "overhang_fan_threshold": "0%",
    "reduce_fan_stop_start_freq": "0",
    "required_nozzle_HRC": "40",
    "slow_down_layer_time": "2",
    "temperature_vitrification": "170",
    "textured_plate_temp": "100",
    "textured_plate_temp_initial_layer": "100"
  },
  "PC": {
    "eng_plate_temp": "100",
    "eng_plate_temp_initial_layer": "100",
    "fan_max_speed": "60",
    "filament_end_gcode": "\n",
    "filament_flow_ratio": "0.94",
    "filament_max_volumetric_speed": "16",
    "filament_multitool_ramming_flow": "16",
    "hot_plate_temp": "100",
    "hot_plate_temp_initial_layer": "100",
    "nozzle_temperature": "280",
    "nozzle_temperature_initial_layer": "280",
    "nozzle_temperature_range_high": "290",
    "nozzle_temperature_range_low": "260",
    "overhang_fan_speed": "60",
    "slow_down_layer_time": "2",
    "temperature_vitrification": "120",
    "textured_plate_temp": "100",
    "textured_plate_temp_initial_layer": "100"
  },
  "PCTG": {
    "eng_plate_temp": "100",
    "eng_plate_temp_initial_layer": "100",
    "fan_max_speed": "40",
    "filament_cost": "28.99",
    "filament_density": "1.29",
    "filament_max_volumetric_speed": "6",
    "filament_multitool_ramming_flow": "10",
    "hot_plate_temp": "100",
    "hot_plate_temp_initial_layer": "100",
    "nozzle_temperature": "255",
    "nozzle_temperature_initial_layer": "255",
    "nozzle_temperature_range_high": "270",
    "overhang_fan_speed": "90",
    "overhang_fan_threshold": "10%",
    "pressure_advance": "0.04",
    "slow_down_layer_time": "12",
    "slow_down_min_speed": "10",
    "temperature_vitrification": "90",
    "textured_plate_temp": "100",
    "textured_plate_temp_initial_layer": "100"
  },
  "PETG": {
    "eng_plate_temp": "80",
    "eng_plate_temp_initial_layer": "80",
    "fan_max_speed": "90",
    "fan_min_speed": "40",
    "filament_cost": "24.99",
    "filament_density": "1.25",
    "filament_long_retractions_when_cut": "1",
    "filament_max_volumetric_speed": "12",
    "filament_retraction_distances_when_cut": "18",
    "hot_plate_temp": "80",
    "hot_plate_temp_initial_layer": "80",
    "nozzle_temperature": "255",
    "nozzle_temperature_initial_layer": "255",
    "nozzle_temperature_range_high": "270",
    "nozzle_temperature_range_low": "230",
    "overhang_fan_speed": "90",
    "overhang_fan_threshold": "10%",
    "pressure_advance": "0.04",
    "slow_down_layer_time": "12",
    "temperature_vitrification": "70",
    "textured_plate_temp": "80",
    "textured_plate_temp_initial_layer": "80"
  },
  "PETG-CF": {
    "eng_plate_temp": "80",
    "eng_plate_temp_initial_layer": "80",
    "fan_max_speed": "40",
    "fan_min_speed": "5",
    "filament_cost": "34.99",
    "filament_density": "1.25",
    "filament_end_gcode": "\n",
    "filament_max_volumetric_speed": "11",
    "filament_multitool_ramming_flow": "13",
    "hot_plate_temp": "80",
    "hot_plate_temp_initial_layer": "80",
    "nozzle_temperature": "255",
    "nozzle_temperature_initial_layer": "255",
    "nozzle_temperature_range_high": "270",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "10%",
    "required_nozzle_HRC": "40",
    "slow_down_layer_time": "6",
    "slow_down_min_speed": "10",
    "temperature_vitrification": "70",
    "textured_plate_temp": "80",
    "textured_plate_temp_initial_layer": "80"
  },
  "PETG-GF": {
    "eng_plate_temp": "80",
    "eng_plate_temp_initial_layer": "80",
    "fan_max_speed": "40",
    "fan_min_speed": "5",
    "filament_cost": "34.99",
    "filament_density": "1.25",
    "filament_max_volumetric_speed": "10",
    "filament_multitool_ramming_flow": "10",
    "hot_plate_temp": "80",
    "hot_plate_temp_initial_layer": "80",
    "nozzle_temperature": "255",
    "nozzle_temperature_initial_layer": "255",
    "nozzle_temperature_range_high": "270",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "10%",
    "pressure_advance": "0.03",
    "required_nozzle_HRC": "40",
    "slow_down_layer_time": "6",
    "slow_down_min_speed": "10",
    "temperature_vitrification": "70",
    "textured_plate_temp": "80",
    "textured_plate_temp_initial_layer": "80"
  },
  "PLA": {
    "additional_cooling_fan_speed": "70",
    "close_fan_the_first_x_layers": "1",
    "cool_plate_temp": "35",
    "cool_plate_temp_initial_layer": "35",
    "eng_plate_temp": "0",
    "eng_plate_temp_initial_layer": "0",
    "fan_cooling_layer_time": "100",
    "fan_max_speed": "100",
    "fan_min_speed": "100",
    "filament_density": "1.24",
    "filament_end_gcode": "\n",
    "filament_flow_ratio": "0.98",
    "filament_max_volumetric_speed": "12",
    "filament_multitool_ramming_flow": "20",
    "graphic_effect_plate_temp": "65",
    "graphic_effect_plate_temp_initial_layer": "65",
    "hot_plate_temp": "65",
    "hot_plate_temp_initial_layer": "65",
    "nozzle_temperature": "220",
    "nozzle_temperature_initial_layer": "220",
    "nozzle_temperature_range_high": "240",
    "nozzle_temperature_range_low": "190",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "50%",
    "slow_down_layer_time": "8",
    "temperature_vitrification": "45",
    "textured_plate_temp": "65",
    "textured_plate_temp_initial_layer": "65"
  },
  "PLA-CF": {
    "close_fan_the_first_x_layers": "1",
    "cool_plate_temp": "45",
    "cool_plate_temp_initial_layer": "45",
    "eng_plate_temp": "0",
    "eng_plate_temp_initial_layer": "0",
    "fan_cooling_layer_time": "100",
    "fan_max_speed": "100",
    "fan_min_speed": "100",
    "filament_density": "1.24",
    "filament_max_volumetric_speed": "12",
    "filament_multitool_ramming_flow": "20",
    "graphic_effect_plate_temp": "65",
    "graphic_effect_plate_temp_initial_layer": "65",
    "hot_plate_temp": "65",
    "hot_plate_temp_initial_layer": "65",
    "nozzle_temperature": "220",
    "nozzle_temperature_initial_layer": "220",
    "nozzle_temperature_range_high": "240",
    "nozzle_temperature_range_low": "190",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "50%",
    "required_nozzle_HRC": "40",
    "slow_down_layer_time": "7",
    "temperature_vitrification": "45",
    "textured_plate_temp": "65",
    "textured_plate_temp_initial_layer": "65"
  },
  "PVA": {
    "additional_cooling_fan_speed": "70",
    "close_fan_the_first_x_layers": "1",
    "cool_plate_temp": "45",
    "cool_plate_temp_initial_layer": "45",
    "eng_plate_temp": "0",
    "eng_plate_temp_initial_layer": "0",
    "fan_cooling_layer_time": "100",
    "fan_max_speed": "100",
    "fan_min_speed": "100",
    "filament_density": "1.24",
    "filament_end_gcode": "; filament end gcode \n\n",
    "filament_is_support": "1",
    "filament_max_volumetric_speed": "6",
    "filament_multitool_ramming_flow": "6",
    "filament_multitool_ramming_volume": "0.1",
    "filament_retract_length_toolchange": "3",
    "filament_soluble": "1",
    "filament_start_gcode": "; filament start gcode\n",
    "hot_plate_temp": "65",
    "hot_plate_temp_initial_layer": "65",
    "nozzle_temperature": "240",
    "nozzle_temperature_initial_layer": "240",
    "nozzle_temperature_range_high": "240",
    "nozzle_temperature_range_low": "190",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "50%",
    "pressure_advance": "0.028",
    "slow_down_layer_time": "7",
    "temperature_vitrification": "45",
    "textured_plate_temp": "65",
    "textured_plate_temp_initial_layer": "65"
  },
  "TPU": {
    "additional_cooling_fan_speed": "70",
    "close_fan_the_first_x_layers": "1",
    "cool_plate_temp": "30",
    "cool_plate_temp_initial_layer": "30",
    "eng_plate_temp": "30",
    "eng_plate_temp_initial_layer": "30",
    "fan_cooling_layer_time": "100",
    "fan_max_speed": "100",
    "fan_min_speed": "100",
    "filament_density": "1.24",
    "filament_deretraction_speed": "20",
    "filament_end_gcode": "; filament end gcode \n\n",
    "filament_flow_ratio": "1",
    "filament_max_volumetric_speed": "3.2",
    "filament_multitool_ramming_flow": "3.2",
    "filament_multitool_ramming_volume": "0.1",
    "filament_retract_length_toolchange": "2",
    "filament_retraction_length": "1.5",
    "filament_retraction_speed": "20",
    "filament_start_gcode": "; filament start gcode\n",
    "graphic_effect_plate_temp": "35",
    "graphic_effect_plate_temp_initial_layer": "35",
    "hot_plate_temp": "35",
    "hot_plate_temp_initial_layer": "35",
    "nozzle_temperature": "240",
    "nozzle_temperature_initial_layer": "240",
    "nozzle_temperature_range_high": "250",
    "nozzle_temperature_range_low": "200",
    "overhang_fan_speed": "100",
    "overhang_fan_threshold": "95%",
    "pressure_advance": "0.4",
    "slow_down_layer_time": "8",
    "slow_down_min_speed": "10",
    "temperature_vitrification": "30",
    "textured_plate_temp": "35",
    "textured_plate_temp_initial_layer": "35"
  }
};
function u1FilamentPreset(type) {
  if (!type) return null;
  const t = type.trim().toUpperCase();
  if (U1_FILAMENT_PRESETS[t]) return U1_FILAMENT_PRESETS[t];
  const family = t.match(/^[A-Z]+/)?.[0];
  return family && U1_FILAMENT_PRESETS[family] ? U1_FILAMENT_PRESETS[family] : null;
}
function applyU1FilamentPreset(cfg, slot, type) {
  const preset = u1FilamentPreset(type);
  if (!preset) return;
  for (const [k, v] of Object.entries(preset)) {
    const arr = cfg[k];
    if (Array.isArray(arr) && slot < arr.length) arr[slot] = v;
  }
}

// src/lib/u1-high-flow.ts
var U1_HIGH_FLOW_FILAMENTS = {
  "Snapmaker ABS @U1 0.4 nozzle": { type: "ABS", hf: { "filament_flow_ratio": "0.95", "pressure_advance": "0.02", "nozzle_temperature_initial_layer": "280", "nozzle_temperature": "280", "filament_max_volumetric_speed": "22", "fan_min_speed": "10", "fan_max_speed": "60", "additional_cooling_fan_speed": "0", "filament_retraction_length": "0.2", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming": "1", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "30", "filament_minimal_purge_on_wipe_tower": "15" } },
  "Snapmaker ASA @U1 0.4 nozzle": { type: "ASA", hf: { "filament_flow_ratio": "0.94", "pressure_advance": "0.02", "nozzle_temperature_initial_layer": "280", "nozzle_temperature": "280", "filament_max_volumetric_speed": "22", "fan_min_speed": "10", "fan_max_speed": "25", "additional_cooling_fan_speed": "0", "filament_retraction_length": "0.6", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming_volume": "10", "filament_multitool_ramming_flow": "20", "filament_minimal_purge_on_wipe_tower": "15" } },
  "Snapmaker PETG HF": { type: "PETG", hf: { "filament_flow_ratio": "0.955", "enable_pressure_advance": "1", "pressure_advance": "0.035", "nozzle_temperature_initial_layer": "230", "nozzle_temperature": "245", "filament_max_volumetric_speed": "30", "fan_min_speed": "30", "fan_max_speed": "60", "additional_cooling_fan_speed": "0", "filament_retraction_length": "0.8", "filament_retraction_speed": "40", "filament_deretraction_speed": "40", "filament_z_hop_types": "Slope Lift", "filament_wipe_distance": "1", "filament_retract_length_toolchange": "8", "filament_multitool_ramming": "1", "filament_multitool_ramming_volume": "8", "filament_multitool_ramming_flow": "30", "filament_minimal_purge_on_wipe_tower": "50" } },
  "Snapmaker PETG Translucent @U1 0.4 nozzle": { type: "PETG", hf: { "pressure_advance": "0.05" } },
  "Snapmaker PLA Full Spectrum @U1 0.4 nozzle": { type: "PLA", hf: { "enable_pressure_advance": "1", "pressure_advance": "0.024", "filament_retraction_length": "0.5", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5" } },
  "Snapmaker PLA Glow @U1 0.4 nozzle": { type: "PLA", hf: { "filament_flow_ratio": "0.98", "pressure_advance": "0.023", "filament_max_volumetric_speed": "18", "additional_cooling_fan_speed": "100" } },
  "Snapmaker PLA Matte @U1": { type: "PLA", hf: { "filament_flow_ratio": "0.99", "enable_pressure_advance": "1", "pressure_advance": "0.024", "nozzle_temperature_initial_layer": "220", "nozzle_temperature": "220", "filament_max_volumetric_speed": "40", "fan_min_speed": "100", "fan_max_speed": "100", "additional_cooling_fan_speed": "100", "filament_retraction_length": "1", "filament_z_hop_types": "Slope Lift", "filament_wipe_distance": "1", "filament_retract_length_toolchange": "5", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "40", "filament_minimal_purge_on_wipe_tower": "15" } },
  "Snapmaker PLA Silk @U1": { type: "PLA", hf: { "filament_flow_ratio": "0.98", "pressure_advance": "0.015", "nozzle_temperature_initial_layer": "230", "nozzle_temperature": "230", "filament_max_volumetric_speed": "12", "fan_min_speed": "100", "fan_max_speed": "100", "additional_cooling_fan_speed": "80", "filament_retraction_length": "0.2", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "25", "filament_minimal_purge_on_wipe_tower": "15" } },
  "Snapmaker PLA SnapSpeed @U1": { type: "PLA", hf: { "filament_flow_ratio": "0.966", "enable_pressure_advance": "1", "pressure_advance": "0.024", "nozzle_temperature_initial_layer": "220", "nozzle_temperature": "220", "filament_max_volumetric_speed": "40", "fan_min_speed": "100", "fan_max_speed": "100", "additional_cooling_fan_speed": "70", "filament_retraction_length": "1.2", "filament_z_hop_types": "Slope Lift", "filament_retract_length_toolchange": "5", "filament_multitool_ramming": "1", "filament_multitool_ramming_volume": "5", "filament_multitool_ramming_flow": "40", "filament_minimal_purge_on_wipe_tower": "15" } },
  "Snapmaker PLA Translucent @U1 0.4 nozzle": { type: "PLA", hf: { "pressure_advance": "0.024" } },
  "Snapmaker PLA Wood @U1 0.4 nozzle": { type: "PLA", hf: { "pressure_advance": "0.024", "filament_max_volumetric_speed": "20", "filament_z_hop_types": "Auto Lift", "filament_retract_length_toolchange": "6" } },
  "Snapmaker PVA @U1": { type: "PVA", hf: { "filament_flow_ratio": "0.97", "filament_max_volumetric_speed": "6", "filament_retraction_length": "0.6" } },
  "Snapmaker Support For PLA @U1 0.4 nozzle": { type: "PLA", hf: { "filament_flow_ratio": "0.95", "filament_max_volumetric_speed": "18" } }
};
var U1_HIGH_FLOW_SPEEDS = {
  outer_wall_speed: "500",
  inner_wall_speed: "600",
  sparse_infill_speed: "600",
  internal_solid_infill_speed: "600"
};
var DEFAULT_FOR_TYPE = {
  PLA: "Snapmaker PLA SnapSpeed @U1",
  PETG: "Snapmaker PETG HF",
  ABS: "Snapmaker ABS @U1 0.4 nozzle",
  ASA: "Snapmaker ASA @U1 0.4 nozzle",
  PVA: "Snapmaker PVA @U1"
};
var FILAMENT_KEYS = [
  "filament_flow_ratio",
  "enable_pressure_advance",
  "pressure_advance",
  "nozzle_temperature_initial_layer",
  "nozzle_temperature",
  "filament_max_volumetric_speed",
  "fan_min_speed",
  "fan_max_speed",
  "additional_cooling_fan_speed",
  "filament_retraction_length",
  "filament_retraction_speed",
  "filament_deretraction_speed",
  "filament_z_hop_types",
  "filament_wipe_distance",
  "filament_retract_length_toolchange",
  "filament_multitool_ramming",
  "filament_multitool_ramming_volume",
  "filament_multitool_ramming_flow",
  "filament_minimal_purge_on_wipe_tower"
];
function highFlowPresetFor(settingsId, type) {
  if (typeof settingsId === "string" && settingsId in U1_HIGH_FLOW_FILAMENTS) return settingsId;
  return DEFAULT_FOR_TYPE[String(type ?? "").toUpperCase()] ?? null;
}
var at = (v, i) => Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v;
function applyHighFlow(cfg) {
  const ids = Array.isArray(cfg.filament_settings_id) ? cfg.filament_settings_id : [];
  const types = Array.isArray(cfg.filament_type) ? cfg.filament_type : [];
  const n = ids.length;
  const slots = ids.map((id, slot) => ({ slot, preset: highFlowPresetFor(id, types[slot]) }));
  if (!slots.some((s) => s.preset)) return slots;
  for (const k of FILAMENT_KEYS) {
    if (!(k in cfg)) continue;
    const v = cfg[k];
    cfg[k] = slots.flatMap(({ slot, preset }) => {
      const std = String(at(v, slot));
      return preset ? [std, U1_HIGH_FLOW_FILAMENTS[preset].hf[k] ?? std] : [std];
    });
  }
  cfg.filament_settings_id = slots.map(({ slot, preset }) => preset ?? ids[slot]);
  cfg.filament_flow_step_size = slots.map((s) => s.preset ? "2" : "1");
  cfg.filament_flow_support = slots.flatMap((s) => s.preset ? ["standard", "high_flow"] : ["standard"]);
  cfg.filament_volume_type = slots.map((s) => s.preset ? "high_flow" : "standard");
  const heads = Array.isArray(cfg.nozzle_diameter) ? cfg.nozzle_diameter.length : n;
  cfg.nozzle_volume_type = Array.from({ length: heads }, (_, i) => slots[i]?.preset ? "high_flow" : "standard");
  cfg.printer_flow_support = ["standard", "high_flow"];
  cfg.process_flow_support = ["standard", "high_flow"];
  for (const [k, hf] of Object.entries(U1_HIGH_FLOW_SPEEDS)) cfg[k] = [String(at(cfg[k], 0) ?? hf), hf];
  return slots;
}

// src/lib/paint.ts
function boundedUnzip(buf, maxTotal, maxEntry = () => Infinity, keep = () => true) {
  const out = {};
  let inflated = 0;
  let overflow = false;
  let entryOverflow = null;
  let failure = null;
  const uz = new Unzip((file) => {
    if (overflow || entryOverflow || failure || !keep(file.name)) return;
    const limit = maxEntry(file.name);
    const chunks = [];
    let size = 0;
    file.ondata = (err2, chunk, final) => {
      if (err2) {
        failure = err2;
        return;
      }
      if (overflow || entryOverflow) return;
      size += chunk.length;
      inflated += chunk.length;
      if (inflated > maxTotal || size > limit) {
        if (inflated > maxTotal) overflow = true;
        else entryOverflow = { name: file.name, size };
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        if (chunks.length === 1) out[file.name] = chunks[0];
        else {
          const all = new Uint8Array(size);
          let o = 0;
          for (const c of chunks) {
            all.set(c, o);
            o += c.length;
          }
          out[file.name] = all;
        }
      }
    };
    file.start();
  });
  uz.register(UnzipInflate);
  const SLICE = 16 * 1024;
  for (let o = 0; o < buf.length && !overflow && !entryOverflow && !failure; o += SLICE) {
    uz.push(buf.subarray(o, o + SLICE), o + SLICE >= buf.length);
  }
  if (failure) throw failure;
  return { out, inflated, overflow, entryOverflow };
}
function normalizeHex(h) {
  const s = (h || "").replace("#", "");
  return s.length >= 6 ? "#" + s.slice(0, 6).toUpperCase() : "#FFFFFF";
}
function hexToBits(h) {
  const bits2 = [];
  for (let j = h.length - 1; j >= 0; j--) {
    const d = parseInt(h[j], 16);
    for (let b = 0; b < 4; b++) bits2.push(d >> b & 1);
  }
  return bits2;
}
function bitsToHex(bits2) {
  let h = "";
  for (let i = 0; i < bits2.length; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4 && i + b < bits2.length; b++) nib |= bits2[i + b] << b;
    h = nib.toString(16).toUpperCase() + h;
  }
  return h;
}
function encodeSolidPaint(state) {
  const bits2 = [0, 0];
  if (state >= 3) {
    bits2.push(1, 1);
    for (let i = 0; i < 4; i++) bits2.push(state - 3 >> i & 1);
  } else {
    bits2.push(state & 1, state >> 1 & 1);
  }
  return bitsToHex(bits2);
}
function applyPrusaVolumePaint(entries) {
  const cfgEntry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("slic3r_pe_model.config"));
  if (!cfgEntry) return entries;
  const cfgXml = strFromU8(cfgEntry[1]);
  const objects = /* @__PURE__ */ new Map();
  for (const om of cfgXml.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const oid = parseInt(om[1], 10);
    const body = om[2];
    const objExtruder = parseInt(body.match(/key="extruder" value="(\d+)"/)?.[1] ?? "1", 10);
    const vols = [];
    for (const vm of body.matchAll(/<volume firstid="(\d+)" lastid="(\d+)"[^>]*>([\s\S]*?)<\/volume>/g)) {
      vols.push({ first: parseInt(vm[1], 10), last: parseInt(vm[2], 10), extruder: parseInt(vm[3].match(/key="extruder" value="(\d+)"/)?.[1] ?? String(objExtruder), 10) });
    }
    objects.set(oid, { objExtruder, vols });
  }
  const withVols = [...objects.values()].filter((o) => o.vols.length);
  if (!withVols.length) return entries;
  const onlyObj = objects.size === 1 ? [...objects.values()][0] : null;
  const out = { ...entries };
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".model")) continue;
    let changed = false;
    const xml = strFromU8(data).replace(/<object id="(\d+)"([^>]*)>([\s\S]*?)<\/object>/g, (block, oidStr) => {
      const info = objects.get(parseInt(oidStr, 10)) ?? onlyObj;
      if (!info || !info.vols.length) return block;
      const extOf = (t2) => {
        for (const v of info.vols) if (t2 >= v.first && t2 <= v.last) return v.extruder;
        return info.objExtruder;
      };
      let t = -1;
      return block.replace(/<triangle\b([^>]*)\/>/g, (tri, rawAttrs) => {
        const attrs = rawAttrs.trimEnd();
        t++;
        if (/paint_color=|mmu_segmentation=/.test(attrs)) return tri;
        changed = true;
        return `<triangle${attrs} paint_color="${encodeSolidPaint(extOf(t))}"/>`;
      });
    });
    if (changed) out[path] = strToU8(xml);
  }
  return out;
}
function remapPaintCode(hex, stateMap) {
  const bits2 = hexToBits(hex);
  let p = 0;
  const rd = (k) => {
    let n = 0;
    for (let i = 0; i < k; i++) n |= (bits2[p++] || 0) << i;
    return n;
  };
  const out = [];
  (function tri() {
    const ss = rd(2);
    if (ss !== 0) {
      const side = rd(2);
      out.push(ss & 1, ss >> 1 & 1, side & 1, side >> 1 & 1);
      for (let c = 0; c < ss + 1; c++) tri();
      return;
    }
    const lo = rd(2);
    const s = lo === 3 ? rd(4) + 3 : lo;
    const ns = stateMap(s);
    out.push(0, 0);
    if (ns >= 3) {
      out.push(1, 1);
      for (let i = 0; i < 4; i++) out.push(ns - 3 >> i & 1);
    } else {
      out.push(ns & 1, ns >> 1 & 1);
    }
  })();
  while (out.length % 4 !== 0) out.push(0);
  return bitsToHex(out);
}
function dominantState(hex) {
  const bits2 = hexToBits(hex);
  let p = 0;
  const rd = (k) => {
    let n = 0;
    for (let i = 0; i < k; i++) n |= (bits2[p++] || 0) << i;
    return n;
  };
  let st = 0;
  (function tri() {
    const ss = rd(2);
    if (ss) {
      rd(2);
      for (let c = 0; c < ss + 1; c++) tri();
    } else {
      const lo = rd(2);
      const s = lo === 3 ? rd(4) + 3 : lo;
      if (st === 0) st = s;
    }
  })();
  return st;
}
var MAX_PREVIEW_INFLATED = 800 * 1024 * 1024;
var PREVIEW_BUDGET = 2e6;
var MAX_WALK_VISITS = 2e6;
var HARD_CAP = 3e7;
var TRI_RE = /<triangle[ />]/g;
var IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function transform12to16(t) {
  if (t.length < 12) return IDENTITY4.slice();
  return [t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0, t[9], t[10], t[11], 1];
}
function matMul(A, B) {
  const R = new Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
      R[r * 4 + c] = s;
    }
  return R;
}
var attr = (s, name) => s.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))?.[1];
var UNIT_MM = {
  micron: 1e-3,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1e3
};
function unitScale(unit) {
  return UNIT_MM[(unit ?? "").trim().toLowerCase()] ?? 1;
}
var stripSlash = (p) => p.replace(/^\//, "");
function paletteFromFullSpectrum(entries) {
  const ent = Object.entries(entries).find(([p]) => /full_spectrum\.json$/i.test(p));
  if (!ent) return null;
  try {
    const o = JSON.parse(strFromU8(ent[1]));
    const all = [...o.physical_extruders ?? [], ...o.virtual_extruders ?? []].filter((e) => e.id && e.color);
    if (!all.length) return null;
    const maxId = Math.max(...all.map((e) => e.id));
    const pal = new Array(maxId).fill("#FFFFFF");
    for (const e of all) pal[e.id - 1] = normalizeHex(e.color);
    return pal;
  } catch {
    return null;
  }
}
function recipesFromFullSpectrum(entries) {
  const ent = Object.entries(entries).find(([p]) => /full_spectrum\.json$/i.test(p));
  if (!ent) return null;
  try {
    const o = JSON.parse(strFromU8(ent[1]));
    const m = /* @__PURE__ */ new Map();
    for (const v of o.virtual_extruders ?? []) {
      if (!v.id || !Array.isArray(v.components)) continue;
      const comps = v.components.filter((c) => c.extruder && c.ratio != null).map((c) => ({ extruder: c.extruder, ratio: c.ratio }));
      if (comps.length) m.set(v.id, comps);
    }
    return m.size ? m : null;
  } catch {
    return null;
  }
}
function extractMeshFromBuffer(buf, maxFaces = PREVIEW_BUDGET, hardCap = HARD_CAP) {
  const unzipped = boundedUnzip(buf, MAX_PREVIEW_INFLATED);
  if (unzipped.overflow) {
    return { positions: new Float32Array(0), mmPerUnit: 1, faceState: new Uint8Array(0), palette: [], usage: [], statesPresent: [], baseState: 1, triangleCount: 0, skipped: true, sampled: false, parts: [], plates: [] };
  }
  const entries = applyPrusaVolumePaint(unzipped.out);
  let palette = [];
  let prusaPalette = [];
  let baseState = 1;
  const faceCountToExtr = /* @__PURE__ */ new Map();
  const faceCountToName = /* @__PURE__ */ new Map();
  const idToExtr = /* @__PURE__ */ new Map();
  const plateDefs = [];
  const files = /* @__PURE__ */ new Map();
  let buildPath = "";
  let mmPerUnit = 1;
  const buildItems = [];
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (base === "project_settings.config") {
      try {
        palette = (JSON.parse(strFromU8(data)).filament_colour ?? []).map(normalizeHex);
      } catch {
      }
    } else if (base === "slic3r_pe.config") {
      const text = strFromU8(data);
      const grab = (key) => {
        const m = text.match(new RegExp(`^;?\\s*${key}\\s*=\\s*(.+)$`, "m"));
        return m ? m[1].trim().split(/[;,]/).map((s) => normalizeHex(s.trim())).filter(Boolean) : [];
      };
      const fc2 = grab("filament_colour");
      const ec2 = grab("extruder_colour");
      const distinct = (a) => new Set(a).size;
      prusaPalette = distinct(fc2) >= 2 ? fc2 : distinct(ec2) >= 2 ? ec2 : fc2.length ? fc2 : ec2;
    } else if (base === "model_settings.config") {
      const xml = strFromU8(data);
      const first = xml.match(/key="extruder" value="(\d+)"/);
      if (first) baseState = parseInt(first[1], 10);
      for (const om of xml.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)) {
        const body = om[1];
        const ex = parseInt(body.match(/key="extruder" value="(\d+)"/)?.[1] ?? "0", 10);
        const fc2 = parseInt(body.match(/face_count="(\d+)"/)?.[1] ?? "0", 10);
        const nm = body.match(/key="name" value="([^"]*)"/)?.[1];
        if (fc2 > 0) {
          if (ex > 0) faceCountToExtr.set(fc2, ex);
          if (nm) faceCountToName.set(fc2, nm);
        }
        for (const pm of body.matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
          const pid = parseInt(attr(pm[1], "id") ?? "-1", 10);
          if (pid < 0) continue;
          const pe = parseInt(pm[2].match(/key="extruder" value="(\d+)"/)?.[1] ?? "0", 10);
          idToExtr.set(pid, pe > 0 ? pe : ex > 0 ? ex : baseState);
        }
      }
      for (const pm of xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
        const body = pm[1];
        const name = body.match(/key="plater_name" value="([^"]*)"/)?.[1] ?? "";
        const objectIds = [...body.matchAll(/key="object_id" value="(\d+)"/g)].map((m) => parseInt(m[1], 10));
        if (objectIds.length) plateDefs.push({ name, objectIds });
      }
    } else if (lower.endsWith(".model")) {
      const xml = strFromU8(data);
      const objs = /* @__PURE__ */ new Map();
      for (const om of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
        const id = parseInt(attr(om[1], "id") ?? "-1", 10);
        if (id < 0) continue;
        const body = om[2];
        const meshM = body.match(/<mesh>([\s\S]*?)<\/mesh>/);
        if (meshM) {
          objs.set(id, { mesh: meshM[1] });
        } else {
          const comps = [];
          for (const cm of body.matchAll(/<component\b([^>]*?)\/?>/g)) {
            const oid = parseInt(attr(cm[1], "objectid") ?? "-1", 10);
            if (oid < 0) continue;
            const cp = attr(cm[1], "path");
            const tStr = attr(cm[1], "transform");
            comps.push({
              path: cp ? stripSlash(cp) : stripSlash(path),
              objectid: oid,
              transform: transform12to16(tStr ? tStr.trim().split(/\s+/).map(Number) : [])
            });
          }
          objs.set(id, { comps });
        }
      }
      files.set(stripSlash(path), objs);
      if (/<build[\s>]/.test(xml)) {
        buildPath = stripSlash(path);
        mmPerUnit = unitScale(attr(xml.match(/<model\b[^>]*>/)?.[0] ?? "", "unit"));
        for (const im of xml.matchAll(/<item\b([^>]*?)\/?>/g)) {
          const oid = parseInt(attr(im[1], "objectid") ?? "-1", 10);
          if (oid < 0) continue;
          const tStr = attr(im[1], "transform");
          buildItems.push({ objectid: oid, transform: transform12to16(tStr ? tStr.trim().split(/\s+/).map(Number) : []) });
        }
      }
    }
  }
  const triCountOf = (node) => {
    if (node.triCount == null) node.triCount = node.mesh ? (node.mesh.match(TRI_RE) || []).length : 0;
    return node.triCount;
  };
  let visits = 0;
  const walk = (path, oid, M, depth, onLeaf) => {
    if (depth > 64) return;
    if (++visits > MAX_WALK_VISITS) throw new Error("model graph too large to preview");
    const node = files.get(path)?.get(oid);
    if (!node) return;
    if (node.mesh != null) {
      onLeaf(node, M, oid);
      return;
    }
    for (const c of node.comps ?? []) walk(c.path, c.objectid, matMul(c.transform, M), depth + 1, onLeaf);
  };
  if (palette.length === 0 && prusaPalette.length) palette = prusaPalette;
  const fsPal = paletteFromFullSpectrum(entries);
  if (fsPal && fsPal.length > palette.length) palette = fsPal;
  let roots = buildItems.map((it) => ({ path: buildPath, objectid: it.objectid, transform: it.transform }));
  if (roots.length === 0) {
    roots = [];
    for (const [path, objs] of files) for (const [id, node] of objs) if (node.mesh != null) roots.push({ path, objectid: id, transform: IDENTITY4.slice() });
  }
  let triangleCount = 0;
  const rootBase = [];
  const rootName = [];
  for (const r of roots) {
    let n = 0;
    walk(r.path, r.objectid, r.transform, 0, (node) => {
      n += triCountOf(node);
    });
    triangleCount += n;
    rootBase.push(faceCountToExtr.get(n) ?? baseState);
    rootName.push(faceCountToName.get(n) ?? "");
  }
  const empty = (skipped) => ({
    positions: new Float32Array(0),
    mmPerUnit,
    faceState: new Uint8Array(0),
    palette,
    usage: palette.map(() => 0),
    statesPresent: [],
    baseState,
    triangleCount,
    skipped,
    sampled: false,
    parts: [],
    plates: []
  });
  if (triangleCount === 0) return empty(false);
  if (triangleCount > hardCap) return empty(true);
  const stride = triangleCount > maxFaces ? Math.ceil(triangleCount / maxFaces) : 1;
  const cap = stride === 1 ? triangleCount : Math.ceil(triangleCount / stride);
  const positions = new Float32Array(cap * 9);
  const faceState = new Uint8Array(cap);
  let vc = 0;
  let fc = 0;
  let gtri = 0;
  const emit = (seg, M, baseExtr) => {
    const nv = (seg.match(/<vertex\b/g) || []).length;
    const vx = new Float32Array(nv * 3);
    let i = 0;
    for (const m of seg.matchAll(/<vertex[^>]*\/>/g)) {
      const tag = m[0];
      const x = +(tag.match(/x="([^"]+)"/)?.[1] ?? 0);
      const y = +(tag.match(/y="([^"]+)"/)?.[1] ?? 0);
      const z = +(tag.match(/z="([^"]+)"/)?.[1] ?? 0);
      vx[i++] = (x * M[0] + y * M[4] + z * M[8] + M[12]) * mmPerUnit;
      vx[i++] = (x * M[1] + y * M[5] + z * M[9] + M[13]) * mmPerUnit;
      vx[i++] = (x * M[2] + y * M[6] + z * M[10] + M[14]) * mmPerUnit;
    }
    for (const m of seg.matchAll(/<triangle ([^>]*?)\/>/g)) {
      if (gtri++ % stride !== 0) continue;
      const a = m[1];
      const v1 = +(a.match(/v1="(\d+)"/)?.[1] ?? 0);
      const v2 = +(a.match(/v2="(\d+)"/)?.[1] ?? 0);
      const v3 = +(a.match(/v3="(\d+)"/)?.[1] ?? 0);
      const pc = a.match(/(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/);
      faceState[fc++] = pc ? dominantState(pc[1]) : baseExtr;
      positions[vc++] = vx[v1 * 3];
      positions[vc++] = vx[v1 * 3 + 1];
      positions[vc++] = vx[v1 * 3 + 2];
      positions[vc++] = vx[v2 * 3];
      positions[vc++] = vx[v2 * 3 + 1];
      positions[vc++] = vx[v2 * 3 + 2];
      positions[vc++] = vx[v3 * 3];
      positions[vc++] = vx[v3 * 3 + 1];
      positions[vc++] = vx[v3 * 3 + 2];
    }
  };
  const partRanges = [];
  roots.forEach((r, ri) => {
    partRanges.push({ name: rootName[ri], objectId: r.objectid, start: fc });
    walk(r.path, r.objectid, r.transform, 0, (node, M, leafOid) => emit(node.mesh, M, idToExtr.get(leafOid) ?? rootBase[ri]));
  });
  const parts = partRanges.map((pr, i) => {
    const end = i + 1 < partRanges.length ? partRanges[i + 1].start : fc;
    return {
      name: pr.name,
      objectId: pr.objectId,
      positions: positions.subarray(pr.start * 9, end * 9),
      faceState: faceState.subarray(pr.start, end),
      triangleCount: end - pr.start
    };
  }).filter((p) => p.triangleCount > 0);
  const plates = plateDefs.map((pd) => ({
    name: pd.name,
    partIndices: parts.map((p, i) => pd.objectIds.includes(p.objectId) ? i : -1).filter((i) => i >= 0)
  })).filter((pl) => pl.partIndices.length > 0);
  const usage = palette.map(() => 0);
  const present = /* @__PURE__ */ new Set();
  for (let f = 0; f < fc; f++) {
    const s = faceState[f];
    if (s >= 1) {
      usage[s - 1] = (usage[s - 1] ?? 0) + 1;
      present.add(s);
    }
  }
  return {
    positions: vc === positions.length ? positions : positions.subarray(0, vc),
    mmPerUnit,
    faceState: fc === faceState.length ? faceState : faceState.subarray(0, fc),
    palette,
    usage,
    statesPresent: [...present].sort((a, b) => a - b),
    baseState,
    triangleCount,
    skipped: false,
    sampled: stride > 1,
    parts,
    plates
  };
}

// src/lib/filament-mixer.ts
var POWERS = [[0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0], [1, 0, 1, 0, 0, 0, 0], [1, 0, 0, 1, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 1], [0, 2, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0], [0, 1, 0, 1, 0, 0, 0], [0, 1, 0, 0, 1, 0, 0], [0, 1, 0, 0, 0, 1, 0], [0, 1, 0, 0, 0, 0, 1], [0, 0, 2, 0, 0, 0, 0], [0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 0, 1, 0, 0], [0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 0, 0, 1], [0, 0, 0, 2, 0, 0, 0], [0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 1, 0, 1, 0], [0, 0, 0, 1, 0, 0, 1], [0, 0, 0, 0, 2, 0, 0], [0, 0, 0, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0, 1], [0, 0, 0, 0, 0, 2, 0], [0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 0, 0, 2], [3, 0, 0, 0, 0, 0, 0], [2, 1, 0, 0, 0, 0, 0], [2, 0, 1, 0, 0, 0, 0], [2, 0, 0, 1, 0, 0, 0], [2, 0, 0, 0, 1, 0, 0], [2, 0, 0, 0, 0, 1, 0], [2, 0, 0, 0, 0, 0, 1], [1, 2, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, 0], [1, 1, 0, 1, 0, 0, 0], [1, 1, 0, 0, 1, 0, 0], [1, 1, 0, 0, 0, 1, 0], [1, 1, 0, 0, 0, 0, 1], [1, 0, 2, 0, 0, 0, 0], [1, 0, 1, 1, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0], [1, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 0, 0, 1], [1, 0, 0, 2, 0, 0, 0], [1, 0, 0, 1, 1, 0, 0], [1, 0, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 0, 1], [1, 0, 0, 0, 2, 0, 0], [1, 0, 0, 0, 1, 1, 0], [1, 0, 0, 0, 1, 0, 1], [1, 0, 0, 0, 0, 2, 0], [1, 0, 0, 0, 0, 1, 1], [1, 0, 0, 0, 0, 0, 2], [0, 3, 0, 0, 0, 0, 0], [0, 2, 1, 0, 0, 0, 0], [0, 2, 0, 1, 0, 0, 0], [0, 2, 0, 0, 1, 0, 0], [0, 2, 0, 0, 0, 1, 0], [0, 2, 0, 0, 0, 0, 1], [0, 1, 2, 0, 0, 0, 0], [0, 1, 1, 1, 0, 0, 0], [0, 1, 1, 0, 1, 0, 0], [0, 1, 1, 0, 0, 1, 0], [0, 1, 1, 0, 0, 0, 1], [0, 1, 0, 2, 0, 0, 0], [0, 1, 0, 1, 1, 0, 0], [0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 0, 1], [0, 1, 0, 0, 2, 0, 0], [0, 1, 0, 0, 1, 1, 0], [0, 1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 0, 2, 0], [0, 1, 0, 0, 0, 1, 1], [0, 1, 0, 0, 0, 0, 2], [0, 0, 3, 0, 0, 0, 0], [0, 0, 2, 1, 0, 0, 0], [0, 0, 2, 0, 1, 0, 0], [0, 0, 2, 0, 0, 1, 0], [0, 0, 2, 0, 0, 0, 1], [0, 0, 1, 2, 0, 0, 0], [0, 0, 1, 1, 1, 0, 0], [0, 0, 1, 1, 0, 1, 0], [0, 0, 1, 1, 0, 0, 1], [0, 0, 1, 0, 2, 0, 0], [0, 0, 1, 0, 1, 1, 0], [0, 0, 1, 0, 1, 0, 1], [0, 0, 1, 0, 0, 2, 0], [0, 0, 1, 0, 0, 1, 1], [0, 0, 1, 0, 0, 0, 2], [0, 0, 0, 3, 0, 0, 0], [0, 0, 0, 2, 1, 0, 0], [0, 0, 0, 2, 0, 1, 0], [0, 0, 0, 2, 0, 0, 1], [0, 0, 0, 1, 2, 0, 0], [0, 0, 0, 1, 1, 1, 0], [0, 0, 0, 1, 1, 0, 1], [0, 0, 0, 1, 0, 2, 0], [0, 0, 0, 1, 0, 1, 1], [0, 0, 0, 1, 0, 0, 2], [0, 0, 0, 0, 3, 0, 0], [0, 0, 0, 0, 2, 1, 0], [0, 0, 0, 0, 2, 0, 1], [0, 0, 0, 0, 1, 2, 0], [0, 0, 0, 0, 1, 1, 1], [0, 0, 0, 0, 1, 0, 2], [0, 0, 0, 0, 0, 3, 0], [0, 0, 0, 0, 0, 2, 1], [0, 0, 0, 0, 0, 1, 2], [0, 0, 0, 0, 0, 0, 3], [4, 0, 0, 0, 0, 0, 0], [3, 1, 0, 0, 0, 0, 0], [3, 0, 1, 0, 0, 0, 0], [3, 0, 0, 1, 0, 0, 0], [3, 0, 0, 0, 1, 0, 0], [3, 0, 0, 0, 0, 1, 0], [3, 0, 0, 0, 0, 0, 1], [2, 2, 0, 0, 0, 0, 0], [2, 1, 1, 0, 0, 0, 0], [2, 1, 0, 1, 0, 0, 0], [2, 1, 0, 0, 1, 0, 0], [2, 1, 0, 0, 0, 1, 0], [2, 1, 0, 0, 0, 0, 1], [2, 0, 2, 0, 0, 0, 0], [2, 0, 1, 1, 0, 0, 0], [2, 0, 1, 0, 1, 0, 0], [2, 0, 1, 0, 0, 1, 0], [2, 0, 1, 0, 0, 0, 1], [2, 0, 0, 2, 0, 0, 0], [2, 0, 0, 1, 1, 0, 0], [2, 0, 0, 1, 0, 1, 0], [2, 0, 0, 1, 0, 0, 1], [2, 0, 0, 0, 2, 0, 0], [2, 0, 0, 0, 1, 1, 0], [2, 0, 0, 0, 1, 0, 1], [2, 0, 0, 0, 0, 2, 0], [2, 0, 0, 0, 0, 1, 1], [2, 0, 0, 0, 0, 0, 2], [1, 3, 0, 0, 0, 0, 0], [1, 2, 1, 0, 0, 0, 0], [1, 2, 0, 1, 0, 0, 0], [1, 2, 0, 0, 1, 0, 0], [1, 2, 0, 0, 0, 1, 0], [1, 2, 0, 0, 0, 0, 1], [1, 1, 2, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0], [1, 1, 1, 0, 1, 0, 0], [1, 1, 1, 0, 0, 1, 0], [1, 1, 1, 0, 0, 0, 1], [1, 1, 0, 2, 0, 0, 0], [1, 1, 0, 1, 1, 0, 0], [1, 1, 0, 1, 0, 1, 0], [1, 1, 0, 1, 0, 0, 1], [1, 1, 0, 0, 2, 0, 0], [1, 1, 0, 0, 1, 1, 0], [1, 1, 0, 0, 1, 0, 1], [1, 1, 0, 0, 0, 2, 0], [1, 1, 0, 0, 0, 1, 1], [1, 1, 0, 0, 0, 0, 2], [1, 0, 3, 0, 0, 0, 0], [1, 0, 2, 1, 0, 0, 0], [1, 0, 2, 0, 1, 0, 0], [1, 0, 2, 0, 0, 1, 0], [1, 0, 2, 0, 0, 0, 1], [1, 0, 1, 2, 0, 0, 0], [1, 0, 1, 1, 1, 0, 0], [1, 0, 1, 1, 0, 1, 0], [1, 0, 1, 1, 0, 0, 1], [1, 0, 1, 0, 2, 0, 0], [1, 0, 1, 0, 1, 1, 0], [1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 0, 2, 0], [1, 0, 1, 0, 0, 1, 1], [1, 0, 1, 0, 0, 0, 2], [1, 0, 0, 3, 0, 0, 0], [1, 0, 0, 2, 1, 0, 0], [1, 0, 0, 2, 0, 1, 0], [1, 0, 0, 2, 0, 0, 1], [1, 0, 0, 1, 2, 0, 0], [1, 0, 0, 1, 1, 1, 0], [1, 0, 0, 1, 1, 0, 1], [1, 0, 0, 1, 0, 2, 0], [1, 0, 0, 1, 0, 1, 1], [1, 0, 0, 1, 0, 0, 2], [1, 0, 0, 0, 3, 0, 0], [1, 0, 0, 0, 2, 1, 0], [1, 0, 0, 0, 2, 0, 1], [1, 0, 0, 0, 1, 2, 0], [1, 0, 0, 0, 1, 1, 1], [1, 0, 0, 0, 1, 0, 2], [1, 0, 0, 0, 0, 3, 0], [1, 0, 0, 0, 0, 2, 1], [1, 0, 0, 0, 0, 1, 2], [1, 0, 0, 0, 0, 0, 3], [0, 4, 0, 0, 0, 0, 0], [0, 3, 1, 0, 0, 0, 0], [0, 3, 0, 1, 0, 0, 0], [0, 3, 0, 0, 1, 0, 0], [0, 3, 0, 0, 0, 1, 0], [0, 3, 0, 0, 0, 0, 1], [0, 2, 2, 0, 0, 0, 0], [0, 2, 1, 1, 0, 0, 0], [0, 2, 1, 0, 1, 0, 0], [0, 2, 1, 0, 0, 1, 0], [0, 2, 1, 0, 0, 0, 1], [0, 2, 0, 2, 0, 0, 0], [0, 2, 0, 1, 1, 0, 0], [0, 2, 0, 1, 0, 1, 0], [0, 2, 0, 1, 0, 0, 1], [0, 2, 0, 0, 2, 0, 0], [0, 2, 0, 0, 1, 1, 0], [0, 2, 0, 0, 1, 0, 1], [0, 2, 0, 0, 0, 2, 0], [0, 2, 0, 0, 0, 1, 1], [0, 2, 0, 0, 0, 0, 2], [0, 1, 3, 0, 0, 0, 0], [0, 1, 2, 1, 0, 0, 0], [0, 1, 2, 0, 1, 0, 0], [0, 1, 2, 0, 0, 1, 0], [0, 1, 2, 0, 0, 0, 1], [0, 1, 1, 2, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0], [0, 1, 1, 1, 0, 1, 0], [0, 1, 1, 1, 0, 0, 1], [0, 1, 1, 0, 2, 0, 0], [0, 1, 1, 0, 1, 1, 0], [0, 1, 1, 0, 1, 0, 1], [0, 1, 1, 0, 0, 2, 0], [0, 1, 1, 0, 0, 1, 1], [0, 1, 1, 0, 0, 0, 2], [0, 1, 0, 3, 0, 0, 0], [0, 1, 0, 2, 1, 0, 0], [0, 1, 0, 2, 0, 1, 0], [0, 1, 0, 2, 0, 0, 1], [0, 1, 0, 1, 2, 0, 0], [0, 1, 0, 1, 1, 1, 0], [0, 1, 0, 1, 1, 0, 1], [0, 1, 0, 1, 0, 2, 0], [0, 1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 0, 0, 2], [0, 1, 0, 0, 3, 0, 0], [0, 1, 0, 0, 2, 1, 0], [0, 1, 0, 0, 2, 0, 1], [0, 1, 0, 0, 1, 2, 0], [0, 1, 0, 0, 1, 1, 1], [0, 1, 0, 0, 1, 0, 2], [0, 1, 0, 0, 0, 3, 0], [0, 1, 0, 0, 0, 2, 1], [0, 1, 0, 0, 0, 1, 2], [0, 1, 0, 0, 0, 0, 3], [0, 0, 4, 0, 0, 0, 0], [0, 0, 3, 1, 0, 0, 0], [0, 0, 3, 0, 1, 0, 0], [0, 0, 3, 0, 0, 1, 0], [0, 0, 3, 0, 0, 0, 1], [0, 0, 2, 2, 0, 0, 0], [0, 0, 2, 1, 1, 0, 0], [0, 0, 2, 1, 0, 1, 0], [0, 0, 2, 1, 0, 0, 1], [0, 0, 2, 0, 2, 0, 0], [0, 0, 2, 0, 1, 1, 0], [0, 0, 2, 0, 1, 0, 1], [0, 0, 2, 0, 0, 2, 0], [0, 0, 2, 0, 0, 1, 1], [0, 0, 2, 0, 0, 0, 2], [0, 0, 1, 3, 0, 0, 0], [0, 0, 1, 2, 1, 0, 0], [0, 0, 1, 2, 0, 1, 0], [0, 0, 1, 2, 0, 0, 1], [0, 0, 1, 1, 2, 0, 0], [0, 0, 1, 1, 1, 1, 0], [0, 0, 1, 1, 1, 0, 1], [0, 0, 1, 1, 0, 2, 0], [0, 0, 1, 1, 0, 1, 1], [0, 0, 1, 1, 0, 0, 2], [0, 0, 1, 0, 3, 0, 0], [0, 0, 1, 0, 2, 1, 0], [0, 0, 1, 0, 2, 0, 1], [0, 0, 1, 0, 1, 2, 0], [0, 0, 1, 0, 1, 1, 1], [0, 0, 1, 0, 1, 0, 2], [0, 0, 1, 0, 0, 3, 0], [0, 0, 1, 0, 0, 2, 1], [0, 0, 1, 0, 0, 1, 2], [0, 0, 1, 0, 0, 0, 3], [0, 0, 0, 4, 0, 0, 0], [0, 0, 0, 3, 1, 0, 0], [0, 0, 0, 3, 0, 1, 0], [0, 0, 0, 3, 0, 0, 1], [0, 0, 0, 2, 2, 0, 0], [0, 0, 0, 2, 1, 1, 0], [0, 0, 0, 2, 1, 0, 1], [0, 0, 0, 2, 0, 2, 0], [0, 0, 0, 2, 0, 1, 1], [0, 0, 0, 2, 0, 0, 2], [0, 0, 0, 1, 3, 0, 0], [0, 0, 0, 1, 2, 1, 0], [0, 0, 0, 1, 2, 0, 1], [0, 0, 0, 1, 1, 2, 0], [0, 0, 0, 1, 1, 1, 1], [0, 0, 0, 1, 1, 0, 2], [0, 0, 0, 1, 0, 3, 0], [0, 0, 0, 1, 0, 2, 1], [0, 0, 0, 1, 0, 1, 2], [0, 0, 0, 1, 0, 0, 3], [0, 0, 0, 0, 4, 0, 0], [0, 0, 0, 0, 3, 1, 0], [0, 0, 0, 0, 3, 0, 1], [0, 0, 0, 0, 2, 2, 0], [0, 0, 0, 0, 2, 1, 1], [0, 0, 0, 0, 2, 0, 2], [0, 0, 0, 0, 1, 3, 0], [0, 0, 0, 0, 1, 2, 1], [0, 0, 0, 0, 1, 1, 2], [0, 0, 0, 0, 1, 0, 3], [0, 0, 0, 0, 0, 4, 0], [0, 0, 0, 0, 0, 3, 1], [0, 0, 0, 0, 0, 2, 2], [0, 0, 0, 0, 0, 1, 3], [0, 0, 0, 0, 0, 0, 4]];
var COEF = [[8709548448573147e-27, 12792695084835988e-25, -20686547431633292e-25], [1.0578330835477154, -0.008021192096633597, -0.07887056514454707], [0.013590595445277484, 0.8712679751384225, 0.10489876041070494], [-0.041645202609976825, 0.01754653815964341, 1.0022459470293155], [0.04503213166612118, -0.07114091554276289, 0.003912323007789027], [0.017667550785192245, -0.13270927611603664, 0.06369352705895098], [-0.0523434830565911, 0.03776817390125217, -0.020869114508750418], [-0.002337225565202248, -0.0015754261146269214, -0.003051586284524788], [-887678609044813e-18, 3831943888377347e-19, 0.0013777921244252308], [-0.00211519042076832, 5823373625157354e-19, 22405510894120482e-20], [4615451255636119e-19, 7728694517079159e-19, -0.0011080063014334688], [0.0010593748415734588, -3144486817328422e-19, -0.001751291824461981], [0.0014904568901636306, -2092208601016741e-19, 5931003389081877e-19], [-3512466562938527e-19, -8207430174853943e-19, 5718540644808029e-19], [-0.9182046436295813, -0.22778812270277315, 0.06399807930227906], [9242434913775237e-20, 7328413323814954e-19, -0.0015521971841510945], [713695056804218e-18, -8464676218796857e-20, 6502029474425057e-19], [0.0016664086474748598, -12449236277121652e-20, 2682365023461564e-19], [-7202536448605275e-19, 7814342203841573e-19, 0.0011266108900736137], [-6830333343652382e-20, 7277426271594908e-19, -0.0017804884383520458], [-0.03134315719933166, -0.8576040348456503, -0.25722592065627686], [-6478672005958983e-20, -0.0011668898257245766, 0.0011417451175026003], [-5007139256133243e-19, -6875980821113235e-19, 6205980698804402e-19], [-856716727659589e-19, 9744787865935594e-19, -0.0016589283840513951], [6534684787501583e-19, 7516620006725167e-19, -6731963262988566e-19], [-0.044253901100010394, -0.020196535969735023, -0.9946634937613144], [-7391073953924031e-19, 528870828612477e-18, 0.0010094718386023454], [-0.002065773009337632, 960215813758718e-18, -3279938881808194e-19], [34778328063837755e-20, 8418243168507057e-19, -887458944147931e-18], [1.209605517095879, -0.07076608180598139, -0.008563328060089465], [21111650931893527e-20, 7684908469941718e-19, -0.0016322899549154242], [6476980753565161e-19, -4205891292680729e-19, 0.001183540013006149], [-0.02787959452538487, 1.2219920100030455, -0.20738307585884774], [-53245738668067735e-21, -9580273203157907e-19, 9896673096490387e-19], [-0.09039324263062898, -0.04009692321870647, 1.2628561118212007], [-0.0021945363074032287, -0.0012189319004942262, -0.0019229336809308542], [1729508454159645e-21, -8939525115601518e-24, -61487490064134065e-22], [802644554976327e-20, -6425437417234873e-21, -6071034192279071e-21], [32030755275531952e-22, -4835337430934665e-21, 9135637641134731e-22], [-21810580406751018e-22, 6195955525984363e-22, 52139285538176094e-22], [-24331012360434556e-22, 2172018134344658e-21, 19409887424236272e-23], [-15629367206525246e-22, 3952560118181104e-21, 16879296207920197e-22], [-0.0013756729525212785, 3597460719872621e-19, 7389271390001573e-20], [4278220041372197e-21, -8801874799676585e-22, 22945313189141198e-22], [7687589379643325e-21, 24090941058555783e-23, 4693512340708545e-21], [-28716670994431703e-22, 7602239029011427e-22, 457864913314468e-20], [-4012951402676546e-21, 2659292758883765e-21, -23657506781956522e-22], [2326930305139108e-22, 2288143967698903e-21, 18352610769989397e-23], [-0.0021821392701128726, 0.0016501308392036786, 2319929988473231e-19], [-7708297646936979e-21, 42388884124067334e-23, 7300183220029441e-21], [-12311132945291153e-22, 15007652971891008e-22, -1911397449282093e-21], [-16887275643348576e-22, 10325423682469798e-22, -17208110816360755e-22], [16427692819970946e-22, -4963502195532311e-22, -1463493851856703e-21], [0.0011273176705784368, 5031042811484452e-19, 0.00136398977654309], [-1054496095180893e-21, -4069521153090075e-22, 3530624413794828e-21], [-19874592382257417e-22, 4980219436932082e-22, 3926450613702184e-21], [-1555693779770051e-22, -40026285648409304e-23, -2496091223970487e-21], [0.0021800502283092467, -41027505706483544e-21, -25977631183675995e-20], [5413374398275522e-22, -18860393252860715e-22, -20642860615247005e-22], [-6032437998071405e-21, -37506786446450202e-22, -30570277685104674e-22], [0.00230038011634901, -0.0013258116186125964, -0.001076800968991884], [4467738779105569e-21, 18500840852852477e-24, -2728513575702817e-21], [-0.001491776365130493, -19142673965417666e-20, -0.001712063843327532], [0.023166132558923774, 0.22654053856306355, 0.054233033704626614], [-14056305996310026e-22, -4505518062949011e-21, 8875428948326713e-21], [-16678091645239146e-22, 4120654348811715e-21, -3558650357768367e-21], [2715366220519544e-22, -3085648589265847e-21, -15216436366240205e-22], [26665963202728016e-22, -11943668689507348e-22, -3257383062792857e-21], [-1436662823463275e-21, -2519234736236397e-21, 5212051203441759e-21], [2829545224696122e-19, -0.0015914745471000897, 0.001276857739781671], [-3994712402942413e-21, 9973237723257672e-23, -5281968232614953e-21], [-639858432699425e-20, -4598978644405069e-21, -2397361497857159e-21], [2894574201064981e-21, -31042751214948976e-22, 9755532214376916e-22], [-8965182597200916e-22, -5539966944619144e-21, 10373396403223767e-21], [8821304971688759e-19, -0.0023361840210556237, 0.0013510041064124438], [-21408852102968584e-22, 2590054103603881e-21, -9787131715049274e-23], [-4506683370715525e-21, 358808570076458e-20, -15615934900754108e-22], [-15234510124424727e-22, 22106676879195958e-22, -21955589854724678e-22], [0.0020733404207476836, -0.0015633349848932952, -5537629403641418e-19], [2221517481344401e-21, -47472993890042975e-23, -3467441503046849e-21], [2953890092211725e-21, -29631202344568633e-22, -9003850683086956e-22], [-6477808483486208e-19, 0.002387722633985743, -893908589731968e-18], [9695015676450258e-22, 24143220587295733e-22, 5569082910938938e-22], [-6333920661852476e-19, 0.002386138442672411, -0.0010538372563726147], [0.06762501356163768, -0.055779957915145485, 0.18339365237466657], [35398689426612007e-22, 5929967171025021e-21, -7323785361564028e-21], [5696671933624539e-21, 12021920190870522e-22, -4566638059562769e-21], [7114942182952222e-22, 29306985835913114e-22, 12321083973226843e-23], [-34191789374179993e-22, -14743529177696675e-22, 10739735437081954e-22], [7309318827342547e-19, 0.0011543314909464488, -0.0024002698256901972], [-12278085990743287e-22, 2292879080840278e-21, 18427075464087783e-22], [7715791400806152e-22, 2923781226159432e-21, -1918009354864164e-22], [-3761072799035592e-22, -18315974346148987e-22, 8170896559842045e-22], [-0.0011083088243005806, -5109080795493393e-19, -0.001778351762351517], [-1268397817436994e-21, -2869422520064484e-21, 447464983859263e-20], [-14451871628469448e-22, -70336063552800445e-22, 10489810951325867e-21], [-4986878880074605e-19, 0.0018699018075256726, -0.001243410181567701], [-2904798013327048e-21, -9242722691107062e-22, 7563542220451192e-22], [-0.0011645153400829415, -0.0023421680182785227, 0.004914792646724473], [-0.0770970926241259, 0.09358555739007744, 0.1506238071588469], [11403990530754748e-22, -18066423518238884e-23, -5155274413170749e-21], [7505595876974164e-21, -6239820346867807e-21, -5012451980641267e-21], [2378409548893859e-21, -415663063190342e-20, 1931188294296976e-21], [-0.0015490304811095078, 2658321944442631e-19, 5344015204449139e-19], [4000406345071837e-21, -24396547469427744e-22, 28868325141328394e-22], [7723019161604006e-21, -9543002756254955e-22, 550777546561021e-20], [-0.0022810312659357437, 0.0010265834100970607, 0.0012201056746417261], [-6328180260022076e-21, 9830882092003342e-22, 5243168083434585e-21], [0.0013717566077939558, 40118871572131394e-20, 7593701992452766e-19], [-0.3331846948479176, 0.07828462258231952, -0.09942700542630781], [-17010877090932464e-22, -5107498317344383e-21, 9802674828800206e-21], [-1793013654190559e-21, 4448396733085615e-21, -3838374220726387e-21], [17191169290448337e-20, -0.0015607748034104443, 0.0013072511557901758], [-35576393867912948e-22, 1205589662075894e-21, -5943401146242533e-21], [0.0010232545353764818, -0.0015264096076280137, 31097311785669254e-20], [0.003818428732958201, -0.3021148844534677, 0.27826458714245667], [34612349872620296e-22, 5059291871032084e-21, -685764673719752e-20], [4472283534899323e-19, 9606722177984158e-19, -0.0021938275801053108], [0.2227118331242988, -0.041414199516280246, -0.427998216564745], [-0.0017827115181704878, -9810391113714643e-19, -0.0013751301184155317], [33530539456094743e-26, -1267107516134125e-24, 35424868594091663e-25], [-9269174233716981e-24, 6211909125974913e-24, 18694225223381267e-24], [-15668769615118094e-25, -5443157313766989e-24, 19382297433701012e-25], [7528977163939743e-25, -3489231681363947e-25, -5942177860873699e-25], [2521168551705699e-25, -2482169039752513e-24, 10169900130363452e-25], [37221557745714673e-25, 4519103147249126e-25, -6153616394222183e-24], [-26208881666670014e-23, 32363108668301017e-23, 8853028527228829e-22], [-13053731984236094e-24, 1468085886191517e-23, 267574040702101e-23], [-12399132762186404e-24, 26129834906907234e-24, -4589193073733372e-24], [5030792449289834e-24, -6737831195757771e-25, -1139358718482697e-23], [9090657851484885e-24, -10430405400496667e-24, -32312381381682798e-25], [9556279101374798e-25, -14112956359113582e-24, -17559440013137362e-25], [-10554966943694677e-23, 8472840961948119e-23, 6707618800914916e-22], [-5920793300084881e-25, 6317021183921412e-24, -4515344487199258e-24], [-10403397032732187e-25, 46777548501353294e-25, 2793485047447586e-24], [53875810895887e-22, -9553806995521441e-24, 616488249338687e-25], [11205740918507345e-25, -30064518374839366e-25, -2149406375107077e-24], [-6270046819349673e-22, 8591597864029401e-22, 27319253766838747e-23], [7367841892147453e-25, -8127619688380605e-25, -24322656458353187e-25], [12554612349724437e-25, -6986096146022192e-25, -5298948127507863e-24], [-8883514757140887e-25, 13713256502567717e-25, 192497813869541e-23], [6109926373263491e-22, -6134963673682173e-22, -219901889726877e-20], [-859090437677068e-25, 2727727321794049e-24, 15455403901132314e-25], [-4587989155258043e-25, 4543848519666938e-24, 36318935081602888e-25], [9931157869333407e-23, 16370086224504893e-23, -17139793740024445e-23], [-16298536131831298e-25, -3107621264486493e-24, 17619349555741959e-25], [6272077375645696e-22, -14934305236500493e-22, 8161688701095737e-23], [0.0014251873838024417, -3475318915831863e-19, -2986618388005599e-19], [8981572541255645e-24, -824242643235329e-23, -5347697302343635e-24], [-2177769994893275e-23, -4471411074735698e-24, -1102185170909209e-23], [3196145098582903e-24, -3328611837549733e-24, 9920167465260477e-26], [-2916603930591677e-24, 5598290997443911e-24, 1700806856463899e-24], [12247952417901442e-25, 9207376833186842e-24, -11061875720974612e-26], [7705945875488823e-24, -13326744689866766e-22, 45281267530873637e-23], [9460806429939517e-24, -19548324903251313e-24, -1235926946202559e-23], [-2023300943454487e-24, 11819853429351213e-26, 2347467761842914e-24], [4008399404065166e-24, -48071673031113704e-25, 5258024571297426e-24], [-2531152024087824e-24, 20556317759101717e-26, 5460032703741291e-24], [3248413199720282e-23, -12428470583972055e-22, 4973265498630156e-22], [13772966100944473e-25, -1679039837720886e-24, -56208374898947255e-25], [-3532569375908068e-25, 449320892992322e-23, -4023004866737789e-24], [24897647554755764e-25, -6972563665330611e-24, 14318508462229929e-25], [-4386172993385562e-24, 9450812488268111e-23, -29119746058556273e-23], [32442910302687977e-25, -17164794360174929e-25, 271076100455403e-23], [3869332351053023e-24, -28262815698898436e-25, 8244557564429655e-24], [-7466140683233535e-22, 12769634052966529e-22, 6884130348333226e-22], [-5781186834807883e-24, 13431900591776014e-25, -1158988738314548e-24], [44268697267126067e-23, 6418105887673418e-22, -11605840534271994e-24], [0.002243991927882317, -0.0013512933647788817, -7399442444982368e-19], [747869199901885e-23, -26876261216557396e-25, -7415847880221094e-24], [18086730828315023e-25, -221500551234044e-23, 1869957688693802e-24], [-50551482930205616e-25, 4740487065391097e-24, 2529989939770161e-24], [13244196711559297e-25, 5703392466638313e-24, 7134483004378467e-25], [11976747529294021e-22, 6724452275828116e-22, -19750031960584155e-22], [-1706123992084585e-24, 10714512055365333e-25, 17322588224955027e-25], [11536912744580796e-25, -5803629965495105e-24, 9335156536671718e-25], [33869274052023e-22, 3725310136759585e-24, -31806275668788686e-25], [11478765378023642e-22, -18491720131962237e-22, -2448342869207365e-22], [14555892879908328e-25, 11272008326734806e-25, 9009405443904939e-25], [2096540011042869e-24, 4929134225784004e-24, 30493807479103907e-26], [35403362321374116e-23, 10725951669121386e-22, -6030272059875247e-22], [-27203823915744607e-25, -16007014394525676e-25, 6038538558073014e-25], [-20323566248523807e-22, -10315196283426035e-22, 19963791862845706e-22], [-0.001262611750774932, -4985039885064849e-19, -0.001038758596191436], [6431827292985304e-25, 801776645076302e-24, -18358979475552317e-25], [401805119037979e-23, -5636735522784875e-25, -1091026506638837e-23], [-14864896119570759e-25, 5010678615080533e-24, 29913278104531926e-25], [-8914047548245346e-22, 7491639685816348e-22, 2125422151831244e-21], [23864257445160852e-25, -3476058108020652e-24, 3869355669205987e-25], [-28003198648818284e-25, -4251604276972465e-26, 2241829218790903e-24], [-12699135781835125e-23, -14534828456883465e-23, 5687925332268154e-22], [13922722974513135e-25, -18484957869935315e-25, 2249672581902673e-24], [-11546250032849759e-22, 18434759076176109e-22, 36491871665449496e-23], [-0.00209357112083412, 16082040030140487e-21, 22741811700865595e-20], [-1044848033787682e-23, 48604355817882805e-25, 20099658812333665e-25], [14404097192777243e-24, 14222301530919523e-25, 1997789746133183e-24], [-1624145741663946e-22, -13197678533956184e-22, 4439180845070001e-22], [3730619438369054e-24, 1000368224368664e-23, -10545097711700535e-25], [-20655193297153956e-23, -9721679712354622e-22, 4288619043007688e-22], [-0.002160518140144253, 0.0014878048850711881, 7799403974199779e-19], [-48054420442866785e-25, -10987077359025932e-25, 6588769919848442e-24], [13157504569205614e-22, 4324307644811313e-22, -1552550905415187e-21], [0.001288239756402156, 40452128344026814e-20, 0.0017618698414188225], [-0.10976725109399144, -0.049411220583834764, -0.05431029781643068], [7936912238548643e-25, 15463951119620845e-24, -1715183034489698e-23], [25652384383345606e-25, -23104739232948646e-25, -4297581333986486e-24], [-9877259010693251e-24, 4281273752182457e-24, 202888056355377e-23], [32176217246160377e-26, -5829375052113228e-24, 388293127512318e-23], [1632506102522413e-24, -7021617051683471e-24, 34659249203289333e-25], [-14427211768308634e-23, -44040851098891415e-23, 5927464088728573e-22], [27196146723529324e-25, -14746666863324487e-24, 28963745263288487e-24], [1476377124763964e-23, 11640678178326258e-25, 20490454055721585e-25], [-5537098078656211e-24, 7055122860921692e-24, 15615911480582056e-25], [5292686497404553e-24, 210616986628942e-22, -3032190044882643e-23], [17997889069365502e-23, 7950853991326931e-22, -4783665676078019e-22], [-40384739389415225e-26, 29035708559721485e-25, 11299216562399295e-25], [2990318714868323e-24, -13795187978060675e-25, 2410482639880751e-24], [12688235739855003e-25, 13063146710179385e-25, 7995742401512018e-25], [-14116956256748914e-24, 12714895571319836e-22, -28938643970716216e-23], [-26879441519800373e-25, 8736734044556549e-25, 2895573822381259e-24], [-4902644373805387e-24, 18920724431659153e-25, 22539346500316526e-25], [-35827465466597985e-24, 29138664652938323e-23, -498477764412919e-22], [16572216585131194e-25, -11167374386333861e-25, -4141311626959521e-24], [-14775128062693987e-23, -24147186500084877e-23, -8535523500496911e-22], [-2243529575835778e-19, 0.001609002735242847, -0.0013226075354959362], [2054976439014311e-24, 13870298271045911e-24, -3098875166890336e-24], [33977049194999775e-25, 941613393506957e-23, -7098447385445183e-25], [7862096876309899e-25, 1935568372246621e-25, -6586309303502347e-24], [-6868411811522535e-25, -5571941491533394e-24, 1412141091561292e-24], [25951607415808375e-23, 13070318125541977e-22, -40245478419298486e-23], [-5794252022628399e-25, 40507176085613494e-25, 30238498510692935e-25], [4006779248666437e-24, -22561461171521913e-25, 7528190432148918e-24], [234003759425061e-23, 5274622585926814e-24, -20572385461825604e-26], [22934017476772262e-23, 1055078685744358e-21, -44590484496453975e-23], [-3916342458665234e-24, 1078499317630488e-24, 18554268677029029e-25], [-6621665132877652e-24, 3863550188110132e-24, -1878617011952244e-24], [13211224084846984e-23, 4393396458614307e-23, -15938459898348634e-22], [20248846210879634e-25, -14842711226759064e-25, -4320554858328052e-24], [-4277015400455664e-22, -14622944339128321e-22, -23818636943340188e-23], [-9867445093687402e-19, 0.0019110409507060683, -8177748434059867e-19], [20689182311794951e-26, -2640609425563767e-24, 18641936605501286e-25], [8337856349793782e-24, -10069717143457169e-24, -28410666458311695e-25], [5070579386923235e-24, -956246298811081e-23, -6333999991170458e-26], [-6788083571629411e-23, -22161294184518468e-23, 9420316249980631e-23], [-3043000650071459e-24, 5641202310835425e-24, 16571860689262863e-25], [3762406428076126e-24, -4589414074468445e-24, 5061625008018211e-24], [7251498853541594e-22, -1181497590759667e-21, -6824063472771202e-22], [-4843581286051446e-24, 45689304683377285e-25, 26704433109259185e-25], [-2549397379869589e-22, -10610622865874636e-22, 5040133867900698e-22], [-0.0021709746887250973, 0.001416244001873136, 8113056057798996e-19], [22463533116967582e-26, -6021441845138753e-24, 4158278783805702e-24], [-4554082583263508e-24, 62031915437632534e-25, 2087608218237502e-24], [21087185386736707e-23, -429346688506603e-21, 11568362384348219e-23], [10073207268312956e-25, 38826775128342206e-27, -6737986266158735e-24], [5345066278472643e-24, -8012628199827176e-23, 1608888462262259e-21], [583419066552946e-18, -0.0023647409484855155, 8793738656882879e-19], [-4851587465104501e-25, -67878962450862446e-25, 4953856491685116e-24], [3474851422713421e-22, 5609447921014685e-22, -43588791068249755e-23], [5758249109198924e-19, -0.002186185544136324, 0.0012273649822453817], [-0.025183888319570722, -0.08234877742843552, 0.03336588317238066], [-8701675296984845e-24, -13708021950192828e-24, 18072822877135408e-24], [-4671115716448071e-24, -27204100812305843e-25, 7066488838525231e-24], [7261832219061727e-25, -6778163391674141e-24, 4528832326516907e-24], [52885230222843305e-25, 6471610053404575e-24, -867298467766009e-23], [-22546551936564185e-23, -6460575852212935e-22, 34815114340058795e-23], [-13005102550422976e-25, -32506228889173094e-25, 20177567949808406e-25], [-5127248098313331e-24, 9339025776669563e-25, -6963273534166259e-25], [-3108109408733739e-24, -7497565346348267e-25, 6873571850585236e-25], [-152109221995822e-20, -4229087679254173e-22, 13862966756830741e-22], [1429553170284592e-24, -7029684612192e-22, -3816171600945495e-24], [25370740092123256e-25, -1607276228776655e-24, -4187653668275004e-24], [-2147507389485548e-22, -6405542769538641e-22, 3761285319939245e-22], [3830732148157878e-24, 4502962898389473e-25, 2295231948945542e-24], [4763407285557353e-22, 6832356130373474e-22, -4722053956462968e-22], [-6106519961763476e-19, -0.001067904999340573, 0.0022908349665586784], [3954978233799977e-24, 13823692815440047e-25, -62621882054858524e-25], [11190493670598656e-25, -1378699463622235e-23, -9340497836990425e-25], [12549924641169774e-25, -27363545318515037e-25, -29150686474063714e-25], [-35988292400659927e-23, 13251137373289541e-22, -15511020706390766e-23], [10706849851160882e-25, 892087770321126e-23, 26282652443310184e-26], [-26931654684148043e-25, 9611382800756019e-25, 5199469771399734e-24], [-5925635797009166e-22, -10507133953929423e-22, 15624996460225637e-23], [13219818018050944e-25, 5160879612553515e-24, 8463395262392481e-25], [2073232200083819e-21, 10230926744633252e-22, -2076615227261658e-21], [0.001314023668463894, 37822979281336606e-20, 0.0017749679393275874], [8593014286240042e-25, -6830717075301251e-24, 33624968087675455e-25], [5273104244918336e-24, 20999908506569298e-24, -31045994580702896e-24], [-888666080375855e-22, 460897593930476e-21, 7415765753866765e-22], [-4855406632309212e-25, -5582434389750368e-24, 7404508117758724e-25], [40314111722505874e-23, 15203553163922745e-22, 9062065148973675e-23], [5610756299156205e-19, -0.0020584790562876505, 0.0011284981749290943], [5112165413212466e-24, 7262929202500601e-24, -8971457410300587e-24], [-42621168891421313e-23, -7033666082102707e-22, 6279955858667918e-22], [0.0011530905294398265, 0.0023447431884415196, -0.004918567485074754], [0.10110442779958896, -0.0422361682938473, -0.1887500075385522], [3947383322988607e-25, -7813723973404407e-25, 4068157172243403e-24], [-8614839286380516e-24, 5374271805358433e-24, 18173810442667637e-24], [-8480112688447061e-25, -5338031433543833e-24, 29970395349493417e-26], [38915409940809206e-23, -24416631126851496e-23, -8032403711350639e-22], [-12024953643940961e-24, 14890893192121002e-24, 1882925731999663e-24], [-11640128916301506e-24, 2578664229369032e-23, -5270223993325551e-24], [13706539991192868e-23, 21649440610236118e-24, -7639245576621795e-22], [-6947541613191999e-25, 6650386213946646e-24, -4317796453712219e-24], [4725421555926146e-22, -7585469868867829e-22, -2359134179258371e-22], [0.0014613381731211324, -325193103208258e-18, -30662518125499174e-20], [9357940826725932e-24, -7929235740222751e-24, -5414262427283489e-24], [-21527923915742875e-24, -4167543390248829e-24, -11289648299550592e-24], [2606453698705824e-25, 14461607112726312e-22, -36333405379999906e-23], [9171057413492889e-24, -20229523365472568e-24, -12000295687708551e-24], [-12775922622609848e-23, 12819377179112447e-22, -5830978275223053e-22], [0.0022688079186991943, -0.001340428500800924, -7650920512857048e-19], [7033740367923258e-24, -2535089582700323e-24, -7661329987085352e-24], [-9719787221890153e-22, -5578365124547791e-22, 196329328074063e-20], [-0.0012611514081130434, -48179207461770463e-20, -0.001068032725378974], [0.1194195648638855, 0.05077667389018409, 0.048764209032092595], [11409041489329752e-25, 15607343376022875e-24, -17805468407842973e-24], [30328513034305615e-25, -15861533753103174e-25, -4949283941013682e-24], [2644832802498401e-22, 2971553962916604e-22, -5416080850950342e-22], [26875755232413923e-25, -14140090764946933e-24, 29325579672945246e-24], [-21109461758456183e-23, -6563556955527933e-22, 3721803216866215e-22], [-2550734523710796e-19, 0.0015794385931748882, -0.0012915448494093824], [14004926662813943e-25, 1407470806569222e-23, -25879202183998196e-25], [-21233036268109018e-23, -13052273322381597e-22, 5844176232533416e-22], [-9331448499096764e-19, 0.0019030557596215255, -8355644179837264e-19], [0.018162480520140696, 0.06849111749698195, -0.02282918825225204], [-8252312999612599e-24, -14022751959608115e-24, 1788095299257164e-23], [19068949153044912e-23, 7010577360022641e-22, -4264306292522946e-22], [-5851468398374999e-19, -0.0010731121564954605, 0.0023198689022273034], [-0.10596239707388652, 0.05515321313604108, 0.18754264890945122], [-0.0013749937082359952, -8496194092423634e-19, -0.0011818035670915995]];
var INTERCEPT = [-1.2920877240014619, 6.622519528666359, -0.13590898468396517];
function mixRgb(c1, c2, t) {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const x = [c1[0], c1[1], c1[2], c2[0], c2[1], c2[2], t];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let sum = INTERCEPT[c];
    for (let i = 0; i < POWERS.length; i++) {
      let val = COEF[i][c];
      if (val === 0) continue;
      const p = POWERS[i];
      for (let j = 0; j < 7; j++) {
        const e = p[j];
        if (e) val *= x[j] ** e;
      }
      sum += val;
    }
    out[c] = Math.min(255, Math.max(0, Math.trunc(sum)));
  }
  return out;
}

// src/lib/color-mix.ts
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r, g, b) {
  const to2 = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return ("#" + to2(r) + to2(g) + to2(b)).toUpperCase();
}
var srgbToLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
function rgbToLab({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => t > 8856e-6 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x);
  y = f(y);
  z = f(z);
  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}
function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb) : null;
}
function deltaE(hexA, hexB) {
  const l1 = hexToLab(hexA), l2 = hexToLab(hexB);
  if (!l1 || !l2) return Infinity;
  return ciede2000(l1, l2);
}
function ciede2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b22 } = lab2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b22);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b22);
  const h1p = Math.atan2(b1, a1p) < 0 ? Math.atan2(b1, a1p) * deg + 360 : Math.atan2(b1, a1p) * deg;
  const h2p = Math.atan2(b22, a2p) < 0 ? Math.atan2(b22, a2p) * deg + 360 : Math.atan2(b22, a2p) * deg;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad) + 0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const Sl = 1 + 0.015 * Math.pow(Lbarp - 50, 2) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dtheta * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

// src/lib/prusa-project.ts
var SLIC3RPE_NS = "http://schemas.slic3r.org/3mf/2017/06";
var FULL_SPECTRUM_FILE = "Metadata/Prusa_Slicer_full_spectrum.json";
var MAX_PAINT_STATE = 16;
var MAX_BLENDS = 8;
var KEEP_SPOOL_DE = 6;
var BLEND_MARGIN_DE = 2;
var rgb3 = (hex) => {
  const c = hexToRgb(hex) ?? { r: 255, g: 255, b: 255 };
  return [c.r, c.g, c.b];
};
var hex3 = ([r, g, b]) => rgbToHex(r, g, b).toUpperCase();
function candidateBlends(slots, loaded = () => true) {
  const c = slots.map(rgb3);
  const out = [];
  const ok = (...ix) => ix.every(loaded);
  for (let i = 0; i < c.length; i++)
    for (let j = i + 1; j < c.length; j++)
      if (ok(i, j)) for (const t of [0.5, 0.25, 0.75])
        out.push({ components: [{ tool: i + 1, ratio: 1 - t }, { tool: j + 1, ratio: t }], hex: hex3(mixRgb(c[i], c[j], t)) });
  for (let i = 0; i < c.length; i++)
    for (let j = i + 1; j < c.length; j++)
      for (let k = j + 1; k < c.length; k++)
        if (ok(i, j, k)) out.push({
          components: [{ tool: i + 1, ratio: 1 / 3 }, { tool: j + 1, ratio: 1 / 3 }, { tool: k + 1, ratio: 1 / 3 }],
          hex: hex3(mixRgb(mixRgb(c[i], c[j], 0.5), c[k], 1 / 3))
        });
  return out;
}
var blendKey = (b) => b.components.map((x) => `${x.tool}:${x.ratio.toFixed(4)}`).join("|");
function planColorMix(palette, slots, tools, usable) {
  const n = Math.min(Math.max(1, tools), slots.length || tools);
  const loaded = slots.slice(0, n).map(normalizeHex);
  const anyUsable = !!usable && loaded.some((_, i) => usable[i]);
  const isLoaded = (i) => !anyUsable || !!usable[i];
  const cands = candidateBlends(loaded, isLoaded);
  const picks = palette.map((hex) => {
    let spool = 0;
    let spoolDE = Infinity;
    loaded.forEach((s, i) => {
      if (!isLoaded(i)) return;
      const d = deltaE(hex, s);
      if (d < spoolDE) {
        spoolDE = d;
        spool = i;
      }
    });
    if (spoolDE < KEEP_SPOOL_DE) return { spool, spoolDE, blend: null, blendDE: Infinity };
    let blend = null;
    let blendDE = Infinity;
    for (const b of cands) {
      const d = deltaE(hex, b.hex);
      if (d < blendDE) {
        blendDE = d;
        blend = b;
      }
    }
    return blendDE < spoolDE - BLEND_MARGIN_DE ? { spool, spoolDE, blend, blendDE } : { spool, spoolDE, blend: null, blendDE };
  });
  const room = Math.max(0, Math.min(MAX_BLENDS, MAX_PAINT_STATE - n));
  const gain = /* @__PURE__ */ new Map();
  for (const p of picks) if (p.blend) gain.set(blendKey(p.blend), Math.max(gain.get(blendKey(p.blend)) ?? 0, p.spoolDE - p.blendDE));
  const kept = [...gain.entries()].sort((a, b) => b[1] - a[1]).slice(0, room).map(([k]) => k);
  const blends = [];
  const idOf = /* @__PURE__ */ new Map();
  for (const p of picks) {
    if (!p.blend) continue;
    const k = blendKey(p.blend);
    if (!kept.includes(k) || idOf.has(k)) continue;
    idOf.set(k, blends.length);
    blends.push(p.blend);
  }
  return {
    map: picks.map((p) => p.blend && idOf.has(blendKey(p.blend)) ? n + idOf.get(blendKey(p.blend)) : p.spool),
    blends,
    predicted: picks.map((p, i) => p.blend && idOf.has(blendKey(p.blend)) ? p.blend.hex : loaded[p.spool] ?? palette[i])
  };
}
function fullSpectrumJson(machine, colours, blends) {
  const n = Math.max(1, machine.toolheads);
  return JSON.stringify(
    {
      version: 1,
      physical_extruders: Array.from({ length: n }, (_, i) => ({ id: i + 1, color: normalizeHex(colours[i] ?? "#FFFFFF") })),
      virtual_extruders: blends.map((b, k) => ({
        id: n + 1 + k,
        kind: "fullspectrum",
        components: b.components.map((c) => ({ extruder: c.tool, ratio: +c.ratio.toFixed(6) }))
      }))
    },
    null,
    4
  );
}
function readExtruders(entries) {
  const object = /* @__PURE__ */ new Map();
  const part = /* @__PURE__ */ new Map();
  const entry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
  if (!entry) return { object, part };
  const xml = strFromU8(entry[1]);
  for (const om of xml.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const [, oid, body] = om;
    const own = body.replace(/<part\b[\s\S]*?<\/part>/g, "").match(/key="extruder" value="(\d+)"/);
    if (own) object.set(oid, parseInt(own[1], 10));
    for (const pm of body.matchAll(/<part id="(\d+)"[^>]*>([\s\S]*?)<\/part>/g)) {
      const e = pm[2].match(/key="extruder" value="(\d+)"/);
      if (e) part.set(`${oid}/${pm[1]}`, parseInt(e[1], 10));
    }
  }
  return { object, part };
}
function baseFilaments(entries, ex) {
  const owner = /* @__PURE__ */ new Map();
  const rootPath = Object.keys(entries).find((p) => p.toLowerCase() === "3d/3dmodel.model");
  if (rootPath) {
    const root = strFromU8(entries[rootPath]);
    for (const om of root.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      for (const cm of om[2].matchAll(/<component\b([^>]*)\/>/g)) {
        const path = /p:path="\/?([^"]+)"/.exec(cm[1])?.[1];
        const oid = /objectid="(\d+)"/.exec(cm[1])?.[1];
        if (path && oid) owner.set(`${path}#${oid}`, om[1]);
      }
    }
  }
  return (path, objectId) => {
    const rootId = owner.get(`${path}#${objectId}`);
    if (rootId) return ex.part.get(`${rootId}/${objectId}`) ?? ex.object.get(rootId) ?? 1;
    return ex.object.get(objectId) ?? 1;
  };
}
var PRUSA_VOLUME_TYPE = {
  normal_part: "ModelPart",
  modifier_part: "ParameterModifier",
  negative_part: "NegativeVolume",
  support_blocker: "SupportBlocker",
  support_enforcer: "SupportEnforcer"
};
function readParts(entries) {
  const parts = /* @__PURE__ */ new Map();
  const entry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
  if (!entry) return parts;
  const IDENTITY = /^(name|extruder|matrix|source_.*)$/;
  for (const om of strFromU8(entry[1]).matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    for (const pm of om[2].matchAll(/<part id="(\d+)"([^>]*)>([\s\S]*?)<\/part>/g)) {
      const subtype = /subtype="([^"]+)"/.exec(pm[2])?.[1] ?? "normal_part";
      const meta = [...pm[3].matchAll(/<metadata key="([^"]+)" value="([^"]*)"/g)];
      const ext = meta.find((m) => m[1] === "extruder")?.[2];
      parts.set(`${om[1]}/${pm[1]}`, {
        subtype,
        name: meta.find((m) => m[1] === "name")?.[2] ?? "",
        extruder: ext ? parseInt(ext, 10) : void 0,
        settings: meta.some((m) => !IDENTITY.test(m[1]))
      });
    }
  }
  return parts;
}
var OBJECT_RE = /<object id="(\d+)"([^>]*)>([\s\S]*?)<\/object>/g;
var xmlAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function transformPoint(t, x, y, z) {
  if (!t) return [x, y, z];
  return [x * t[0] + y * t[3] + z * t[6] + t[9], x * t[1] + y * t[4] + z * t[7] + t[10], x * t[2] + y * t[5] + z * t[8] + t[11]];
}
function areaCentre(area) {
  if (!Array.isArray(area) || !area.length) return null;
  const pts = area.map((p) => String(p).split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
function prusaProjectConfig(machine, colours, types) {
  const n = Math.max(1, machine.toolheads);
  const pad = (a, fill) => Array.from({ length: n }, (_, i) => a[i] ?? fill);
  const cols = pad(colours.map(normalizeHex), "#FFFFFF");
  const tys = pad(types, "PLA");
  const { x, y, z } = machine.bed;
  const lines = [
    `; generated by BedReady for ${machine.name}: identity and colours only; the preset supplies the rest`,
    `; printer_settings_id = ${machine.printerSettingsId ?? machine.name}`,
    ...machine.printerModel ? [`; printer_model = ${machine.printerModel}`] : [],
    ...machine.printerVariant ? [`; printer_variant = ${machine.printerVariant}`] : [],
    `; bed_shape = 0x0,${x}x0,${x}x${y},0x${y}`,
    `; max_print_height = ${z}`,
    `; nozzle_diameter = ${pad([], machine.nozzle).join(",")}`,
    `; extruder_colour = ${cols.join(";")}`,
    `; filament_colour = ${cols.join(";")}`,
    `; filament_type = ${tys.join(";")}`
  ];
  return lines.join("\n") + "\n";
}
function hasObjectSettings(entries) {
  const entry = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("model_settings.config"));
  if (!entry) return false;
  for (const om of strFromU8(entry[1]).matchAll(/<object id="\d+"[^>]*>([\s\S]*?)<\/object>/g)) {
    const own = om[1].replace(/<part\b[\s\S]*?<\/part>/g, "");
    for (const m of own.matchAll(/<metadata key="([^"]+)"/g)) if (!/^(name|extruder|matrix|source_.*)$/.test(m[1])) return true;
  }
  return false;
}
function toPrusaProject(entries, machine, input) {
  const slots = Math.max(1, machine.toolheads);
  const blends = (input.blends ?? []).slice(0, Math.max(0, MAX_PAINT_STATE - slots));
  const toSlot = (filament) => {
    const s = input.map ? (input.map[filament - 1] ?? 0) + 1 : filament;
    return Math.min(Math.max(1, s), slots + blends.length);
  };
  const baseOf = baseFilaments(entries, readExtruders(entries));
  const parts = readParts(entries);
  const untranslated = /* @__PURE__ */ new Set();
  for (const [path, data] of Object.entries(entries)) {
    const base = path.toLowerCase().split("/").pop() ?? "";
    if (base === "custom_gcode_per_layer.xml" && /<layer\b/.test(strFromU8(data))) untranslated.add("per_height_colors");
    if (base === "layer_config_ranges.xml" && /<range\b/.test(strFromU8(data))) untranslated.add("height_ranges");
  }
  if ([...parts.values()].some((p) => p.settings) || hasObjectSettings(entries)) untranslated.add("part_settings");
  const PAINT_ATTR = /\s(?:paint_color|slic3rpe:mmu_segmentation)="[0-9A-Fa-f]*"/g;
  const paintTriangle = (rawAttrs, base) => {
    const attrs = rawAttrs.trimEnd();
    const stateMap = (s) => s === 0 ? base : toSlot(s);
    const m = /\s(?:paint_color|slic3rpe:mmu_segmentation)="([0-9A-Fa-f]+)"/.exec(attrs);
    const code = m ? remapPaintCode(m[1], stateMap) : encodeSolidPaint(base);
    return `<triangle${attrs.replace(PAINT_ATTR, "")} slic3rpe:mmu_segmentation="${code}"/>`;
  };
  const texts = {};
  for (const [path, data] of Object.entries(entries)) if (path.toLowerCase().endsWith(".model")) texts[path] = strFromU8(data);
  const flat = flattenNonModelParts(texts, parts, baseOf, toSlot, paintTriangle);
  let shift = [0, 0];
  const ps = Object.entries(entries).find(([p]) => p.toLowerCase().endsWith("project_settings.config"));
  if (ps) {
    try {
      const c = areaCentre(JSON.parse(strFromU8(ps[1])).printable_area);
      if (c) shift = [machine.bed.x / 2 - c[0], machine.bed.y / 2 - c[1]];
    } catch {
    }
  }
  const out = {};
  const removed = [];
  let painted = flat.painted;
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    if (lower.startsWith("metadata/") && (lower.endsWith(".config") || lower.endsWith(".json") || lower.endsWith(".xml") || lower.endsWith(".gcode") || lower.endsWith(".md5"))) {
      removed.push(path);
      continue;
    }
    if (!lower.endsWith(".model")) {
      out[path] = data;
      continue;
    }
    let xml = texts[path];
    const filePath = path.replace(/^\//, "");
    const isRoot = lower === "3d/3dmodel.model";
    xml = xml.replace(OBJECT_RE, (block, oid) => {
      if (!block.includes("<triangle")) return block;
      if (isRoot && flat.ids.has(oid)) return block;
      const base = toSlot(baseOf(filePath, oid));
      return block.replace(/<triangle\b([^>]*)\/>/g, (_t, rawAttrs) => {
        painted = true;
        return paintTriangle(rawAttrs, base);
      });
    });
    if (painted && !/xmlns:slic3rpe=/.test(xml)) {
      xml = xml.replace(/<model\b/, `<model xmlns:slic3rpe="${SLIC3RPE_NS}"`);
    }
    if (isRoot && (shift[0] || shift[1])) {
      xml = xml.replace(/<item\b([^>]*?)\btransform="([^"]+)"/g, (_m, pre, tr) => {
        const v = tr.trim().split(/\s+/).map(Number);
        if (v.length !== 12 || !v.every(Number.isFinite)) return `<item${pre}transform="${tr}"`;
        v[9] += shift[0];
        v[10] += shift[1];
        return `<item${pre}transform="${v.map((n) => +n.toFixed(6)).join(" ")}"`;
      });
    }
    out[path] = strToU8(xml);
  }
  out["Metadata/Slic3r_PE.config"] = strToU8(prusaProjectConfig(machine, input.colours, input.types));
  if (flat.config) out[PRUSA_MODEL_CONFIG] = strToU8(flat.config);
  if (blends.length) out[FULL_SPECTRUM_FILE] = strToU8(fullSpectrumJson(machine, input.colours, blends));
  return { out, removed, painted, untranslated: [...untranslated] };
}
var PRUSA_MODEL_CONFIG = "Metadata/Slic3r_PE_model.config";
function flattenNonModelParts(texts, parts, baseOf, toSlot, paintTriangle) {
  const ids = /* @__PURE__ */ new Set();
  const rootPath = Object.keys(texts).find((p) => p.toLowerCase() === "3d/3dmodel.model");
  if (!rootPath || ![...parts.values()].some((p) => p.subtype !== "normal_part")) return { ids, config: "", painted: false };
  let nextId = 1;
  const refs = /* @__PURE__ */ new Map();
  const norm = (p) => p.replace(/^\//, "");
  for (const [path, xml] of Object.entries(texts)) {
    for (const om of xml.matchAll(OBJECT_RE)) {
      nextId = Math.max(nextId, parseInt(om[1], 10) + 1);
      for (const cm of om[3].matchAll(/<component\b([^>]*)\/>/g)) {
        const key = `${norm(/p:path="([^"]+)"/.exec(cm[1])?.[1] ?? path)}#${/objectid="(\d+)"/.exec(cm[1])?.[1]}`;
        refs.set(key, (refs.get(key) ?? 0) + 1);
      }
    }
  }
  const meshOf = (path, oid) => {
    const file = Object.keys(texts).find((p) => norm(p) === path);
    if (!file) return null;
    for (const om of texts[file].matchAll(OBJECT_RE)) if (om[1] === oid && om[3].includes("<mesh")) return om[3];
    return null;
  };
  const consumed = /* @__PURE__ */ new Map();
  const objectsXml = [];
  const renamed = /* @__PURE__ */ new Map();
  let painted = false;
  texts[rootPath] = texts[rootPath].replace(OBJECT_RE, (block, rid, attrs, body) => {
    if (!body.includes("<components")) return block;
    const comps = [...body.matchAll(/<component\b([^>]*)\/>/g)].map((cm) => ({
      path: norm(/p:path="([^"]+)"/.exec(cm[1])?.[1] ?? rootPath),
      oid: /objectid="(\d+)"/.exec(cm[1])?.[1] ?? "",
      t: (() => {
        const v = /transform="([^"]+)"/.exec(cm[1])?.[1]?.trim().split(/\s+/).map(Number);
        return v && v.length === 12 && v.every(Number.isFinite) ? v : null;
      })()
    }));
    const kinds = comps.map((c) => parts.get(`${rid}/${c.oid}`)?.subtype ?? "normal_part");
    if (kinds.every((k) => k === "normal_part")) return block;
    const meshes = comps.map((c) => meshOf(c.path, c.oid));
    if (meshes.some((m) => m === null)) return block;
    const vertices = [];
    const triangles = [];
    const volumes = [];
    comps.forEach((c, i) => {
      const part = parts.get(`${rid}/${c.oid}`);
      const kind = kinds[i];
      const isModel = kind === "normal_part";
      const vOffset = vertices.length;
      const first = triangles.length;
      for (const vm of meshes[i].matchAll(/<vertex\b([^>]*)\/>/g)) {
        const num = (k) => parseFloat(new RegExp(`\\b${k}="([^"]+)"`).exec(vm[1])?.[1] ?? "0");
        const [x, y, z] = transformPoint(c.t, num("x"), num("y"), num("z"));
        vertices.push(`<vertex x="${+x.toFixed(6)}" y="${+y.toFixed(6)}" z="${+z.toFixed(6)}"/>`);
      }
      const base = toSlot(baseOf(c.path, c.oid));
      for (const tm of meshes[i].matchAll(/<triangle\b([^>]*)\/>/g)) {
        const attrs2 = tm[1].replace(/\b(v[123])="(\d+)"/g, (_m, k, n) => `${k}="${parseInt(n, 10) + vOffset}"`);
        if (isModel) {
          painted = true;
          triangles.push(paintTriangle(attrs2, base));
        } else {
          triangles.push(`<triangle${attrs2.trimEnd().replace(/\s(?:paint_color|slic3rpe:mmu_segmentation)="[0-9A-Fa-f]*"/g, "")}/>`);
        }
      }
      if (triangles.length === first) return;
      const meta = [
        `<metadata type="volume" key="name" value="${xmlAttr(part?.name || `part ${c.oid}`)}"/>`,
        `<metadata type="volume" key="volume_type" value="${PRUSA_VOLUME_TYPE[kind] ?? "ModelPart"}"/>`,
        ...kind === "modifier_part" && part?.extruder ? [`<metadata type="volume" key="extruder" value="${toSlot(part.extruder)}"/>`] : []
      ];
      volumes.push(`  <volume firstid="${first}" lastid="${triangles.length - 1}">
   ${meta.join("\n   ")}
  </volume>`);
      const key = `${c.path}#${c.oid}`;
      consumed.set(key, (consumed.get(key) ?? 0) + 1);
    });
    if (!volumes.length) return block;
    const id = nextId++;
    renamed.set(rid, id);
    ids.add(String(id));
    objectsXml.push(` <object id="${id}" instances_count="1">
${volumes.join("\n")}
 </object>`);
    return `<object id="${id}"${attrs}><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object>`;
  });
  if (!renamed.size) return { ids, config: "", painted: false };
  texts[rootPath] = texts[rootPath].replace(
    /(<item\b[^>]*?\bobjectid=")(\d+)(")/g,
    (m, a, n, b) => renamed.has(n) ? `${a}${renamed.get(n)}${b}` : m
  );
  for (const [key, n] of consumed) {
    if (refs.get(key) !== n) continue;
    const [path, oid] = [key.slice(0, key.lastIndexOf("#")), key.slice(key.lastIndexOf("#") + 1)];
    const file = Object.keys(texts).find((p) => norm(p) === path);
    if (file) texts[file] = texts[file].replace(OBJECT_RE, (block, id) => id === oid ? "" : block);
  }
  const config = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectsXml.join("\n")}
</config>
`;
  return { ids, config, painted };
}

// src/lib/print-groups.ts
function printGroups(mesh) {
  if (mesh.plates.length > 1) {
    return mesh.plates.map((pl) => ({
      name: pl.name ?? "",
      parts: pl.partIndices.map((i) => mesh.parts[i]).filter(Boolean)
    })).filter((g) => g.parts.length > 0);
  }
  if (mesh.parts.length) return [{ name: mesh.plates[0]?.name ?? "", parts: mesh.parts }];
  return [{ name: "", parts: [{ positions: mesh.positions, faceState: mesh.faceState }] }];
}
function flattenGroup(group) {
  const parts = group.parts;
  if (parts.length === 1) return { positions: parts[0].positions, faceState: parts[0].faceState ?? new Uint8Array(0) };
  const posLen = parts.reduce((n, p) => n + p.positions.length, 0);
  const stLen = parts.reduce((n, p) => n + (p.faceState?.length ?? 0), 0);
  const positions = new Float32Array(posLen);
  const faceState = new Uint8Array(stLen);
  let pi = 0, si = 0;
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i++) positions[pi++] = p.positions[i];
    if (p.faceState) for (let i = 0; i < p.faceState.length; i++) faceState[si++] = p.faceState[i];
  }
  return { positions, faceState };
}

// src/lib/color-bands.ts
var HEADS = 4;
function detectColorBands(positions, faceState, baseState, opts = {}) {
  const binHeight = opts.binHeight && opts.binHeight > 0 ? opts.binHeight : 0.2;
  const purityMin = opts.purity ?? 0.9;
  const faceCount = faceState.length;
  const none = (reason) => ({ banded: false, bands: [], changeHeights: [], colorCount: 0, manualSwaps: 0, purity: 0, reason });
  if (faceCount === 0 || positions.length < faceCount * 9) return none("no geometry to analyse");
  let zMin = Infinity, zMax = -Infinity;
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    for (const zi of [o + 2, o + 5, o + 8]) {
      const z = positions[zi];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  const span = zMax - zMin;
  if (!(span > 0)) return none("model has no height");
  const nbins = Math.min(4e3, Math.max(1, Math.ceil(span / binHeight)));
  const binH = span / nbins;
  const binOf = (z) => Math.min(nbins - 1, Math.max(0, Math.floor((z - zMin) / binH)));
  const bins = Array.from({ length: nbins }, () => /* @__PURE__ */ new Map());
  const binTotal = new Float64Array(nbins);
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const cxx = uy * vz - uz * vy, cyy = uz * vx - ux * vz, czz = ux * vy - uy * vx;
    const area = 0.5 * Math.hypot(cxx, cyy, czz);
    if (!(area > 0)) continue;
    const state = faceState[f] === 0 ? baseState : faceState[f];
    const flo = Math.min(az, bz, cz), fhi = Math.max(az, bz, cz);
    if (fhi - flo < 1e-9) {
      const b = binOf(flo);
      bins[b].set(state, (bins[b].get(state) ?? 0) + area);
      binTotal[b] += area;
      continue;
    }
    const first = binOf(flo), last = binOf(fhi);
    const inv = 1 / (fhi - flo);
    for (let b = first; b <= last; b++) {
      const bBot = zMin + b * binH, bTop = bBot + binH;
      const ov = Math.min(fhi, bTop) - Math.max(flo, bBot);
      if (ov <= 0) continue;
      const a = area * ov * inv;
      bins[b].set(state, (bins[b].get(state) ?? 0) + a);
      binTotal[b] += a;
    }
  }
  const dom = new Array(nbins).fill(0);
  let domArea = 0, totArea = 0;
  for (let b = 0; b < nbins; b++) {
    totArea += binTotal[b];
    if (binTotal[b] <= 0) continue;
    let best = 0, bestA = -1;
    for (const [s, a] of bins[b]) if (a > bestA) {
      bestA = a;
      best = s;
    }
    dom[b] = best;
    domArea += bestA;
  }
  const purity = totArea > 0 ? domArea / totArea : 0;
  if (purity < purityMin)
    return { banded: false, bands: [], changeHeights: [], colorCount: 0, manualSwaps: 0, purity, reason: "colours share layers (in-layer detail) \u2014 needs multiple heads, not a swap" };
  const seq = [];
  for (let b = 0; b < nbins; b++) if (dom[b] !== 0) seq.push({ state: dom[b], bin: b });
  if (seq.length === 0) return none("no colour data");
  for (let i = 1; i < seq.length - 1; i++)
    if (seq[i].state !== seq[i - 1].state && seq[i - 1].state === seq[i + 1].state) seq[i].state = seq[i - 1].state;
  const bands = [];
  for (const { state, bin } of seq) {
    const bBot = zMin + bin * binH, bTop = bBot + binH;
    const cur = bands[bands.length - 1];
    if (cur && cur.state === state) cur.z1 = bTop;
    else bands.push({ state, z0: bBot, z1: bTop });
  }
  const changeHeights = bands.slice(1).map((b) => b.z0);
  const colorCount = new Set(bands.map((b) => b.state)).size;
  const manualSwaps = Math.max(0, bands.length - HEADS);
  return {
    banded: true,
    bands,
    changeHeights,
    colorCount,
    manualSwaps,
    purity,
    reason: bands.length <= 1 ? "single colour \u2014 no swaps needed" : `${bands.length} colour bands; ${manualSwaps} manual filament swap${manualSwaps === 1 ? "" : "s"} on the U1`
  };
}
function sameSwaps(a, b, tol) {
  return a.length === b.length && a.every((h, i) => Math.abs(h - b[i]) <= tol);
}
function detectColorBandsForMesh(mesh, baseState, opts = {}) {
  const groups = printGroups(mesh);
  const plans = groups.map((g) => {
    const { positions, faceState } = flattenGroup(g);
    return {
      name: g.name,
      plan: detectColorBands(
        positions instanceof Float32Array ? positions : Float32Array.from(Array.from(positions)),
        faceState instanceof Uint8Array ? faceState : Uint8Array.from(Array.from(faceState)),
        baseState,
        opts
      )
    };
  });
  if (plans.length === 0) return detectColorBands(new Float32Array(0), new Uint8Array(0), baseState, opts);
  if (plans.length === 1) return plans[0].plan;
  const named = (n, i) => n || `plate ${i + 1}`;
  const unbanded = plans.findIndex((p) => !p.plan.banded);
  if (unbanded >= 0) {
    return {
      ...plans[unbanded].plan,
      reason: `${named(plans[unbanded].name, unbanded)}: ${plans[unbanded].plan.reason}`
    };
  }
  const tol = (opts.binHeight && opts.binHeight > 0 ? opts.binHeight : 0.2) / 2;
  const first = plans[0].plan;
  const differing = plans.findIndex((p) => !sameSwaps(p.plan.changeHeights, first.changeHeights, tol));
  if (differing > 0) {
    return {
      banded: false,
      bands: [],
      changeHeights: [],
      colorCount: 0,
      manualSwaps: 0,
      purity: Math.min(...plans.map((p) => p.plan.purity)),
      reason: `each plate is banded, but they need different swap heights (${named(plans[0].name, 0)} at ${first.changeHeights.map((h) => h.toFixed(1)).join("/")} mm, ${named(plans[differing].name, differing)} at ${plans[differing].plan.changeHeights.map((h) => h.toFixed(1)).join("/")} mm) \u2014 convert one plate at a time to use swaps`
    };
  }
  return first;
}

// src/lib/swap-pauses.ts
var N_PHYSICAL = 4;
function parseLayers(xml) {
  const out = [];
  for (const m of xml.matchAll(/<layer\b([^>]*?)\/?>/g)) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    out.push({ attrs, raw: m[0] });
  }
  return out;
}
function layerXml(attrs) {
  const order = ["top_z", "type", "extruder", "color", "extra", "gcode"];
  const keys = [...order.filter((k) => k in attrs), ...Object.keys(attrs).filter((k) => !order.includes(k))];
  return `<layer ${keys.map((k) => `${k}="${attrs[k]}"`).join(" ")}/>`;
}
function detectConflicts(remap) {
  const groups = /* @__PURE__ */ new Map();
  for (const [src, phys] of remap) {
    if (phys < 0) continue;
    const arr = groups.get(phys) ?? [];
    arr.push(src);
    groups.set(phys, arr);
  }
  const conflicts = /* @__PURE__ */ new Map();
  for (const [p, srcs] of groups) if (srcs.length > 1) conflicts.set(p, srcs.sort((a, b) => a - b));
  return conflicts;
}
function insertSwapPauses(xml, remap, colours, pauseGcode, layerHeight) {
  if (detectConflicts(remap).size === 0) return { xml, instructions: [] };
  const extToPhys = /* @__PURE__ */ new Map();
  for (const [src, phys] of remap) if (phys >= 0) extToPhys.set(src, phys % N_PHYSICAL);
  const loadedInit = /* @__PURE__ */ new Map();
  for (const src of [...remap.keys()].sort((a, b) => a - b)) {
    const phys = remap.get(src);
    if (phys < 0) continue;
    const h = phys % N_PHYSICAL;
    if (!loadedInit.has(h)) loadedInit.set(h, src);
  }
  const layers = parseLayers(xml);
  if (layers.length === 0) return { xml, instructions: [] };
  const zs = [...new Set(layers.map((l) => parseFloat(l.attrs.top_z)).filter((z) => !isNaN(z)))].sort(
    (a, b) => a - b
  );
  let layerH = layerHeight && layerHeight > 0 ? layerHeight : 0.2;
  if (!(layerHeight && layerHeight > 0)) {
    for (let i = 1; i < zs.length; i++) if (zs[i] - zs[i - 1] > 0) {
      layerH = zs[i] - zs[i - 1];
      break;
    }
  }
  const details = [];
  const loaded = new Map(loadedInit);
  const headLast = /* @__PURE__ */ new Map();
  layers.forEach((layer, i) => {
    if (layer.attrs.type !== "2") return;
    const ext = parseInt(layer.attrs.extruder ?? "0", 10);
    const phys = extToPhys.get(ext);
    if (phys === void 0) return;
    const cur2 = loaded.get(phys);
    if (cur2 !== ext) {
      details.push({
        firstNeeded: i,
        lastUse: headLast.get(phys) ?? -1,
        phys,
        fromSlot: cur2 ?? ext,
        toSlot: ext,
        fromColour: cur2 && cur2 <= colours.length ? colours[cur2 - 1] : "",
        toColour: layer.attrs.color ?? ""
      });
      loaded.set(phys, ext);
    }
    headLast.set(phys, i);
  });
  if (details.length === 0) return { xml, instructions: [] };
  const batches = [];
  let cur = [];
  for (const d of details) {
    if (cur.length === 0) {
      cur = [d];
      continue;
    }
    const mx = Math.max(...[...cur, d].map((s) => s.lastUse));
    const mn = Math.min(...[...cur, d].map((s) => s.firstNeeded));
    if (mx < mn) cur.push(d);
    else {
      batches.push(cur);
      cur = [d];
    }
  }
  batches.push(cur);
  const instructions = [];
  const inserts = [];
  for (const batch of batches) {
    const minFirst = Math.min(...batch.map((s) => s.firstNeeded));
    const firstZ = parseFloat(layers[minFirst].attrs.top_z ?? "0") || 0;
    const pauseZ = `${Math.max(layerH, firstZ - layerH)}`;
    inserts.push({
      afterRaw: layers[minFirst].raw,
      pause: layerXml({ top_z: pauseZ, type: "1", extruder: "1", color: "", extra: "", gcode: pauseGcode })
    });
    for (const s of batch)
      instructions.push({
        z: parseFloat(pauseZ),
        toolhead: s.phys + 1,
        fromSlot: s.fromSlot,
        toSlot: s.toSlot,
        fromColour: s.fromColour,
        toColour: s.toColour,
        label: `T${s.phys + 1}: ${s.fromColour || "?"} \u2192 ${s.toColour || "?"} @ ${pauseZ}mm`
      });
  }
  let outXml = xml;
  for (const ins of inserts) outXml = outXml.replace(ins.afterRaw, ins.pause + ins.afterRaw);
  return { xml: outXml, instructions };
}
function buildBandSwapPlan(bands, colours, pauseGcode, layerHeight, baseState) {
  const order = [];
  if (baseState != null) order.push(baseState);
  for (const b of bands) if (!order.includes(b.state)) order.push(b.state);
  const remap = /* @__PURE__ */ new Map();
  order.forEach((s, i) => remap.set(s, i % N_PHYSICAL));
  const tags = bands.map((b) => `<layer top_z="${b.z0}" type="2" extruder="${b.state}" color="${colours[b.state - 1] ?? ""}"/>`).join("");
  const xml = `<custom_gcodes_per_layer><plate>${tags}</plate></custom_gcodes_per_layer>`;
  const { instructions } = insertSwapPauses(xml, remap, colours, pauseGcode, layerHeight);
  const pauseZs = [...new Set(instructions.map((s) => s.z))].sort((a, b) => a - b);
  const pauseTags = pauseZs.map((z) => layerXml({ top_z: `${z}`, type: "1", extruder: "1", color: "", extra: "", gcode: pauseGcode })).join("\n    ");
  const customGcodeXml = `<?xml version="1.0" encoding="utf-8"?>
<custom_gcodes_per_layer>
  <plate>
    <plate_info id="1"/>
    ${pauseTags}
  </plate>
</custom_gcodes_per_layer>
`;
  return { instructions, headOf: remap, customGcodeXml };
}

// src/lib/mixed-filament.ts
function fmtOffset(v) {
  let s = (v || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}
function serializeMixedDef(d) {
  const tokens = [
    d.componentA,
    d.componentB,
    d.enabled === false ? 0 : 1,
    d.custom === false ? 0 : 1,
    Math.max(0, Math.min(100, Math.round(d.mixBPercent))),
    d.pointillismAll ? 1 : 0,
    "g" + (d.gradientIds ?? ""),
    "w" + (d.gradientWeights ?? ""),
    "m" + (d.distributionMode ?? 2),
    "z" + Math.max(0, d.localZ ?? 0),
    "xa" + fmtOffset(d.surfaceOffsetA ?? 0),
    "xb" + fmtOffset(d.surfaceOffsetB ?? 0),
    "d" + (d.deleted ? 1 : 0),
    "o" + (d.originAuto ? 1 : 0),
    "u" + d.stableId
  ].join(",");
  const ui = d.uiMode ?? 0;
  return ui >= 0 ? `${tokens},cm${ui}` : tokens;
}
function serializeMixedDefs(defs) {
  return defs.map(serializeMixedDef).join(";");
}
var MIXED_DITHERING_DEFAULTS = {
  // NB: mixed_color_layer_height_a/_b are an integer A/B *layer-cadence* (value ÷ global layer height,
  // rounded), NOT a print height; the *_bound keys only apply in Local-Z / gradient modes. To actually
  // thin the mixed regions use dithering_z_step_size (see below) — verified against Snapmaker Orca's
  // PrintObject::update_layer_height_profile / ToolOrdering::resolve_mixed_with_layer_heights.
  mixed_color_layer_height_a: "0",
  mixed_color_layer_height_b: "0",
  // Ordered dithering: spread the layer cadence evenly instead of contiguous blocks, so an extreme
  // ratio (e.g. 80/20 → 1:4) blends finely rather than printing one thick band of each colour.
  mixed_filament_advanced_dithering: "1",
  mixed_filament_component_bias_enabled: "0",
  mixed_filament_gradient_mode: "0",
  mixed_filament_height_lower_bound: "0.04",
  mixed_filament_height_upper_bound: "0.16",
  mixed_filament_pointillism_line_gap: "0",
  mixed_filament_pointillism_pixel_size: "0",
  mixed_filament_region_collapse: "1",
  mixed_filament_surface_indentation: "0",
  // "Subdivide Mix Layer" (dithering_local_z_mode). Orca's adaptive Local-Z pipeline: inside the
  // painted mixing areas it subdivides each model layer into per-colour sublayers (heights chosen
  // within the lower/upper bounds above, 0.04–0.16) so colours alternate more often → noticeably
  // cleaner mixes, most visibly on top surfaces. Real Minion print confirmed the win. Defaulted ON
  // now because the purge it adds is routed entirely to the prime tower (see withMixes), so the
  // earlier ooze concern that kept subdivision off no longer applies. dithering_local_z_infill mirrors
  // Orca auto-enabling infill subdivision with the mode. Label/key/default verified against Snapmaker
  // Orca PrintConfig.cpp. NB: this is a DIFFERENT pipeline from dithering_z_step_size (a fixed height
  // everywhere) — the two are mutually exclusive, so the z-step override path turns Local-Z back off.
  dithering_local_z_mode: "1",
  dithering_local_z_infill: "1",
  // Fixed mixed-zone layer height (the OTHER, non-adaptive pipeline): 0 = unused; default mixing uses
  // Local-Z above. A positive value (set per-conversion via CleanOpts.mixedLayerHeight) re-slices the
  // painted mixed zones at that exact height and requires Local-Z off (guard: !local_z && !gradient &&
  // step > 0) — withMixes handles that switch.
  dithering_z_step_size: "0",
  dithering_step_painted_zones_only: "1"
};

// src/lib/convert.patched.ts
var MAX_ZIP_COMPRESSED = Number(globalThis.__BEDREADY_CAP_COMPRESSED__) || 200 * 1024 * 1024;
var MAX_ZIP_INFLATED = Number(globalThis.__BEDREADY_CAP_INFLATED__) || 800 * 1024 * 1024;
var ThreeMFError = class extends Error {
  constructor(code, sizeMB, capMB) {
    super(code === "not_3mf" ? "not_3mf: no 3D model in this file" : `${code}: ${sizeMB}MB exceeds ${capMB}MB`);
    this.code = code;
    this.sizeMB = sizeMB;
    this.capMB = capMB;
    this.name = "ThreeMFError";
  }
};
var MB = 1024 * 1024;
var TEXT_ENTRY = /\.(model|config|xml|rels)$/i;
var MAX_TEXT_ENTRY = 536870888;
function textEntryTooLarge(path, byteLength) {
  return TEXT_ENTRY.test(path) && byteLength > MAX_TEXT_ENTRY;
}
function safeUnzip(buf) {
  if (buf.length > MAX_ZIP_COMPRESSED) {
    throw new ThreeMFError("too_large", Math.round(buf.length / MB), Math.round(MAX_ZIP_COMPRESSED / MB));
  }
  return boundedUnzipOrThrow(buf);
}
var ROOT_MODEL = "3d/3dmodel.model";
function hasModelPart(entries) {
  const names = new Set(Object.keys(entries).map((p) => p.toLowerCase()));
  if (names.has(ROOT_MODEL)) return true;
  const rels = Object.keys(entries).find((p) => p.toLowerCase() === "_rels/.rels");
  if (!rels) return false;
  for (const m of strFromU8(entries[rels]).matchAll(/Target="\/?([^"]+\.model)"/gi)) {
    if (names.has(m[1].toLowerCase())) return true;
  }
  return false;
}
function readThreeMF(buf) {
  const entries = safeUnzip(buf);
  if (!hasModelPart(entries)) throw new ThreeMFError("not_3mf", Math.round(buf.length / MB), 0);
  return entries;
}
function boundedUnzipOrThrow(buf, keep) {
  const { out, inflated, overflow, entryOverflow } = boundedUnzip(buf, MAX_ZIP_INFLATED, (name) => TEXT_ENTRY.test(name) ? MAX_TEXT_ENTRY : Infinity, keep);
  if (overflow) {
    throw new ThreeMFError("expands_too_large", Math.round(inflated / MB), Math.round(MAX_ZIP_INFLATED / MB));
  }
  if (entryOverflow) {
    throw new ThreeMFError("expands_too_large", Math.round(entryOverflow.size / MB), Math.round(MAX_TEXT_ENTRY / MB));
  }
  for (const [path, data] of Object.entries(out)) {
    if (textEntryTooLarge(path, data.byteLength)) {
      throw new ThreeMFError("expands_too_large", Math.round(data.byteLength / MB), Math.round(MAX_TEXT_ENTRY / MB));
    }
  }
  return out;
}
var MAX_COLORS = 64;
var tooManyColours = (n) => new Error(`This .3mf declares ${n} filament colours \u2014 too many to process (looks malformed).`);
var EXHAUSTIVE_DROP_MAX = 8;
var U1_BUILD_MM = U1.buildMM;
var U1_BUILD_Z_MM = U1.buildZMM;
function tallyPaintUsage(entries, n) {
  const usage = new Array(n).fill(0);
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".model")) continue;
    for (const m of strFromU8(data).matchAll(/paint_color="([0-9A-Fa-f]+)"/g)) {
      const s = dominantState(m[1]);
      if (s >= 1 && s <= n) usage[s - 1] += 1;
    }
  }
  return usage;
}
var GENERIC_CORE = /(^3D\/|^_rels\/|\.rels$|\[Content_Types\]\.xml$|\.model$)/i;
var GENERIC_IMAGE = /\.(png|jpe?g)$/i;
function isGenericKeep(path) {
  return GENERIC_CORE.test(path) || GENERIC_IMAGE.test(path);
}
function isStrippable(path) {
  const p = path.toLowerCase();
  const base = p.split("/").pop() ?? "";
  if (base === "slice_info.config") return true;
  if (base === "slic3r_pe.config") return true;
  if (base === "slic3r_pe_model.config") return true;
  if (base === "creality.config") return true;
  if (base.endsWith(".ini") && p.includes("metadata/")) return true;
  if (/^metadata\/(plate|top|pick)_/.test(p)) return true;
  if (base.endsWith(".gcode") || base.endsWith(".gcode.md5")) return true;
  return false;
}
function normalizeHex2(h) {
  const s = (h || "").replace("#", "");
  if (s.length >= 6) return "#" + s.slice(0, 6).toUpperCase();
  return "#FFFFFF";
}
function hexToRgb2(h) {
  const s = normalizeHex2(h).slice(1);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function srgbToLinear2(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function rgbToLab2([r, g, b]) {
  const R = srgbToLinear2(r), G = srgbToLinear2(g), B = srgbToLinear2(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => t > 8856e-6 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE2(a, b) {
  const [L1, a1, b1] = a;
  const [L2, a2, b22] = b;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b22);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b22);
  const hp = (y, x) => {
    let h = Math.atan2(y, x) / rad;
    if (h < 0) h += 360;
    return h;
  };
  const h1p = C1p === 0 ? 0 : hp(b1, a1p);
  const h2p = C2p === 0 ? 0 : hp(b22, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad) + 0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + 0.015 * (Lbarp - 50) ** 2 / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * Rc;
  const lTerm = dLp / SL;
  const cTerm = dCp / SC;
  const hTerm = dHp / SH;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + RT * cTerm * hTerm);
}
function rgbHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).toUpperCase().padStart(2, "0")).join("");
}
function bestMix(targetHex, baseHexes) {
  const tLab = rgbToLab2(hexToRgb2(targetHex));
  const bases = baseHexes.map((h) => hexToRgb2(h));
  let best = null;
  const consider = (a, b, pct, rgb) => {
    const dE = deltaE2(tLab, rgbToLab2(rgb));
    if (!best || dE < best.deltaE) best = { a: a + 1, b: b + 1, mixBPercent: pct, hex: rgbHex(rgb), deltaE: dE };
  };
  for (let i = 0; i < bases.length; i++) {
    consider(i, i, 0, bases[i]);
    for (let j = i + 1; j < bases.length; j++)
      for (let pct = MIN_MIX_RATIO; pct <= 100 - MIN_MIX_RATIO; pct += 5) consider(i, j, pct, mixRgb(bases[i], bases[j], pct / 100));
  }
  return best;
}
var MIN_MIX_RATIO = 15;
function mix3(rgb, w) {
  const wab = w[0] + w[1];
  const t1 = mixRgb(rgb[0], rgb[1], wab > 0 ? w[1] / wab : 0.5);
  return mixRgb(t1, rgb[2], (w[2] ?? 0) / 100);
}
function bestMixMulti(targetHex, baseHexes) {
  const tLab = rgbToLab2(hexToRgb2(targetHex));
  const bases = baseHexes.map((h) => hexToRgb2(h));
  const n = bases.length;
  let best = null;
  const consider = (ids, weights, rgb, bias = 0) => {
    const dE = deltaE2(tLab, rgbToLab2(rgb));
    if (!best || dE + bias < best.deltaE) best = { ids: ids.map((x) => x + 1), weights, hex: rgbHex(rgb), deltaE: dE };
  };
  const MIN = MIN_MIX_RATIO;
  for (let i = 0; i < n; i++) {
    consider([i], [100], bases[i]);
    for (let j = i + 1; j < n; j++)
      for (let p = MIN; p <= 100 - MIN; p += 5) consider([i, j], [100 - p, p], mixRgb(bases[i], bases[j], p / 100));
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let wa = MIN; wa <= 100 - 2 * MIN; wa += 5)
          for (let wb = MIN; wa + wb <= 100 - MIN; wb += 5) {
            const wc = 100 - wa - wb;
            if (wc < MIN) continue;
            consider([i, j, k], [wa, wb, wc], mix3([bases[i], bases[j], bases[k]], [wa, wb, wc]), 1.5);
          }
  return best;
}
function bestPhysicalSet(hexes, usage = [], pinned = []) {
  const all = [...hexes.keys()];
  if (all.length <= 4) return all.sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));
  const pin = new Set(pinned.filter((i) => i >= 0 && i < hexes.length));
  const keep = new Set(all);
  const labs = hexes.map((h) => rgbToLab2(hexToRgb2(normalizeHex2(h))));
  while (keep.size > EXHAUSTIVE_DROP_MAX) {
    const idxs = [...keep].filter((c) => !pin.has(c));
    if (!idxs.length) break;
    const near = /* @__PURE__ */ new Map();
    for (const c of idxs) {
      let d = Infinity;
      for (const x of keep) if (x !== c) d = Math.min(d, deltaE2(labs[c], labs[x]));
      near.set(c, d);
    }
    const minD = Math.min(...idxs.map((c) => near.get(c)));
    const dropI = idxs.filter((c) => near.get(c) <= minD + 1.5).sort((a, b) => (usage[a] ?? 0) - (usage[b] ?? 0))[0];
    keep.delete(dropI);
  }
  while (keep.size > 4) {
    const idxs = [...keep].filter((c) => !pin.has(c));
    if (!idxs.length) break;
    const dE = /* @__PURE__ */ new Map();
    for (const c of idxs) {
      const others = [...keep].filter((x) => x !== c).map((x) => normalizeHex2(hexes[x]));
      dE.set(c, bestMix(normalizeHex2(hexes[c]), others).deltaE);
    }
    const minDE = Math.min(...idxs.map((c) => dE.get(c)));
    const dropI = idxs.filter((c) => dE.get(c) <= minDE + 1.5).sort((a, b) => (usage[a] ?? 0) - (usage[b] ?? 0))[0];
    keep.delete(dropI);
  }
  return [...keep].sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));
}
function reduceColors(hexes, usage, pinned, target = 4) {
  const pinSet = new Set(pinned ?? []);
  const groups = hexes.map((h, i) => ({
    lab: rgbToLab2(hexToRgb2(h)),
    members: [i],
    rep: normalizeHex2(h),
    use: usage?.[i] ?? 1,
    pin: pinSet.has(i)
  }));
  const want = Math.max(1, target);
  while (groups.length > want) {
    if (usage) {
      let li = -1;
      for (let i = 0; i < groups.length; i++) if (!groups[i].pin && (li < 0 || groups[i].use < groups[li].use)) li = i;
      if (li < 0) {
        for (let i = 0; i < groups.length; i++) if (li < 0 || groups[i].use < groups[li].use) li = i;
      }
      let ni = -1, nd = Infinity;
      for (let j = 0; j < groups.length; j++) {
        if (j === li) continue;
        const d = deltaE2(groups[li].lab, groups[j].lab);
        if (d < nd) {
          nd = d;
          ni = j;
        }
      }
      groups[ni].members = groups[ni].members.concat(groups[li].members);
      groups[ni].use += groups[li].use;
      groups[ni].pin = groups[ni].pin || groups[li].pin;
      groups.splice(li, 1);
    } else {
      let bi = 0, bj = 1, bd = Infinity;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const d = deltaE2(groups[i].lab, groups[j].lab);
          if (d < bd) {
            bd = d;
            bi = i;
            bj = j;
          }
        }
      }
      const gi = groups[bi], gj = groups[bj];
      const removeGj = gi.pin && !gj.pin || gi.pin === gj.pin && gj.members.length <= gi.members.length;
      if (removeGj) {
        gi.members = gi.members.concat(gj.members);
        gi.pin = gi.pin || gj.pin;
        groups.splice(bj, 1);
      } else {
        gj.members = gj.members.concat(gi.members);
        gj.pin = gj.pin || gi.pin;
        groups.splice(bi, 1);
      }
    }
  }
  const map = new Array(hexes.length);
  groups.forEach((g, gi) => g.members.forEach((m) => map[m] = gi));
  return { colors: groups.map((g) => normalizeHex2(g.rep)), map };
}
var FEATURE_FILAMENT_KEYS = [
  "wall_filament",
  "sparse_infill_filament",
  "solid_infill_filament",
  "support_filament",
  "support_interface_filament",
  "wipe_tower_filament"
];
var SLOT_REF_XML = new RegExp(`(key="(extruder|${FEATURE_FILAMENT_KEYS.join("|")})"\\s+value=")(\\d+)(")`, "g");
function remapSlotNumber(n, map) {
  return n >= 1 && n <= map.length && map[n - 1] != null ? map[n - 1] + 1 : n;
}
function remapSlotRefs(target, r) {
  const feature = r.feature ?? r.slot;
  if (typeof target === "string") {
    return target.replace(SLOT_REF_XML, (_m, a, key, n, c) => `${a}${remapSlotNumber(parseInt(n, 10), key === "extruder" ? r.slot : feature)}${c}`);
  }
  for (const k of FEATURE_FILAMENT_KEYS) {
    if (!(k in target)) continue;
    target[k] = mapVal(target[k], null, (v) => {
      if (!/^\s*\d+\s*$/.test(String(v))) return v;
      const n = remapSlotNumber(parseInt(String(v), 10), feature);
      return typeof v === "number" ? n : String(n);
    });
  }
  return target;
}
function slotSources(assign, slotCount, srcColours, slotColours) {
  return Array.from({ length: slotCount }, (_, s) => {
    const members = assign.flatMap((a, i) => a === s ? [i] : []);
    const want = slotColours[s] ? normalizeHex2(slotColours[s]) : "";
    return members.find((i) => want && typeof srcColours[i] === "string" && normalizeHex2(srcColours[i]) === want) ?? members[0] ?? -1;
  });
}
var SNAPMAKER_PRESET_TYPES = /* @__PURE__ */ new Set(["PLA", "PETG", "ABS", "ASA", "PET", "PVA", "TPU"]);
function filamentPresetId(type, brand = "source", sourceId) {
  const t = type || "PLA";
  if (brand === "snapmaker") return SNAPMAKER_PRESET_TYPES.has(t) ? `Snapmaker ${t}` : `Generic ${t}`;
  if (brand === "generic") return `Generic ${t}`;
  return sourceId ?? `Generic ${t}`;
}
function isU1Reference(machine) {
  return machine.id === U1.id || machine.id.startsWith(`${U1.id}-`);
}
function buildU1Config(colors, types, hasVLH = false, diff, machine = U1, brand = "source") {
  const cfg = JSON.parse(JSON.stringify(machine.profile));
  const baseId = cfg.filament_settings_id?.[0] ?? "Generic PLA";
  const colour = [];
  const type = [];
  const sid = [];
  for (let i = 0; i < 4; i++) {
    colour.push(normalizeHex2(colors[i] ?? cfg.filament_colour[i] ?? "#FFFFFF"));
    const known = types[i] ?? types[0];
    const t = known ?? cfg.filament_type[i] ?? "PLA";
    type.push(t);
    sid.push(
      brand === "source" ? known ? baseId.replace(/^Generic\s+\S+/, `Generic ${t}`) : cfg.filament_settings_id[i] : filamentPresetId(t, brand)
    );
  }
  cfg.filament_colour = colour;
  cfg.filament_type = type;
  cfg.filament_settings_id = sid;
  if (isU1Reference(machine)) for (let i = 0; i < 4; i++) applyU1FilamentPreset(cfg, i, type[i]);
  if (hasVLH) applyVlhGuard(cfg, diff);
  return JSON.stringify(cfg);
}
var U1_IDENTITY_KEYS = /* @__PURE__ */ new Set([
  "printable_area",
  "printable_height",
  "bed_exclude_area",
  "bed_custom_model",
  "bed_custom_texture",
  "extruder_offset",
  "extruder_clearance_height_to_lid",
  "extruder_clearance_height_to_rod",
  "extruder_clearance_radius",
  "single_extruder_multi_material",
  "single_extruder_multi_material_priming",
  "gcode_flavor",
  "emit_machine_limits_to_gcode",
  "before_layer_change_gcode",
  "layer_change_gcode",
  "change_filament_gcode",
  "change_extrusion_role_gcode",
  "time_lapse_gcode",
  "printing_by_object_gcode",
  "template_custom_gcode",
  "version",
  "name"
]);
function isU1IdentityKey(k) {
  if (k.startsWith("machine_")) return true;
  if (k.startsWith("printer_")) return true;
  if (k.startsWith("nozzle_temperature_range")) return true;
  if (k.startsWith("nozzle_") && !k.startsWith("nozzle_temperature")) return true;
  return U1_IDENTITY_KEYS.has(k);
}
var PER_EXTRUDER_KEYS = /* @__PURE__ */ new Set([
  "extruder_colour",
  "deretraction_speed",
  "long_retractions_when_cut",
  "max_layer_height",
  "min_layer_height",
  "retract_before_wipe",
  "retract_length_toolchange",
  "retract_lift_above",
  "retract_lift_below",
  "retract_lift_enforce",
  "retract_restart_extra",
  "retract_restart_extra_toolchange",
  "retract_when_changing_layer",
  "retraction_distances_when_cut",
  "retraction_length",
  "retraction_minimum_travel",
  "retraction_speed",
  "travel_slope",
  "wipe",
  "wipe_distance",
  "z_hop",
  "z_hop_types",
  "z_hop_when_prime"
]);
function isPerFilamentKey(k, ref) {
  return Array.isArray(ref) && ref.length === 4 && !isU1IdentityKey(k) && !PER_EXTRUDER_KEYS.has(k);
}
function mapTo4(arr, sources, u1Arr) {
  const out = [];
  for (let s = 0; s < 4; s++) {
    const i = sources[s] ?? -1;
    out.push(i >= 0 && i < arr.length ? arr[i] : arr[0] ?? u1Arr[s] ?? u1Arr[0]);
  }
  return out;
}
var U1_CLAMP_KEYS = /* @__PURE__ */ new Set([
  "outer_wall_speed",
  "inner_wall_speed",
  "sparse_infill_speed",
  "internal_solid_infill_speed",
  "top_surface_speed",
  "gap_infill_speed",
  "travel_speed",
  "initial_layer_speed",
  "initial_layer_infill_speed",
  "initial_layer_travel_speed",
  "overhang_1_4_speed",
  "overhang_2_4_speed",
  "overhang_3_4_speed",
  "overhang_4_4_speed",
  "bridge_speed",
  "support_speed",
  "support_interface_speed",
  "default_acceleration",
  "outer_wall_acceleration",
  "inner_wall_acceleration",
  "sparse_infill_acceleration",
  "top_surface_acceleration",
  "initial_layer_acceleration",
  "travel_acceleration",
  "bridge_acceleration",
  // Hot-end temperature. Preserve mode carries the creator's temps over verbatim, and a project
  // sliced for ABS/ASA/PC on a machine with a hotter hot end routinely specifies 290–300 °C — which
  // then rode through into a file claiming to be U1-ready. See U1_CLAMP_AGAINST for the ceiling used.
  "nozzle_temperature",
  "nozzle_temperature_initial_layer"
]);
var U1_CLAMP_AGAINST = {
  nozzle_temperature: "nozzle_temperature_range_high",
  nozzle_temperature_initial_layer: "nozzle_temperature_range_high"
};
var U1_FILAMENT_SLOT_SENTINEL_KEYS = new Set(FEATURE_FILAMENT_KEYS);
var U1_NEGATIVE_SENTINEL_KEYS = /* @__PURE__ */ new Set([
  "raft_first_layer_expansion",
  "tree_support_wall_count",
  "prime_tower_lift_height"
]);
var U1_VALUE_REMAP = {
  ensure_vertical_shell_thickness: { disabled: "none", enabled: "ensure_all", partial: "ensure_all" },
  support_style: { tree_organic: "default" }
};
var U1_TOWER_SAFETY_KEYS = /* @__PURE__ */ new Set(["wipe_tower_wall_type", "prime_tower_brim_width"]);
var refAt = (ref, i) => Array.isArray(ref) ? ref[i] ?? ref[0] : ref;
function mapVal(v, ref, fn) {
  return Array.isArray(v) ? v.map((x, i) => fn(x, refAt(ref, i))) : fn(v, refAt(ref, 0));
}
function clampNum(v, ref) {
  const n = parseFloat(String(v)), c = parseFloat(String(ref));
  if (!Number.isFinite(n) || !Number.isFinite(c) || c <= 0 || n <= c) return v;
  return typeof v === "string" ? String(c) : c;
}
function maxNum(v) {
  const nums = (Array.isArray(v) ? v : [v]).map((x) => parseFloat(String(x))).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : NaN;
}
var NOZZLE_FIT_KEYS = /* @__PURE__ */ new Set([
  "line_width",
  "initial_layer_line_width",
  "inner_wall_line_width",
  "outer_wall_line_width",
  "internal_solid_infill_line_width",
  "sparse_infill_line_width",
  "support_line_width",
  "top_surface_line_width",
  "layer_height",
  "initial_layer_print_height"
]);
var NOZZLE_LIMIT_KEYS = ["max_layer_height", "min_layer_height"];
var LAYER_MIN_RATIO = 0.2;
var LAYER_MAX_RATIO = 0.8;
function nozzleOf(cfg) {
  const v = cfg?.nozzle_diameter;
  return parseFloat(String(Array.isArray(v) ? v[0] : v));
}
function applyNozzleFit(out, src, ref, diff) {
  const tgt = nozzleOf(ref), from = nozzleOf(src);
  if (!Number.isFinite(tgt) || !Number.isFinite(from) || tgt <= 0 || from <= 0) return;
  for (const k of NOZZLE_LIMIT_KEYS) if (k in ref) out[k] = ref[k];
  if (Math.abs(tgt - from) < 1e-3) return;
  const ratio = tgt / from;
  const lo = +(tgt * LAYER_MIN_RATIO).toFixed(2), hi = +(tgt * LAYER_MAX_RATIO).toFixed(2);
  for (const k of NOZZLE_FIT_KEYS) {
    const v = out[k];
    if (v === void 0 || Array.isArray(v)) continue;
    const s = String(v);
    if (s.includes("%")) continue;
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0) continue;
    let next = Math.round(n * ratio * 100) / 100;
    if (k === "layer_height" || k === "initial_layer_print_height") next = Math.min(hi, Math.max(lo, next));
    if (next === n) continue;
    out[k] = typeof v === "string" ? String(next) : next;
    diff?.nozzleFit.push({ key: k, from: s, to: String(next) });
  }
}
var PRUSA_PAINT_RENAMES = [
  [/\bslic3rpe:mmu_segmentation=/g, "paint_color="],
  [/\bslic3rpe:custom_supports=/g, "paint_supports="],
  [/\bslic3rpe:custom_seam=/g, "paint_seam="],
  [/\bslic3rpe:fuzzy_skin=/g, "paint_fuzzy_skin="]
];
function renamePrusaPaint(xml) {
  let out = xml;
  for (const [re, to] of PRUSA_PAINT_RENAMES) out = out.replace(re, to);
  out = out.replace(/\s+xmlns:slic3rpe="[^"]*"/g, "").replace(/\s+slic3rpe:[\w-]+="[^"]*"/g, "");
  return out;
}
var ORCA_GENERATOR = "OrcaSlicer-2.1.1";
var TRUSTED_GENERATORS = /^(BambuStudio-|OrcaSlicer-|SnapmakerOrca-|Snapmaker_Orca-)/;
function applicationValue(xml) {
  const m = /<metadata\s+name="Application"[^>]*>([^<]*)<\/metadata>/.exec(xml);
  return m ? m[1].trim() : null;
}
function needsGeneratorFix(xml) {
  const app = applicationValue(xml);
  return app !== null && !TRUSTED_GENERATORS.test(app);
}
function forceOrcaGenerator(xml) {
  return xml.replace(
    /(<metadata\s+name="Application"[^>]*>)[^<]*(<\/metadata>)/g,
    (_m, open, close) => `${open}${ORCA_GENERATOR}${close}`
  );
}
function generateOrcaModelSettings(mainModelXml) {
  const items = [...mainModelXml.matchAll(/<item\b([^>]*?)\/>/g)].map((m) => ({ id: /objectid="(\d+)"/.exec(m[1])?.[1], tr: /transform="([^"]*)"/.exec(m[1])?.[1] ?? "1 0 0 0 1 0 0 0 1 0 0 0" })).filter((it) => !!it.id);
  if (!items.length) return "";
  const objs = items.map((it) => `  <object id="${it.id}">
    <metadata key="name" value="object ${it.id}"/>
    <metadata key="extruder" value="1"/>
  </object>`).join("\n");
  const insts = items.map((it) => `    <model_instance>
      <metadata key="object_id" value="${it.id}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`).join("\n");
  const asm = items.map((it) => `  <assemble_item object_id="${it.id}" instance_id="0" transform="${it.tr}" offset="0 0 0"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objs}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
${insts}
  </plate>
  <assemble>
${asm}
  </assemble>
</config>
`;
}
function readPrusaPalette(entries) {
  for (const [path, data] of Object.entries(entries)) {
    if ((path.split("/").pop() ?? "").toLowerCase() !== "slic3r_pe.config") continue;
    const text = strFromU8(data);
    const grab = (key) => {
      const m = text.match(new RegExp(`^;?\\s*${key}\\s*=\\s*(.+)$`, "m"));
      return m ? m[1].trim().split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
    };
    const fc = grab("filament_colour").map(normalizeHex2);
    const ec2 = grab("extruder_colour").map(normalizeHex2);
    const distinct = (a) => new Set(a).size;
    const colours = distinct(fc) >= 2 ? fc : distinct(ec2) >= 2 ? ec2 : fc.length ? fc : ec2;
    if (colours.length) return { colours, types: grab("filament_type") };
  }
  return null;
}
function hasPrusaPaint(entries) {
  for (const [path, data] of Object.entries(entries)) {
    if (path.toLowerCase().endsWith(".model") && strFromU8(data).includes("slic3rpe:")) return true;
  }
  return false;
}
function bedOrigin(area) {
  const c = String((Array.isArray(area) ? area[0] : "") ?? "").split("x").map(Number);
  return [Number.isFinite(c[0]) ? c[0] : 0, Number.isFinite(c[1]) ? c[1] : 0];
}
function shiftBuildItems(xml, dx, dy) {
  if (!dx && !dy) return { xml, applied: false };
  let max2 = 0;
  for (const m of xml.matchAll(/transform="([^"]+)"/g)) {
    const v = m[1].trim().split(/\s+/).map(Number);
    if (v.length >= 12) max2 = Math.max(max2, Math.abs(v[9]), Math.abs(v[10]));
  }
  if (max2 > 400) return { xml, applied: false };
  let applied = false;
  const out = xml.replace(/(<item\b[^>]*\btransform=")([^"]+)(")/g, (m, a, t, c) => {
    const v = t.trim().split(/\s+/);
    if (v.length < 12) return m;
    v[9] = String(parseFloat(v[9]) + dx);
    v[10] = String(parseFloat(v[10]) + dy);
    applied = true;
    return `${a}${v.join(" ")}${c}`;
  });
  return { xml: out, applied };
}
function pinProcessKeys(out, keys) {
  if (!keys.length) return;
  const filCount = Array.isArray(out.filament_colour) ? out.filament_colour.length : 4;
  const prev = Array.isArray(out.different_settings_to_system) ? out.different_settings_to_system : [];
  const merged = [.../* @__PURE__ */ new Set([...(prev[0] ?? "").split(";").filter(Boolean), ...keys])].sort();
  const dss = new Array(Math.max(filCount + 2, prev.length)).fill("");
  for (let i = 1; i < prev.length; i++) dss[i] = prev[i] ?? "";
  dss[0] = merged.join(";");
  out.different_settings_to_system = dss;
}
function dropRangeLayerHeights(xml) {
  return xml.replace(/[ \t]*<option\s+opt_key="layer_height"\s*>[^<]*<\/option>[ \t]*\r?\n?/g, "");
}
function applyVlhGuard(out, diff) {
  const pins = [];
  if (String(out.enable_prime_tower) !== "0") {
    out.enable_prime_tower = "0";
    pins.push("enable_prime_tower");
  }
  if (typeof out.support_type === "string" && out.support_type.startsWith("tree")) {
    out.support_type = out.support_type.replace(/^tree/, "normal");
    pins.push("support_type");
  }
  if (pins.length) {
    pinProcessKeys(out, pins);
    if (diff) diff.vlhGuard = true;
  }
}
function applyU1Safety(out, u1, diff) {
  const changed = (prev, k) => prev !== JSON.stringify(out[k]);
  for (const k of U1_TOWER_SAFETY_KEYS) {
    if (!(k in u1)) continue;
    const had = k in out, prev = JSON.stringify(out[k]);
    out[k] = u1[k];
    if (diff && had && changed(prev, k)) diff.towerSafety.push(k);
  }
  for (const k of U1_FILAMENT_SLOT_SENTINEL_KEYS) {
    if (!(k in out) || !(k in u1)) continue;
    const prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], u1[k], (val, r) => String(val) === "0" ? r : val);
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  for (const k of Object.keys(out)) {
    if (k !== "line_width" && !k.endsWith("_line_width") || u1[k] == null) continue;
    const prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], u1[k], (val, r) => parseFloat(String(val)) === 0 ? r : val);
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  for (const k of U1_NEGATIVE_SENTINEL_KEYS) {
    if (!(k in out) || !(k in u1)) continue;
    const prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], u1[k], (val, r) => parseFloat(String(val)) === -1 ? r : val);
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  for (const k of Object.keys(U1_VALUE_REMAP)) {
    if (!(k in out)) continue;
    const m = U1_VALUE_REMAP[k], prev = JSON.stringify(out[k]);
    out[k] = mapVal(out[k], null, (val) => typeof val === "string" && val in m ? m[val] : val);
    if (diff && changed(prev, k)) diff.sentinelFixed.push(k);
  }
  for (const k of U1_CLAMP_KEYS) {
    const ceilKey = U1_CLAMP_AGAINST[k] ?? k;
    if (!(k in out) || !(ceilKey in u1)) continue;
    const prevVal = out[k], prev = JSON.stringify(prevVal);
    out[k] = mapVal(out[k], u1[ceilKey], clampNum);
    if (diff && changed(prev, k)) diff.clamped.push({ key: k, from: String(maxNum(prevVal)), to: String(maxNum(out[k])) });
  }
  let clobber = false;
  if ("inherits_group" in out) {
    out.inherits_group = Array.isArray(out.inherits_group) ? out.inherits_group.map(() => "") : "";
    clobber = true;
  }
  if (typeof out.print_settings_id === "string" && !out.print_settings_id.endsWith(" (converted)")) {
    out.print_settings_id = out.print_settings_id + " (converted)";
    clobber = true;
  }
  if (diff) diff.antiClobber = clobber;
}
var FILAMENT_FLOW_VARIANT_KEYS = [
  "filament_flow_ratio",
  "enable_pressure_advance",
  "pressure_advance",
  "nozzle_temperature_initial_layer",
  "nozzle_temperature",
  "filament_max_volumetric_speed",
  "fan_min_speed",
  "fan_max_speed",
  "additional_cooling_fan_speed",
  "filament_retraction_length",
  "filament_retraction_speed",
  "filament_deretraction_speed",
  "filament_z_hop_types",
  "filament_wipe_distance",
  "filament_retract_length_toolchange",
  "filament_multitool_ramming",
  "filament_multitool_ramming_volume",
  "filament_multitool_ramming_flow",
  "filament_minimal_purge_on_wipe_tower"
];
var PROCESS_FLOW_VARIANT_KEYS = [
  "outer_wall_speed",
  "inner_wall_speed",
  "sparse_infill_speed",
  "internal_solid_infill_speed",
  "top_surface_speed",
  "gap_infill_speed",
  "bridge_speed",
  "internal_bridge_speed",
  "ironing_speed",
  "small_perimeter_speed",
  "small_perimeter_threshold",
  "support_speed",
  "support_interface_speed",
  "initial_layer_speed",
  "initial_layer_infill_speed",
  "initial_layer_travel_speed",
  "travel_speed",
  "slow_down_layers",
  "overhang_1_4_speed",
  "overhang_2_4_speed",
  "overhang_3_4_speed",
  "overhang_4_4_speed",
  "enable_overhang_speed",
  "slowdown_for_curled_perimeters",
  "default_acceleration",
  "outer_wall_acceleration",
  "inner_wall_acceleration",
  "top_surface_acceleration",
  "initial_layer_acceleration",
  "bridge_acceleration",
  "travel_acceleration",
  "sparse_infill_acceleration",
  "internal_solid_infill_acceleration",
  "accel_to_decel_enable",
  "accel_to_decel_factor",
  "default_jerk",
  "outer_wall_jerk",
  "inner_wall_jerk",
  "infill_jerk",
  "top_surface_jerk",
  "initial_layer_jerk",
  "travel_jerk",
  "default_junction_deviation",
  "max_volumetric_extrusion_rate_slope",
  "max_volumetric_extrusion_rate_slope_segment_length",
  "extrusion_rate_smoothing_external_perimeter_only"
];
var STANDARD_FLOW = "standard";
function collapseFlowVariants(o) {
  const steps = Array.isArray(o.filament_flow_step_size) ? o.filament_flow_step_size : [];
  const sizes = steps.map((s) => Math.max(1, parseInt(String(s), 10) || 1));
  if (sizes.some((n) => n > 1)) {
    const total = sizes.reduce((a, b) => a + b, 0);
    const support = Array.isArray(o.filament_flow_support) ? o.filament_flow_support.map(String) : [];
    const picks = [];
    let start = 0;
    for (const n of sizes) {
      const at2 = support.slice(start, start + n).indexOf(STANDARD_FLOW);
      picks.push(start + Math.max(0, at2));
      start += n;
    }
    for (const k of FILAMENT_FLOW_VARIANT_KEYS) {
      const v = o[k];
      if (Array.isArray(v) && v.length === total) o[k] = picks.map((i) => v[i]);
    }
    o.filament_flow_step_size = sizes.map(() => "1");
    o.filament_flow_support = sizes.map(() => STANDARD_FLOW);
  }
  const proc = Array.isArray(o.process_flow_support) ? o.process_flow_support.map(String) : [];
  if (proc.length > 1) {
    const at2 = Math.max(0, proc.indexOf(STANDARD_FLOW));
    for (const k of PROCESS_FLOW_VARIANT_KEYS) {
      const v = o[k];
      if (Array.isArray(v) && v.length === proc.length) o[k] = [v[at2]];
    }
    o.process_flow_support = [STANDARD_FLOW];
  }
  for (const k of ["filament_volume_type", "nozzle_volume_type"]) {
    const v = o[k];
    if (Array.isArray(v)) o[k] = v.map(() => STANDARD_FLOW);
  }
  return o;
}
function parseProjectConfig(data) {
  return collapseFlowVariants(JSON.parse(strFromU8(data)));
}
var PRESET_MATERIALS = ["PETG-CF", "PETG-GF", "PLA-CF", "PA-CF", "PCTG", "PETG", "PLA", "ABS", "ASA", "TPU", "PVA", "BVOH", "HIPS", "PET", "PC", "PA"];
function materialFromPresetName(name) {
  if (typeof name !== "string") return void 0;
  const n = name.toUpperCase();
  return PRESET_MATERIALS.find((m) => new RegExp(`(^|[^A-Z0-9])${m.replace("-", "\\-")}([^A-Z0-9]|$)`).test(n));
}
function sourceFilamentTypes(o) {
  const types = Array.isArray(o.filament_type) ? o.filament_type : [];
  const ids = Array.isArray(o.filament_settings_id) ? o.filament_settings_id : [];
  const n = Math.max(types.length, types.length ? 0 : ids.length);
  return Array.from({ length: n }, (_, i) => {
    const t = types[i];
    return typeof t === "string" && t.trim() ? t : materialFromPresetName(ids[i]) ?? "";
  }).map((t, i, all) => t || all.find(Boolean) || "");
}
var PRESET_FILL_SKIP = /* @__PURE__ */ new Set(["nozzle_temperature_range_high", "nozzle_temperature_range_low"]);
function fillMissingFromPreset(out, src, machine) {
  if (!isU1Reference(machine)) return;
  const types = out.filament_type ?? [];
  types.forEach((t, slot) => {
    for (const [k, v] of Object.entries(u1FilamentPreset(t) ?? {})) {
      const arr = out[k];
      if (!(k in src) && !PRESET_FILL_SKIP.has(k) && Array.isArray(arr) && slot < arr.length) arr[slot] = v;
    }
  });
}
function buildPreservedConfig(src, colors, types, assign, diff, hasVLH = false, machine = U1, brand = "source") {
  const u1 = JSON.parse(JSON.stringify(machine.profile));
  const out = {};
  if (diff) diff.droppedForeignKeys = Object.keys(src).filter((k) => !(k in u1)).length;
  src = remapSlotRefs({ ...src }, { slot: assign });
  const sources = slotSources(assign, 4, Array.isArray(src.filament_colour) ? src.filament_colour : [], colors);
  for (const k of Object.keys(u1)) {
    if (isU1IdentityKey(k)) out[k] = u1[k];
    else if (k in src) out[k] = src[k];
    else out[k] = u1[k];
  }
  for (const k of Object.keys(u1)) {
    if (isU1IdentityKey(k)) continue;
    const uv = u1[k];
    if (Array.isArray(uv) && uv.length === 4) {
      const sv = out[k];
      out[k] = Array.isArray(sv) ? mapTo4(sv, sources, uv) : uv;
    }
  }
  const baseId = (Array.isArray(u1.filament_settings_id) ? u1.filament_settings_id[0] : "") || "Generic PLA";
  const srcTypesAll = sourceFilamentTypes(src);
  const prevType = srcTypesAll.length ? mapTo4(srcTypesAll, sources, ["PLA", "PLA", "PLA", "PLA"]) : void 0;
  const prevSid = out.filament_settings_id;
  out.filament_colour = [0, 1, 2, 3].map((s) => normalizeHex2(colors[s] ?? "#FFFFFF"));
  out.filament_type = [0, 1, 2, 3].map((s) => types[s] ?? prevType?.[s] ?? "PLA");
  out.filament_settings_id = [0, 1, 2, 3].map((s) => {
    const t = out.filament_type[s];
    return filamentPresetId(t, brand, prevSid?.[s] ?? baseId.replace(/^Generic\s+\S+/, `Generic ${t}`));
  });
  fillMissingFromPreset(out, src, machine);
  applyU1Safety(out, u1, diff);
  applyNozzleFit(out, src, u1, diff);
  if (hasVLH) applyVlhGuard(out, diff);
  return JSON.stringify(out);
}
function buildFullSpectrumConfig(src, keptOld, srcCount, keptHex, diff, hasVLH = false, machine = U1, brand = "source", remap) {
  const u1 = JSON.parse(JSON.stringify(machine.profile));
  const out = {};
  if (diff) diff.droppedForeignKeys = Object.keys(src).filter((k) => !(k in u1)).length;
  if (remap) src = remapSlotRefs({ ...src }, remap);
  for (const k of Object.keys(u1)) {
    if (isU1IdentityKey(k)) out[k] = u1[k];
    else if (k in src) out[k] = src[k];
    else out[k] = u1[k];
  }
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (Array.isArray(v) && v.length === srcCount && !isU1IdentityKey(k)) {
      out[k] = keptOld.map((oldI) => v[oldI] ?? v[0]);
    }
  }
  const refFilled = [];
  for (const k of Object.keys(out)) {
    const ref = u1[k], v = out[k];
    const range = k.startsWith("nozzle_temperature_range") && Array.isArray(ref) && ref.length === 4;
    if (!(isPerFilamentKey(k, ref) || range) || !Array.isArray(v) || v.length === keptOld.length) continue;
    const sv = !range && Array.isArray(src[k]) ? src[k] : null;
    out[k] = keptOld.map((oldI, j) => {
      if (sv && oldI < sv.length) return sv[oldI];
      if (sv) refFilled.push([k, j]);
      return ref[j] ?? ref[0];
    });
  }
  const srcColours = src.filament_colour ?? [];
  const srcTypes = sourceFilamentTypes(src);
  const baseId = (Array.isArray(u1.filament_settings_id) ? u1.filament_settings_id[0] : "") || "Generic PLA";
  const srcSid = Array.isArray(src.filament_settings_id) ? src.filament_settings_id : [];
  out.filament_colour = keptOld.map((i, k) => normalizeHex2(keptHex?.[k] || srcColours[i] || "#FFFFFF"));
  out.filament_type = keptOld.map((i) => srcTypes[i] || "PLA");
  out.filament_settings_id = keptOld.map(
    (i) => filamentPresetId(srcTypes[i] || "PLA", brand, srcSid[i] ?? baseId.replace(/^Generic\s+\S+/, `Generic ${srcTypes[i] || "PLA"}`))
  );
  fillMissingFromPreset(out, src, machine);
  if (isU1Reference(machine)) {
    for (const [k, j] of refFilled) {
      const v = u1FilamentPreset(out.filament_type[j])?.[k];
      if (v !== void 0 && !PRESET_FILL_SKIP.has(k)) out[k][j] = v;
    }
  }
  applyU1Safety(out, u1, diff);
  applyNozzleFit(out, src, u1, diff);
  if (hasVLH) applyVlhGuard(out, diff);
  return JSON.stringify(out);
}
function tallyUsage(entries, n) {
  const usage = new Array(n).fill(0);
  for (const [path, data] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".config")) continue;
    for (const m of strFromU8(data).matchAll(/key="extruder"\s+value="(\d+)"/g)) {
      const v = parseInt(m[1], 10);
      if (v >= 1 && v <= n) usage[v - 1] += 1;
    }
  }
  return usage;
}
function detectFlavour(entries) {
  const names = Object.keys(entries);
  if (names.some((p) => /project_settings\.config$/i.test(p))) {
    const si = Object.entries(entries).find(([p]) => /slice_info\.config$/i.test(p));
    return si && /orca/i.test(strFromU8(si[1])) ? "orca" : "bambu";
  }
  if (names.some((p) => /slic3r_pe\.config$/i.test(p))) return "prusa";
  return "generic";
}
function bedRect(bed) {
  return ["0x0", `${bed.x}x0`, `${bed.x}x${bed.y}`, `0x${bed.y}`];
}
var KEPT_PRINTER_KEYS = /* @__PURE__ */ new Set(["printer_model", "printer_settings_id", "printer_variant", "nozzle_diameter", "printable_area", "printable_height", "printer_technology"]);
var PRINTER_PRESET_KEYS = /* @__PURE__ */ new Set([
  "auxiliary_fan",
  "bed_exclude_area",
  "bed_custom_model",
  "bed_custom_texture",
  "best_object_pos",
  "cooling_filter_enabled",
  "default_filament_profile",
  "default_nozzle_volume_type",
  "default_print_profile",
  "deretraction_speed",
  "enable_long_retraction_when_cut",
  "enable_pre_heating",
  "extruder_clearance_dist_to_rod",
  "extruder_clearance_height_to_lid",
  "extruder_clearance_height_to_rod",
  "extruder_clearance_max_radius",
  "extruder_clearance_radius",
  "extruder_colour",
  "extruder_height_gap",
  "extruder_max_nozzle_count",
  "extruder_offset",
  "extruder_printable_area",
  "extruder_printable_height",
  "extruder_type",
  "extruder_variant_list",
  "fan_direction",
  "farthest_point_timelapse",
  "gcode_flavor",
  "grab_length",
  "group_algo_with_time",
  "head_wrap_detect_zone",
  "hotend_cooling_rate",
  "hotend_heating_rate",
  "long_retractions_when_cut",
  "master_extruder_id",
  "max_layer_height",
  "min_layer_height",
  "nozzle_flush_dataset",
  "nozzle_height",
  "nozzle_type",
  "nozzle_volume",
  "nozzle_hrc",
  "physical_extruder_map",
  "print_in_clockwise",
  "retract_before_wipe",
  "retract_length_toolchange",
  "retract_lift_above",
  "retract_lift_below",
  "retract_lift_enforce",
  "retract_restart_extra",
  "retract_restart_extra_toolchange",
  "retract_when_changing_layer",
  "retraction_distances_when_cut",
  "retraction_length",
  "retraction_minimum_travel",
  "retraction_speed",
  "scan_first_layer",
  "silent_mode",
  "single_extruder_multi_material",
  "support_air_filtration",
  "support_chamber_temp_control",
  "support_cooling_filter",
  "support_fast_purge_mode",
  "support_object_skip_flush",
  "travel_slope",
  "upward_compatible_machine",
  "wipe",
  "wipe_distance",
  "wrapping_exclude_area",
  "z_hop",
  "z_hop_types",
  "z_offset",
  "thumbnails",
  "thumbnails_format",
  "use_firmware_retraction",
  "use_relative_e_distances",
  "emit_machine_limits_to_gcode",
  "disable_m73",
  "manual_filament_change",
  "host_type",
  "print_host",
  "printhost_apikey",
  "bbl_use_printhost"
]);
function isPrinterPresetKey(k) {
  if (KEPT_PRINTER_KEYS.has(k)) return false;
  if (PRINTER_PRESET_KEYS.has(k) || k.startsWith("machine_") || k.startsWith("printer_")) return true;
  return k.endsWith("_gcode") && !k.startsWith("filament_");
}
function retargetPrinterIdentity(o, machine) {
  for (const k of Object.keys(o)) if (isPrinterPresetKey(k)) delete o[k];
  if (machine.printerModel) o.printer_model = machine.printerModel;
  else delete o.printer_model;
  if (machine.printerSettingsId) o.printer_settings_id = machine.printerSettingsId;
  else delete o.printer_settings_id;
  if (machine.printerVariant) o.printer_variant = machine.printerVariant;
  else delete o.printer_variant;
  for (const k of ["inherits_group", "different_settings_to_system"]) {
    const v = o[k];
    if (Array.isArray(v) && v.length) o[k] = [...v.slice(0, -1), ""];
  }
}
function stripToGeneric(entries) {
  const out = {};
  const removed = [];
  for (const [path, data] of Object.entries(entries)) {
    if (isGenericKeep(path)) out[path] = data;
    else removed.push(path);
  }
  const zipped = zipSync(out, { level: 6 });
  return {
    blob: new Blob([zipped.buffer], { type: "model/3mf" }),
    removed,
    kept: Object.keys(out).length,
    colorsKept: 0,
    colorsTotal: 0,
    over4: false,
    reduced: false,
    painted: false,
    manual: false,
    preserved: false,
    swaps: [],
    diff: null
  };
}
function retargetThreeMF(entries, machine, opts) {
  const srcFlavour = detectFlavour(entries);
  const srcFamily = configFamily(srcFlavour);
  const tgtFamily = configFamily(machine.flavour);
  const reprofile = srcFamily !== "generic" && srcFamily === tgtFamily;
  const toPrusa = srcFamily === "bbl" && tgtFamily === "prusa" && !!machine.printerSettingsId;
  if (!reprofile && !toPrusa) return stripToGeneric(entries);
  let srcColours = [];
  let srcTypes = [];
  for (const [path, data] of Object.entries(entries)) {
    if ((path.split("/").pop() ?? "").toLowerCase() === "project_settings.config") {
      try {
        const o = parseProjectConfig(data);
        srcColours = Array.isArray(o.filament_colour) ? o.filament_colour : [];
        srcTypes = sourceFilamentTypes(o);
      } catch {
      }
    }
  }
  if (!srcColours.length) {
    const pp = readPrusaPalette(entries);
    if (pp) {
      srcColours = pp.colours;
      srcTypes = pp.types;
    }
  }
  const colorsTotal = srcColours.length;
  if (colorsTotal > MAX_COLORS) throw tooManyColours(colorsTotal);
  const slots = Math.max(1, machine.toolheads);
  let map = null;
  let useColours = srcColours;
  let useTypes = srcTypes;
  const manual = Boolean(opts?.slots && opts.slots.length > 0 && opts.assign);
  if (manual) {
    map = opts.assign;
    useColours = opts.slots.slice(0, slots).map(normalizeHex2);
  } else if (colorsTotal > slots) {
    const r = reduceColors(srcColours, tallyUsage(entries, colorsTotal), void 0, slots);
    map = r.map.map((g) => Math.min(g, slots - 1));
    useColours = r.colors.slice(0, slots).map(normalizeHex2);
  }
  const sources = map ? slotSources(map, slots, srcColours, useColours) : null;
  if (sources) useTypes = useColours.map((_, s) => sources[s] >= 0 ? srcTypes[sources[s]] ?? "PLA" : "PLA");
  const reduced = !!map && (colorsTotal > slots || !map.every((a, i) => a === i));
  const recoloured = !reduced && manual && useColours.slice(0, colorsTotal).some((c, i) => c !== normalizeHex2(srcColours[i] ?? ""));
  if (toPrusa) {
    const colours = (map ? useColours : srcColours).map(normalizeHex2);
    let projectMap = map;
    let blends = [];
    if (opts?.colorMix && machine.prusaColorMix && srcColours.length) {
      const plan = planColorMix(srcColours.map(normalizeHex2), colours, slots, opts.loadedSlots);
      if (plan.blends.length) {
        blends = plan.blends;
        projectMap = srcColours.map((_, i) => plan.map[i] >= slots ? plan.map[i] : map ? map[i] : Math.min(i, slots - 1));
      }
    }
    const project = toPrusaProject(entries, machine, { map: projectMap, blends, colours, types: map ? useTypes : srcTypes });
    const zippedProject = zipSync(project.out, { level: 6 });
    return {
      blob: new Blob([zippedProject.buffer], { type: "model/3mf" }),
      removed: project.removed,
      kept: Object.keys(project.out).length,
      colorsKept: Math.min(colours.length || colorsTotal, slots),
      colorsTotal,
      over4: colorsTotal > 4,
      reduced,
      painted: project.painted,
      manual,
      preserved: false,
      swaps: [],
      diff: null,
      untranslated: project.untranslated
    };
  }
  const nozzleStr = String(machine.nozzle ?? 0.4);
  const printableArea = machine.printableArea ?? bedRect(machine.bed);
  const printableHeight = machine.printableHeight ?? String(machine.bed.z);
  const stateMap = reduced && map ? (s) => s === 0 ? 0 : s >= 1 && s <= colorsTotal ? map[s - 1] + 1 : s : null;
  const out = {};
  const removed = [];
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (base === "project_settings.config") {
      let o;
      try {
        o = parseProjectConfig(data);
      } catch {
        out[path] = data;
        continue;
      }
      retargetPrinterIdentity(o, machine);
      o.nozzle_diameter = Array.isArray(o.nozzle_diameter) ? o.nozzle_diameter.map(() => nozzleStr) : nozzleStr;
      o.printable_area = printableArea.slice();
      o.printable_height = printableHeight;
      if (reduced && map) {
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (Array.isArray(v) && v.length === colorsTotal) {
            o[k] = sources.map((oi) => oi >= 0 ? v[oi] : v[0]);
          }
        }
        remapSlotRefs(o, { slot: map });
        o.filament_colour = useColours.slice();
        o.filament_type = useTypes.slice();
      } else if (recoloured) {
        o.filament_colour = srcColours.map((c, i) => useColours[i] ?? normalizeHex2(c));
      }
      out[path] = strToU8(JSON.stringify(o));
      continue;
    }
    if (base === "slic3r_pe.config") {
      let text = strFromU8(data);
      if (machine.printerModel) text = text.replace(/^(;?\s*printer_model\s*=).*$/im, `$1 ${machine.printerModel}`);
      text = text.replace(/^(;?\s*nozzle_diameter\s*=)(.*)$/im, (_m, k, v) => `${k} ${v.split(",").map(() => nozzleStr).join(",")}`);
      for (const [key, val] of [["printer_settings_id", machine.printerSettingsId], ["printer_variant", machine.printerVariant]]) {
        const line = new RegExp(`^(;?\\s*${key}\\s*=).*$`, "im");
        text = val ? text.replace(line, `$1 ${val}`) : text.replace(new RegExp(`^;?\\s*${key}\\s*=.*(\\r?\\n|$)`, "im"), "");
      }
      const { x, y, z } = machine.bed;
      text = text.replace(/^(;?\s*bed_shape\s*=).*$/im, `$1 0x0,${x}x0,${x}x${y},0x${y}`);
      text = text.replace(/^(;?\s*max_print_height\s*=).*$/im, `$1 ${z}`);
      if (recoloured) {
        const list = srcColours.map((c, i) => useColours[i] ?? normalizeHex2(c)).join(";");
        text = text.replace(/^(;?\s*(?:extruder|filament)_colour\s*=).*$/gim, `$1 ${list}`);
      }
      out[path] = strToU8(text);
      continue;
    }
    if (isStrippable(path)) {
      removed.push(path);
      continue;
    }
    if (lower.endsWith(".model")) {
      const raw = strFromU8(data);
      if (stateMap && raw.includes("paint_color")) {
        out[path] = strToU8(raw.replace(/paint_color="([0-9A-Fa-f]+)"/g, (_m, c) => `paint_color="${remapPaintCode(c, stateMap)}"`));
      } else {
        out[path] = data;
      }
      continue;
    }
    if (reduced && map && lower.endsWith(".config")) {
      out[path] = strToU8(remapSlotRefs(strFromU8(data), { slot: map }));
      continue;
    }
    out[path] = data;
  }
  const zipped = zipSync(out, { level: 6 });
  return {
    blob: new Blob([zipped.buffer], { type: "model/3mf" }),
    removed,
    kept: Object.keys(out).length,
    colorsKept: Math.min(useColours.length || colorsTotal, slots),
    colorsTotal,
    over4: colorsTotal > 4,
    reduced,
    painted: !!stateMap,
    manual,
    preserved: false,
    swaps: [],
    diff: null
  };
}
async function cleanThreeMF(file, target, opts) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = applyPrusaVolumePaint(readThreeMF(buf));
  if (target === "generic") return stripToGeneric(entries);
  const targetMachine = target !== "u1" && target !== "current" ? MACHINES[target] : void 0;
  if (targetMachine && targetMachine.id !== "u1") return retargetThreeMF(entries, targetMachine, opts);
  const isPrusa = target === "u1" && Object.keys(entries).some((p) => /slic3r_pe(_model)?\.config$/i.test(p));
  const prusaPaint = target === "u1" && hasPrusaPaint(entries);
  if (isPrusa) {
    for (const [path, data] of Object.entries(entries)) {
      if (!path.toLowerCase().endsWith(".model")) continue;
      const t = strFromU8(data);
      if (/slic3rpe[:=]/.test(t)) entries[path] = strToU8(renamePrusaPaint(t));
    }
  }
  let srcColours = [];
  let srcTypes = [];
  let srcCfg = null;
  let painted = false;
  let maxSlot = 0;
  let hasGeometry = false;
  let hasPlateGcode = false;
  let hasVLH = false;
  const gcodeLayerExt = /* @__PURE__ */ new Set();
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (/plate_\d+\.gcode$/.test(lower)) hasPlateGcode = true;
    if (base === "layer_config_ranges.xml" || base === "layer_heights_profile.txt") hasVLH = true;
    if (base === "project_settings.config") {
      try {
        const o = parseProjectConfig(data);
        srcCfg = o;
        srcColours = Array.isArray(o.filament_colour) ? o.filament_colour : [];
        srcTypes = sourceFilamentTypes(o);
      } catch {
      }
    }
    if (lower.endsWith(".model")) {
      const text = strFromU8(data);
      if (!painted && text.includes("paint_color")) painted = true;
      if (!hasGeometry && text.includes("<vertex")) hasGeometry = true;
    }
    if (lower.endsWith(".config")) {
      for (const m of strFromU8(data).matchAll(/key="extruder"\s+value="(\d+)"/g)) {
        const v = parseInt(m[1], 10);
        if (v > maxSlot) maxSlot = v;
      }
    }
    if (base === "custom_gcode_per_layer.xml") {
      for (const m of strFromU8(data).matchAll(/type="2"[^>]*extruder="(\d+)"|extruder="(\d+)"[^>]*type="2"/g)) {
        gcodeLayerExt.add(parseInt(m[1] ?? m[2], 10));
      }
    }
  }
  if (!hasGeometry && hasPlateGcode) {
    throw new Error(
      "This looks like an already-sliced G-code file, not an editable 3D model. Open the original model file (the one you slice from) and convert that instead."
    );
  }
  if (!srcColours.length) {
    const pp = readPrusaPalette(entries);
    if (pp) {
      srcColours = pp.colours;
      srcTypes = pp.types;
    }
  }
  const fsPalette = paletteFromFullSpectrum(entries);
  if (fsPalette && fsPalette.length > srcColours.length) {
    srcColours = fsPalette;
    srcTypes = fsPalette.map((_, i) => srcTypes[i] ?? srcTypes[0] ?? "PLA");
  }
  const fsRecipes = fsPalette ? recipesFromFullSpectrum(entries) : null;
  const colorsTotal = srcColours.length;
  if (colorsTotal > MAX_COLORS) throw tooManyColours(colorsTotal);
  const over4 = colorsTotal > 4;
  const objectAssigned = !painted && maxSlot > 4;
  const byLayerOver4 = gcodeLayerExt.size > 4;
  const useSwap = Boolean(opts?.swapPauses) && target === "u1" && byLayerOver4;
  let reduced = false;
  let map = null;
  let useColours = srcColours;
  let useTypes = srcTypes;
  let stateMap = null;
  let swapRemap = null;
  let swaps = [];
  const mixDefs = [];
  let fsKeptOld = null;
  let customFS = false;
  let keptAll = false;
  let bandSwapXml = null;
  const manual = Boolean(opts?.slots && opts.slots.length > 0);
  let bandDetect = null;
  if (target === "u1" && painted && opts?.bandSwap && buf.length < 2e8) {
    try {
      const mesh = extractMeshFromBuffer(buf);
      if (mesh.positions.length > 0) {
        const bp = detectColorBandsForMesh(mesh, mesh.baseState);
        if (bp.banded && bp.bands.length > 1) bandDetect = { bands: bp.bands, baseState: mesh.baseState };
      }
    } catch {
    }
  }
  if (target === "u1" && opts?.keepAllColours && over4 && srcCfg) {
    fsKeptOld = [...Array(colorsTotal).keys()];
    keptAll = true;
  } else if (target === "u1" && bandDetect) {
    const lh = srcCfg && srcCfg.layer_height != null ? parseFloat(String(srcCfg.layer_height)) : NaN;
    const { instructions, headOf, customGcodeXml } = buildBandSwapPlan(
      bandDetect.bands,
      srcColours,
      "M600",
      Number.isFinite(lh) ? lh : void 0,
      bandDetect.baseState
    );
    const baseHead = (headOf.get(bandDetect.baseState) ?? 0) + 1;
    stateMap = (s) => s === 0 ? baseHead : (headOf.get(s) ?? 0) + 1;
    map = srcColours.map((_, i) => headOf.get(i + 1) ?? 0);
    const firstOnHead = (h) => {
      for (const [st, hd] of headOf) if (hd === h) return st;
      return 1;
    };
    useColours = [0, 1, 2, 3].map((h) => normalizeHex2(srcColours[firstOnHead(h) - 1] ?? "#FFFFFF"));
    useTypes = [0, 1, 2, 3].map((h) => srcTypes[firstOnHead(h) - 1] ?? srcTypes[0] ?? "PLA");
    swaps = instructions;
    bandSwapXml = customGcodeXml;
    reduced = true;
  } else if (target === "u1" && (painted || objectAssigned) && colorsTotal > 0 && opts?.fullSpectrum && opts?.customPhysical?.length === 4) {
    const physHex = opts.customPhysical.map(normalizeHex2);
    const newOf = /* @__PURE__ */ new Map();
    let mixIdx = 0;
    for (let oldI = 0; oldI < colorsTotal; oldI++) {
      const ov = opts.mixes?.[oldI];
      if (ov && ov.a >= 1 && ov.a <= 4 && ov.b >= 1 && ov.b <= 4) {
        if (ov.a === ov.b) newOf.set(oldI, ov.a);
        else {
          newOf.set(oldI, 5 + mixIdx);
          mixDefs.push({ componentA: ov.a, componentB: ov.b, mixBPercent: ov.mixBPercent, stableId: ++mixIdx });
        }
        continue;
      }
      const mm = bestMixMulti(normalizeHex2(srcColours[oldI]), physHex);
      if (mm.ids.length === 1) {
        newOf.set(oldI, mm.ids[0]);
        continue;
      }
      if (mm.ids.length === 2) {
        const [a, b] = mm.ids, pctB = mm.weights[1];
        if (pctB >= 92) {
          newOf.set(oldI, b);
          continue;
        }
        if (pctB <= 8) {
          newOf.set(oldI, a);
          continue;
        }
        newOf.set(oldI, 5 + mixIdx);
        mixDefs.push({ componentA: a, componentB: b, mixBPercent: pctB, stableId: ++mixIdx });
        continue;
      }
      newOf.set(oldI, 5 + mixIdx);
      mixDefs.push({
        componentA: mm.ids[0],
        componentB: mm.ids[1],
        mixBPercent: 50,
        gradientIds: mm.ids.join(""),
        gradientWeights: mm.weights.join("/"),
        distributionMode: 0,
        stableId: ++mixIdx
      });
    }
    stateMap = (s) => s === 0 ? 0 : newOf.get(s - 1) ?? 1;
    map = srcColours.map((_, i) => (newOf.get(i) ?? 1) - 1);
    useColours = physHex;
    useTypes = physHex.map(() => "PLA");
    customFS = true;
    reduced = true;
  } else if (target === "u1" && useSwap) {
    map = srcColours.map((_, i) => i % 4);
    swapRemap = new Map(srcColours.map((_, i) => [i + 1, i % 4]));
    useColours = [0, 1, 2, 3].map((h) => normalizeHex2(srcColours[h] ?? "#FFFFFF"));
    useTypes = [0, 1, 2, 3].map((h) => srcTypes[h] ?? srcTypes[0] ?? "PLA");
    reduced = true;
  } else if (target === "u1" && (painted || objectAssigned) && colorsTotal > 0 && opts?.fullSpectrum && over4) {
    const pu = tallyPaintUsage(entries, colorsTotal);
    const order = [...Array(colorsTotal).keys()].sort((a, b) => (pu[b] ?? 0) - (pu[a] ?? 0));
    const physOld = (
      // Full Spectrum file (Prusa ColorMix): the first 4 palette entries ARE the physical bases and the
      // rest are already mixes of them — you can't load a "mix" on a head. Force the 4 bases as physical;
      // otherwise the picker may choose a virtual mix colour as a filament and Orca renders one colour.
      fsPalette ? [0, 1, 2, 3] : opts.physical && opts.physical.length === 4 ? opts.physical.slice(0, 4) : bestPhysicalSet(srcColours.slice(0, colorsTotal), pu)
    );
    const physHex = physOld.map((i, k) => normalizeHex2((fsPalette ? void 0 : opts.physicalHex?.[k]) || srcColours[i]));
    const newOf = /* @__PURE__ */ new Map();
    physOld.forEach((oldI, k) => newOf.set(oldI, k + 1));
    let mixIdx = 0;
    for (const oldI of order) {
      if (newOf.has(oldI)) continue;
      const ov = opts.mixes?.[oldI];
      if (ov && ov.a >= 1 && ov.a <= 4 && ov.b >= 1 && ov.b <= 4) {
        if (ov.a === ov.b) newOf.set(oldI, ov.a);
        else {
          newOf.set(oldI, 5 + mixIdx);
          mixDefs.push({ componentA: ov.a, componentB: ov.b, mixBPercent: ov.mixBPercent, stableId: ++mixIdx });
        }
        continue;
      }
      const rec = fsRecipes?.get(oldI + 1)?.filter((c) => c.extruder >= 1 && c.extruder <= 4);
      if (rec && rec.length) {
        if (rec.length === 1 || rec[0].extruder === rec[1]?.extruder) {
          newOf.set(oldI, rec[0].extruder);
          continue;
        }
        if (rec.length === 2) {
          newOf.set(oldI, 5 + mixIdx);
          mixDefs.push({ componentA: rec[0].extruder, componentB: rec[1].extruder, mixBPercent: Math.round(rec[1].ratio * 100), stableId: ++mixIdx });
          continue;
        }
        const g = rec.slice(0, 3);
        newOf.set(oldI, 5 + mixIdx);
        mixDefs.push({
          componentA: g[0].extruder,
          componentB: g[1].extruder,
          mixBPercent: 50,
          gradientIds: g.map((c) => c.extruder).join(""),
          gradientWeights: g.map((c) => Math.round(c.ratio * 100)).join("/"),
          distributionMode: 0,
          stableId: ++mixIdx
        });
        continue;
      }
      const mm = bestMixMulti(normalizeHex2(srcColours[oldI]), physHex);
      if (mm.ids.length === 1) {
        newOf.set(oldI, mm.ids[0]);
        continue;
      }
      if (mm.ids.length === 2) {
        const [a, b] = mm.ids, pctB = mm.weights[1];
        if (pctB >= 92) {
          newOf.set(oldI, b);
          continue;
        }
        if (pctB <= 8) {
          newOf.set(oldI, a);
          continue;
        }
        newOf.set(oldI, 5 + mixIdx);
        mixDefs.push({ componentA: a, componentB: b, mixBPercent: pctB, stableId: ++mixIdx });
        continue;
      }
      newOf.set(oldI, 5 + mixIdx);
      mixDefs.push({
        componentA: mm.ids[0],
        componentB: mm.ids[1],
        mixBPercent: 50,
        gradientIds: mm.ids.join(""),
        gradientWeights: mm.weights.join("/"),
        distributionMode: 0,
        stableId: ++mixIdx
      });
    }
    fsKeptOld = physOld;
    stateMap = (s) => s === 0 ? 0 : newOf.get(s - 1) ?? 1;
    map = srcColours.map((_, i) => (newOf.get(i) ?? 1) - 1);
    useColours = physHex;
    useTypes = physOld.map((i) => srcTypes[i] ?? "PLA");
    reduced = true;
  } else if (target === "u1" && painted && colorsTotal > 0) {
    let assign;
    if (manual && opts.assign) {
      assign = opts.assign;
      useColours = opts.slots.slice(0, 4).map(normalizeHex2);
    } else {
      const r = reduceColors(srcColours, tallyPaintUsage(entries, colorsTotal));
      assign = r.map;
      useColours = r.colors;
    }
    const sources = slotSources(assign, 4, srcColours, useColours);
    useTypes = sources.map((oi) => oi >= 0 ? srcTypes[oi] ?? "PLA" : "PLA");
    const pu = tallyPaintUsage(entries, colorsTotal);
    const domIdx = pu.indexOf(Math.max(...pu, 0));
    const domSlot = domIdx >= 0 && assign[domIdx] != null ? assign[domIdx] + 1 : 1;
    stateMap = (s) => s === 0 ? 0 : s >= 1 && s <= colorsTotal ? assign[s - 1] + 1 : domSlot;
    map = assign;
    reduced = true;
  } else if (target === "u1") {
    if (manual) {
      useColours = opts.slots.slice(0, 4).map(normalizeHex2);
      if (opts.assign && srcTypes.length) {
        useTypes = slotSources(opts.assign, 4, srcColours, useColours).map((oi) => oi >= 0 ? srcTypes[oi] ?? "PLA" : "PLA");
      }
      const reorders = opts.assign && !opts.assign.every((a, i) => a === i);
      if (opts.assign && (objectAssigned || reorders)) {
        map = opts.assign;
        reduced = true;
      }
    } else if (over4 && objectAssigned) {
      const r = reduceColors(srcColours, tallyUsage(entries, srcColours.length));
      map = r.map;
      useColours = r.colors;
      useTypes = slotSources(r.map, r.colors.length, srcColours, r.colors).map((oi) => srcTypes[oi] ?? srcTypes[0] ?? "PLA");
      reduced = true;
    }
  }
  const wantPreserve = (opts?.mode ?? "preserve") === "preserve";
  const canPreserve = wantPreserve && srcCfg !== null && colorsTotal > 0 && !customFS;
  const machine = opts?.machine ?? U1;
  const brand = opts?.filamentBrand ?? "source";
  const assignEff = map ?? opts?.assign ?? srcColours.map((_, i) => Math.min(i, 3));
  const mixHead = (d) => {
    if (!d) return 0;
    const ids = d.gradientIds ? d.gradientIds.split("").map(Number) : [d.componentA, d.componentB];
    const w = d.gradientWeights ? d.gradientWeights.split("/").map(Number) : [100 - d.mixBPercent, d.mixBPercent];
    return (ids[w.indexOf(Math.max(...w))] ?? d.componentA) - 1;
  };
  const featureMap = map && mixDefs.length ? map.map((v) => v < 4 ? v : mixHead(mixDefs[v - 4])) : void 0;
  const slotRemap = map ? { slot: map, feature: featureMap } : null;
  const diff = target === "u1" ? {
    mode: canPreserve ? "preserve" : "stamp",
    printerFrom: srcCfg?.printer_settings_id ?? srcCfg?.printer_model ?? null,
    printerTo: machine.name,
    clamped: [],
    sentinelFixed: [],
    towerSafety: [],
    droppedForeignKeys: 0,
    antiClobber: false,
    vlhGuard: false,
    vlhDropped: false,
    bedShift: null,
    prusaPaint,
    foreignNative: false,
    fullSpectrumMixes: mixDefs.length,
    nozzleFit: [],
    highFlow: null,
    untestedProfile: machine.testedProfile === false,
    keptAllColours: keptAll ? colorsTotal : 0,
    filamentBrand: brand === "source" ? null : brand
  } : null;
  const u1Org = bedOrigin(machine.profile?.printable_area);
  const srcOrg = bedOrigin(srcCfg?.printable_area);
  const dx = target === "u1" ? +(u1Org[0] - srcOrg[0]).toFixed(3) : 0;
  const dy = target === "u1" ? +(u1Org[1] - srcOrg[1]).toFixed(3) : 0;
  const withMixes = (cfg) => {
    if (!mixDefs.length) return cfg;
    const o = JSON.parse(cfg);
    o.mixed_filament_definitions = serializeMixedDefs(mixDefs);
    for (const [k, v] of Object.entries(MIXED_DITHERING_DEFAULTS)) o[k] = v;
    if (opts?.subdivide === false) {
      o.dithering_local_z_mode = "0";
      o.dithering_local_z_infill = "0";
    }
    const topGap = parseFloat(String(o.support_top_z_distance ?? "0"));
    if (!(topGap >= 0.35)) o.support_top_z_distance = "0.35";
    const botGap = parseFloat(String(o.support_bottom_z_distance ?? "0"));
    if (!(botGap >= 0.25)) o.support_bottom_z_distance = "0.25";
    o.flush_into_objects = "0";
    o.flush_into_infill = "0";
    o.flush_into_support = "0";
    const mlh = opts?.mixedLayerHeight;
    if (mlh && mlh > 0) {
      o.dithering_z_step_size = String(mlh);
      o.dithering_step_painted_zones_only = "1";
      o.dithering_local_z_mode = "0";
      o.dithering_local_z_infill = "0";
    }
    const overrideKeys = [
      "mixed_filament_definitions",
      ...Object.keys(MIXED_DITHERING_DEFAULTS),
      "support_top_z_distance",
      "support_bottom_z_distance",
      "flush_into_objects",
      "flush_into_infill",
      "flush_into_support"
    ];
    const filCount = Array.isArray(o.filament_colour) ? o.filament_colour.length : 4;
    const prev = Array.isArray(o.different_settings_to_system) ? o.different_settings_to_system : [];
    const prevPrint = (prev[0] ?? "").split(";").filter(Boolean);
    const printDiffs = [.../* @__PURE__ */ new Set([...prevPrint, ...overrideKeys])].sort();
    const dss = new Array(filCount + 2).fill("");
    dss[0] = printDiffs.join(";");
    o.different_settings_to_system = dss;
    return JSON.stringify(o);
  };
  const dropVlh = hasVLH && opts?.vlhGuard === "keep-prime-tower";
  const guardVlh = hasVLH && !dropVlh && (opts?.vlhGuard === "keep-layers" || !opts?.keepPrimeTowerVlh);
  if (dropVlh && diff) diff.vlhDropped = true;
  const highFlow = !!opts?.highFlow && target === "u1" && machine.id === U1.id;
  const finishConfig = (cfg) => {
    const mixed = withMixes(cfg);
    if (!highFlow) return mixed;
    const o = JSON.parse(mixed);
    const slots = applyHighFlow(o);
    if (diff) diff.highFlow = slots;
    return JSON.stringify(o);
  };
  const makeU1Config = () => finishConfig(
    fsKeptOld && srcCfg ? buildFullSpectrumConfig(srcCfg, fsKeptOld, colorsTotal, useColours, diff ?? void 0, guardVlh, machine, brand, slotRemap ?? void 0) : canPreserve ? buildPreservedConfig(srcCfg, useColours, useTypes, assignEff, diff ?? void 0, guardVlh, machine, brand) : buildU1Config(useColours, useTypes, guardVlh, diff ?? void 0, machine, brand)
  );
  const removed = [];
  const out = {};
  let hadProject = false;
  for (const [path, data] of Object.entries(entries)) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if (base === "project_settings.config") {
      hadProject = true;
      if (target === "u1") out[path] = strToU8(makeU1Config());
      else removed.push(path);
      continue;
    }
    if (target === "u1" && base === "custom_gcode_per_layer.xml") {
      let xml = strFromU8(data).replace(
        /(<layer\b[^>]*\btype="1"[^>]*\bgcode=")[^"]*(")/g,
        "$1M600$2"
      );
      if (useSwap && swapRemap) {
        const lh = srcCfg && srcCfg.layer_height != null ? parseFloat(String(srcCfg.layer_height)) : void 0;
        const r = insertSwapPauses(xml, swapRemap, srcColours, "M600", Number.isFinite(lh) ? lh : void 0);
        xml = r.xml;
        swaps = r.instructions;
      }
      out[path] = strToU8(xml);
      continue;
    }
    if (isStrippable(path)) {
      removed.push(path);
      continue;
    }
    if (dropVlh && base === "layer_heights_profile.txt") {
      removed.push(path);
      continue;
    }
    if (dropVlh && base === "layer_config_ranges.xml") {
      out[path] = strToU8(dropRangeLayerHeights(strFromU8(data)));
      continue;
    }
    if (lower.endsWith(".model")) {
      const raw = strFromU8(data);
      const needsPaint = !!stateMap && raw.includes("paint_color");
      const needsShift = target === "u1" && (!!dx || !!dy) && raw.includes("<build");
      const needsGen = target === "u1" && needsGeneratorFix(raw);
      if (!needsPaint && !needsShift && !needsGen) {
        out[path] = data;
        continue;
      }
      let text = needsPaint ? raw.replace(/paint_color="([0-9A-Fa-f]+)"/g, (_m, c) => `paint_color="${remapPaintCode(c, stateMap)}"`) : raw;
      if (needsShift) {
        const r = shiftBuildItems(text, dx, dy);
        if (r.applied) {
          text = r.xml;
          if (diff) diff.bedShift = { dx, dy };
        }
      }
      if (needsGen) {
        text = forceOrcaGenerator(text);
        if (diff) diff.foreignNative = true;
      }
      out[path] = strToU8(text);
    } else if (reduced && slotRemap && lower.endsWith(".config")) {
      out[path] = strToU8(remapSlotRefs(strFromU8(data), slotRemap));
    } else {
      out[path] = data;
    }
  }
  if (target === "u1" && !hadProject) {
    out["Metadata/project_settings.config"] = strToU8(finishConfig(buildU1Config(useColours, useTypes, guardVlh, diff ?? void 0, machine, brand)));
  }
  if (target === "u1" && bandSwapXml) out["Metadata/custom_gcode_per_layer.xml"] = strToU8(bandSwapXml);
  if (target === "u1" && !Object.keys(out).some((p) => /model_settings\.config$/i.test(p))) {
    const mainModel = Object.entries(out).find(
      ([p, d]) => p.toLowerCase().endsWith(".model") && strFromU8(d).includes("<build")
    );
    if (mainModel) {
      const ms = generateOrcaModelSettings(strFromU8(mainModel[1]));
      if (ms) out["Metadata/model_settings.config"] = strToU8(ms);
    }
  }
  const zipped = zipSync(out, { level: 6 });
  return {
    blob: new Blob([zipped.buffer], { type: "model/3mf" }),
    removed,
    kept: Object.keys(out).length,
    // Pass-through keeps every filament, so the U1's 4 heads are not the ceiling here.
    colorsKept: target === "u1" ? keptAll ? colorsTotal : Math.min(useColours.length || 4, 4) : 0,
    colorsTotal,
    over4,
    reduced,
    painted,
    manual,
    preserved: target === "u1" && canPreserve,
    swaps,
    diff
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MACHINES,
  U1,
  cleanThreeMF,
  configFamily,
  dropRangeLayerHeights,
  getMachine,
  normalizeHex,
  u1NozzleVariant
});
