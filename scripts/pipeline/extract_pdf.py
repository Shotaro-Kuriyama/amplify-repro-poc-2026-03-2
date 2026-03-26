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
- openings は空配列（Phase 8A 後半以降で実装予定）

使用ライブラリ: PyMuPDF (fitz)
  pip install PyMuPDF
"""

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
#   ※ "c" (curve/bezier), "qu" (quad) 等は今回は無視
#
# 【壁候補の判定ルール（暫定）】
#   - 長さが MIN_WALL_LENGTH_MM (50mm) 以上
#   - 水平または垂直に近い（水平/垂直からの角度差が MAX_ANGLE_DEV_DEG (5°) 以内）
#   - ページ全体の背景矩形は除外する
#
# 【thickness の扱い】
#   - line: PDF の stroke width を mm に変換。0 や未設定の場合は DEFAULT_THICKNESS_MM
#   - rect: 短辺の長さを thickness として使う
#   - いずれも暫定値。高精度な壁厚推定は Phase 8A 以降で行う
#
# 【confidence の扱い】
#   - 固定値 0.5（暫定）。長さや角度に応じた重み付けは将来対応
#
# このルールは暫定的なものであり、高精度化は Phase 8B 以降で行う。
# ═══════════════════════════════════════════════════════════

PT_TO_MM = 0.3528

# 壁候補判定の閾値
MIN_WALL_LENGTH_MM = 50.0    # これ以下の線分は壁候補にしない
MAX_ANGLE_DEV_DEG = 5.0      # 水平/垂直からの許容角度差（度）
DEFAULT_THICKNESS_MM = 150.0  # stroke width が不明な場合のデフォルト壁厚
DEFAULT_CONFIDENCE = 0.5      # 暫定の固定 confidence

# ── 重複除去・マージの閾値（暫定） ──
# これらの値は暫定的なもの。PDF の解像度や図面縮尺によっては
# 調整が必要になる可能性がある。高精度化は Phase 8B 以降で行う。
DEDUP_TOLERANCE_MM = 2.0     # 始点・終点がこの距離以内なら「同一 wall」とみなす
COLLINEAR_TOLERANCE_MM = 3.0  # 垂直方向の座標差がこの範囲内なら「同一直線上」とみなす
MERGE_GAP_MM = 5.0           # 端点間のギャップがこの範囲内ならマージ対象


def _extract_line_segments(page) -> list[dict]:
    """
    page.get_drawings() から線分候補を抽出する。

    返り値は以下の shape を持つ dict のリスト:
      {
        "x1": float, "y1": float,  # 始点 (mm)
        "x2": float, "y2": float,  # 終点 (mm)
        "thickness_mm": float,     # 推定壁厚 (mm)
        "source_type": str,        # "line" or "rect"
      }
    """
    page_rect = page.rect
    page_w_pt = page_rect.width
    page_h_pt = page_rect.height

    segments = []
    drawings = page.get_drawings()

    for d in drawings:
        for item in d["items"]:
            item_type = item[0]

            if item_type == "l":
                # 直線
                p1, p2 = item[1], item[2]
                stroke_w = d.get("width") or 0
                thickness_mm = stroke_w * PT_TO_MM if stroke_w > 0 else DEFAULT_THICKNESS_MM
                segments.append({
                    "x1": p1.x * PT_TO_MM, "y1": p1.y * PT_TO_MM,
                    "x2": p2.x * PT_TO_MM, "y2": p2.y * PT_TO_MM,
                    "thickness_mm": round(thickness_mm, 1),
                    "source_type": "line",
                })

            elif item_type == "re":
                # 矩形 → 4辺に分解
                r = item[1]
                # ページ全体の背景矩形を除外（幅・高さがページの 95% 以上）
                if (abs(r.width) > page_w_pt * 0.95
                        and abs(r.height) > page_h_pt * 0.95):
                    continue

                # 塗りつぶし矩形の場合、短辺を thickness として使う
                w_mm = abs(r.width) * PT_TO_MM
                h_mm = abs(r.height) * PT_TO_MM
                is_horizontal = w_mm >= h_mm
                thickness_mm = h_mm if is_horizontal else w_mm

                # 4辺を展開
                x0, y0 = r.x0 * PT_TO_MM, r.y0 * PT_TO_MM
                x1, y1 = r.x1 * PT_TO_MM, r.y1 * PT_TO_MM
                rect_edges = [
                    (x0, y0, x1, y0),  # 上辺
                    (x1, y0, x1, y1),  # 右辺
                    (x1, y1, x0, y1),  # 下辺
                    (x0, y1, x0, y0),  # 左辺
                ]
                for ex1, ey1, ex2, ey2 in rect_edges:
                    segments.append({
                        "x1": ex1, "y1": ey1,
                        "x2": ex2, "y2": ey2,
                        "thickness_mm": round(thickness_mm, 1),
                        "source_type": "rect",
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


def _extract_raw_walls(page) -> list[dict]:
    """
    drawing 情報から壁候補を抽出する（正規化・重複除去前の raw データ）。

    返り値は ExtractedWall の shape に合致する dict のリスト。
    座標・thickness はすべて mm 単位。id は仮のもの（後で振り直す）。
    """
    segments = _extract_line_segments(page)
    walls = []

    for seg in segments:
        length = _segment_length(seg)
        if length < MIN_WALL_LENGTH_MM:
            continue
        if not _is_near_axis_aligned(seg["x1"], seg["y1"], seg["x2"], seg["y2"]):
            continue

        # thickness: line の場合は stroke width を使うが、
        # あまりに細い場合 (< 1mm) はデフォルト値にフォールバック
        thickness = seg["thickness_mm"]
        if thickness < 1.0:
            thickness = DEFAULT_THICKNESS_MM

        walls.append({
            "startX": round(seg["x1"], 1),
            "startY": round(seg["y1"], 1),
            "endX": round(seg["x2"], 1),
            "endY": round(seg["y2"], 1),
            "thickness": round(thickness, 1),
            "confidence": DEFAULT_CONFIDENCE,
        })

    return walls


# ═══════════════════════════════════════════════════════════
# 壁候補の正規化・重複除去・マージ（Phase 8A 継続 — 暫定ルールベース）
#
# 処理パイプライン:
#   raw walls → 正規化 → 重複除去 → 同一直線上マージ → id 振り直し
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


def _deduplicate_walls(walls: list[dict]) -> list[dict]:
    """
    ほぼ同一の壁候補を除去する。

    始点・終点がともに DEDUP_TOLERANCE_MM 以内の wall を同一とみなす。
    重複時は thickness が大きい方を残す。
    """
    result: list[dict] = []
    for wall in walls:
        dup_idx = None
        for i, existing in enumerate(result):
            if (abs(wall["startX"] - existing["startX"]) <= DEDUP_TOLERANCE_MM
                    and abs(wall["startY"] - existing["startY"]) <= DEDUP_TOLERANCE_MM
                    and abs(wall["endX"] - existing["endX"]) <= DEDUP_TOLERANCE_MM
                    and abs(wall["endY"] - existing["endY"]) <= DEDUP_TOLERANCE_MM):
                dup_idx = i
                break
        if dup_idx is not None:
            # 重複 → thickness が大きい方を残す
            if wall["thickness"] > result[dup_idx]["thickness"]:
                result[dup_idx] = wall
        else:
            result.append(wall)
    return result


def _merge_collinear_walls(walls: list[dict]) -> list[dict]:
    """
    同一直線上で近接・接続する壁候補をマージする。

    水平線同士/垂直線同士を対象に、
    垂直方向の座標差が COLLINEAR_TOLERANCE_MM 以内で
    端点間が MERGE_GAP_MM 以内（または重なり）なら 1 本にまとめる。
    """
    h_walls = [w for w in walls if _is_horizontal(w)]
    v_walls = [w for w in walls if not _is_horizontal(w)]

    merged_h = _merge_axis_group(h_walls, axis="h")
    merged_v = _merge_axis_group(v_walls, axis="v")

    return merged_h + merged_v


def _merge_axis_group(walls: list[dict], axis: str) -> list[dict]:
    """
    同一軸グループ内でマージする。

    axis="h": 水平線。Y 座標が近いものを同一直線とみなし、X 方向でマージ
    axis="v": 垂直線。X 座標が近いものを同一直線とみなし、Y 方向でマージ
    """
    if not walls:
        return []

    if axis == "h":
        # Y で並べ、同じ Y グループ内を startX 順に
        walls_sorted = sorted(walls, key=lambda w: (w["startY"], w["startX"]))
    else:
        # X で並べ、同じ X グループ内を startY 順に
        walls_sorted = sorted(walls, key=lambda w: (w["startX"], w["startY"]))

    merged = [dict(walls_sorted[0])]  # コピーして使う

    for wall in walls_sorted[1:]:
        prev = merged[-1]

        if axis == "h":
            same_line = abs(wall["startY"] - prev["startY"]) <= COLLINEAR_TOLERANCE_MM
            # wall は startX 順なので、prev の endX + GAP >= wall の startX なら接続
            adjacent = same_line and wall["startX"] <= prev["endX"] + MERGE_GAP_MM
        else:
            same_line = abs(wall["startX"] - prev["startX"]) <= COLLINEAR_TOLERANCE_MM
            adjacent = same_line and wall["startY"] <= prev["endY"] + MERGE_GAP_MM

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
            # thickness は最大値を採用
            prev["thickness"] = max(prev["thickness"], wall["thickness"])
        else:
            merged.append(dict(wall))

    return merged


def extract_walls(page) -> list[dict]:
    """
    drawing 情報から壁候補を抽出し、整理して返す。

    処理パイプライン:
      1. drawing から raw な壁候補を抽出
      2. 方向を正規化
      3. ほぼ同一の重複を除去
      4. 同一直線上の近接壁をマージ
      5. wall-0, wall-1, ... と id を振り直す

    返り値は ExtractedWall の shape に合致する dict のリスト。
    座標・thickness はすべて mm 単位。
    """
    # Step 1: raw 抽出
    raw = _extract_raw_walls(page)

    # Step 2: 正規化
    normalized = _normalize_walls(raw)

    # Step 3: 重複除去
    deduped = _deduplicate_walls(normalized)

    # Step 4: 同一直線上マージ
    merged = _merge_collinear_walls(deduped)

    # Step 5: id 振り直し
    for i, wall in enumerate(merged):
        wall["id"] = f"wall-{i}"

    # デバッグ用ログ（stderr に出力。stdout は JSON プロトコル用なので汚さない）
    print(
        f"[wall-extract] raw={len(raw)}, normalized={len(normalized)}, "
        f"deduped={len(deduped)}, merged={len(merged)}",
        file=sys.stderr,
    )

    return merged


def extract_floor_data(file_entry: dict, doc: fitz.Document, page_index: int = 0) -> dict:
    """1ページ分の最小抽出データを返す。"""
    page = doc[page_index]
    # ページサイズ: PDF の単位はポイント (1pt = 1/72 inch = 0.3528mm)
    rect = page.rect
    page_width_mm = round(rect.width * PT_TO_MM, 1)
    page_height_mm = round(rect.height * PT_TO_MM, 1)

    # --- 壁候補の抽出 ---
    walls = extract_walls(page)

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
        "openings": [],  # Phase 8A 後半以降: 開口部を推定する
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
    floors = []
    total_walls = 0
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
            floor_data = extract_floor_data(file_entry, doc, page_index=0)
            floors.append(floor_data)
            total_walls += len(floor_data["walls"])
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
            "totalOpenings": 0,  # Phase 8A 後半以降で実装
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
