import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, 'aidl');

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(message);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {unknown[]}
 */
function asArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} step
 * @returns {Record<string, unknown>}
 */
function compileComputeStep(step) {
  if (typeof step.compute === 'string') {
    return step;
  }

  const name = asString(step.name, 'compute step name');

  if ('add' in step) {
    return { name, compute: 'math.add', values: asArray(step.add, `${name}.add`) };
  }
  if ('sum' in step) {
    return { name, compute: 'math.sum', values: asArray(step.sum, `${name}.sum`) };
  }
  if ('mul' in step) {
    return { name, compute: 'math.mul', values: asArray(step.mul, `${name}.mul`) };
  }
  if ('sub' in step) {
    return { name, compute: 'math.sub', values: asArray(step.sub, `${name}.sub`) };
  }
  if ('floor_div' in step) {
    const parts = asArray(step.floor_div, `${name}.floor_div`);
    if (parts.length !== 2) {
      fail(`${name}.floor_div must have exactly 2 elements [dividend, divisor].`);
    }
    return { name, compute: 'math.floor_div', dividend: parts[0], divisor: parts[1] };
  }
  if ('if' in step) {
    const spec = asObject(step.if, `${name}.if`);
    return {
      name,
      compute: 'logic.if',
      condition: spec.condition,
      then: spec.then,
      else: spec.else,
    };
  }
  if ('get' in step) {
    const spec = asObject(step.get, `${name}.get`);
    return {
      name,
      compute: 'list.get',
      values: spec.values,
      index: spec.index,
    };
  }
  if ('filter' in step) {
    const spec = asObject(step.filter, `${name}.filter`);
    return {
      name,
      compute: 'list.filter',
      items: spec.items,
      where: spec.where,
    };
  }
  if ('min_by' in step) {
    const spec = asObject(step.min_by, `${name}.min_by`);
    return {
      name,
      compute: 'list.min_by',
      items: spec.items,
      path: spec.path,
      ...(spec.allow_empty !== undefined ? { allow_empty: spec.allow_empty } : {}),
    };
  }
  if ('max_by' in step) {
    const spec = asObject(step.max_by, `${name}.max_by`);
    return {
      name,
      compute: 'list.max_by',
      items: spec.items,
      path: spec.path,
      ...(spec.allow_empty !== undefined ? { allow_empty: spec.allow_empty } : {}),
    };
  }
  if ('coalesce' in step) {
    return {
      name,
      compute: 'coalesce',
      values: asArray(step.coalesce, `${name}.coalesce`),
    };
  }
  if ('eq' in step || 'ne' in step || 'gt' in step || 'gte' in step || 'lt' in step || 'lte' in step) {
    const key = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].find((item) => item in step);
    const parts = asArray(step[key], `${name}.${key}`);
    if (parts.length !== 2) {
      fail(`${name}.${key} must have exactly 2 elements [left, right].`);
    }
    const map = {
      eq: 'compare.equals',
      ne: 'compare.not_equals',
      gt: 'compare.gt',
      gte: 'compare.gte',
      lt: 'compare.lt',
      lte: 'compare.lte',
    };
    return { name, compute: map[key], left: parts[0], right: parts[1] };
  }
  if ('pda' in step) {
    const spec = asObject(step.pda, `${name}.pda`);
    return {
      name,
      compute: 'pda(seed_spec)',
      ...(spec.program_id !== undefined ? { program_id: spec.program_id } : {}),
      ...(spec.map_over !== undefined ? { map_over: spec.map_over } : {}),
      seeds: spec.seeds,
    };
  }

  fail(`Unsupported compute shorthand for step ${name}.`);
}

/**
 * @param {Record<string, unknown>} expand
 * @returns {Record<string, unknown>}
 */
function compileExpand(expand) {
  const out = { ...expand };
  const compute = expand.compute;
  if (compute === undefined) {
    return out;
  }

  const steps = asArray(compute, 'expand.compute');
  out.compute = steps.map((raw, index) => compileComputeStep(asObject(raw, `expand.compute[${index}]`)));
  return out;
}

/**
 * @param {Record<string, unknown>} template
 * @returns {Record<string, unknown>}
 */
function compileTemplate(template) {
  const out = { ...template };
  const expand = asObject(template.expand, 'template.expand');
  out.expand = compileExpand(expand);
  return out;
}

/**
 * @param {Record<string, unknown>} action
 * @returns {Record<string, unknown>}
 */
function compileOperation(action) {
  const out = { ...action };
  if (action.useTemplate !== undefined) {
    out.use = action.useTemplate;
    delete out.useTemplate;
  }
  if (!Array.isArray(out.use)) {
    fail('operation.use (or useTemplate) must be an array.');
  }
  return out;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} sourceFile
 * @returns {{ outputPath: string; output: Record<string, unknown> }}
 */
function compileAidl(source, sourceFile) {
  const kind = asString(source.kind, `${sourceFile}.kind`);
  if (kind !== 'aidl.v0.1') {
    fail(`${sourceFile}.kind must be aidl.v0.1`);
  }

  const target = asObject(source.target, `${sourceFile}.target`);
  const outputPath = asString(target.output, `${sourceFile}.target.output`);
  const schema = asString(target.schema, `${sourceFile}.target.schema`);
  const schemaPath = asString(target.schemaPath, `${sourceFile}.target.schemaPath`);
  const version = asString(target.version, `${sourceFile}.target.version`);
  const protocolId = asString(target.protocolId, `${sourceFile}.target.protocolId`);
  const rootLabel = source.label === undefined ? undefined : asString(source.label, `${sourceFile}.label`);

  const templatesRaw = asObject(source.templates, `${sourceFile}.templates`);
  const operationsRaw = asObject(source.operations, `${sourceFile}.operations`);
  const appsRaw = source.apps === undefined ? undefined : asObject(source.apps, `${sourceFile}.apps`);
  const sourcesRaw = source.sources === undefined ? undefined : asObject(source.sources, `${sourceFile}.sources`);
  if (source.user_forms !== undefined) {
    fail(`${sourceFile}.user_forms is no longer supported. Use apps (schema v0.6 app-first).`);
  }

  /** @type {Record<string, unknown>} */
  const templates = {};
  for (const [templateName, templateValue] of Object.entries(templatesRaw)) {
    templates[templateName] = compileTemplate(asObject(templateValue, `${sourceFile}.templates.${templateName}`));
  }

  /** @type {Record<string, unknown>} */
  const operations = {};
  for (const [operationName, operationValue] of Object.entries(operationsRaw)) {
    operations[operationName] = compileOperation(
      asObject(operationValue, `${sourceFile}.operations.${operationName}`),
    );
  }

  const output = {
    $schema: schemaPath,
    schema,
    version,
    protocolId,
    ...(rootLabel ? { label: rootLabel } : {}),
    ...(sourcesRaw ? { sources: sourcesRaw } : {}),
    templates,
    operations,
    ...(appsRaw ? { apps: appsRaw } : {}),
  };

  return {
    outputPath: path.join(ROOT, outputPath),
    output,
  };
}

/**
 * @param {string} filepath
 * @returns {Promise<{ sourceFile: string; compiled: { outputPath: string; output: Record<string, unknown> }}>}
 */
async function loadAndCompileFile(filepath) {
  const sourceFile = path.relative(ROOT, filepath);
  const raw = await fs.readFile(filepath, 'utf8');
  const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
  const compiled = compileAidl(parsed, sourceFile);
  return { sourceFile, compiled };
}

async function main() {
  const checkMode = process.argv.includes('--check');

  const entries = await fs.readdir(INPUT_DIR, { withFileTypes: true });
  const aidlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.aidl.json'))
    .map((entry) => path.join(INPUT_DIR, entry.name))
    .sort();

  if (aidlFiles.length === 0) {
    console.log('No .aidl.json files found.');
    return;
  }

  /** @type {string[]} */
  const updates = [];

  for (const file of aidlFiles) {
    const { sourceFile, compiled } = await loadAndCompileFile(file);
    const text = `${JSON.stringify(compiled.output, null, 2)}\n`;

    if (checkMode) {
      const current = await fs.readFile(compiled.outputPath, 'utf8').catch(() => null);
      if (current !== text) {
        updates.push(`${sourceFile} -> ${path.relative(ROOT, compiled.outputPath)}`);
      }
      continue;
    }

    await fs.mkdir(path.dirname(compiled.outputPath), { recursive: true });
    await fs.writeFile(compiled.outputPath, text, 'utf8');
    updates.push(`${sourceFile} -> ${path.relative(ROOT, compiled.outputPath)}`);
  }

  if (checkMode) {
    if (updates.length > 0) {
      console.error('AIDL outputs are out of date:');
      for (const item of updates) {
        console.error(`- ${item}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log('AIDL outputs are up to date.');
    return;
  }

  console.log('Compiled AIDL:');
  for (const item of updates) {
    console.log(`- ${item}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
