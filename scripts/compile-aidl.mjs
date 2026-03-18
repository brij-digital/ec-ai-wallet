import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, 'aidl');
const COMPUTE_OUTPUT_DIR = path.join(ROOT, 'public/compute');
const COMPUTE_LIBRARY_KIND = 'aidl.compute.v0.1';

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
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Record<string, unknown>} libraries
 * @param {string} sourceFile
 * @returns {Record<string, Record<string, unknown>[]>}
 */
function parseComputeLibraries(libraries, sourceFile) {
  /** @type {Record<string, Record<string, unknown>[]>} */
  const output = {};
  for (const [libraryName, rawSteps] of Object.entries(libraries)) {
    const steps = asArray(rawSteps, `${sourceFile}.libraries.${libraryName}`);
    output[libraryName] = steps.map((rawStep, index) =>
      asObject(rawStep, `${sourceFile}.libraries.${libraryName}[${index}]`),
    );
  }
  return output;
}

/**
 * @returns {Promise<{ libraries: Record<string, Record<string, unknown>[]>; files: string[] }>}
 */
async function loadComputeLibraries() {
  const entries = await fs.readdir(INPUT_DIR, { withFileTypes: true });
  const libraryFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.compute.json'))
    .map((entry) => path.join(INPUT_DIR, entry.name))
    .sort();

  /** @type {Record<string, Record<string, unknown>[]>} */
  const libraries = {};
  for (const file of libraryFiles) {
    const sourceFile = path.relative(ROOT, file);
    const raw = await fs.readFile(file, 'utf8');
    const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
    const kind = asString(parsed.kind, `${sourceFile}.kind`);
    if (kind !== COMPUTE_LIBRARY_KIND) {
      fail(`${sourceFile}.kind must be ${COMPUTE_LIBRARY_KIND}`);
    }
    const rawLibraries = asObject(parsed.libraries, `${sourceFile}.libraries`);
    const parsedLibraries = parseComputeLibraries(rawLibraries, sourceFile);
    for (const [name, steps] of Object.entries(parsedLibraries)) {
      if (libraries[name]) {
        fail(`Duplicate compute library name ${name} in ${sourceFile}.`);
      }
      libraries[name] = steps;
    }
  }

  return { libraries, files: libraryFiles };
}

/**
 * @param {string[]} sourceFiles
 * @param {boolean} checkMode
 * @param {string[]} updates
 * @returns {Promise<void>}
 */
async function syncComputeOutputs(sourceFiles, checkMode, updates) {
  await fs.mkdir(COMPUTE_OUTPUT_DIR, { recursive: true });

  const expectedNames = new Set(sourceFiles.map((file) => path.basename(file)));
  const existingEntries = await fs.readdir(COMPUTE_OUTPUT_DIR, { withFileTypes: true });
  const existingFiles = existingEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.compute.json'))
    .map((entry) => entry.name)
    .sort();

  for (const name of existingFiles) {
    if (expectedNames.has(name)) {
      continue;
    }
    const outputPath = path.join(COMPUTE_OUTPUT_DIR, name);
    if (checkMode) {
      updates.push(`stale compute output: ${path.relative(ROOT, outputPath)}`);
      continue;
    }
    await fs.unlink(outputPath);
    updates.push(`removed stale compute output: ${path.relative(ROOT, outputPath)}`);
  }

  for (const sourceFile of sourceFiles) {
    const sourceRaw = await fs.readFile(sourceFile, 'utf8');
    const sourceJson = JSON.parse(sourceRaw);
    const outputText = `${JSON.stringify(sourceJson, null, 2)}\n`;
    const outputPath = path.join(COMPUTE_OUTPUT_DIR, path.basename(sourceFile));

    if (checkMode) {
      const current = await fs.readFile(outputPath, 'utf8').catch(() => null);
      if (current !== outputText) {
        updates.push(`${path.relative(ROOT, sourceFile)} -> ${path.relative(ROOT, outputPath)}`);
      }
      continue;
    }

    await fs.writeFile(outputPath, outputText, 'utf8');
    updates.push(`${path.relative(ROOT, sourceFile)} -> ${path.relative(ROOT, outputPath)}`);
  }
}

/**
 * @param {Record<string, unknown>} expand
 * @param {Record<string, Record<string, unknown>[]>} computeLibraries
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function compileExpand(expand, computeLibraries, label) {
  const out = { ...expand };
  const refsRaw =
    expand.compute_refs === undefined ? [] : asArray(expand.compute_refs, `${label}.compute_refs`);
  const refs = refsRaw.map((entry, index) => asString(entry, `${label}.compute_refs[${index}]`));
  const inlineCompute = expand.compute === undefined ? [] : asArray(expand.compute, `${label}.compute`);

  if (refs.length === 0 && inlineCompute.length === 0) {
    delete out.compute_refs;
    return out;
  }

  /** @type {Record<string, unknown>[]} */
  const steps = [];
  for (const ref of refs) {
    const librarySteps = computeLibraries[ref];
    if (!librarySteps) {
      fail(`${label}.compute_refs references unknown library ${ref}.`);
    }
    steps.push(...librarySteps.map((entry) => asObject(cloneJson(entry), `${label}.compute_refs.${ref}`)));
  }
  steps.push(...inlineCompute.map((raw, index) => asObject(raw, `${label}.compute[${index}]`)));
  out.compute = steps.map((step) => compileComputeStep(step));
  delete out.compute_refs;
  return out;
}

/**
 * @param {Record<string, unknown>} template
 * @param {Record<string, Record<string, unknown>[]>} computeLibraries
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function compileTemplate(template, computeLibraries, label) {
  const out = { ...template };
  const expand = asObject(template.expand, `${label}.expand`);
  out.expand = compileExpand(expand, computeLibraries, `${label}.expand`);
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
 * @param {Record<string, unknown>} step
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function normalizeStepStatusText(step, label) {
  const title =
    typeof step.title === 'string' && step.title.trim().length > 0
      ? step.title.trim()
      : asString(step.label, `${label}.label`);
  const raw =
    step.status_text === undefined ? {} : asObject(step.status_text, `${label}.status_text`);
  const running =
    typeof raw.running === 'string' && raw.running.trim().length > 0
      ? raw.running.trim()
      : `Running ${title}...`;
  const success =
    typeof raw.success === 'string' && raw.success.trim().length > 0
      ? raw.success.trim()
      : `${title} completed.`;
  const error =
    typeof raw.error === 'string' && raw.error.trim().length > 0
      ? raw.error.trim()
      : `${title} failed: {error}`;
  const status = { running, success, error };
  if (typeof raw.idle === 'string' && raw.idle.trim().length > 0) {
    return { ...status, idle: raw.idle.trim() };
  }
  return status;
}

/**
 * @param {Record<string, unknown>} step
 * @param {string} label
 * @returns {{ requires_paths: string[] }}
 */
function normalizeStepRequiresPaths(step, label) {
  if (step.blocking !== undefined) {
    fail(`${label}.blocking wrapper is no longer supported. Use requires_paths directly on the step.`);
  }
  const direct = step.requires_paths;
  if (Array.isArray(direct)) {
    return {
      requires_paths: direct.map((entry, index) =>
        asString(entry, `${label}.requires_paths[${index}]`),
      ),
    };
  }
  return { requires_paths: [] };
}

/**
 * @param {Record<string, unknown>} step
 * @param {string} label
 * @returns {string | null}
 */
function normalizeStepNextOnSuccess(step, label) {
  if (step.transitions !== undefined) {
    fail(`${label}.transitions is no longer supported. Use next_on_success only.`);
  }
  return step.next_on_success === undefined
    ? null
    : asString(step.next_on_success, `${label}.next_on_success`);
}

/**
 * @param {Record<string, unknown>} app
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function normalizeApp(app, label) {
  const title = asString(app.title, `${label}.title`);
  const appLabel = asString(app.label, `${label}.label`);
  const entryStep = asString(app.entry_step, `${label}.entry_step`);
  const steps = asArray(app.steps, `${label}.steps`);
  const normalizedSteps = steps.map((rawStep, stepIndex) => {
    const step = asObject(rawStep, `${label}.steps[${stepIndex}]`);
    const stepId = asString(step.id, `${label}.steps[${stepIndex}].id`);
    const stepLabel = `${label}.steps.${stepId}`;
    const stepTitle = asString(step.title, `${stepLabel}.title`);
    asString(step.operation, `${stepLabel}.operation`);
    asString(step.label, `${stepLabel}.label`);
    const actionsRaw = asArray(step.actions, `${stepLabel}.actions`);
    if (actionsRaw.length === 0) {
      fail(`${stepLabel}.actions must be a non-empty array.`);
    }
    const actions = actionsRaw.map((rawAction, actionIndex) => {
      const action = asObject(rawAction, `${stepLabel}.actions[${actionIndex}]`);
      const actionKeys = Object.keys(action);
      const allowedActionKeys = new Set(['label', 'do']);
      for (const key of actionKeys) {
        if (!allowedActionKeys.has(key)) {
          fail(
            `${stepLabel}.actions[${actionIndex}] supports only { label, do }. Unexpected key: ${key}.`,
          );
        }
      }
      const actionLabel = asString(action.label, `${stepLabel}.actions[${actionIndex}].label`);
      const doRaw = asObject(action.do, `${stepLabel}.actions[${actionIndex}].do`);
      const doKeys = Object.keys(doRaw);
      const allowedDoKeys = new Set(['fn', 'mode']);
      for (const key of doKeys) {
        if (!allowedDoKeys.has(key)) {
          fail(
            `${stepLabel}.actions[${actionIndex}].do supports only { fn, mode }. Unexpected key: ${key}.`,
          );
        }
      }

      const fn = asString(doRaw.fn, `${stepLabel}.actions[${actionIndex}].do.fn`);
      if (fn !== 'run' && fn !== 'back' && fn !== 'reset') {
        fail(`${stepLabel}.actions[${actionIndex}].do.fn must be run|back|reset.`);
      }

      let mode;
      if (fn === 'run') {
        mode = asString(doRaw.mode, `${stepLabel}.actions[${actionIndex}].do.mode`);
        if (mode !== 'view' && mode !== 'simulate' && mode !== 'send') {
          fail(`${stepLabel}.actions[${actionIndex}].do.mode must be view|simulate|send for run.`);
        }
      } else if (doRaw.mode !== undefined) {
        fail(`${stepLabel}.actions[${actionIndex}].do.mode is only allowed for fn=run.`);
      }

      return {
        label: actionLabel,
        do: {
          fn,
          ...(mode ? { mode } : {}),
        },
      };
    });

    const nextOnSuccess = normalizeStepNextOnSuccess(step, stepLabel);
    return {
      ...step,
      id: stepId,
      title: stepTitle,
      label: asString(step.label, `${stepLabel}.label`),
      actions,
      requires_paths: normalizeStepRequiresPaths(step, stepLabel).requires_paths,
      status_text: normalizeStepStatusText(step, stepLabel),
      ...(nextOnSuccess ? { next_on_success: nextOnSuccess } : {}),
    };
  });

  return {
    ...app,
    title,
    label: appLabel,
    entry_step: entryStep,
    steps: normalizedSteps,
  };
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} sourceFile
 * @param {Record<string, Record<string, unknown>[]>} computeLibraries
 * @returns {{ outputPath: string; output: Record<string, unknown> }}
 */
function compileAidl(source, sourceFile, computeLibraries) {
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
  const rootLabel = asString(source.label, `${sourceFile}.label`);

  const templatesRaw = asObject(source.templates, `${sourceFile}.templates`);
  const operationsRaw = asObject(source.operations, `${sourceFile}.operations`);
  const appsRaw = asObject(source.apps, `${sourceFile}.apps`);
  const sourcesRaw = source.sources === undefined ? undefined : asObject(source.sources, `${sourceFile}.sources`);
  if (source.user_forms !== undefined) {
    fail(`${sourceFile}.user_forms is no longer supported. Use apps (schema v0.6 app-first).`);
  }

  /** @type {Record<string, unknown>} */
  const templates = {};
  for (const [templateName, templateValue] of Object.entries(templatesRaw)) {
    templates[templateName] = compileTemplate(
      asObject(templateValue, `${sourceFile}.templates.${templateName}`),
      computeLibraries,
      `${sourceFile}.templates.${templateName}`,
    );
  }

  /** @type {Record<string, unknown>} */
  const operations = {};
  for (const [operationName, operationValue] of Object.entries(operationsRaw)) {
    const compiled = compileOperation(
      asObject(operationValue, `${sourceFile}.operations.${operationName}`),
    );
    asString(compiled.label, `${sourceFile}.operations.${operationName}.label`);
    const inputs = asObject(compiled.inputs, `${sourceFile}.operations.${operationName}.inputs`);
    for (const [inputName, inputSpecValue] of Object.entries(inputs)) {
      const inputSpec = asObject(
        inputSpecValue,
        `${sourceFile}.operations.${operationName}.inputs.${inputName}`,
      );
      asString(
        inputSpec.label,
        `${sourceFile}.operations.${operationName}.inputs.${inputName}.label`,
      );
    }
    operations[operationName] = compiled;
  }

  /** @type {Record<string, unknown>} */
  const apps = {};
  for (const [appName, appValue] of Object.entries(appsRaw)) {
    const app = asObject(appValue, `${sourceFile}.apps.${appName}`);
    apps[appName] = normalizeApp(app, `${sourceFile}.apps.${appName}`);
  }

  const output = {
    $schema: schemaPath,
    schema,
    version,
    protocolId,
    label: rootLabel,
    ...(sourcesRaw ? { sources: sourcesRaw } : {}),
    templates,
    operations,
    apps,
  };

  return {
    outputPath: path.join(ROOT, outputPath),
    output,
  };
}

/**
 * @param {string} filepath
 * @param {Record<string, Record<string, unknown>[]>} computeLibraries
 * @returns {Promise<{ sourceFile: string; compiled: { outputPath: string; output: Record<string, unknown> }}>}
 */
async function loadAndCompileFile(filepath, computeLibraries) {
  const sourceFile = path.relative(ROOT, filepath);
  const raw = await fs.readFile(filepath, 'utf8');
  const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
  const compiled = compileAidl(parsed, sourceFile, computeLibraries);
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

  const loaded = await loadComputeLibraries();
  const computeLibraries = loaded.libraries;

  /** @type {string[]} */
  const updates = [];

  for (const file of aidlFiles) {
    const { sourceFile, compiled } = await loadAndCompileFile(file, computeLibraries);
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

  await syncComputeOutputs(loaded.files, checkMode, updates);

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
