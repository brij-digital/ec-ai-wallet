import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(IDL_DIR, 'registry.json');

function fail(message) {
  throw new Error(message);
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

function asNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

async function readJson(filePath, label) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) {
    fail(`${label} not found: ${path.relative(ROOT, filePath)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} is invalid JSON: ${path.relative(ROOT, filePath)}`);
  }
}

function toLocalPublicPath(assetPath, label) {
  const cleaned = asNonEmptyString(assetPath, label);
  if (!cleaned.startsWith('/idl/')) {
    fail(`${label} must start with /idl/.`);
  }
  const resolved = path.normalize(path.join(ROOT, 'public', cleaned.slice(1)));
  if (!resolved.startsWith(path.join(ROOT, 'public'))) {
    fail(`${label} resolves outside public/.`);
  }
  return resolved;
}

function validateAction(stepLabel, action, index) {
  const actionObj = asObject(action, `${stepLabel}.actions[${index}]`);
  asNonEmptyString(actionObj.label, `${stepLabel}.actions[${index}].label`);
  const doObj = asObject(actionObj.do, `${stepLabel}.actions[${index}].do`);
  const fn = asNonEmptyString(doObj.fn, `${stepLabel}.actions[${index}].do.fn`);
  if (!['run', 'back', 'reset'].includes(fn)) {
    fail(`${stepLabel}.actions[${index}].do.fn must be run|back|reset.`);
  }
  const mode = doObj.mode;
  if (fn === 'run') {
    const runMode = asNonEmptyString(mode, `${stepLabel}.actions[${index}].do.mode`);
    if (!['view', 'simulate', 'send'].includes(runMode)) {
      fail(`${stepLabel}.actions[${index}].do.mode must be view|simulate|send for run actions.`);
    }
  } else if (mode !== undefined) {
    fail(`${stepLabel}.actions[${index}].do.mode must be omitted for ${fn} actions.`);
  }
}

function validateStatusText(stepLabel, statusTextRaw) {
  const statusText = asObject(statusTextRaw, `${stepLabel}.status_text`);
  asNonEmptyString(statusText.running, `${stepLabel}.status_text.running`);
  asNonEmptyString(statusText.success, `${stepLabel}.status_text.success`);
  asNonEmptyString(statusText.error, `${stepLabel}.status_text.error`);
  if (statusText.idle !== undefined && String(statusText.idle).trim().length === 0) {
    fail(`${stepLabel}.status_text.idle must be non-empty if provided.`);
  }
}

function validateNextOnRules(stepLabel, step, knownStepIds) {
  if (step.transitions !== undefined) {
    fail(`${stepLabel}.transitions is deprecated. Use next_on_success only.`);
  }
  if (step.blocking !== undefined) {
    fail(`${stepLabel}.blocking wrapper is deprecated. Use requires_paths on the step.`);
  }
  if (step.next_on_success !== undefined) {
    const next = asNonEmptyString(step.next_on_success, `${stepLabel}.next_on_success`);
    if (!knownStepIds.has(next)) {
      fail(`${stepLabel}.next_on_success references unknown step ${next}.`);
    }
  }

  if (step.next_on_error !== undefined) {
    fail(`${stepLabel}.next_on_error is not supported.`);
  }
}

async function main() {
  const registry = asObject(await readJson(REGISTRY_PATH, 'IDL registry'), 'registry');
  const protocols = asArray(registry.protocols, 'registry.protocols');
  const reports = [];

  for (const protocolRaw of protocols) {
    const protocol = asObject(protocolRaw, 'registry.protocol');
    const protocolId = asNonEmptyString(protocol.id, 'registry.protocol.id');
    const metaCorePath = protocol.metaCorePath ?? protocol.metaPath;
    const appPath = protocol.appPath;
    if (!metaCorePath || !appPath) {
      continue;
    }

    const metaCore = asObject(
      await readJson(toLocalPublicPath(metaCorePath, `${protocolId}.metaCorePath`), `${protocolId} meta core`),
      `${protocolId}.metaCore`,
    );
    const operations = asObject(metaCore.operations, `${protocolId}.metaCore.operations`);

    for (const [operationId, operationRaw] of Object.entries(operations)) {
      const operation = asObject(operationRaw, `${protocolId}.metaCore.operations.${operationId}`);
      const inputs = asObject(
        operation.inputs ?? {},
        `${protocolId}.metaCore.operations.${operationId}.inputs`,
      );
      for (const [inputName, inputRaw] of Object.entries(inputs)) {
        const input = asObject(
          inputRaw,
          `${protocolId}.metaCore.operations.${operationId}.inputs.${inputName}`,
        );
        if (input.ui_editable === false) {
          const readFrom = input.read_from;
          if (typeof readFrom !== 'string' || readFrom.trim().length === 0) {
            fail(
              `${protocolId}.metaCore.operations.${operationId}.inputs.${inputName}: ui_editable=false requires non-empty read_from.`,
            );
          }
        }
      }
    }

    const appPack = asObject(
      await readJson(toLocalPublicPath(appPath, `${protocolId}.appPath`), `${protocolId} app spec`),
      `${protocolId}.app`,
    );
    if (appPack.schema !== 'meta-app.v0.1') {
      fail(`${protocolId}.app.schema must be meta-app.v0.1.`);
    }
    const apps = asObject(appPack.apps, `${protocolId}.app.apps`);

    let validatedSteps = 0;
    for (const [appId, appRaw] of Object.entries(apps)) {
      const app = asObject(appRaw, `${protocolId}.apps.${appId}`);
      asNonEmptyString(app.title, `${protocolId}.apps.${appId}.title`);
      asNonEmptyString(app.label, `${protocolId}.apps.${appId}.label`);
      const steps = asArray(app.steps, `${protocolId}.apps.${appId}.steps`);
      if (steps.length === 0) {
        fail(`${protocolId}.apps.${appId}.steps must not be empty.`);
      }
      const entryStep = asNonEmptyString(app.entry_step, `${protocolId}.apps.${appId}.entry_step`);
      const stepIds = new Set(
        steps.map((raw, index) => asNonEmptyString(asObject(raw, `${protocolId}.apps.${appId}.steps[${index}]`).id, `${protocolId}.apps.${appId}.steps[${index}].id`)),
      );
      if (!stepIds.has(entryStep)) {
        fail(`${protocolId}.apps.${appId}.entry_step references unknown step ${entryStep}.`);
      }

      for (let index = 0; index < steps.length; index += 1) {
        const step = asObject(steps[index], `${protocolId}.apps.${appId}.steps[${index}]`);
        const stepId = asNonEmptyString(step.id, `${protocolId}.apps.${appId}.steps[${index}].id`);
        const stepLabel = `${protocolId}.apps.${appId}.steps.${stepId}`;
        const operationId = asNonEmptyString(step.operation, `${stepLabel}.operation`);
        if (!(operationId in operations)) {
          fail(`${stepLabel}.operation references unknown operation ${operationId}.`);
        }
        asNonEmptyString(step.title, `${stepLabel}.title`);
        asNonEmptyString(step.label, `${stepLabel}.label`);
        validateStatusText(stepLabel, step.status_text);
        const actions = asArray(step.actions, `${stepLabel}.actions`);
        if (actions.length === 0) {
          fail(`${stepLabel}.actions must not be empty.`);
        }
        actions.forEach((action, actionIndex) => validateAction(stepLabel, action, actionIndex));
        validateNextOnRules(stepLabel, step, stepIds);
        validatedSteps += 1;
      }
    }
    reports.push({ protocolId, validatedSteps });
  }

  for (const report of reports) {
    console.log(`${report.protocolId}: app lint OK (${report.validatedSteps} step(s)).`);
  }
  console.log(`pack:lint passed for ${reports.length} protocol(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
