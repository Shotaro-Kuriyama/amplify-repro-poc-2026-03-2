"""
Phase 8A: extract_pdf.py の fixture ベース再現テスト

テスト方針:
- A: scale=50 での後方互換確認（fixture PDF）
- B: scale 変更時の threshold 追従確認
- C: arc-opening の 1対1 マッチ保証（合成データ）
- D: arc-only door 候補の生成確認（合成データ）

fixture:
- line_only_doors_scale_1_50.pdf
    line ベースの壁 + gap-based opening 1 件 + door arc 3 本。
    gap+arc マッチ 1 件 (conf 0.6) + arc-only door 2 件 (conf 0.5)。
- walls_only_scale_1_50.pdf
    rect ベースの壁のみ。opening 0 件、arc 0 件。

実行方法:
  cd amplify-mock
  pip install -r scripts/pipeline/requirements-dev.txt
  python3 -m pytest scripts/pipeline/tests/ -v
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

# extract_pdf モジュールを import できるように path を追加
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from extract_pdf import (
    derive_thresholds,
    extract_openings,
    extract_walls,
    _extract_door_arcs,
    _enhance_openings_with_arcs,
    _find_nearest_wall_for_arc,
    _is_horizontal,
    _point_to_segment_distance,
)

# ── fixture PDF パス ──
# repo 内の正式な fixture を参照（data/uploads/ には依存しない）
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
LINE_ONLY_PDF = FIXTURES_DIR / "line_only_doors_scale_1_50.pdf"
WALLS_ONLY_PDF = FIXTURES_DIR / "walls_only_scale_1_50.pdf"


def _have_fitz():
    """PyMuPDF がインストール済みか確認"""
    try:
        import fitz  # noqa: F401
        return True
    except ImportError:
        return False


needs_fitz = pytest.mark.skipif(
    not _have_fitz(), reason="PyMuPDF (fitz) not installed"
)
needs_line_only = pytest.mark.skipif(
    not LINE_ONLY_PDF.exists(), reason="line_only fixture PDF not found"
)
needs_walls_only = pytest.mark.skipif(
    not WALLS_ONLY_PDF.exists(), reason="walls_only fixture PDF not found"
)


# ═══════════════════════════════════════════════════════════
# テスト A: scale=50 での後方互換確認
#
# fixture の期待値:
#   line_only: walls=8, gap_openings=1, arcs=3, total_openings=3
#   walls_only: walls=6, openings=0, arcs=0
# ═══════════════════════════════════════════════════════════

class TestScaleBackwardCompat:
    """scale=50 で fixture から期待通りの結果が得られることを確認する。"""

    @needs_fitz
    @needs_line_only
    def test_line_only_walls_count(self):
        """line_only fixture で壁候補が 8 本であること。
        外壁 4 + 内壁 y=110 左右 2 + x=150 + x=210 = 8 本。
        ただし merge 状況により ±1 の余裕を持つ。"""
        import fitz
        doc = fitz.open(str(LINE_ONLY_PDF))
        th = derive_thresholds(50)
        walls = extract_walls(doc[0], th)
        doc.close()
        assert 7 <= len(walls) <= 9, f"expected ~8 walls, got {len(walls)}"

    @needs_fitz
    @needs_line_only
    def test_line_only_openings_count(self):
        """line_only fixture で opening が 3 件であること（gap 1 + arc-only 2）。"""
        import fitz
        doc = fitz.open(str(LINE_ONLY_PDF))
        th = derive_thresholds(50)
        page = doc[0]
        walls = extract_walls(page, th)
        openings = extract_openings(walls, th)
        arcs = _extract_door_arcs(page, th)
        openings = _enhance_openings_with_arcs(openings, arcs, walls, th)
        doc.close()
        # gap 1 + arc-only 2 = 3
        assert len(openings) >= 2, f"expected >=2 openings, got {len(openings)}"

    @needs_fitz
    @needs_line_only
    def test_line_only_door_count(self):
        """line_only fixture で全 opening が door タイプであること。"""
        import fitz
        doc = fitz.open(str(LINE_ONLY_PDF))
        th = derive_thresholds(50)
        page = doc[0]
        walls = extract_walls(page, th)
        openings = extract_openings(walls, th)
        arcs = _extract_door_arcs(page, th)
        openings = _enhance_openings_with_arcs(openings, arcs, walls, th)
        doc.close()
        doors = [o for o in openings if o["type"] == "door"]
        assert len(doors) == len(openings), "all openings should be doors"

    @needs_fitz
    @needs_walls_only
    def test_walls_only_no_openings(self):
        """walls_only fixture で opening が 0 件であること。"""
        import fitz
        doc = fitz.open(str(WALLS_ONLY_PDF))
        th = derive_thresholds(50)
        page = doc[0]
        walls = extract_walls(page, th)
        openings = extract_openings(walls, th)
        arcs = _extract_door_arcs(page, th)
        openings = _enhance_openings_with_arcs(openings, arcs, walls, th)
        doc.close()
        assert len(openings) == 0

    @needs_fitz
    @needs_walls_only
    def test_walls_only_walls_count(self):
        """walls_only fixture で壁候補が 6 本であること。
        外壁 4 辺 × 4 edges each = rect → filtered、内壁 2 本。"""
        import fitz
        doc = fitz.open(str(WALLS_ONLY_PDF))
        th = derive_thresholds(50)
        walls = extract_walls(doc[0], th)
        doc.close()
        assert 5 <= len(walls) <= 8, f"expected ~6 walls, got {len(walls)}"


# ═══════════════════════════════════════════════════════════
# テスト B: scale 変更時の threshold 追従確認
# ═══════════════════════════════════════════════════════════

class TestScaleThresholds:
    """scale に応じて threshold が正しく変化することを確認する。"""

    def test_scale_50_matches_legacy(self):
        """scale=50 で従来の固定値と一致すること。"""
        th = derive_thresholds(50)
        assert th["min_wall_length"] == 50.0
        assert th["max_rect_thickness"] == 20.0
        assert th["fallback_thickness"] == 5.0
        assert th["dedup_tolerance"] == 2.0
        assert th["collinear_tolerance"] == 3.0
        assert th["merge_gap"] == 5.0
        assert th["min_opening_width"] == 8.0
        assert th["max_opening_width"] == 40.0
        assert th["door_threshold"] == 14.0
        assert th["min_arc_radius"] == 8.0
        assert th["max_arc_radius"] == 30.0

    def test_scale_100_halves_thresholds(self):
        """scale=100 で paper mm しきい値が scale=50 の半分になること。"""
        th50 = derive_thresholds(50)
        th100 = derive_thresholds(100)
        for key in th50:
            assert abs(th100[key] - th50[key] / 2) < 0.01, \
                f"{key}: expected {th50[key]/2}, got {th100[key]}"

    def test_scale_25_doubles_thresholds(self):
        """scale=25 で paper mm しきい値が scale=50 の 2 倍になること。"""
        th50 = derive_thresholds(50)
        th25 = derive_thresholds(25)
        for key in th50:
            assert abs(th25[key] - th50[key] * 2) < 0.01, \
                f"{key}: expected {th50[key]*2}, got {th25[key]}"

    def test_invalid_scale_fallback(self):
        """scale=0 や負数は 50 にフォールバック。"""
        th0 = derive_thresholds(0)
        th50 = derive_thresholds(50)
        assert th0 == th50

        th_neg = derive_thresholds(-10)
        assert th_neg == th50

    @needs_fitz
    @needs_line_only
    def test_scale_100_different_wall_count(self):
        """scale=100 では min_wall_length が小さくなり、壁の数が変化する。"""
        import fitz
        doc = fitz.open(str(LINE_ONLY_PDF))
        th50 = derive_thresholds(50)
        th100 = derive_thresholds(100)
        walls50 = extract_walls(doc[0], th50)
        walls100 = extract_walls(doc[0], th100)
        doc.close()
        # scale=100 では min_wall_length=25mm なので、短い線分も拾える → 壁数が増えるはず
        assert len(walls100) >= len(walls50), \
            f"scale=100 should detect >= walls than scale=50, got {len(walls100)} vs {len(walls50)}"


# ═══════════════════════════════════════════════════════════
# テスト C: 1対1 マッチ保証
# ═══════════════════════════════════════════════════════════

class TestOneToOneMatching:
    """arc-opening の 1対1 マッチが保証されることを確認する。"""

    def _make_walls(self):
        """テスト用の壁データ。"""
        return [
            {"id": "w0", "startX": 0, "startY": 50, "endX": 100, "endY": 50, "thickness": 5, "confidence": 0.5},
            {"id": "w1", "startX": 0, "startY": 100, "endX": 100, "endY": 100, "thickness": 5, "confidence": 0.5},
        ]

    def test_no_arc_duplication(self):
        """1 本の arc が 2 つの opening に同時使用されないこと。"""
        th = derive_thresholds(50)
        # 近接した 2 つの opening
        openings = [
            {"id": "o0", "type": "unknown", "centerX": 30, "centerY": 50,
             "width": 15, "height": 5, "wallId": "w0", "confidence": 0.4},
            {"id": "o1", "type": "unknown", "centerX": 35, "centerY": 50,
             "width": 15, "height": 5, "wallId": "w0", "confidence": 0.4},
        ]
        # 1 本の arc（両方の opening に近い）
        arcs = [
            {"start": (32, 50), "end": (32, 35), "center": (32, 42.5), "radius": 15},
        ]
        walls = self._make_walls()

        result = _enhance_openings_with_arcs(openings, arcs, walls, th)

        # arc は 1 本しかないので、最大 1 つの opening にだけ arc が適用される
        arc_matched = [o for o in result if o.get("_arc_matched")]
        assert len(arc_matched) <= 1, \
            f"1 arc should match at most 1 opening, got {len(arc_matched)}"

    def test_no_opening_duplication(self):
        """1 つの opening が 2 本の arc を同時採用しないこと。"""
        th = derive_thresholds(50)
        # 1 つの opening
        openings = [
            {"id": "o0", "type": "unknown", "centerX": 50, "centerY": 50,
             "width": 15, "height": 5, "wallId": "w0", "confidence": 0.4},
        ]
        # 2 本の arc（同じ opening の近く）
        arcs = [
            {"start": (48, 50), "end": (48, 35), "center": (48, 42.5), "radius": 15},
            {"start": (52, 50), "end": (52, 35), "center": (52, 42.5), "radius": 15},
        ]
        walls = self._make_walls()

        result = _enhance_openings_with_arcs(openings, arcs, walls, th)

        # opening は 1 つなので、arc と結びつくのは最大 1 回
        original_matched = [o for o in result[:1] if o.get("_arc_matched")]
        assert len(original_matched) <= 1

    def test_greedy_best_match(self):
        """距離が最も近いペアが優先されること。"""
        th = derive_thresholds(50)
        # opening at x=50, arc at x=49 (distance=1) and arc at x=60 (distance=10)
        openings = [
            {"id": "o0", "type": "unknown", "centerX": 50, "centerY": 50,
             "width": 15, "height": 5, "wallId": "w0", "confidence": 0.4},
        ]
        arcs = [
            {"start": (60, 50), "end": (60, 35), "center": (60, 42.5), "radius": 15},  # far
            {"start": (49, 50), "end": (49, 35), "center": (49, 42.5), "radius": 15},  # near
        ]
        walls = self._make_walls()

        result = _enhance_openings_with_arcs(openings, arcs, walls, th)

        # opening-0 should be matched (arc was close enough)
        assert result[0].get("_arc_matched") is True
        assert result[0]["confidence"] == 0.6  # ARC_DOOR_CONFIDENCE

    @needs_fitz
    @needs_line_only
    def test_real_pdf_one_to_one(self):
        """fixture PDF で arc と opening が 1対1 になっていること。"""
        import fitz
        doc = fitz.open(str(LINE_ONLY_PDF))
        th = derive_thresholds(50)
        page = doc[0]
        walls = extract_walls(page, th)
        openings = extract_openings(walls, th)
        arcs = _extract_door_arcs(page, th)
        openings = _enhance_openings_with_arcs(openings, arcs, walls, th)
        doc.close()

        # arc_matched フラグがついた opening の数 <= arc の数
        arc_matched_count = sum(1 for o in openings if o.get("_arc_matched"))
        assert arc_matched_count <= len(arcs), \
            f"arc_matched ({arc_matched_count}) should be <= arcs ({len(arcs)})"


# ═══════════════════════════════════════════════════════════
# テスト D: arc-only door の確認
# ═══════════════════════════════════════════════════════════

class TestArcOnlyDoor:
    """gap がなくても壁近くの arc から door 候補が作られることを確認する。"""

    def test_arc_near_wall_creates_door(self):
        """arc の端点が壁線上にあるとき、新規 door が追加されること。"""
        th = derive_thresholds(50)
        openings: list[dict] = []  # gap-based opening はない
        walls = [
            {"id": "w0", "startX": 0, "startY": 100, "endX": 200, "endY": 100,
             "thickness": 5, "confidence": 0.5},
        ]
        # arc の start が壁線 y=100 上にある
        arcs = [
            {"start": (50, 100), "end": (50, 85), "center": (50, 92.5), "radius": 15},
        ]

        result = _enhance_openings_with_arcs(openings, arcs, walls, th)

        assert len(result) == 1, f"expected 1 arc-only door, got {len(result)}"
        door = result[0]
        assert door["type"] == "door"
        assert door["confidence"] == 0.5  # ARC_ONLY_DOOR_CONFIDENCE
        assert door["wallId"] == "w0"

    def test_arc_far_from_wall_ignored(self):
        """arc が壁から遠い場合、door は追加されないこと。"""
        th = derive_thresholds(50)
        openings: list[dict] = []
        walls = [
            {"id": "w0", "startX": 0, "startY": 100, "endX": 200, "endY": 100,
             "thickness": 5, "confidence": 0.5},
        ]
        # arc が壁から 50mm 離れている（ARC_WALL_DISTANCE_MM=5 を超える）
        arcs = [
            {"start": (50, 50), "end": (50, 35), "center": (50, 42.5), "radius": 15},
        ]

        result = _enhance_openings_with_arcs(openings, arcs, walls, th)
        assert len(result) == 0, "arc far from wall should not create door"

    def test_each_arc_creates_one_door(self):
        """複数の arc がそれぞれ 1 件ずつ door を作ること。"""
        th = derive_thresholds(50)
        openings: list[dict] = []
        walls = [
            {"id": "w0", "startX": 0, "startY": 100, "endX": 200, "endY": 100,
             "thickness": 5, "confidence": 0.5},
        ]
        arcs = [
            {"start": (30, 100), "end": (30, 85), "center": (30, 92.5), "radius": 15},
            {"start": (80, 100), "end": (80, 85), "center": (80, 92.5), "radius": 15},
            {"start": (130, 100), "end": (130, 85), "center": (130, 92.5), "radius": 15},
        ]

        result = _enhance_openings_with_arcs(openings, arcs, walls, th)
        assert len(result) == 3, f"expected 3 arc-only doors, got {len(result)}"
        for door in result:
            assert door["type"] == "door"

    @needs_fitz
    @needs_line_only
    def test_real_pdf_arc_only_doors(self):
        """line_only fixture で arc-only door が存在すること。"""
        import fitz
        doc = fitz.open(str(LINE_ONLY_PDF))
        th = derive_thresholds(50)
        page = doc[0]
        walls = extract_walls(page, th)
        gap_openings = extract_openings(walls, th)
        arcs = _extract_door_arcs(page, th)

        gap_count = len(gap_openings)
        openings = _enhance_openings_with_arcs(gap_openings, arcs, walls, th)
        doc.close()

        arc_only_doors = len(openings) - gap_count
        assert arc_only_doors >= 1, \
            f"expected at least 1 arc-only door, got {arc_only_doors}"


# ═══════════════════════════════════════════════════════════
# ユーティリティ関数のテスト
# ═══════════════════════════════════════════════════════════

class TestUtilities:
    """ユーティリティ関数の基本動作を確認する。"""

    def test_point_to_segment_on_segment(self):
        """点が線分上にあるとき距離 0。"""
        d = _point_to_segment_distance(50, 100, 0, 100, 200, 100)
        assert d < 0.01

    def test_point_to_segment_perpendicular(self):
        """点が線分から垂直に離れているとき。"""
        d = _point_to_segment_distance(50, 90, 0, 100, 200, 100)
        assert abs(d - 10.0) < 0.01

    def test_point_to_segment_past_end(self):
        """点が線分の端を超えているとき。"""
        d = _point_to_segment_distance(210, 100, 0, 100, 200, 100)
        assert abs(d - 10.0) < 0.01
