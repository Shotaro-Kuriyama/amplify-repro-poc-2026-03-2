/**
 * File storage abstraction for uploaded files.
 *
 * Phase 7.5: ファイル実体の保持を開始する。
 * 現在は LocalFileStorage（ローカルディスク）を使用。
 * 将来は S3 / GCS などに差し替え可能な設計にしている。
 */

import { promises as fs } from "fs";
import path from "path";

// ── Storage interface ──

export interface FileStorage {
  /** ファイルを保存し、保存先パスを返す */
  save(fileId: string, buffer: Buffer, originalName: string): Promise<string>;

  /** 保存済みファイルのパスを返す（存在しない場合 null） */
  getPath(fileId: string): Promise<string | null>;

  /** 保存済みファイルの Buffer を返す（存在しない場合 null） */
  read(fileId: string): Promise<Buffer | null>;
}

// ── Local filesystem implementation ──

/**
 * ローカルディスクにファイルを保存する実装。
 *
 * 保存先: {baseDir}/{fileId}/{originalName}
 * - fileId ごとにディレクトリを分けることで、同名ファイルの衝突を防ぐ
 * - originalName を保持することで、後から参照しやすくする
 *
 * 制約:
 * - サーバー再起動後もファイルは残る（in-memory メタデータは消える）
 * - Vercel / serverless 環境では /tmp 以外に書けない場合がある
 * - 本番環境では S3FileStorage 等に差し替えること
 */
export class LocalFileStorage implements FileStorage {
  private baseDir: string;
  /** fileId → ファイルパスのキャッシュ（ディスクアクセス削減用） */
  private pathCache = new Map<string, string>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), "data", "uploads");
  }

  async save(
    fileId: string,
    buffer: Buffer,
    originalName: string
  ): Promise<string> {
    const dir = path.join(this.baseDir, fileId);
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, originalName);
    await fs.writeFile(filePath, buffer);

    this.pathCache.set(fileId, filePath);
    return filePath;
  }

  async getPath(fileId: string): Promise<string | null> {
    // キャッシュにあればそれを返す
    const cached = this.pathCache.get(fileId);
    if (cached) {
      try {
        await fs.access(cached);
        return cached;
      } catch {
        this.pathCache.delete(fileId);
      }
    }

    // ディレクトリを探索
    const dir = path.join(this.baseDir, fileId);
    try {
      const entries = await fs.readdir(dir);
      if (entries.length > 0) {
        const filePath = path.join(dir, entries[0]);
        this.pathCache.set(fileId, filePath);
        return filePath;
      }
    } catch {
      // ディレクトリが存在しない
    }

    return null;
  }

  async read(fileId: string): Promise<Buffer | null> {
    const filePath = await this.getPath(fileId);
    if (!filePath) return null;

    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }
}

// ── Singleton instance ──

/**
 * デフォルトのファイルストレージインスタンス。
 * Route Handler から直接利用する。
 * 将来は DI や環境変数で実装を切り替える想定。
 */
export const fileStorage: FileStorage = new LocalFileStorage();
