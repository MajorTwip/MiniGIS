import { ApiError } from './api';

/** German user-facing message for a failed photo upload. */
export function photoErrorMessage(err: unknown, maxPhotoMb?: number): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return err.errors?.file ?? ( maxPhotoMb ? `Datei zu gross (max. ${maxPhotoMb} MB)` : 'Datei zu gross');
    if (err.status === 415) return err.errors?.file ?? 'Nur JPEG, PNG oder WebP';
  }
  return 'Fehler beim Hochladen';
}

export interface FeatureRef {
  layer: string;
  id: number | null;
}

/** True when an async result captured for `captured` still belongs to the feature now shown. */
export function isCurrent(captured: FeatureRef, now: FeatureRef): boolean {
  return captured.layer === now.layer && captured.id === now.id;
}
