import type { AttributeDef, LayerDef } from './config-schema.js';

export type AttributeValue = string | number | boolean | null;
export interface ValidationResult {
  values: Record<string, AttributeValue>;
  errors: Record<string, string>;
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?\d+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Returns the cleaned value, or an error message. Input is known to be non-empty. */
function convert(attr: AttributeDef, raw: unknown): { value: AttributeValue } | { error: string } {
  switch (attr.type) {
    case 'text':
    case 'textarea':
      return typeof raw === 'string' ? { value: raw } : { error: 'Text erwartet' };
    case 'integer': {
      if (typeof raw === 'number' && Number.isSafeInteger(raw)) return { value: raw };
      if (typeof raw === 'string' && INTEGER_RE.test(raw.trim())) {
        const n = Number(raw.trim());
        if (Number.isSafeInteger(n)) return { value: n };
      }
      return { error: 'Ganze Zahl erwartet' };
    }
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw };
      if (typeof raw === 'string' && NUMBER_RE.test(raw.trim())) {
        const n = Number(raw.trim());
        if (Number.isFinite(n)) return { value: n };
      }
      return { error: 'Zahl erwartet' };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'Ja/Nein erwartet' };
    }
    case 'date':
      return typeof raw === 'string' && isRealDate(raw.trim())
        ? { value: raw.trim() }
        : { error: 'Ungültiges Datum' };
    case 'select':
      return typeof raw === 'string' && (attr.options ?? []).includes(raw)
        ? { value: raw }
        : { error: 'Ungültiger Wert' };
  }
}

export function validateAttributes(
  layer: LayerDef,
  input: Record<string, unknown>,
  opts: { applyDefaults?: boolean } = {},
): ValidationResult {
  const values: Record<string, AttributeValue> = {};
  const errors: Record<string, string> = {};

  for (const attr of layer.attributes) {
    const present = Object.prototype.hasOwnProperty.call(input, attr.name);
    if (!present && !opts.applyDefaults) continue;

    let raw: unknown = present ? input[attr.name] : undefined;
    if (!present && attr.default !== undefined) raw = attr.default;

    if (isEmpty(raw)) {
      if (attr.required) errors[attr.name] = 'Pflichtfeld';
      else values[attr.name] = null;
      continue;
    }
    const r = convert(attr, raw);
    if ('error' in r) errors[attr.name] = r.error;
    else values[attr.name] = r.value;
  }
  return { values, errors };
}
