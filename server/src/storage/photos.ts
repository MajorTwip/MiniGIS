import { randomUUID } from 'node:crypto';
import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import gdal from 'gdal-async';
import sharp from 'sharp';
import { findLayer, type Mutex } from './db.js';

export type PhotoMeta = {
  id: string;
  layer: string;
  featureId: number;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
};

export class UnsupportedTypeError extends Error {
  constructor() {
    super('Nur JPEG, PNG und WebP werden unterstützt');
    this.name = 'UnsupportedTypeError';
  }
}

const FORMATS: Record<string, { ext: string; contentType: string }> = {
  jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
  png: { ext: 'png', contentType: 'image/png' },
  webp: { ext: 'webp', contentType: 'image/webp' },
};
const EXT_TYPES: Record<string, string> = Object.fromEntries(
  Object.values(FORMATS).map((f) => [f.ext, f.contentType]),
);

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class PhotoStore {
  constructor(
    private ds: gdal.Dataset,
    private dataDir: string,
    private mutex: Mutex,
  ) {}

  private get lyr(): gdal.Layer {
    const l = findLayer(this.ds, 'photos');
    if (!l) throw new Error('photos table missing');
    return l;
  }

  private dir(layer: string, fid: number): string {
    return join(this.dataDir, 'photos', layer, String(fid));
  }

  private toMeta(f: gdal.Feature): PhotoMeta {
    const g = (n: string) => f.fields.get(n) as string | number | null;
    return {
      id: g('id') as string,
      layer: g('layer') as string,
      featureId: g('feature_id') as number,
      filename: g('filename') as string,
      contentType: g('content_type') as string,
      size: g('size') as number,
      createdAt: g('created_at') as string,
      createdBy: (g('created_by') as string | null) ?? null,
    };
  }

  /** Rows matching an attribute filter, as [fid, meta]. Always clears the filter. */
  private rows(where: string): Array<{ fid: number; meta: PhotoMeta }> {
    const lyr = this.lyr;
    lyr.setAttributeFilter(where);
    try {
      const out: Array<{ fid: number; meta: PhotoMeta }> = [];
      lyr.features.forEach((f) => {
        out.push({ fid: f.fid, meta: this.toMeta(f) });
      });
      return out;
    } finally {
      lyr.setAttributeFilter(null as never);
    }
  }

  private paths(m: PhotoMeta): { path: string; thumbPath: string } {
    const ext = Object.entries(EXT_TYPES).find(([, t]) => t === m.contentType)?.[0] ?? 'jpg';
    const dir = this.dir(m.layer, m.featureId);
    return { path: join(dir, `${m.id}.${ext}`), thumbPath: join(dir, `${m.id}.thumb.jpg`) };
  }

  async add(
    layer: string,
    fid: number,
    file: { filename: string; contentType: string; data: Buffer },
    user: string | null,
  ): Promise<PhotoMeta> {
    let format: string | undefined;
    let thumb: Buffer;
    try {
      format = (await sharp(file.data).metadata()).format;
      if (!format || !FORMATS[format]) throw new UnsupportedTypeError();
      thumb = await sharp(file.data)
        .rotate()
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg()
        .toBuffer();
    } catch (e) {
      throw e instanceof UnsupportedTypeError ? e : new UnsupportedTypeError();
    }
    const fmt = FORMATS[format];
    const meta: PhotoMeta = {
      id: randomUUID(),
      layer,
      featureId: fid,
      filename: file.filename,
      contentType: fmt.contentType,
      size: file.data.length,
      createdAt: new Date().toISOString(),
      createdBy: user,
    };
    const { path, thumbPath } = this.paths(meta);

    return this.mutex.run(async () => {
      await mkdir(this.dir(layer, fid), { recursive: true });
      await writeFile(path, file.data);
      await writeFile(thumbPath, thumb);
      try {
        const lyr = this.lyr;
        const f = new gdal.Feature(lyr);
        f.fields.set('id', meta.id);
        f.fields.set('layer', layer);
        f.fields.set('feature_id', fid);
        f.fields.set('filename', meta.filename);
        f.fields.set('content_type', meta.contentType);
        f.fields.set('size', meta.size);
        f.fields.set('created_at', meta.createdAt);
        f.fields.set('created_by', user as never);
        lyr.features.add(f);
        lyr.flush();
      } catch (e) {
        await rm(path, { force: true });
        await rm(thumbPath, { force: true });
        await this.rmEmptyDir(layer, fid);
        throw e;
      }
      return meta;
    });
  }

  async list(layer: string, fid: number): Promise<PhotoMeta[]> {
    return this.rows(`layer = ${sqlStr(layer)} AND feature_id = ${Math.trunc(fid)}`)
      .map((r) => r.meta)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<{ meta: PhotoMeta; path: string; thumbPath: string } | null> {
    const row = this.rows(`id = ${sqlStr(id)}`)[0];
    return row ? { meta: row.meta, ...this.paths(row.meta) } : null;
  }

  async delete(id: string): Promise<boolean> {
    return this.mutex.run(async () => {
      const row = this.rows(`id = ${sqlStr(id)}`)[0];
      if (!row) return false;
      await this.removeRow(row);
      await this.rmEmptyDir(row.meta.layer, row.meta.featureId);
      return true;
    });
  }

  /**
   * Not wrapped in the mutex on purpose: FeatureStore.delete calls it as `onDelete`
   * from inside its own mutex.run, and the Mutex is not re-entrant.
   */
  async deleteForFeature(layer: string, fid: number): Promise<void> {
    const rows = this.rows(`layer = ${sqlStr(layer)} AND feature_id = ${Math.trunc(fid)}`);
    for (const row of rows) await this.removeRow(row);
    await this.rmEmptyDir(layer, fid);
  }

  private async removeRow(row: { fid: number; meta: PhotoMeta }): Promise<void> {
    const { path, thumbPath } = this.paths(row.meta);
    await rm(path, { force: true });
    await rm(thumbPath, { force: true });
    this.lyr.features.remove(row.fid);
    this.lyr.flush();
  }

  private async rmEmptyDir(layer: string, fid: number): Promise<void> {
    try {
      await rmdir(this.dir(layer, fid));
    } catch {
      // not empty or already gone
    }
  }
}
