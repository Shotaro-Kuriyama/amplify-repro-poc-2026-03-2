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


def extract_walls(page) -> list[dict]:
    """
    drawing 情報から壁候補を抽出する。

    返り値は ExtractedWall の shape に合致する dict のリスト。
    座標・thickness はすべて mm 単位。
    """
    segments = _extract_line_segments(page)
    walls = []
    wall_id = 0

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
            "id": f"wall-{wall_id}",
            "startX": round(seg["x1"], 1),
            "startY": round(seg["y1"], 1),
            "endX": round(seg["x2"], 1),
            "endY": round(seg["y2"], 1),
            "thickness": round(thickness, 1),
            "confidence": DEFAULT_CONFIDENCE,
        })
        wall_id += 1

    return walls


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
