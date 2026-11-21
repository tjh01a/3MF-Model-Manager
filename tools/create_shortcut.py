"""在桌面创建带图标的 PrintShelf 快捷方式（双击即开，无黑框）。

优先使用 Windows 原生 IShellLinkW / IPersistFile（ctypes 直调，不依赖
WScript.Shell、pywin32 或 PowerShell）；若 COM 不可用则回退到手工构造
Shell Link 二进制。可重复运行，结果幂等。
"""
from __future__ import annotations

import ctypes
import os
import struct
import sys
import winreg
from ctypes import POINTER, WINFUNCTYPE, byref, c_int, c_long, c_ulong, c_void_p, c_wchar_p, wintypes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ELECTRON = os.path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
ICON = os.path.join(ROOT, 'resources', 'app.ico')
LNK_NAME = 'PrintShelf.lnk'
DESC = 'PrintShelf · 本地 3MF 模型库'


def desktop_dir() -> str:
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders')
        raw = winreg.QueryValueEx(key, 'Desktop')[0]
        path = os.path.expandvars(raw)
        if os.path.isdir(path):
            return path
    except Exception:
        pass
    return os.path.join(os.environ['USERPROFILE'], 'Desktop')


class GUID(ctypes.Structure):
    _fields_ = [('Data1', wintypes.DWORD),
                ('Data2', wintypes.WORD),
                ('Data3', wintypes.WORD),
                ('Data4', ctypes.c_ubyte * 8)]


def guid(d1, d2, d3, d4):
    return GUID(d1, d2, d3, (ctypes.c_ubyte * 8)(*d4))


CLSID_SHELL_LINK = guid(0x00021401, 0, 0, (0xC0, 0, 0, 0, 0, 0, 0, 0x46))
IID_ISHELL_LINK_W = guid(0x000214F9, 0, 0, (0xC0, 0, 0, 0, 0, 0, 0, 0x46))
IID_IPERSIST_FILE = guid(0x0000010B, 0, 0, (0xC0, 0, 0, 0, 0, 0, 0, 0x46))

# IShellLinkW vtable 索引
SET_PATH, SET_ARGS, SET_WORKDIR = 20, 11, 9
SET_ICON, SET_DESC, SET_SHOWCMD = 17, 7, 15


def _vtable(obj):
    return ctypes.cast(obj, POINTER(POINTER(c_void_p))).contents


def _check(hr, what):
    if hr != 0:
        raise RuntimeError('%s 失败，HRESULT=0x%08X' % (what, hr & 0xFFFFFFFF))


def create_via_com(lnk: str) -> dict:
    ole32 = ctypes.windll.ole32
    ole32.CoInitializeEx.argtypes = [c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = c_long
    ole32.CoCreateInstance.argtypes = [POINTER(GUID), c_void_p, wintypes.DWORD,
                                       POINTER(GUID), POINTER(c_void_p)]
    ole32.CoCreateInstance.restype = c_long

    hr = ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED
    if hr not in (0, 0x80010106):  # S_OK / RPC_E_CHANGED_MODE
        _check(hr, 'CoInitializeEx')

    link = c_void_p()
    _check(ole32.CoCreateInstance(byref(CLSID_SHELL_LINK), None, 1,
                                  byref(IID_ISHELL_LINK_W), byref(link)),
           'CoCreateInstance(ShellLink)')
    vt = _vtable(link)

    def method(idx, restype, *argtypes):
        return WINFUNCTYPE(restype, c_void_p, *argtypes)(vt[idx])

    _check(method(SET_PATH, c_long, c_wchar_p)(link, ELECTRON), 'SetPath')
    _check(method(SET_ARGS, c_long, c_wchar_p)(link, '"%s"' % ROOT), 'SetArguments')
    _check(method(SET_WORKDIR, c_long, c_wchar_p)(link, ROOT), 'SetWorkingDirectory')
    _check(method(SET_ICON, c_long, c_wchar_p, c_int)(link, ICON, 0), 'SetIconLocation')
    _check(method(SET_DESC, c_long, c_wchar_p)(link, DESC), 'SetDescription')
    _check(method(SET_SHOWCMD, c_long, c_int)(link, 1), 'SetShowCmd')

    qi = WINFUNCTYPE(c_long, c_void_p, POINTER(GUID), POINTER(c_void_p))(vt[0])
    persist = c_void_p()
    _check(qi(link, byref(IID_IPERSIST_FILE), byref(persist)), 'QueryInterface(IPersistFile)')
    pvt = _vtable(persist)
    save = WINFUNCTYPE(c_long, c_void_p, c_wchar_p, wintypes.BOOL)(pvt[6])
    _check(save(persist, lnk, True), 'Save')

    release_p = WINFUNCTYPE(c_ulong, c_void_p)(pvt[2])
    release_l = WINFUNCTYPE(c_ulong, c_void_p)(vt[2])
    release_p(persist)
    release_l(link)

    return {'method': 'IShellLinkW (COM)'}


def _unicode_string(text: str) -> bytes:
    data = text.encode('utf-16-le')
    return struct.pack('<H', len(text)) + data


def create_via_binary(lnk: str) -> dict:
    """手工构造 Shell Link（无 IDList，含 LinkInfo + Unicode 路径 + StringData）。"""
    HAS_LINK_INFO, HAS_NAME = 0x02, 0x04
    HAS_WORKDIR, HAS_ARGS, HAS_ICON, IS_UNICODE = 0x10, 0x20, 0x40, 0x80
    flags = HAS_LINK_INFO | HAS_NAME | HAS_WORKDIR | HAS_ARGS | HAS_ICON | IS_UNICODE

    clsid = bytes.fromhex('0114020000000000c000000000000046')
    header = struct.pack('<I16sIIQQQIIIHHII',
                         0x4C, clsid, flags, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0)

    target = ELECTRON
    ansi = lambda s: s.encode('mbcs', 'replace') + b'\x00'

    # VolumeID：固定盘 + 空卷标
    label = b'\x00'
    volume = struct.pack('<IIII', 16 + len(label), 3, 0, 0x10) + label

    local_ansi = ansi(target)
    suffix_ansi = b'\x00'
    local_uni = target.encode('utf-16-le') + b'\x00\x00'
    suffix_uni = b'\x00\x00'

    hdr_size = 0x24
    volume_off = hdr_size
    local_off = volume_off + len(volume)
    suffix_off = local_off + len(local_ansi)
    local_uni_off = suffix_off + len(suffix_ansi)
    suffix_uni_off = local_uni_off + len(local_uni)
    total = suffix_uni_off + len(suffix_uni)

    link_info = struct.pack('<IIIIIIII',
                            total, hdr_size, 1, volume_off, local_off, 0,
                            suffix_off, local_uni_off) + struct.pack('<I', suffix_uni_off)
    link_info += volume + local_ansi + suffix_ansi + local_uni + suffix_uni
    assert len(link_info) == total, (len(link_info), total)

    string_data = (_unicode_string(DESC) + _unicode_string(ROOT) +
                   _unicode_string('"%s"' % ROOT) + _unicode_string(ICON))
    terminal = struct.pack('<I', 0)

    with open(lnk, 'wb') as f:
        f.write(header + link_info + string_data + terminal)
    return {'method': 'manual ShellLink binary'}


def main():
    for p in (ELECTRON, ICON):
        if not os.path.isfile(p):
            print('缺少文件：', p)
            print('请先运行 npm install 与 python tools/make_icon.py')
            return 1

    d = desktop_dir()
    lnk = os.path.join(d, LNK_NAME)
    info = None
    try:
        info = create_via_com(lnk)
    except Exception as e:
        print('COM 方式不可用，改用二进制构造：', e)
        info = create_via_binary(lnk)

    ok = os.path.isfile(lnk) and os.path.getsize(lnk) > 100
    print('桌面目录 :', d)
    print('快捷方式 :', lnk)
    print('创建方式 :', info.get('method'))
    print('目标     :', ELECTRON)
    print('参数     :', '"%s"' % ROOT)
    print('图标     :', ICON)
    print('大小     :', os.path.getsize(lnk) if os.path.isfile(lnk) else 0, 'bytes')
    print('RESULT   :', 'OK' if ok else 'FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
