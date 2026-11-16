import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { isCurrent, photoErrorMessage } from '../src/photos';

describe('photoErrorMessage', () => {
  it('prefers the server message on 413', () => {
    expect(photoErrorMessage(new ApiError(413, { file: 'Zu viele Dateien (max. 20)' }), 15)).toBe('Zu viele Dateien (max. 20)');
  });

  it('maps 413 with the configured limit', () => {
    expect(photoErrorMessage(new ApiError(413), 15)).toBe('Datei zu gross (max. 15 MB)');
  });
  it('maps 413 without a limit', () => {
    expect(photoErrorMessage(new ApiError(413))).toBe('Datei zu gross');
  });
  it('maps 415 to the server message', () => {
    expect(photoErrorMessage(new ApiError(415, { file: 'Nur JPEG, PNG oder WebP' }))).toBe('Nur JPEG, PNG oder WebP');
  });
  it('maps 415 without server message', () => {
    expect(photoErrorMessage(new ApiError(415))).toBe('Nur JPEG, PNG oder WebP');
  });
  it('falls back for other errors', () => {
    expect(photoErrorMessage(new ApiError(500))).toBe('Fehler beim Hochladen');
    expect(photoErrorMessage(new TypeError('x'))).toBe('Fehler beim Hochladen');
  });
});

describe('isCurrent', () => {
  it('matches the same layer and id', () => {
    expect(isCurrent({ layer: 'a', id: 1 }, { layer: 'a', id: 1 })).toBe(true);
  });
  it('rejects same id on another layer', () => {
    expect(isCurrent({ layer: 'a', id: 1 }, { layer: 'b', id: 1 })).toBe(false);
  });
  it('rejects another id', () => {
    expect(isCurrent({ layer: 'a', id: 1 }, { layer: 'a', id: 2 })).toBe(false);
  });
});
