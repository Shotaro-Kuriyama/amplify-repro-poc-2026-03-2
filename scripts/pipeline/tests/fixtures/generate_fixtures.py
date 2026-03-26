#!/usr/bin/env python3
"""
fixture PDF 生成スクリプト

Phase 8A テスト用の小さな fixture PDF を再生成するためのスクリプト。
通常は repo に含まれている PDF をそのまま使えばよいが、
fixture の構造を理解したいときや再生成が必要なときに使う。

使い方:
  cd amplify-mock
  python3 scripts/pipeline/tests/fixtures/generate_fixtures.py

生成される PDF:
  1. line_only_doors_scale_1_50.pdf
     - line ベースの壁（外壁 + 内壁）
     - gap-based opening（壁間のギャップ）が 1 箇所
     - cubic bezier によるドア円弧が 3 本
     - うち 1 本は gap opening と対応 → confidence 0.6
     - うち 2 本は arc-only door → confidence 0.5

  2. walls_only_scale_1_50.pdf
     - rect ベースの壁（外壁 + 内壁）
     - gap なし（すべての壁が閉じている）
     - curve なし
     - opening 0 件、arc 0 件を確認するための fixture

  3. windows_only_scale_1_50.pdf
     - line ベースの壁（外壁 + 内壁）
     - gap なし、arc なし
     - 壁上に窓マーカー rect を配置（横壁上 1 + 縦壁上 1 = 計 2 箇所）
     - type="window" の検出を確認するための fixture

座標系: すべて paper mm (scale 1:50)。PDF 内部では pt (1pt = 1/72 inch = 0.3528mm)。
ページサイズ: A4 横 (297mm x 210mm)
"""

from __future__ import annotations

import math
import os
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF が必要です。pip install PyMuPDF を実行してください。")
    sys.exit(1)

# mm → pt 変換
MM_TO_PT = 1.0 / 0.3528

# quarter-circle bezier の kappa 定数
# cubic bezier で 90° 円弧を近似するための制御点係数
KAPPA = 4.0 * (math.sqrt(2) - 1) / 3.0  # ≈ 0.5523

FIXTURES_DIR = os.path.dirname(os.path.abspath(__file__))


def mm_to_pt(v: float) -> float:
    return v * MM_TO_PT


def draw_line(shape, x1_mm, y1_mm, x2_mm, y2_mm, width_pt=1.0):
    """line を描画する (mm 座標指定)。"""
    p1 = fitz.Point(mm_to_pt(x1_mm), mm_to_pt(y1_mm))
    p2 = fitz.Point(mm_to_pt(x2_mm), mm_to_pt(y2_mm))
    shape.draw_line(p1, p2)
    shape.finish(width=width_pt, color=(0, 0, 0))


def draw_rect_filled(shape, x_mm, y_mm, w_mm, h_mm):
    """塗りつぶし rect を描画する (mm 座標指定)。"""
    r = fitz.Rect(
        mm_to_pt(x_mm), mm_to_pt(y_mm),
        mm_to_pt(x_mm + w_mm), mm_to_pt(y_mm + h_mm),
    )
    shape.draw_rect(r)
    shape.finish(fill=(0, 0, 0), width=0)


def draw_quarter_arc(shape, start_mm, end_mm, width_pt=0.5):
    """
    quarter-circle (90°) の cubic bezier 円弧を描画する。

    start_mm, end_mm: 円弧の始点・終点 (mm)。
    始点→終点が 90° の円弧を描く。制御点は kappa 係数で計算。

    例: 右下方向に開くドア
      start=(cx, cy-r)  →  end=(cx+r, cy)
      → 12時方向から3時方向への円弧
    """
    sx, sy = start_mm
    ex, ey = end_mm

    # 制御点の計算:
    # start → end が 90° 円弧なので、
    # cp1 は start から end 方向に kappa * (弧の半径) だけずらす
    # cp2 は end から start 方向に kappa * (弧の半径) だけずらす
    dx = ex - sx
    dy = ey - sy
    cp1 = (sx + KAPPA * dx, sy + KAPPA * dy)
    # 逆方向: end から start に向かって kappa 分
    cp2 = (ex - KAPPA * dx + KAPPA * dy, ey - KAPPA * dy - KAPPA * dx)

    # 実際には正確な quarter-circle にするため、
    # 始点の接線方向と終点の接線方向から制御点を計算する
    #
    # quarter-circle: center を推定して kappa で計算
    # 2点と90度の制約から center を求める:
    #   |center - start| = |center - end| = radius
    #   center から start/end への角度差が 90°
    #
    # 簡易的に: start と end を直交方向にずらして制御点を作る
    # standard quarter-circle bezier:
    #   P0 = start, P3 = end
    #   P1 = P0 + kappa * tangent_at_start
    #   P2 = P3 - kappa * tangent_at_end

    # 以下は正確な quarter-circle bezier 制御点の計算
    # center of the quarter circle
    # For a quarter circle from P0 to P3, the center is at:
    #   C = P0 + rot90(P3 - P0) where the rotation depends on direction

    # midpoint approach: center = midpoint + perpendicular offset
    mx, my = (sx + ex) / 2, (sy + ey) / 2
    # half-chord perpendicular
    hx, hy = (ex - sx) / 2, (ey - sy) / 2
    # For a quarter circle, the center is at distance r from both points
    # and r = chord / sqrt(2)
    # center offset from midpoint = r - chord/2 in perpendicular direction
    # Actually, for a 90-degree arc: center is at the corner of the
    # bounding square that contains start and end as adjacent corners

    # Determine center based on the arc direction
    # The center should be such that start and end are at 90° angles
    # For a "door swing" arc, the center is where the door hinge is

    # Simple case: if start=(x1,y1), end=(x2,y2), and the arc sweeps 90°,
    # then center is one of two possible points:
    # Option A: cx=x1, cy=y2 (for arcs like top-to-right)
    # Option B: cx=x2, cy=y1 (for arcs like right-to-bottom)
    # We pick based on which makes a valid quarter circle

    # Try both options and pick the one where distances are equal
    ca_x, ca_y = sx, ey  # option A
    cb_x, cb_y = ex, sy  # option B

    da = math.sqrt((sx - ca_x) ** 2 + (sy - ca_y) ** 2)
    db = math.sqrt((sx - cb_x) ** 2 + (sy - cb_y) ** 2)
    da_end = math.sqrt((ex - ca_x) ** 2 + (ey - ca_y) ** 2)
    db_end = math.sqrt((ex - cb_x) ** 2 + (ey - cb_y) ** 2)

    if abs(da - da_end) < 0.1:
        cx, cy = ca_x, ca_y
        r = da
    else:
        cx, cy = cb_x, cb_y
        r = db

    # Now compute bezier control points for quarter circle
    # from start to end around center
    # tangent at start is perpendicular to (start - center), pointing toward end
    t1x, t1y = -(sy - cy), (sx - cx)  # rotate (start-center) by 90°
    t2x, t2y = (ey - cy), -(ex - cx)  # rotate (end-center) by -90° → tangent at end toward start

    # Normalize: tangent length should be kappa * r
    # t1 already has length r (since |start-center| = r), so multiply by kappa
    p1 = fitz.Point(mm_to_pt(sx + KAPPA * t1x), mm_to_pt(sy + KAPPA * t1y))
    p2 = fitz.Point(mm_to_pt(ex + KAPPA * t2x), mm_to_pt(ey + KAPPA * t2y))
    p0 = fitz.Point(mm_to_pt(sx), mm_to_pt(sy))
    p3 = fitz.Point(mm_to_pt(ex), mm_to_pt(ey))

    shape.draw_bezier(p0, p1, p2, p3)
    shape.finish(width=width_pt, color=(0, 0, 0), fill=None)


# ═══════════════════════════════════════════════════════════
# Fixture 1: line_only_doors_scale_1_50.pdf
# ═══════════════════════════════════════════════════════════

def generate_line_only():
    """
    line ベースの壁 + gap opening + door arc を含む fixture。

    構造 (paper mm, scale 1:50):
    ┌─────────────────┬──────────────┐  y=30
    │                 │              │
    │    Room A       │   Room B     │
    │                 │              │
    ├────────┤gap├────┼──────────────┤  y=110
    │                 │       │      │
    │    Room C       │ Rm D  │ Rm E │
    │                 │       │      │
    └─────────────────┴───────┴──────┘  y=190
    x=20           x=150  x=210   x=260

    壁:
    - 外壁 4 辺 (lines, 各 160mm 以上 → 壁候補確定)
    - 内壁: x=150 全高、y=110 左右 (gap あり)、x=210 下半分
    - 壁長は全て min_wall_length (50mm) 以上

    gap:
    - y=110 上の x=72..90 に 18mm gap (= 900mm real → "door")
    - gap の左側壁 52mm、右側壁 60mm → 両方 >= 50mm

    door arcs (quarter circle, radius = 16mm):
    - arc 0: y=110 の gap 付近 → gap opening と対応 (→ confidence 0.6)
    - arc 1: x=150 壁付近, y≈55 → arc-only door (→ confidence 0.5)
    - arc 2: x=210 壁付近, y≈150 → arc-only door (→ confidence 0.5)
    """
    doc = fitz.open()
    # A4 横: 297mm x 210mm
    page = doc.new_page(width=mm_to_pt(297), height=mm_to_pt(210))
    shape = page.new_shape()

    # ── 外壁 (4 辺) ──
    draw_line(shape, 20, 30, 260, 30)      # Top: 240mm
    draw_line(shape, 20, 190, 260, 190)    # Bottom: 240mm
    draw_line(shape, 20, 30, 20, 190)      # Left: 160mm
    draw_line(shape, 260, 30, 260, 190)    # Right: 160mm

    # ── 内壁 ──
    # 縦壁 x=150 (全高)
    draw_line(shape, 150, 30, 150, 190)    # 160mm

    # 横壁 y=110 左側 (gap の左端まで): 52mm ≥ 50mm ✓
    draw_line(shape, 20, 110, 72, 110)
    # gap: x=72 ~ x=90 → 18mm = 900mm real → "door"
    # 横壁 y=110 左中 (gap の右端から中央壁まで): 60mm ≥ 50mm ✓
    draw_line(shape, 90, 110, 150, 110)
    # 横壁 y=110 右側: 110mm
    draw_line(shape, 150, 110, 260, 110)

    # 縦壁 x=210 (下半分): 80mm
    draw_line(shape, 210, 110, 210, 190)

    # ── door arcs (quarter circle, radius=16mm) ──

    # arc 0: gap 付近 → gap opening とマッチ (confidence 0.6 期待)
    # gap center ≈ (81, 110)。arc の start/end/center いずれかが距離 20mm 以内
    # start=(90, 110) は壁端点上、end=(74, 94) は上方向に開く
    draw_quarter_arc(shape, (90, 110), (74, 94))

    # arc 1: x=150 壁付近, y≈55 → arc-only door (gap なし)
    # start=(150, 47) は壁 x=150 上、end=(166, 63) は右下に開く
    draw_quarter_arc(shape, (150, 47), (166, 63))

    # arc 2: x=210 壁付近, y≈150 → arc-only door (gap なし)
    # start=(210, 142) は壁 x=210 上、end=(226, 158) は右下に開く
    draw_quarter_arc(shape, (210, 142), (226, 158))

    shape.commit()

    out_path = os.path.join(FIXTURES_DIR, "line_only_doors_scale_1_50.pdf")
    doc.save(out_path)
    doc.close()
    print(f"Generated: {out_path}")
    return out_path


# ═══════════════════════════════════════════════════════════
# Fixture 2: walls_only_scale_1_50.pdf
# ═══════════════════════════════════════════════════════════

def generate_walls_only():
    """
    rect ベースの壁のみの fixture。gap なし、curve なし。

    構造 (paper mm, scale 1:50):
    ┌────────────────────────────────┐  y=30
    │              │                 │
    │   Room A     │     Room B     │
    │              │                 │
    ├──────────────┼─────────────────┤  y=110
    │              │                 │
    │   Room C     │                 │
    │              │                 │
    └────────────────────────────────┘  y=190
    x=20        x=130            x=260

    壁厚: 2.5mm (= 125mm real, scale 1:50)

    壁はすべて filled rect で描画。gap を作らない。
    """
    doc = fitz.open()
    page = doc.new_page(width=mm_to_pt(297), height=mm_to_pt(210))
    shape = page.new_shape()

    T = 2.5  # 壁厚 mm

    # ── 外壁 (rect) ──
    # Top wall: y=30, 幅=240mm, 厚さ=T
    draw_rect_filled(shape, 20, 30, 240, T)
    # Bottom wall: y=190-T
    draw_rect_filled(shape, 20, 190 - T, 240, T)
    # Left wall: x=20
    draw_rect_filled(shape, 20, 30, T, 160)
    # Right wall: x=260-T
    draw_rect_filled(shape, 260 - T, 30, T, 160)

    # ── 内壁 (rect) ──
    # 縦壁 x=130 (全高)
    draw_rect_filled(shape, 130, 30, T, 160)
    # 横壁 y=110 (全幅)
    draw_rect_filled(shape, 20, 110, 240, T)

    shape.commit()

    out_path = os.path.join(FIXTURES_DIR, "walls_only_scale_1_50.pdf")
    doc.save(out_path)
    doc.close()
    print(f"Generated: {out_path}")
    return out_path


# ═══════════════════════════════════════════════════════════
# Fixture 3: windows_only_scale_1_50.pdf
# ═══════════════════════════════════════════════════════════

def generate_windows_only():
    """
    line ベースの壁 + 窓マーカー rect の fixture。gap なし、arc なし。

    構造 (paper mm, scale 1:50):
    ┌────────────────────────────────┐  y=30
    │                               │
    │         [win1]                │  win1: 横壁 y=30 上の rect
    │                               │
    │                               │
    │              ┌────────────────┤  y=110
    │              │  [win2]        │  win2: 縦壁 x=150 上の rect
    │              │                │
    │              │                │
    └──────────────┴────────────────┘  y=190
    x=20        x=150            x=260

    壁:
    - 外壁 4 辺 (lines)
    - 内壁: x=150 下半分、y=110 右側

    窓マーカー (filled rect):
    - win1: 横壁 y=30 上に、幅 20mm (= 1000mm real) の細い rect
    - win2: 縦壁 x=150 上に、幅 16mm (= 800mm real) の細い rect
    """
    doc = fitz.open()
    page = doc.new_page(width=mm_to_pt(297), height=mm_to_pt(210))
    shape = page.new_shape()

    # ── 壁 (line) ──
    draw_line(shape, 20, 30, 260, 30)      # Top: 240mm
    draw_line(shape, 20, 190, 260, 190)    # Bottom: 240mm
    draw_line(shape, 20, 30, 20, 190)      # Left: 160mm
    draw_line(shape, 260, 30, 260, 190)    # Right: 160mm
    draw_line(shape, 150, 110, 150, 190)   # Inner vertical: 80mm
    draw_line(shape, 150, 110, 260, 110)   # Inner horizontal: 110mm

    # ── 窓マーカー (filled rect) ──
    # win1: 横壁 y=30 上、x=80 付近、幅 20mm (= 1000mm real)
    # rect: 薄い水平 rect (幅 20mm × 高さ 2mm)、壁 y=30 に密着
    draw_rect_filled(shape, 80, 29, 20, 2)

    # win2: 縦壁 x=150 上、y=140 付近、幅 16mm (= 800mm real)
    # rect: 薄い垂直 rect (幅 2mm × 高さ 16mm)、壁 x=150 に密着
    draw_rect_filled(shape, 149, 140, 2, 16)

    shape.commit()

    out_path = os.path.join(FIXTURES_DIR, "windows_only_scale_1_50.pdf")
    doc.save(out_path)
    doc.close()
    print(f"Generated: {out_path}")
    return out_path


# ═══════════════════════════════════════════════════════════
# メイン
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Generating fixture PDFs...")
    generate_line_only()
    generate_walls_only()
    generate_windows_only()
    print("Done.")
