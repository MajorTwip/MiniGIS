import type { AppConfig } from '@minigis/shared';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type FeatureProps = Record<string, string | number | boolean | null>;
export type ApiFeature = Feature<Geometry, FeatureProps>;
export type ApiFeatureCollection = FeatureCollection<Geometry, FeatureProps>;
export interface FeatureBody {
  geometry?: Geometry;
  properties?: Record<string, unknown>;
}
export interface PhotoMeta {
  id: string;
  layer: string;
  featureId: number;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public errors?: Record<string, string>,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: { errors?: Record<string, string>; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, body.errors, body.error);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const seg = encodeURIComponent;
const feats = (layer: string) => `/api/layers/${seg(layer)}/features`;

export const api = {
  getConfig: () => request<AppConfig>('/api/config'),
  listFeatures: (layer: string) => request<ApiFeatureCollection>(feats(layer)),
  createFeature: (layer: string, f: FeatureBody) => request<ApiFeature>(feats(layer), json('POST', f)),
  updateFeature: (layer: string, id: number, f: FeatureBody) =>
    request<ApiFeature>(`${feats(layer)}/${id}`, json('PUT', f)),
  deleteFeature: (layer: string, id: number) =>
    request<void>(`${feats(layer)}/${id}`, { method: 'DELETE' }),
  listPhotos: (layer: string, id: number) => request<PhotoMeta[]>(`${feats(layer)}/${id}/photos`),
  uploadPhotos: (layer: string, id: number, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    return request<PhotoMeta[]>(`${feats(layer)}/${id}/photos`, { method: 'POST', body: form });
  },
  deletePhoto: (id: string) => request<void>(`/api/photos/${seg(id)}`, { method: 'DELETE' }),
  photoUrl: (id: string) => `/api/photos/${seg(id)}`,
  thumbUrl: (id: string) => `/api/photos/${seg(id)}/thumb`,
};
