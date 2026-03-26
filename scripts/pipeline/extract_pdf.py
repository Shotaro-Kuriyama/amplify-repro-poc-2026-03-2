#!/usr/bin/env python3
"""
Phase 8A: 最小 PDF 処理スクリプト

プロトコル:
- stdin から PipelineInput JSON を受け取る
- PDF を読み取り、最小の構造化データを抽出する
- stdout に PipelineOutput JSON を出力する

現時点の処理内容:
- ページ数、ページサイズの取得
- テキスト抽出（取れれば）
- drawing 情報から線分を抽出し、最小ルールで壁候補を推定
- 壁候補間のギャップ + 円弧パターンから開口部候補を暫定推定（Phase 8A 暫定）

使用ライブラリ: PyMuPDF (fitz)
  pip install PyMuPDF
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print(
        json.dumps(
            {
                "jobId": "",
                "success": False,
                "floors": [],
                "artifacts": [],
                "error": {
                    "code": "DEPENDENCY_MISSING",
                    "message": "PyMuPDF がインストールされていません。pip install PyMuPDF を実行してください。",
                    "failedAt": "initialization",
                },
                "stats": {
                    "durationMs": 0,
                    "totalWalls": 0,
                    "totalOpenings": 0,
                    "totalRooms": 0,
                },
            }
        )
    )
    sys.exit(0)  # エラーだが JSON で返すので exit code は 0


# ═══════════════════════════════════════════════════════════
# 線分抽出・壁候補推定（Phase 8A 後半 — 暫定ルールベース）
#
# 【単位系】
#   PDF 内部: ポイント (pt)。1pt = 1/72 inch = 0.3528mm
#   出力 (ExtractedWall): すべて mm 単位
#
# 【抽出対象】
#   - "l" (line): 直線 → そのまま線分として扱う
#   - "re" (rect): 矩形 → 4辺に分解して線分として扱う
#   - "c" (curve/bezier): 壁候補には使わないが、ドア円弧の検出に使用
#   ※ "qu" (quad) 等は今回は無視
#
# 【壁候補の判定ルール（暫定）】
#   - 長さが MIN_WALL_LENGTH_MM (50mm) 以上
#   - 水平または垂直に近い（水平/垂直からの角度差が MAX_ANGLE_DEV_DEG (5°) 以内）
#   - ページ全体の背景矩形は除外する
#
# 【thickness の推定ルール（暫定）】
#   優先順位: rect 短辺 > line stroke width > 近傍 rect 代表値 > fallback
#   - rect: 短辺 <= MAX_RECT_THICKNESS_MM なら壁厚として信頼する
#           短辺 > MAX_RECT_THICKNESS_MM なら部屋形状とみなし fallback
#   - line: stroke width >= 1mm なら参考情報として使う (line_stroke)
#           < 1mm なら fallback
#   - refinement: fallback の wall は、同一ページの rect 由来厚みの中央値で補完する
#   - それでも情報がなければ FALLBACK_THICKNESS_MM (5mm) を使う
#
# 【confidence の扱い】
#   - 固定値 0.5（暫定）。長さや角度に応じた重み付けは将来対応
#
# このルールは暫定的なものであり、高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════

PT_TO_MM = 0.3528

# ── scale 非依存の定数 ──
MAX_ANGLE_DEV_DEG = 5.0       # 水平/垂直からの許容角度差（度）
DEFAULT_CONFIDENCE = 0.5      # 壁候補の暫定 confidence
OPENING_CONFIDENCE = 0.4      # gap-only 開口部の暫定 confidence
ARC_DOOR_CONFIDENCE = 0.6     # arc 根拠ありの door confidence
ARC_ONLY_DOOR_CONFIDENCE = 0.5  # arc のみ (gap なし) の door confidence
ARC_ASPECT_MIN = 0.7          # quarter-circle 判定の最小アスペクト比
ARC_ASPECT_MAX = 1.4          # quarter-circle 判定の最大アスペクト比
WINDOW_CONFIDENCE = 0.35      # window 候補の暫定 confidence

# ═══════════════════════════════════════════════════════════
# scale-aware しきい値（Phase 8A 暫定）
#
# 【方針】
# 各種しきい値は **実寸 mm** で定義し、scale に応じて paper mm に換算する。
# paper_mm = real_mm / scale
#
# 基準値は現在の scale=50 での挙動から逆算:
#   現在の paper mm × 50 = 実寸 mm
#
# 例: MIN_WALL_LENGTH_MM = 50 paper mm (scale=50) = 2500mm 実寸
#     → scale=100 なら 2500/100 = 25 paper mm
#
# 【thickness 推定の優先順位（暫定）】
#   1. "rect" — 矩形の短辺 (<= max_rect_thickness)
#   2. "line_stroke" — PDF の stroke width (>= 1mm)
#   3. "nearby_rect" — 同一ページ内の rect 由来代表値
#   4. "fallback" — デフォルト壁厚
#
# これらは暫定ルール。高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════

# 実寸 mm ベースの基準値。derive_thresholds(scale) で paper mm に換算する。
_REAL_MM_BASES: dict[str, float] = {
    # ── 壁候補 ──
    "min_wall_length": 2500.0,           # 壁として認識する最小長さ
    "max_rect_thickness": 1000.0,        # rect 短辺をこれ以下なら壁厚として信頼
    "fallback_thickness": 250.0,         # 壁厚の手がかりがない場合のデフォルト
    # ── 重複除去 / マージ ──
    "dedup_tolerance": 100.0,            # 同一 wall とみなす端点距離
    "collinear_tolerance": 150.0,        # 同一直線上とみなす垂直距離
    "merge_gap": 250.0,                  # マージ対象とする端点間ギャップ
    # ── 開口部 ──
    "min_opening_width": 400.0,          # opening 候補の最小幅
    "max_opening_width": 2000.0,         # opening 候補の最大幅
    "door_threshold": 700.0,             # これ以上の幅を "door" 寄り
    "opening_collinear_tolerance": 75.0, # opening 検出用の同一直線判定
    "default_opening_height": 250.0,     # opening height の仮値
    # ── 円弧 / ドア ──
    "min_arc_radius": 400.0,             # door arc 候補の最小半径
    "max_arc_radius": 1500.0,            # door arc 候補の最大半径
    "arc_match_distance": 1000.0,        # arc-opening を結びつける最大距離
    "arc_wall_distance": 250.0,          # arc 端点が壁線上にあると判定する距離
    # ── 窓 ──
    "min_window_width": 500.0,           # window 候補の最小幅（= rect 長辺）
    "max_window_width": 1800.0,          # window 候補の最大幅
    "max_window_marker_thickness": 200.0,  # window marker rect の短辺上限
    "window_wall_distance": 150.0,       # rect 中心から壁線までの最大距離
    "window_dedup_distance": 300.0,      # door/window 重複除去の距離
}


def derive_thresholds(scale: int | float) -> dict[str, float]:
    """
    scale から paper mm のしきい値を導出する。

    paper_mm = real_mm / scale
    scale=50 のとき、Phase 8A の従来固定値とほぼ一致する。

    >>> t = derive_thresholds(50)
    >>> t["min_wall_length"]
    50.0
    >>> t["door_threshold"]
    14.0
    >>> t = derive_thresholds(100)
    >>> t["min_wall_length"]
    25.0
    """
    if scale <= 0:
        scale = 50  # 安全策: 不正な scale は 50 にフォールバック
    return {k: round(v / scale, 2) for k, v in _REAL_MM_BASES.items()}


def _extract_line_segments(page, th: dict[str, float]) -> list[dict]:
    """
    page.get_drawings() から線分候補を抽出する。

    th: derive_thresholds() の返り値。
    """
    page_rect = page.rect
    page_w_pt = page_rect.width
    page_h_pt = page_rect.height

    fallback_t = th["fallback_thickness"]
    max_rect_t = th["max_rect_thickness"]

    segments = []
    drawings = page.get_drawings()

    for d in drawings:
        for item in d["items"]:
            item_type = item[0]

            if item_type == "l":
                p1, p2 = item[1], item[2]
                stroke_w = d.get("width") or 0
                stroke_mm = stroke_w * PT_TO_MM if stroke_w > 0 else 0
                if stroke_mm >= 1.0:
                    thickness_mm = stroke_mm
                    thickness_source = "line_stroke"
                else:
                    thickness_mm = fallback_t
                    thickness_source = "fallback"
                segments.append({
                    "x1": p1.x * PT_TO_MM, "y1": p1.y * PT_TO_MM,
                    "x2": p2.x * PT_TO_MM, "y2": p2.y * PT_TO_MM,
                    "thickness_mm": round(thickness_mm, 1),
                    "source_type": "line",
                    "thickness_source": thickness_source,
                })

            elif item_type == "re":
                r = item[1]
                if (abs(r.width) > page_w_pt * 0.95
                        and abs(r.height) > page_h_pt * 0.95):
                    continue

                w_mm = abs(r.width) * PT_TO_MM
                h_mm = abs(r.height) * PT_TO_MM
                is_horizontal = w_mm >= h_mm
                short_side_mm = h_mm if is_horizontal else w_mm

                if short_side_mm <= max_rect_t:
                    thickness_mm = short_side_mm
                    thickness_source = "rect"
                else:
                    thickness_mm = fallback_t
                    thickness_source = "fallback"

                x0, y0 = r.x0 * PT_TO_MM, r.y0 * PT_TO_MM
                x1, y1 = r.x1 * PT_TO_MM, r.y1 * PT_TO_MM
                rect_edges = [
                    (x0, y0, x1, y0),
                    (x1, y0, x1, y1),
                    (x1, y1, x0, y1),
                    (x0, y1, x0, y0),
                ]
                for ex1, ey1, ex2, ey2 in rect_edges:
                    segments.append({
                        "x1": ex1, "y1": ey1,
                        "x2": ex2, "y2": ey2,
                        "thickness_mm": round(thickness_mm, 1),
                        "source_type": "rect",
                        "thickness_source": thickness_source,
                    })

    return segments


def _is_near_axis_aligned(x1: float, y1: float, x2: float, y2: float) -> bool:
    """線分が水平または垂直に近いかどうかを判定する。"""
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return False
    angle_rad = math.atan2(abs(dy), abs(dx))
    angle_deg = math.degrees(angle_rad)
    # 水平に近い (0° ± MAX_ANGLE_DEV_DEG) or 垂直に近い (90° ± MAX_ANGLE_DEV_DEG)
    return angle_deg <= MAX_ANGLE_DEV_DEG or angle_deg >= (90 - MAX_ANGLE_DEV_DEG)


def _segment_length(seg: dict) -> float:
    """線分の長さ (mm) を返す。"""
    dx = seg["x2"] - seg["x1"]
    dy = seg["y2"] - seg["y1"]
    return math.sqrt(dx * dx + dy * dy)


def _extract_raw_walls(page, th: dict[str, float]) -> list[dict]:
    """
    drawing 情報から壁候補を抽出する（正規化・重複除去前の raw データ）。
    """
    segments = _extract_line_segments(page, th)
    walls = []
    min_len = th["min_wall_length"]

    for seg in segments:
        length = _segment_length(seg)
        if length < min_len:
            continue
        if not _is_near_axis_aligned(seg["x1"], seg["y1"], seg["x2"], seg["y2"]):
            continue

        walls.append({
            "startX": round(seg["x1"], 1),
            "startY": round(seg["y1"], 1),
            "endX": round(seg["x2"], 1),
            "endY": round(seg["y2"], 1),
            "thickness": round(seg["thickness_mm"], 1),
            "confidence": DEFAULT_CONFIDENCE,
            # 内部用: thickness の推定ソース (最終出力前に除去)
            "_thickness_source": seg["thickness_source"],
        })

    return walls


# ═══════════════════════════════════════════════════════════
# thickness の補完（Phase 8A 継続 — 暫定ルールベース）
#
# fallback のまま残っている wall の thickness を、
# 同一ページ内の rect 由来情報で補完する。
# ═══════════════════════════════════════════════════════════


def _refine_thickness(walls: list[dict]) -> list[dict]:
    """
    fallback thickness を、同一ページ内の rect 由来厚みの代表値で補完する。

    - rect 由来 (_thickness_source == "rect") の thickness 値を収集する
    - その中央値を「このページの代表的な壁厚」として使う
    - fallback の wall にこの代表値を割り当て、source を "nearby_rect" に更新する
    - rect 由来の厚みが 1 つもなければ、FALLBACK_THICKNESS_MM のまま残す
    """
    # rect 由来の thickness を収集
    rect_thicknesses = [
        w["thickness"] for w in walls if w.get("_thickness_source") == "rect"
    ]

    if not rect_thicknesses:
        # rect 由来の情報がない → 補完できないのでそのまま返す
        return walls

    # 代表値として中央値を採用
    rect_thicknesses_sorted = sorted(rect_thicknesses)
    n = len(rect_thicknesses_sorted)
    if n % 2 == 1:
        median_thickness = rect_thicknesses_sorted[n // 2]
    else:
        median_thickness = (rect_thicknesses_sorted[n // 2 - 1] + rect_thicknesses_sorted[n // 2]) / 2
    median_thickness = round(median_thickness, 1)

    # fallback の wall を補完
    for w in walls:
        if w.get("_thickness_source") == "fallback":
            w["thickness"] = median_thickness
            w["_thickness_source"] = "nearby_rect"

    return walls


# thickness source の信頼度順序 (数値が大きいほど信頼度が高い)
_THICKNESS_RELIABILITY = {
    "rect": 3,
    "nearby_rect": 2,
    "line_stroke": 1,
    "fallback": 0,
}


def _pick_better_thickness(wall_a: dict, wall_b: dict) -> tuple[float, str]:
    """
    2 つの wall から、より信頼度の高い thickness を選ぶ。

    同じ信頼度の場合は thickness が大きい方を採用する。
    返り値は (thickness, source) のタプル。
    """
    src_a = wall_a.get("_thickness_source", "fallback")
    src_b = wall_b.get("_thickness_source", "fallback")
    rel_a = _THICKNESS_RELIABILITY.get(src_a, 0)
    rel_b = _THICKNESS_RELIABILITY.get(src_b, 0)

    if rel_a > rel_b:
        return wall_a["thickness"], src_a
    elif rel_b > rel_a:
        return wall_b["thickness"], src_b
    else:
        # 同じ信頼度 → 大きい方
        if wall_a["thickness"] >= wall_b["thickness"]:
            return wall_a["thickness"], src_a
        else:
            return wall_b["thickness"], src_b


# ═══════════════════════════════════════════════════════════
# 壁候補の正規化・重複除去・マージ（Phase 8A 継続 — 暫定ルールベース）
#
# 処理パイプライン:
#   raw walls → 正規化 → thickness 補完 → 重複除去 → 同一直線上マージ → id 振り直し
#
# 【正規化】
#   水平線: startX <= endX に統一
#   垂直線: startY <= endY に統一
#   → 方向の違いによる重複判定漏れを防ぐ
#
# 【重複除去】
#   始点・終点がともに DEDUP_TOLERANCE_MM (2mm) 以内の wall を同一とみなす
#   重複時は thickness が大きい方を残す（より信頼性が高い壁厚情報を優先）
#
# 【同一直線上マージ】
#   水平線同士/垂直線同士で:
#   - 垂直方向の座標差が COLLINEAR_TOLERANCE_MM (3mm) 以内
#   - 端点間のギャップが MERGE_GAP_MM (5mm) 以内、または重なっている
#   場合に 1 本にまとめる
#   thickness は最大値を採用、confidence は固定値のまま
#
# これらの閾値は暫定的なもの。高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════


def _is_horizontal(wall: dict) -> bool:
    """wall が水平方向かどうかを判定する。"""
    return abs(wall["endX"] - wall["startX"]) >= abs(wall["endY"] - wall["startY"])


def _normalize_walls(walls: list[dict]) -> list[dict]:
    """
    壁候補の方向を正規化する。

    水平線: startX <= endX に統一
    垂直線: startY <= endY に統一
    """
    result = []
    for w in walls:
        if _is_horizontal(w):
            if w["startX"] > w["endX"]:
                w = {**w, "startX": w["endX"], "startY": w["endY"],
                     "endX": w["startX"], "endY": w["startY"]}
        else:
            if w["startY"] > w["endY"]:
                w = {**w, "startX": w["endX"], "startY": w["endY"],
                     "endX": w["startX"], "endY": w["startY"]}
        result.append(w)
    return result


def _deduplicate_walls(walls: list[dict], th: dict[str, float]) -> list[dict]:
    """
    ほぼ同一の壁候補を除去する。
    """
    tol = th["dedup_tolerance"]
    result: list[dict] = []
    for wall in walls:
        dup_idx = None
        for i, existing in enumerate(result):
            if (abs(wall["startX"] - existing["startX"]) <= tol
                    and abs(wall["startY"] - existing["startY"]) <= tol
                    and abs(wall["endX"] - existing["endX"]) <= tol
                    and abs(wall["endY"] - existing["endY"]) <= tol):
                dup_idx = i
                break
        if dup_idx is not None:
            # 重複 → 信頼度の高い thickness を採用
            better_t, better_src = _pick_better_thickness(result[dup_idx], wall)
            result[dup_idx]["thickness"] = better_t
            result[dup_idx]["_thickness_source"] = better_src
        else:
            result.append(wall)
    return result


def _merge_collinear_walls(walls: list[dict], th: dict[str, float]) -> list[dict]:
    """
    同一直線上で近接・接続する壁候補をマージする。
    """
    h_walls = [w for w in walls if _is_horizontal(w)]
    v_walls = [w for w in walls if not _is_horizontal(w)]

    merged_h = _merge_axis_group(h_walls, axis="h", th=th)
    merged_v = _merge_axis_group(v_walls, axis="v", th=th)

    return merged_h + merged_v


def _merge_axis_group(walls: list[dict], axis: str, th: dict[str, float]) -> list[dict]:
    """
    同一軸グループ内でマージする。
    """
    if not walls:
        return []

    col_tol = th["collinear_tolerance"]
    gap_tol = th["merge_gap"]

    if axis == "h":
        walls_sorted = sorted(walls, key=lambda w: (w["startY"], w["startX"]))
    else:
        walls_sorted = sorted(walls, key=lambda w: (w["startX"], w["startY"]))

    merged = [dict(walls_sorted[0])]

    for wall in walls_sorted[1:]:
        prev = merged[-1]

        if axis == "h":
            same_line = abs(wall["startY"] - prev["startY"]) <= col_tol
            adjacent = same_line and wall["startX"] <= prev["endX"] + gap_tol
        else:
            same_line = abs(wall["startX"] - prev["startX"]) <= col_tol
            adjacent = same_line and wall["startY"] <= prev["endY"] + gap_tol

        if adjacent:
            # マージ: 長い方に延長する
            if axis == "h":
                prev["endX"] = max(prev["endX"], wall["endX"])
                # Y 座標は平均に寄せる
                avg_y = round((prev["startY"] + wall["startY"]) / 2, 1)
                prev["startY"] = avg_y
                prev["endY"] = avg_y
            else:
                prev["endY"] = max(prev["endY"], wall["endY"])
                avg_x = round((prev["startX"] + wall["startX"]) / 2, 1)
                prev["startX"] = avg_x
                prev["endX"] = avg_x
            # thickness は信頼度の高い方を採用
            better_t, better_src = _pick_better_thickness(prev, wall)
            prev["thickness"] = better_t
            prev["_thickness_source"] = better_src
        else:
            merged.append(dict(wall))

    return merged


def extract_walls(page, th: dict[str, float]) -> list[dict]:
    """
    drawing 情報から壁候補を抽出し、整理して返す。

    th: derive_thresholds() の返り値。
    """
    # Step 1: raw 抽出
    raw = _extract_raw_walls(page, th)

    # Step 2: 正規化
    normalized = _normalize_walls(raw)

    # Step 3: thickness 補完 (fallback → nearby_rect)
    refined = _refine_thickness(normalized)

    # Step 4: 重複除去
    deduped = _deduplicate_walls(refined, th)

    # Step 5: 同一直線上マージ
    merged = _merge_collinear_walls(deduped, th)

    # Step 6: 内部補助情報を除去し、id を振り直す
    for i, wall in enumerate(merged):
        wall["id"] = f"wall-{i}"
        wall.pop("_thickness_source", None)

    # デバッグ用ログ（stderr に出力。stdout は JSON プロトコル用なので汚さない）
    # thickness source の分布も出力
    src_counts: dict[str, int] = {}
    for w in refined:
        src = w.get("_thickness_source", "unknown")
        src_counts[src] = src_counts.get(src, 0) + 1
    print(
        f"[wall-extract] raw={len(raw)}, refined={len(refined)}, "
        f"deduped={len(deduped)}, merged={len(merged)}, "
        f"thickness_sources={src_counts}",
        file=sys.stderr,
    )

    return merged


# ═══════════════════════════════════════════════════════════
# 開口部候補の推定（Phase 8A 暫定 — ギャップベースの最小ルール）
#
# 【方針】
# 壁マージ後の壁リストを使い、同一直線上の壁間ギャップから開口部を推定する。
# マージ処理で MERGE_GAP_MM (5mm) 以下のギャップは既に結合されているため、
# 残っているギャップは意図的な開口部の可能性が高い。
#
# 【対象】
#   - 水平壁同士のギャップ (Y 座標が近い壁間の X 方向のギャップ)
#   - 垂直壁同士のギャップ (X 座標が近い壁間の Y 方向のギャップ)
#   - 斜め壁は対象外
#
# 【type の分類ルール（暫定）】
#   - gap >= DOOR_THRESHOLD_MM → "door"
#   - gap < DOOR_THRESHOLD_MM → "unknown" (窓と断定するには情報不足)
#
# 【height の扱い】
#   - 壁厚ベースの仮値を使用 (隣接壁の thickness の平均)
#   - 実際の開口部高さは図面情報だけでは判定困難なため暫定
#
# この推定は暫定的なもの。高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════


def extract_openings(walls: list[dict], th: dict[str, float]) -> list[dict]:
    """
    壁候補間のギャップから開口部候補を推定する。

    th: derive_thresholds() の返り値。
    """
    if not walls:
        return []

    h_walls = [w for w in walls if _is_horizontal(w)]
    v_walls = [w for w in walls if not _is_horizontal(w)]

    openings: list[dict] = []
    openings += _find_gaps_on_axis(h_walls, axis="h", th=th)
    openings += _find_gaps_on_axis(v_walls, axis="v", th=th)

    print(
        f"[opening-detect] gap_based={len(openings)}",
        file=sys.stderr,
    )

    return openings


def _find_gaps_on_axis(walls: list[dict], axis: str, th: dict[str, float]) -> list[dict]:
    """
    同一軸の壁グループ内でギャップを検出し、開口部候補を返す。
    """
    if not walls:
        return []

    col_tol = th["opening_collinear_tolerance"]
    min_w = th["min_opening_width"]
    max_w = th["max_opening_width"]
    door_t = th["door_threshold"]
    default_h = th["default_opening_height"]

    if axis == "h":
        walls_sorted = sorted(walls, key=lambda w: (w["startY"], w["startX"]))
    else:
        walls_sorted = sorted(walls, key=lambda w: (w["startX"], w["startY"]))

    groups: list[list[dict]] = []
    current_group: list[dict] = [walls_sorted[0]]

    for wall in walls_sorted[1:]:
        prev = current_group[0]
        if axis == "h":
            same_line = abs(wall["startY"] - prev["startY"]) <= col_tol
        else:
            same_line = abs(wall["startX"] - prev["startX"]) <= col_tol

        if same_line:
            current_group.append(wall)
        else:
            groups.append(current_group)
            current_group = [wall]
    groups.append(current_group)

    openings: list[dict] = []
    for group in groups:
        if len(group) < 2:
            continue

        if axis == "h":
            group_sorted = sorted(group, key=lambda w: w["startX"])
        else:
            group_sorted = sorted(group, key=lambda w: w["startY"])

        for j in range(len(group_sorted) - 1):
            wall_a = group_sorted[j]
            wall_b = group_sorted[j + 1]

            if axis == "h":
                gap_start = wall_a["endX"]
                gap_end = wall_b["startX"]
                perp_coord = (wall_a["startY"] + wall_b["startY"]) / 2
            else:
                gap_start = wall_a["endY"]
                gap_end = wall_b["startY"]
                perp_coord = (wall_a["startX"] + wall_b["startX"]) / 2

            gap_width = gap_end - gap_start

            if gap_width < min_w or gap_width > max_w:
                continue

            gap_center = (gap_start + gap_end) / 2
            avg_thickness = (wall_a["thickness"] + wall_b["thickness"]) / 2

            if gap_width >= door_t:
                opening_type = "door"
            else:
                opening_type = "unknown"

            if axis == "h":
                center_x = round(gap_center, 1)
                center_y = round(perp_coord, 1)
            else:
                center_x = round(perp_coord, 1)
                center_y = round(gap_center, 1)

            wall_id = wall_a.get("id")

            openings.append({
                "id": "",
                "type": opening_type,
                "centerX": center_x,
                "centerY": center_y,
                "width": round(gap_width, 1),
                "height": round(avg_thickness, 1) if avg_thickness > 0 else default_h,
                "wallId": wall_id,
                "confidence": OPENING_CONFIDENCE,
            })

    return openings


# ═══════════════════════════════════════════════════════════
# 円弧ベースのドア推定（Phase 8A 暫定 — cubic bezier の最小利用）
#
# 【方針】
# PyMuPDF の get_drawings() が返す "c" (cubic bezier) アイテムのうち、
# ドアの開き記号に見える quarter-circle パターンを検出する。
#
# 【ドア円弧の特徴（建築図面）】
#   - 90° の扇形（quarter circle）として描画される
#   - 制御点の bounding box が正方形に近い (aspect ≈ 1.0)
#   - 半径がドア幅に対応（一般的なドア: 700〜900mm → 1:50 で 14〜18mm paper）
#   - 一方の端点がドアヒンジ（壁線上に接触）
#
# 【cubic bezier → quarter circle の判定】
#   PDF では円弧を cubic bezier で近似する。
#   quarter circle の場合、4 制御点の bounding box がほぼ正方形になる。
#   この性質を利用して簡易判定する（厳密な曲率計算は行わない）。
#
# この推定は暫定的なもの。高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════


def _extract_door_arcs(page, th: dict[str, float]) -> list[dict]:
    """
    drawing 情報からドア開き円弧の候補を抽出する。

    th: derive_thresholds() の返り値。
    """
    min_r = th["min_arc_radius"]
    max_r = th["max_arc_radius"]

    drawings = page.get_drawings()
    arcs: list[dict] = []

    for d in drawings:
        for item in d["items"]:
            if item[0] != "c":
                continue

            p1, p2, p3, p4 = item[1], item[2], item[3], item[4]

            x1, y1 = p1.x * PT_TO_MM, p1.y * PT_TO_MM
            cx1, cy1 = p2.x * PT_TO_MM, p2.y * PT_TO_MM
            cx2, cy2 = p3.x * PT_TO_MM, p3.y * PT_TO_MM
            x4, y4 = p4.x * PT_TO_MM, p4.y * PT_TO_MM

            all_x = [x1, cx1, cx2, x4]
            all_y = [y1, cy1, cy2, y4]
            bbox_w = max(all_x) - min(all_x)
            bbox_h = max(all_y) - min(all_y)

            if bbox_w < 1 or bbox_h < 1:
                continue

            aspect = bbox_w / bbox_h
            if aspect < ARC_ASPECT_MIN or aspect > ARC_ASPECT_MAX:
                continue

            chord = math.sqrt((x4 - x1) ** 2 + (y4 - y1) ** 2)
            radius = chord / math.sqrt(2)

            if radius < min_r or radius > max_r:
                continue

            center_x = (min(all_x) + max(all_x)) / 2
            center_y = (min(all_y) + max(all_y)) / 2

            arcs.append({
                "start": (round(x1, 1), round(y1, 1)),
                "end": (round(x4, 1), round(y4, 1)),
                "center": (round(center_x, 1), round(center_y, 1)),
                "radius": round(radius, 1),
            })

    return arcs


def _enhance_openings_with_arcs(
    openings: list[dict],
    arcs: list[dict],
    walls: list[dict],
    th: dict[str, float],
) -> list[dict]:
    """
    arc 候補を使って opening 候補を強化する（1対1 マッチ保証）。

    アルゴリズム（greedy matching by distance）:
    1. 全 (opening, arc) ペアの距離を計算
    2. 距離昇順でソート
    3. まだ未使用の opening/arc 同士だけ採用 → 1対1 を保証
    4. マッチしなかった arc は壁近くなら新規 door 候補に

    th: derive_thresholds() の返り値。
    """
    if not arcs:
        return openings

    match_dist = th["arc_match_distance"]

    # Step 1: 全候補ペアの距離を集める
    pairs: list[tuple[float, int, int]] = []  # (distance, opening_idx, arc_idx)
    for oi, opening in enumerate(openings):
        ox, oy = opening["centerX"], opening["centerY"]
        for ai, arc in enumerate(arcs):
            # arc の start/end/center 全てとの距離を計算し、最小を使う
            min_dist = float("inf")
            for pt in [arc["start"], arc["end"], arc["center"]]:
                d = math.sqrt((ox - pt[0]) ** 2 + (oy - pt[1]) ** 2)
                if d < min_dist:
                    min_dist = d
            if min_dist <= match_dist:
                pairs.append((min_dist, oi, ai))

    # Step 2: 距離昇順でソートし、greedy で 1対1 マッチ
    pairs.sort(key=lambda x: x[0])
    opening_matched: set[int] = set()
    arc_matched: set[int] = set()

    for dist, oi, ai in pairs:
        if oi in opening_matched or ai in arc_matched:
            continue
        # マッチ成立
        openings[oi]["type"] = "door"
        openings[oi]["confidence"] = ARC_DOOR_CONFIDENCE
        openings[oi]["_arc_matched"] = True
        opening_matched.add(oi)
        arc_matched.add(ai)

    # Step 3: マッチしなかった arc から新規 door 候補を生成
    for ai, arc in enumerate(arcs):
        if ai in arc_matched:
            continue

        wall_id = _find_nearest_wall_for_arc(arc, walls, th)
        if wall_id is None:
            continue

        sx, sy = arc["start"]
        ex, ey = arc["end"]
        center_x = round((sx + ex) / 2, 1)
        center_y = round((sy + ey) / 2, 1)

        door_width = round(arc["radius"], 1)

        wall = next((w for w in walls if w.get("id") == wall_id), None)
        height = round(wall["thickness"], 1) if wall else th["default_opening_height"]

        openings.append({
            "id": "",
            "type": "door",
            "centerX": center_x,
            "centerY": center_y,
            "width": door_width,
            "height": height,
            "wallId": wall_id,
            "confidence": ARC_ONLY_DOOR_CONFIDENCE,
            "_arc_matched": True,
        })

    # デバッグ: マッチ内訳
    arc_gap_count = len(opening_matched)
    arc_only_count = sum(1 for ai in range(len(arcs)) if ai not in arc_matched
                         and _find_nearest_wall_for_arc(arcs[ai], walls, th) is not None)
    gap_only_count = sum(1 for oi in range(len(openings))
                         if not openings[oi].get("_arc_matched"))
    print(
        f"[arc-match] pairs_checked={len(pairs)}, "
        f"arc+gap={arc_gap_count}, arc_only={arc_only_count}, "
        f"gap_only={gap_only_count}",
        file=sys.stderr,
    )

    return openings


# ═══════════════════════════════════════════════════════════
# 窓候補の推定（Phase 8A 暫定 — rect パターンの最小ルール）
#
# 【方針】
# PDF の drawing 情報から、壁上または壁近傍にある細長い rect を
# 窓マーカーとして検出する。建築図面では窓を二重線や小さな
# rect で表現することが多い。
#
# 【窓候補の判定ルール（暫定）】
#   - rect の長辺が min_window_width 〜 max_window_width の範囲
#   - rect の短辺が max_window_marker_thickness 以下（薄いマーカー）
#   - rect の中心が壁線から window_wall_distance 以内
#   - rect の長辺方向が壁と平行（水平壁に水平 rect、垂直壁に垂直 rect）
#   - 既存の door opening と近すぎる場合は除外
#   - ページ全体の背景矩形は除外
#
# このルールは暫定的なもの。高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════


def extract_windows(
    page, walls: list[dict], existing_openings: list[dict], th: dict[str, float],
) -> list[dict]:
    """
    drawing 情報の rect パターンから窓候補を抽出する。

    壁近傍の細長い rect を窓マーカーとみなす最小ルール。
    既存 opening (door 等) と近すぎる候補は除外する。

    th: derive_thresholds() の返り値。
    """
    if not walls:
        return []

    min_w = th["min_window_width"]
    max_w = th["max_window_width"]
    max_marker_t = th["max_window_marker_thickness"]
    wall_dist = th["window_wall_distance"]
    dedup_dist = th["window_dedup_distance"]
    default_h = th.get("default_opening_height", 5.0)

    page_rect = page.rect
    page_w_pt = page_rect.width
    page_h_pt = page_rect.height

    candidates: list[dict] = []
    drawings = page.get_drawings()

    for d in drawings:
        for item in d["items"]:
            if item[0] != "re":
                continue

            r = item[1]
            # ページ全体の背景矩形は除外
            if (abs(r.width) > page_w_pt * 0.95
                    and abs(r.height) > page_h_pt * 0.95):
                continue

            w_mm = abs(r.width) * PT_TO_MM
            h_mm = abs(r.height) * PT_TO_MM

            # 長辺と短辺
            long_side = max(w_mm, h_mm)
            short_side = min(w_mm, h_mm)

            # 窓幅チェック
            if long_side < min_w or long_side > max_w:
                continue
            # マーカー薄さチェック
            if short_side > max_marker_t:
                continue

            # rect の中心
            cx = (r.x0 + r.x1) / 2 * PT_TO_MM
            cy = (r.y0 + r.y1) / 2 * PT_TO_MM

            # rect の向き (水平 or 垂直)
            rect_is_horizontal = w_mm >= h_mm

            # 壁との近接チェック + 平行チェック
            best_wall = None
            best_dist = float("inf")
            for wall in walls:
                wall_horiz = _is_horizontal(wall)
                # rect と壁の向きが一致しなければスキップ
                if rect_is_horizontal != wall_horiz:
                    continue

                wx1, wy1 = wall["startX"], wall["startY"]
                wx2, wy2 = wall["endX"], wall["endY"]
                dist = _point_to_segment_distance(cx, cy, wx1, wy1, wx2, wy2)
                if dist < best_dist:
                    best_dist = dist
                    best_wall = wall

            if best_wall is None or best_dist > wall_dist:
                continue

            # 壁の辺として既にカウントされている大きな rect は除外
            # (壁候補の厚み以下の短辺 + 壁候補以上の長辺 → 壁そのもの)
            wall_min_len = th["min_wall_length"]
            if long_side >= wall_min_len:
                continue

            candidates.append({
                "centerX": round(cx, 1),
                "centerY": round(cy, 1),
                "width": round(long_side, 1),
                "height": round(short_side, 1),
                "wallId": best_wall.get("id"),
                "_wall_dist": best_dist,
            })

    # 重複除去: 近接候補をまとめる (最も壁に近いものを残す)
    merged = _dedup_window_candidates(candidates, dedup_dist)

    # 既存 opening (door 等) と近すぎるものを除外
    windows: list[dict] = []
    for cand in merged:
        too_close = False
        for op in existing_openings:
            d = math.sqrt(
                (cand["centerX"] - op["centerX"]) ** 2
                + (cand["centerY"] - op["centerY"]) ** 2
            )
            if d <= dedup_dist:
                too_close = True
                break
        if not too_close:
            windows.append({
                "id": "",
                "type": "window",
                "centerX": cand["centerX"],
                "centerY": cand["centerY"],
                "width": cand["width"],
                "height": cand["height"],
                "wallId": cand["wallId"],
                "confidence": WINDOW_CONFIDENCE,
            })

    print(
        f"[window-detect] raw_candidates={len(candidates)}, "
        f"merged={len(merged)}, after_dedup={len(windows)}",
        file=sys.stderr,
    )

    return windows


def _dedup_window_candidates(
    candidates: list[dict], dedup_dist: float,
) -> list[dict]:
    """近接する window 候補を統合する。壁に近い方を残す。"""
    if not candidates:
        return []

    # 壁に近い順にソート
    sorted_cands = sorted(candidates, key=lambda c: c["_wall_dist"])
    used = [False] * len(sorted_cands)
    result: list[dict] = []

    for i, cand in enumerate(sorted_cands):
        if used[i]:
            continue
        result.append(cand)
        # 近接候補を除外
        for j in range(i + 1, len(sorted_cands)):
            if used[j]:
                continue
            d = math.sqrt(
                (cand["centerX"] - sorted_cands[j]["centerX"]) ** 2
                + (cand["centerY"] - sorted_cands[j]["centerY"]) ** 2
            )
            if d <= dedup_dist:
                used[j] = True

    return result


def _find_nearest_wall_for_arc(
    arc: dict, walls: list[dict], th: dict[str, float],
) -> str | None:
    """
    arc の端点が壁線の近くにあるかチェックし、最も近い壁の id を返す。
    """
    wall_dist = th["arc_wall_distance"]
    best_wall_id = None
    best_dist = float("inf")

    for wall in walls:
        wx1, wy1 = wall["startX"], wall["startY"]
        wx2, wy2 = wall["endX"], wall["endY"]

        for pt in [arc["start"], arc["end"]]:
            px, py = pt
            dist = _point_to_segment_distance(px, py, wx1, wy1, wx2, wy2)
            if dist < best_dist:
                best_dist = dist
                best_wall_id = wall.get("id")

    if best_dist <= wall_dist:
        return best_wall_id
    return None


def _point_to_segment_distance(
    px: float, py: float,
    x1: float, y1: float,
    x2: float, y2: float,
) -> float:
    """点 (px, py) と線分 (x1,y1)-(x2,y2) の最短距離を返す。"""
    dx = x2 - x1
    dy = y2 - y1
    length_sq = dx * dx + dy * dy

    if length_sq == 0:
        # 線分が点の場合
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)

    # 線分上の最近接点のパラメータ t (0..1)
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / length_sq))
    nearest_x = x1 + t * dx
    nearest_y = y1 + t * dy

    return math.sqrt((px - nearest_x) ** 2 + (py - nearest_y) ** 2)


def extract_floor_data(
    file_entry: dict,
    doc: fitz.Document,
    page_index: int = 0,
    settings: dict | None = None,
) -> dict:
    """
    1ページ分の最小抽出データを返す。

    settings: PipelineInput.settings (scale, floorHeight)。
              None の場合は scale=50 をデフォルトとして使う。
    """
    scale = (settings or {}).get("scale", 50)
    th = derive_thresholds(scale)

    page = doc[page_index]
    rect = page.rect
    page_width_mm = round(rect.width * PT_TO_MM, 1)
    page_height_mm = round(rect.height * PT_TO_MM, 1)

    # --- 壁候補の抽出 ---
    walls = extract_walls(page, th)

    # --- 開口部候補の推定（gap ベース + arc ベース + 窓） ---
    openings = extract_openings(walls, th)

    door_arcs = _extract_door_arcs(page, th)
    openings = _enhance_openings_with_arcs(openings, door_arcs, walls, th)

    # --- 窓候補の推定（rect パターン） ---
    windows = extract_windows(page, walls, openings, th)
    openings.extend(windows)

    # id を振り直し、内部フラグを除去
    arc_confirmed = sum(1 for op in openings if op.get("_arc_matched"))
    for i, op in enumerate(openings):
        op["id"] = f"opening-{i}"
        op.pop("_arc_matched", None)

    # デバッグログ
    type_counts: dict[str, int] = {}
    for op in openings:
        t = op["type"]
        type_counts[t] = type_counts.get(t, 0) + 1
    print(
        f"[opening-arc] arcs={len(door_arcs)}, arc_confirmed={arc_confirmed}, "
        f"windows={len(windows)}, total_openings={len(openings)}, "
        f"types={type_counts}, scale={scale}",
        file=sys.stderr,
    )

    # --- テキスト抽出（取れるものだけ） ---
    text_blocks = page.get_text("blocks")  # (x0, y0, x1, y1, text, block_no, block_type)

    # 部屋名の候補をテキストから簡易抽出
    # ※ これは最小実装。精度は Phase 8A 後半以降で改善する。
    rooms = []
    room_id = 0
    for block in text_blocks:
        if block[6] == 0:  # type 0 = テキストブロック
            block_text = block[4].strip()
            if block_text and len(block_text) < 20:
                # 短いテキストブロックを部屋名候補として扱う（暫定）
                rooms.append(
                    {
                        "id": f"room-{room_id}",
                        "name": block_text,
                        "polygon": [
                            {"x": round(block[0] * PT_TO_MM, 1), "y": round(block[1] * PT_TO_MM, 1)},
                            {"x": round(block[2] * PT_TO_MM, 1), "y": round(block[1] * PT_TO_MM, 1)},
                            {"x": round(block[2] * PT_TO_MM, 1), "y": round(block[3] * PT_TO_MM, 1)},
                            {"x": round(block[0] * PT_TO_MM, 1), "y": round(block[3] * PT_TO_MM, 1)},
                        ],
                        "confidence": 0.3,  # 暫定: テキストブロック位置からの推定なので低信頼度
                    }
                )
                room_id += 1

    return {
        "floorLabel": file_entry["floorLabel"],
        "walls": walls,
        "openings": openings,
        "rooms": rooms,
        "source": {
            "fileId": file_entry["fileId"],
            "pageIndex": page_index,
            "pageWidth": page_width_mm,
            "pageHeight": page_height_mm,
        },
    }


def process_pipeline(pipeline_input: dict) -> dict:
    """PipelineInput を受け取り、PipelineOutput を返す。"""
    start_time = time.time()

    job_id = pipeline_input["jobId"]
    files = pipeline_input["files"]
    settings = pipeline_input.get("settings", {})
    floors = []
    total_walls = 0
    total_openings = 0
    total_rooms = 0

    for file_entry in files:
        file_path = file_entry["filePath"]

        if not Path(file_path).exists():
            return {
                "jobId": job_id,
                "success": False,
                "floors": [],
                "artifacts": [],
                "error": {
                    "code": "FILE_NOT_FOUND",
                    "message": f"ファイルが見つかりません: {file_path}",
                    "failedAt": "file_read",
                },
                "stats": {
                    "durationMs": round((time.time() - start_time) * 1000),
                    "totalWalls": 0,
                    "totalOpenings": 0,
                    "totalRooms": 0,
                },
            }

        try:
            doc = fitz.open(file_path)
        except Exception as e:
            return {
                "jobId": job_id,
                "success": False,
                "floors": [],
                "artifacts": [],
                "error": {
                    "code": "PDF_PARSE_ERROR",
                    "message": f"PDF の読み取りに失敗しました: {str(e)}",
                    "failedAt": "pdf_open",
                },
                "stats": {
                    "durationMs": round((time.time() - start_time) * 1000),
                    "totalWalls": 0,
                    "totalOpenings": 0,
                    "totalRooms": 0,
                },
            }

        # 最小実装: 各ファイルの最初のページのみ処理
        if doc.page_count > 0:
            floor_data = extract_floor_data(file_entry, doc, page_index=0, settings=settings)
            floors.append(floor_data)
            total_walls += len(floor_data["walls"])
            total_openings += len(floor_data["openings"])
            total_rooms += len(floor_data["rooms"])

        doc.close()

    duration_ms = round((time.time() - start_time) * 1000)

    # 構造化 JSON を成果物として記録（ファイル書き出しはせず、output に含める）
    output_json = json.dumps({"floors": floors}, ensure_ascii=False)

    return {
        "jobId": job_id,
        "success": True,
        "floors": floors,
        "artifacts": [
            {
                "format": "structured_json",
                "filePath": "(inline)",  # 今回はファイル書き出しせずインラインで返す
                "size": len(output_json.encode("utf-8")),
            }
        ],
        "stats": {
            "durationMs": duration_ms,
            "totalWalls": total_walls,
            "totalOpenings": total_openings,
            "totalRooms": total_rooms,
        },
    }


def main():
    """stdin から PipelineInput を読み、stdout に PipelineOutput を出力する。"""
    try:
        raw = sys.stdin.read()
        pipeline_input = json.loads(raw)
    except json.JSONDecodeError as e:
        output = {
            "jobId": "",
            "success": False,
            "floors": [],
            "artifacts": [],
            "error": {
                "code": "INVALID_INPUT",
                "message": f"入力 JSON のパースに失敗しました: {str(e)}",
                "failedAt": "input_parse",
            },
            "stats": {
                "durationMs": 0,
                "totalWalls": 0,
                "totalOpenings": 0,
                "totalRooms": 0,
            },
        }
        print(json.dumps(output, ensure_ascii=False))
        return

    output = process_pipeline(pipeline_input)
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
