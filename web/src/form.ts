import { validateAttributes, type AttributeDef, type LayerDef, type ValidationResult } from '@minigis/shared';

export type FormInput = 'text' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select';

export interface FormField {
  name: string;
  label: string;
  input: FormInput;
  required: boolean;
  options?: string[];
  step?: '1' | 'any';
}

/** Raw form state: strings for inputs, booleans for checkboxes. */
export type FormValues = Record<string, string | boolean>;

const INPUT: Record<AttributeDef['type'], FormInput> = {
  text: 'text',
  textarea: 'textarea',
  integer: 'number',
  number: 'number',
  date: 'date',
  boolean: 'checkbox',
  select: 'select',
};

export function buildFormFields(def: LayerDef): FormField[] {
  return def.attributes.map((attr) => {
    const field: FormField = {
      name: attr.name,
      label: attr.label ?? attr.name,
      input: INPUT[attr.type],
      required: attr.required ?? false,
    };
    if (attr.type === 'select') field.options = [...(attr.options ?? [])];
    if (attr.type === 'integer') field.step = '1';
    if (attr.type === 'number') field.step = 'any';
    return field;
  });
}

/** Validates raw form state with the same rules as the server. */
export function formToValues(def: LayerDef, raw: FormValues): ValidationResult {
  return validateAttributes(def, raw);
}

const isTrue = (v: unknown) => v === true || v === 1 || v === 'true';

/** Form state for a new feature (config defaults) or an existing one (its properties). */
export function initialFormValues(def: LayerDef, props?: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  for (const attr of def.attributes) {
    const v = props ? props[attr.name] : attr.default;
    if (attr.type === 'boolean') out[attr.name] = isTrue(v);
    else out[attr.name] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}
