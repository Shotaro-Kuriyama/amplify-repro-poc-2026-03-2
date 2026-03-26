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
- walls / openings / rooms は空配列（Phase 8A 後半で実装予定）

使用ライブラリ: PyMuPDF (fitz)
  pip install PyMuPDF
"""

import json
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


def extract_floor_data(file_entry: dict, doc: fitz.Document, page_index: int = 0) -> dict:
    """1ページ分の最小抽出データを返す。"""
    page = doc[page_index]
    # ページサイズ: PDF の単位はポイント (1pt = 1/72 inch = 0.3528mm)
    rect = page.rect
    page_width_mm = round(rect.width * 0.3528, 1)
    page_height_mm = round(rect.height * 0.3528, 1)

    # テキスト抽出（取れるものだけ）
    text = page.get_text("text").strip()
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
                            {"x": round(block[0] * 0.3528, 1), "y": round(block[1] * 0.3528, 1)},
                            {"x": round(block[2] * 0.3528, 1), "y": round(block[1] * 0.3528, 1)},
                            {"x": round(block[2] * 0.3528, 1), "y": round(block[3] * 0.3528, 1)},
                            {"x": round(block[0] * 0.3528, 1), "y": round(block[3] * 0.3528, 1)},
                        ],
                        "confidence": 0.3,  # 暫定: テキストブロック位置からの推定なので低信頼度
                    }
                )
                room_id += 1

    return {
        "floorLabel": file_entry["floorLabel"],
        "walls": [],  # Phase 8A 後半: 線分抽出から壁を推定する
        "openings": [],  # Phase 8A 後半: 開口部を推定する
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
            "totalWalls": 0,  # Phase 8A 後半で実装
            "totalOpenings": 0,  # Phase 8A 後半で実装
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
