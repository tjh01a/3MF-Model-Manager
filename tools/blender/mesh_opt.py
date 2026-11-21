# -*- coding: utf-8 -*-
"""
PrintShelf · Blender 无头网格优化引擎
=====================================

调用方式（本机 Blender 5.3.0 实测）：
    blender.exe --background --factory-startup --python mesh_opt.py -- \
        inputDir=<dir> outputDir=<dir> preset=<gentle|standard|strong|voxel> \
        parts=<int> report=<json路径> [voxel=<float>]

设计要点
--------
* Blender 没有 3MF 导入器：每个部件由 Node 层单独导出成 PLY，本脚本逐件
  「导入 -> 优化 -> 导出 -> 删除」，Node 层再读回坐标写回 3MF。
* gentle/standard/strong 用 SMOOTH 修改器：它只移动顶点，不改变顶点数、
  顶点顺序、三角面索引，因此输出 PLY 可与输入顶点表一一对应写回。
  voxel 档会改变拓扑（顶点/面数如实写进报告），无法逐顶点写回。
* 每完成一件打印 `PROGRESS <i>/<N> <文件名>`（flush=True）供 Node 解析进度；
  出错打印 `ERROR <message>` 并以非零退出码结束。
  注意：Blender 会吞掉顶层未捕获异常、进程仍返回 0，因此错误必须主动
  sys.exit(1)（见 die() 与本文件末尾的兜底捕获）。
"""

import bpy
import json
import os
import sys
import time


# 预设参数映射。SMOOTH 档的 factor / iterations 见各档；
# voxel 档不使用修改器，改走 bpy.ops.object.voxel_remesh()。
PRESETS = {
    "gentle":   {"kind": "smooth", "factor": 0.3, "iterations": 4},
    "standard": {"kind": "smooth", "factor": 0.6, "iterations": 8},
    "strong":   {"kind": "smooth", "factor": 0.8, "iterations": 12},
    "voxel":    {"kind": "voxel"},
}


def die(message):
    """统一错误出口：打印 ERROR 行并以非零退出码结束，供 Node 侧解析。"""
    print("ERROR %s" % message, flush=True)
    # Blender 5.3.0 实测：sys.exit(n) 会把退出码 n 正确传给操作系统；
    # 而让异常冒到顶层会被 Blender 吞掉、进程仍返回 0，故必须显式退出。
    sys.exit(1)


def parse_args():
    """解析 '--' 之后的 key=value 参数（Blender 把脚本参数原样放进 sys.argv）。"""
    if "--" not in sys.argv:
        die("缺少 '--' 参数分隔符")
    tokens = sys.argv[sys.argv.index("--") + 1:]
    args = {}
    for token in tokens:
        if "=" in token:
            key, value = token.split("=", 1)
            args[key] = value
    return args


def main():
    t_start = time.time()
    args = parse_args()

    # ---------- 参数校验 ----------
    for key in ("inputDir", "outputDir", "preset", "parts", "report"):
        if not args.get(key):
            die("缺少必需参数 %s" % key)

    input_dir = args["inputDir"]
    output_dir = args["outputDir"]
    preset = args["preset"]
    report_path = args["report"]

    if preset not in PRESETS:
        die("未知 preset '%s'（可选 gentle/standard/strong/voxel）" % preset)
    try:
        n_parts = int(args["parts"])
    except ValueError:
        die("parts 不是整数: %s" % args["parts"])
    if n_parts <= 0:
        die("parts 必须为正整数，收到 %d" % n_parts)

    if not os.path.isdir(input_dir):
        die("inputDir 不存在或不是目录: %s" % input_dir)
    try:
        os.makedirs(output_dir, exist_ok=True)
    except OSError as exc:
        die("无法创建 outputDir %s: %s" % (output_dir, exc))

    # voxel 档可选参数，默认 0.25；其它档忽略此参数。
    voxel_size = 0.25
    if PRESETS[preset]["kind"] == "voxel":
        try:
            voxel_size = float(args.get("voxel", "0.25"))
        except (TypeError, ValueError):
            die("voxel 不是合法浮点数: %s" % args.get("voxel"))
        if voxel_size <= 0:
            die("voxel 必须为正数，收到 %s" % voxel_size)

    # ---------- 输入文件清单（按文件名排序，与 3MF 部件顺序对应）----------
    try:
        entries = os.listdir(input_dir)
    except OSError as exc:
        die("无法读取 inputDir %s: %s" % (input_dir, exc))
    src_files = sorted(
        name for name in entries
        if name.lower().endswith(".ply")
        and os.path.isfile(os.path.join(input_dir, name))
    )
    if len(src_files) < n_parts:
        die("inputDir 中 PLY 数量不足：parts=%d，实际找到 %d 个（%s）"
            % (n_parts, len(src_files), input_dir))
    src_files = src_files[:n_parts]

    # ---------- 初始化干净场景 ----------
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cfg = PRESETS[preset]

    parts_report = []
    for index, filename in enumerate(src_files, start=1):
        t0 = time.time()
        src_path = os.path.join(input_dir, filename)
        dst_path = os.path.join(output_dir, filename)  # 输出同名 PLY

        # 导入前再确认一次文件存在（缺文件 -> ERROR 退出）
        if not os.path.isfile(src_path):
            die("找不到输入文件: %s" % src_path)

        # 逐件导入。显式固定三个关键项：
        #   merge_verts=False   -> 禁止合并重复顶点，保证顶点数/顺序不变
        #   forward_axis/up_axis-> 与导出的轴设置一致，保证坐标原样往返（不旋转）
        #   global_scale=1.0    -> 不缩放
        try:
            bpy.ops.wm.ply_import(
                filepath=src_path,
                merge_verts=False,
                forward_axis="Y",
                up_axis="Z",
                global_scale=1.0,
            )
        except Exception as exc:
            die("导入 PLY 失败 %s: %s" % (filename, exc))

        # 场景在上一轮已被清空，此时网格对象即当前这一件
        objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        if not objs:
            die("导入后未找到网格对象: %s" % filename)

        in_v = sum(len(o.data.vertices) for o in objs)
        in_f = sum(len(o.data.polygons) for o in objs)

        # 应用修改器前：设定活动对象，并确保处于 OBJECT 模式
        bpy.context.view_layer.objects.active = objs[0]
        if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        # 导出前只选中当前件（全部新导入对象），取消其它选择
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)

        # ---------- 应用优化 ----------
        if cfg["kind"] == "smooth":
            # SMOOTH：仅移动顶点，不改拓扑，输出可与输入逐顶点对应写回 3MF
            for o in objs:
                bpy.context.view_layer.objects.active = o
                mod = o.modifiers.new(name="PrintShelfSmooth", type="SMOOTH")
                mod.factor = cfg["factor"]
                mod.iterations = cfg["iterations"]
                bpy.ops.object.modifier_apply(modifier=mod.name)
        else:
            # VOXEL：原地体素重网格，拓扑会变化
            for o in objs:
                bpy.context.view_layer.objects.active = o
                o.data.remesh_voxel_size = voxel_size
                o.data.remesh_voxel_adaptivity = 0.0
                bpy.ops.object.voxel_remesh()

        out_v = sum(len(o.data.vertices) for o in objs)
        out_f = sum(len(o.data.polygons) for o in objs)

        # ---------- 导出 ----------
        # 导出前再次确认选中集合（个别算子可能改动选择状态）
        for o in objs:
            o.select_set(True)
        # export_selected_objects=True : 只写选中的当前件
        # apply_modifiers=True         : 与调用约定一致（修改器已 apply，此处幂等）
        # ascii_format=False           : 强制 binary_little_endian
        # forward_axis/up_axis 与导入一致: 保证坐标原样往返
        bpy.ops.wm.ply_export(
            filepath=dst_path,
            export_selected_objects=True,
            apply_modifiers=True,
            ascii_format=False,
            forward_axis="Y",
            up_axis="Z",
            global_scale=1.0,
        )

        # ---------- 删除本件，控制内存，保证下一件从空场景开始 ----------
        for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
            bpy.data.objects.remove(o, do_unlink=True)
        for mesh in list(bpy.data.meshes):
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)

        parts_report.append({
            "file": filename,
            "inV": in_v,
            "inF": in_f,
            "outV": out_v,
            "outF": out_f,
            "seconds": round(time.time() - t0, 3),
        })
        print("PROGRESS %d/%d %s" % (index, n_parts, filename), flush=True)

    # ---------- 写报告 ----------
    report = {
        "ok": True,
        "preset": preset,
        "parts": parts_report,
        "seconds": round(time.time() - t_start, 3),
    }
    try:
        report_dir = os.path.dirname(os.path.abspath(report_path))
        if report_dir:
            os.makedirs(report_dir, exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as fp:
            json.dump(report, fp, ensure_ascii=False)
    except OSError as exc:
        die("写报告失败 %s: %s" % (report_path, exc))

    print("DONE %d parts, %.3fs" % (n_parts, report["seconds"]), flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise  # die() 已打印 ERROR，保留其非零退出码
    except Exception as exc:
        # Blender 会吞掉顶层异常并返回退出码 0，故必须捕获后显式非零退出
        print("ERROR 未捕获异常 %s: %s" % (type(exc).__name__, exc), flush=True)
        sys.exit(1)
