import { describe, expect, it } from 'vitest';
import type { LayerDef } from '@minigis/shared';
import { buildFormFields, formToValues, initialFormValues } from '../src/form';

const abfallcontainer: LayerDef = {
  title: 'Abfallcontainer',
  geometry: 'point',
  photos: true,
  snapToRoads: false,
  style: { color: '#2e7d32', radius: 7 },
  label: 'nummer',
  attributes: [
    { name: 'nummer', label: 'Nummer', type: 'text', required: true },
    { name: 'typ', label: 'Typ', type: 'select', options: ['Glas', 'Alu/Blech', 'Altöl', 'Grüngut', 'Papier'] },
    { name: 'volumen', label: 'Volumen (l)', type: 'integer' },
    { name: 'geleert', label: 'Letzte Leerung', type: 'date' },
    { name: 'bemerkung', label: 'Bemerkung', type: 'textarea' },
  ],
};

const misc: LayerDef = {
  title: 'Misc',
  geometry: 'polygon',
  photos: false,
  snapToRoads: false,
  style: { color: '#000' },
  attributes: [
    { name: 'flaeche', type: 'number' },
    { name: 'bekaempft', label: 'Bekämpft', type: 'boolean', default: true },
    { name: 'art', type: 'text', default: 'Andere' },
  ],
};

const field = (def: LayerDef, name: string) => buildFormFields(def).find((f) => f.name === name)!;

describe('buildFormFields', () => {
  it('maps the abfallcontainer attributes to inputs', () => {
    expect(field(abfallcontainer, 'typ').input).toBe('select');
    expect(field(abfallcontainer, 'typ').options).toHaveLength(5);
    expect(field(abfallcontainer, 'volumen').input).toBe('number');
    expect(field(abfallcontainer, 'volumen').step).toBe('1');
    expect(field(abfallcontainer, 'bemerkung').input).toBe('textarea');
    expect(field(abfallcontainer, 'nummer').required).toBe(true);
    expect(field(abfallcontainer, 'nummer').label).toBe('Nummer');
    expect(field(abfallcontainer, 'geleert').input).toBe('date');
  });

  it('uses step any for numbers, checkbox for booleans and the name as fallback label', () => {
    expect(field(misc, 'flaeche')).toMatchObject({ input: 'number', step: 'any', label: 'flaeche', required: false });
    expect(field(misc, 'bekaempft').input).toBe('checkbox');
  });
});

describe('formToValues', () => {
  it('reports errors for an empty required field and a non-integer', () => {
    const r = formToValues(abfallcontainer, { nummer: '', volumen: '12a' });
    expect(Object.keys(r.errors).sort()).toEqual(['nummer', 'volumen']);
    expect(r.errors.nummer).toBe('Pflichtfeld');
  });

  it('turns empty optional fields into null and converts types', () => {
    const r = formToValues(abfallcontainer, { nummer: 'A-12', typ: 'Grüngut', volumen: '800', geleert: '', bemerkung: '' });
    expect(r.errors).toEqual({});
    expect(r.values).toEqual({ nummer: 'A-12', typ: 'Grüngut', volumen: 800, geleert: null, bemerkung: null });
  });

  it('keeps checkbox booleans', () => {
    expect(formToValues(misc, { flaeche: '', bekaempft: false, art: '' }).values).toEqual({
      flaeche: null,
      bekaempft: false,
      art: null,
    });
  });
});

describe('initialFormValues', () => {
  it('uses config defaults for a new feature', () => {
    expect(initialFormValues(misc)).toEqual({ flaeche: '', bekaempft: true, art: 'Andere' });
  });

  it('uses existing values and stringifies them for inputs', () => {
    const v = initialFormValues(abfallcontainer, { nummer: 'A-1', volumen: 800, typ: null });
    expect(v).toEqual({ nummer: 'A-1', typ: '', volumen: '800', geleert: '', bemerkung: '' });
    expect(initialFormValues(misc, { bekaempft: 1 }).bekaempft).toBe(true);
  });
});
