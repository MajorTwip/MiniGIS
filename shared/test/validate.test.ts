import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { configSchema, validateAttributes, type LayerDef } from '../src/index';

const cfgPath = fileURLToPath(new URL('../../config/minigis.yaml', import.meta.url));
const layer: LayerDef = configSchema.parse(yaml.parse(readFileSync(cfgPath, 'utf8'))).layers
  .abfallcontainer;

const withDefaults: LayerDef = {
  ...layer,
  attributes: [
    { name: 'typ', type: 'select', options: ['Glas', 'Papier'], default: 'Glas' },
    { name: 'aktiv', type: 'boolean', default: true },
    { name: 'name', type: 'text', required: true, default: 'X' },
  ],
};

describe('validateAttributes', () => {
  it('required empty string errors', () => {
    expect(validateAttributes(layer, { nummer: '' }).errors.nummer).toBe('Pflichtfeld');
    expect(validateAttributes(layer, { nummer: '   ' }).errors.nummer).toBe('Pflichtfeld');
  });

  it('optional empty becomes null', () => {
    const r = validateAttributes(layer, { nummer: 'A1', bemerkung: '' });
    expect(r.values.bemerkung).toBeNull();
    expect(r.errors.bemerkung).toBeUndefined();
  });

  it('integer rejects 12a and accepts 240', () => {
    expect(validateAttributes(layer, { volumen: '12a' }).errors.volumen).toBe('Ganze Zahl erwartet');
    expect(validateAttributes(layer, { volumen: '1.5' }).errors.volumen).toBe('Ganze Zahl erwartet');
    expect(validateAttributes(layer, { volumen: '240' }).values.volumen).toBe(240);
    expect(validateAttributes(layer, { volumen: 240 }).values.volumen).toBe(240);
  });

  it('number accepts 1.5', () => {
    const l: LayerDef = { ...layer, attributes: [{ name: 'x', type: 'number' }] };
    expect(validateAttributes(l, { x: '1.5' }).values.x).toBe(1.5);
    expect(validateAttributes(l, { x: 1.5 }).values.x).toBe(1.5);
    expect(validateAttributes(l, { x: 'abc' }).errors.x).toBe('Zahl erwartet');
  });

  it('boolean accepts native and string', () => {
    const l: LayerDef = { ...layer, attributes: [{ name: 'b', type: 'boolean' }] };
    expect(validateAttributes(l, { b: 'true' }).values.b).toBe(true);
    expect(validateAttributes(l, { b: false }).values.b).toBe(false);
    expect(validateAttributes(l, { b: 'ja' }).errors.b).toBe('Ja/Nein erwartet');
  });

  it('date rejects 2026-13-01 and non-calendar dates', () => {
    expect(validateAttributes(layer, { geleert: '2026-13-01' }).errors.geleert).toBe('Ungültiges Datum');
    expect(validateAttributes(layer, { geleert: '2026-02-30' }).errors.geleert).toBe('Ungültiges Datum');
    expect(validateAttributes(layer, { geleert: '2026-02-28' }).values.geleert).toBe('2026-02-28');
  });

  it('select rejects value not in options, accepts Grüngut', () => {
    expect(validateAttributes(layer, { typ: 'Sand' }).errors.typ).toBe('Ungültiger Wert');
    expect(validateAttributes(layer, { typ: 'Grüngut' }).values.typ).toBe('Grüngut');
  });

  it('unknown keys dropped', () => {
    expect('foo' in validateAttributes(layer, { foo: 1 }).values).toBe(false);
  });

  it('partial update: absent keys give no values and no errors', () => {
    const r = validateAttributes(layer, { volumen: 5 });
    expect(r.values).toEqual({ volumen: 5 });
    expect(r.errors).toEqual({});
  });

  it('create: absent required key errors, absent optional key is null', () => {
    const r = validateAttributes(layer, {}, { applyDefaults: true });
    expect(r.errors.nummer).toBe('Pflichtfeld');
    expect(r.values.volumen).toBeNull();
  });

  it('default applied when key absent on create', () => {
    const r = validateAttributes(withDefaults, {}, { applyDefaults: true });
    expect(r.values).toEqual({ typ: 'Glas', aktiv: true, name: 'X' });
    expect(r.errors).toEqual({});
    expect(validateAttributes(withDefaults, {}).values).toEqual({});
  });

  it('explicit empty is not replaced by default', () => {
    const r = validateAttributes(withDefaults, { typ: '' }, { applyDefaults: true });
    expect(r.values.typ).toBeNull();
  });
});
