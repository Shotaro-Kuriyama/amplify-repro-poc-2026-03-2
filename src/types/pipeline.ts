/**
 * Phase 8A 処理パイプラインの型定義
 *
 * PDF → 構造化データ → IFC 生成 の流れにおける
 * 最小の入力・中間表現・出力の型を定義する。
 *
 * 現時点では型定義のみ。実装は Phase 8A で行う。
 * ここで定義した型は、以下の境界を明確にするために使う:
 * - Route Handler が Worker に渡す入力
 * - Worker が返す出力
 * - 将来の Python Worker との JSON 契約
 */

// ═══════════════════════════════════════════════════════════
// パイプライン入力 — Route Handler → Worker に渡すもの
// ═══════════════════════════════════════════════════════════

/** 1枚の PDF を処理するための最小入力 */
export interface PipelineInput {
  /** ジョブ ID */
  jobId: string;
  /** 処理対象のファイル情報（複数階の場合は複数） */
  files: PipelineFileEntry[];
  /** 変換設定 */
  settings: PipelineSettings;
}

/** パイプラインに渡すファイル情報 */
export interface PipelineFileEntry {
  /** ファイル ID */
  fileId: string;
  /** ストレージ上のパス（または将来的には URL） */
  filePath: string;
  /** 元のファイル名 */
  originalName: string;
  /** 階数ラベル（例: "1F", "B1"） */
  floorLabel: string;
}

/** パイプラインの変換設定 */
export interface PipelineSettings {
  /** 図面縮尺（例: 100 → 1:100） */
  scale: number;
  /** 階高（メートル） */
  floorHeight: number;
}

// ═══════════════════════════════════════════════════════════
// 中間表現 — PDF から抽出した構造化データ
// Phase 8A のルールベース処理で生成する
// ═══════════════════════════════════════════════════════════

/** PDF から抽出した構造化データ（1階分） */
export interface ExtractedFloorData {
  /** 階数ラベル */
  floorLabel: string;
  /** 検出した壁の一覧 */
  walls: ExtractedWall[];
  /** 検出した開口部の一覧 */
  openings: ExtractedOpening[];
  /** 検出した部屋領域の一覧 */
  rooms: ExtractedRoom[];
  /** 抽出元の情報 */
  source: {
    fileId: string;
    /** ページ番号（0-indexed） */
    pageIndex: number;
    /** ページサイズ（mm） */
    pageWidth: number;
    pageHeight: number;
  };
}

/** 壁の最小表現: 始点・終点・厚さ */
export interface ExtractedWall {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** 壁厚（mm） */
  thickness: number;
  /** 推定の信頼度（0-1）。ルールベースでは固定値でもよい */
  confidence: number;
}

/** 開口部（ドア・窓）の最小表現 */
export interface ExtractedOpening {
  id: string;
  type: "door" | "window" | "unknown";
  /** 開口部の中心座標 */
  centerX: number;
  centerY: number;
  /** 開口幅（mm） */
  width: number;
  /** 開口高さ（mm） */
  height: number;
  /** 所属する壁の ID（特定できた場合） */
  wallId?: string;
  confidence: number;
}

/** 部屋領域の最小表現 */
export interface ExtractedRoom {
  id: string;
  /** 部屋名（テキスト認識で取得できた場合） */
  name?: string;
  /** 部屋の境界を構成する頂点（時計回り） */
  polygon: Array<{ x: number; y: number }>;
  /** 面積（㎡） */
  area?: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════
// パイプライン出力 — Worker → Route Handler に返すもの
// ═══════════════════════════════════════════════════════════

/** パイプラインの処理結果 */
export interface PipelineOutput {
  /** ジョブ ID */
  jobId: string;
  /** 処理成否 */
  success: boolean;
  /** 各階の抽出データ */
  floors: ExtractedFloorData[];
  /** 生成した成果物 */
  artifacts: PipelineArtifact[];
  /** エラー情報（失敗時） */
  error?: {
    code: string;
    message: string;
    /** 失敗したステップ */
    failedAt: string;
  };
  /** 処理統計 */
  stats: {
    /** 処理時間（ms） */
    durationMs: number;
    /** 検出した要素の概要 */
    totalWalls: number;
    totalOpenings: number;
    totalRooms: number;
  };
}

/** 生成された成果物の情報 */
export interface PipelineArtifact {
  /** 成果物の種類 */
  format: "ifc" | "structured_json";
  /** ストレージ上のパス */
  filePath: string;
  /** ファイルサイズ（bytes） */
  size: number;
}
