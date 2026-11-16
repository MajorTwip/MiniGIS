import { z } from 'zod';

export const GEOMETRY_TYPES = ['point', 'line', 'polygon'] as const;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];

export const ATTRIBUTE_TYPES = [
  'text',
  'textarea',
  'integer',
  'number',
  'date',
  'boolean',
  'select',
] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const RESERVED_COLUMNS: readonly string[] = [
  'fid',
  'geom',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
];

const ID_RE = /^[a-z][a-z0-9_]*$/;
const idMessage = 'must match ^[a-z][a-z0-9_]*$';

const attributeSchema = z
  .object({
    name: z
      .string()
      .regex(ID_RE, idMessage)
      .refine((n) => !RESERVED_COLUMNS.includes(n), {
        message: `is a reserved name (${RESERVED_COLUMNS.join(', ')})`,
      }),
    label: z.string().optional(),
    type: z.enum(ATTRIBUTE_TYPES),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(z.string()).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.type === 'select' && (!a.options || a.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'select attributes need a non-empty options list',
      });
    }
  });
export type AttributeDef = z.infer<typeof attributeSchema>;

export const SYMBOL_SHAPES = [
  'circle',
  'square',
  'diamond',
  'triangle',
  'triangle-down',
  'pentagon',
  'hexagon',
  'star',
] as const;
export type SymbolShape = (typeof SYMBOL_SHAPES)[number];

const symbolSchema = z.object({
  shape: z.enum(SYMBOL_SHAPES),
  color: z.string(),
});
export type SymbolDef = z.infer<typeof symbolSchema>;

const styleSchema = z.object({
  color: z.string(),
  fill: z.string().optional(),
  radius: z.number().positive().optional(),
  /** Point layers: pick the symbol by the value of this select attribute. */
  symbolBy: z.string().optional(),
  /** Symbol per attribute value; values without an entry use `color` as a circle. */
  symbols: z.record(z.string(), symbolSchema).optional(),
});

const layerSchema = z
  .object({
    title: z.string(),
    geometry: z.enum(GEOMETRY_TYPES),
    photos: z.boolean().default(false),
    style: styleSchema,
    label: z.string().optional(),
    attributes: z.array(attributeSchema),
  })
  .superRefine((l, ctx) => {
    const seen = new Set<string>();
    l.attributes.forEach((a, i) => {
      if (seen.has(a.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attributes', i, 'name'],
          message: `duplicate attribute name "${a.name}"`,
        });
      }
      seen.add(a.name);
    });
    if (l.style.symbolBy !== undefined) {
      const attr = l.attributes.find((a) => a.name === l.style.symbolBy);
      if (!attr || attr.type !== 'select') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['style', 'symbolBy'],
          message: `symbolBy "${l.style.symbolBy}" must name a select attribute of this layer`,
        });
      } else {
        for (const value of Object.keys(l.style.symbols ?? {})) {
          if (!attr.options?.includes(value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['style', 'symbols', value],
              message: `"${value}" is not an option of ${attr.name}`,
            });
          }
        }
      }
    }
    if (l.label !== undefined && !seen.has(l.label)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['label'],
        message: `label "${l.label}" is not an attribute of this layer`,
      });
    }
  });
export type LayerDef = z.infer<typeof layerSchema>;

export type TreeNode = { group: string; children: TreeNode[] } | { layer: string };

const treeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.union([
    z.object({ group: z.string(), children: z.array(treeNodeSchema) }).strict(),
    z.object({ layer: z.string() }).strict(),
  ]),
);

function treeLayers(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if ('layer' in n) out.push(n.layer);
    else treeLayers(n.children, out);
  }
  return out;
}

export const configSchema = z
  .object({
    app: z
      .object({
        title: z.string(),
        userHeader: z.string().default('X-Authentik-Username'),
        maxPhotoMb: z.number().positive().default(15),
      })
      .default({ title: 'MiniGIS' }),
    map: z.object({
      center: z.tuple([z.number(), z.number()]),
      zoom: z.number(),
    }),
    basemaps: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        layer: z.string(),
        default: z.boolean().optional(),
      }),
    ),
    tree: z.array(treeNodeSchema),
    layers: z.record(z.string().regex(ID_RE, idMessage), layerSchema),
  })
  .superRefine((c, ctx) => {
    for (const id of treeLayers(c.tree)) {
      if (!(id in c.layers)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tree'],
          message: `tree references undefined layer "${id}"`,
        });
      }
    }
  });
export type AppConfig = z.infer<typeof configSchema>;
