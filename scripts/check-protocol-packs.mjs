import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const IDL_DIR = path.join(PUBLIC_DIR, 'idl');
const REGISTRY_PATH = path.join(IDL_DIR, 'registry.json');
const FIXTURE_DIR = path.join(ROOT, 'protocol-packs', 'fixtures');
const RPC_SIM_FIXTURE_DIR = path.join(ROOT, 'protocol-packs', 'rpc', 'simulations');
const RPC_PARITY_FIXTURE_DIR = path.join(ROOT, 'protocol-packs', 'rpc', 'parity');

const REQUIRED_META_IDL_SCHEMA = 'meta-idl.v0.6';

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

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function asStringArray(value, label) {
  const out = asArray(value, label);
  for (let i = 0; i < out.length; i += 1) {
    asString(out[i], `${label}[${i}]`);
  }
  return out;
}

function toBase58Pubkey(value, label) {
  try {
    return new PublicKey(asString(value, label)).toBase58();
  } catch {
    fail(`${label} must be a valid base58 public key.`);
  }
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function pathExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

function cloneJsonLike(value) {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => [key, sortJson(nested)]);
  return Object.fromEntries(entries);
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

async function readJsonFile(filepath, label) {
  const raw = await fs.readFile(filepath, 'utf8').catch(() => null);
  if (raw === null) {
    fail(`${label} not found: ${path.relative(ROOT, filepath)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} is not valid JSON: ${path.relative(ROOT, filepath)}`);
  }
}

function resolvePublicAssetPath(assetPath, label) {
  const rel = asString(assetPath, label);
  assert(rel.startsWith('/idl/'), `${label} must start with /idl/.`);
  const normalized = path.normalize(path.join(PUBLIC_DIR, rel.slice(1)));
  assert(normalized.startsWith(PUBLIC_DIR), `${label} resolves outside public/.`);
  return normalized;
}

function readPathFromValue(value, dottedPath) {
  const cleaned = dottedPath.startsWith('$') ? dottedPath.slice(1) : dottedPath;
  const parts = cleaned.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function resolvePath(scope, dottedPath) {
  const resolved = readPathFromValue(scope, dottedPath);
  if (resolved === undefined) {
    fail(`Cannot resolve template path ${dottedPath}.`);
  }
  return resolved;
}

function resolveTemplateExpansionValue(value, paramScope) {
  if (typeof value === 'string' && value.startsWith('$param.')) {
    return resolvePath(paramScope, value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplateExpansionValue(entry, paramScope));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, resolveTemplateExpansionValue(nested, paramScope)]),
    );
  }
  return value;
}

function resolveTemplateParams(templateName, template, useSpec) {
  const provided = useSpec.with ?? {};
  if (template.params && typeof template.params !== 'object') {
    fail(`Template ${templateName} params must be an object.`);
  }

  const resolved = {};
  if (template.params) {
    for (const [name, rawSpec] of Object.entries(template.params)) {
      const spec = typeof rawSpec === 'string' ? { type: rawSpec } : rawSpec;
      if (provided[name] !== undefined) {
        resolved[name] = provided[name];
        continue;
      }
      if (spec.default !== undefined) {
        resolved[name] = spec.default;
        continue;
      }
      if (spec.required !== false) {
        fail(`Template ${templateName} missing required param ${name}.`);
      }
    }

    for (const key of Object.keys(provided)) {
      if (!(key in template.params)) {
        fail(`Template ${templateName} received unknown param ${key}.`);
      }
    }
  } else {
    Object.assign(resolved, provided);
  }

  return resolved;
}

function mergeActionFragment(target, fragment, label) {
  if (fragment.instruction) {
    if (target.instruction && target.instruction !== fragment.instruction) {
      fail(
        `Conflicting instruction while materializing (${label}): ${target.instruction} vs ${fragment.instruction}.`,
      );
    }
    target.instruction = fragment.instruction;
  }

  if (fragment.inputs) {
    target.inputs = {
      ...target.inputs,
      ...cloneJsonLike(fragment.inputs),
    };
  }

  if (fragment.discover) {
    target.discover.push(...cloneJsonLike(fragment.discover));
  }

  if (fragment.derive) {
    target.derive.push(...cloneJsonLike(fragment.derive));
  }

  if (fragment.compute) {
    target.compute.push(...cloneJsonLike(fragment.compute));
  }

  if (fragment.args) {
    target.args = {
      ...target.args,
      ...cloneJsonLike(fragment.args),
    };
  }

  if (fragment.accounts) {
    target.accounts = {
      ...target.accounts,
      ...cloneJsonLike(fragment.accounts),
    };
  }

  if (fragment.remaining_accounts !== undefined) {
    const cloned = cloneJsonLike(fragment.remaining_accounts);
    if (Array.isArray(cloned) && Array.isArray(target.remainingAccounts)) {
      target.remainingAccounts.push(...cloned);
    } else {
      target.remainingAccounts = cloned;
    }
  }

  if (fragment.post && fragment.post.length > 0) {
    target.post = [...(target.post ?? []), ...cloneJsonLike(fragment.post)];
  }
}

function materializeOperation(operationId, operation, meta) {
  const materialized = {
    instruction: '',
    inputs: {},
    discover: [],
    derive: [],
    compute: [],
    args: {},
    accounts: {},
    remainingAccounts: [],
    post: [],
  };

  for (const useSpec of operation.use ?? []) {
    const templateName = useSpec.template;
    if (!templateName) {
      fail(`Operation ${operationId} contains use item without template name.`);
    }
    const template = meta.templates?.[templateName];
    if (!template) {
      fail(`Operation ${operationId} references unknown template ${templateName}.`);
    }
    const params = resolveTemplateParams(templateName, template, useSpec);
    const expanded = resolveTemplateExpansionValue(cloneJsonLike(template.expand), { param: params });
    mergeActionFragment(materialized, expanded, `template ${templateName}`);
  }

  mergeActionFragment(
    materialized,
    cloneJsonLike({
      instruction: operation.instruction,
      inputs: operation.inputs,
      discover: operation.discover,
      derive: operation.derive,
      compute: operation.compute,
      args: operation.args,
      accounts: operation.accounts,
      remaining_accounts: operation.remaining_accounts,
      post: operation.post,
    }),
    `operation ${operationId}`,
  );

  return materialized;
}

function ensureUniqueStepNames(steps, label) {
  const seen = new Set();
  for (let index = 0; index < steps.length; index += 1) {
    const step = asObject(steps[index], `${label}[${index}]`);
    const name = asString(step.name, `${label}[${index}].name`);
    if (seen.has(name)) {
      fail(`${label} contains duplicate step name: ${name}`);
    }
    seen.add(name);
  }
}

function collectIdlInstructionNames(idl, label) {
  const instructions = asArray(idl.instructions, `${label}.instructions`);
  const names = new Set();
  for (let i = 0; i < instructions.length; i += 1) {
    const instruction = asObject(instructions[i], `${label}.instructions[${i}]`);
    names.add(asString(instruction.name, `${label}.instructions[${i}].name`));
  }
  return names;
}

function validateMetaSchema(meta, manifest) {
  const schema = asString(meta.schema, `${manifest.id}.meta.schema`);
  if (schema !== REQUIRED_META_IDL_SCHEMA) {
    fail(`${manifest.id}: unsupported meta schema ${schema}. Required: ${REQUIRED_META_IDL_SCHEMA}.`);
  }

  const version = asString(meta.version, `${manifest.id}.meta.version`);
  assert(version.length > 0, `${manifest.id}: meta version must not be empty.`);

  const protocolId = asString(meta.protocolId, `${manifest.id}.meta.protocolId`);
  if (protocolId !== manifest.id) {
    fail(`${manifest.id}: meta protocolId mismatch (${protocolId}).`);
  }
}

function validateApps(meta, protocolId, operations) {
  const apps = asObject(meta.apps, `${protocolId}.apps`);
  const appEntries = Object.entries(apps);
  if (appEntries.length === 0) {
    fail(`${protocolId}: apps must not be empty for app-first schema.`);
  }

  for (const [appId, appRaw] of appEntries) {
    const app = asObject(appRaw, `${protocolId}.apps.${appId}`);
    asString(app.title, `${protocolId}.apps.${appId}.title`);
    const entryStep = asString(app.entry_step, `${protocolId}.apps.${appId}.entry_step`);
    const steps = asArray(app.steps, `${protocolId}.apps.${appId}.steps`);
    if (steps.length === 0) {
      fail(`${protocolId}.apps.${appId}.steps must not be empty.`);
    }

    const stepIds = new Set();
    for (let i = 0; i < steps.length; i += 1) {
      const step = asObject(steps[i], `${protocolId}.apps.${appId}.steps[${i}]`);
      const stepId = asString(step.id, `${protocolId}.apps.${appId}.steps[${i}].id`);
      if (stepIds.has(stepId)) {
        fail(`${protocolId}.apps.${appId} has duplicate step id ${stepId}.`);
      }
      stepIds.add(stepId);
      const operationId = asString(step.operation, `${protocolId}.apps.${appId}.steps[${i}].operation`);
      if (!operations[operationId]) {
        fail(`${protocolId}.apps.${appId}.steps.${stepId} references unknown operation ${operationId}.`);
      }
      asString(step.title, `${protocolId}.apps.${appId}.steps[${i}].title`);

      const transitions = asArray(step.transitions, `${protocolId}.apps.${appId}.steps.${stepId}.transitions`);
      for (let t = 0; t < transitions.length; t += 1) {
        const transition = asObject(
          transitions[t],
          `${protocolId}.apps.${appId}.steps.${stepId}.transitions[${t}]`,
        );
        const on = asString(transition.on, `${protocolId}.apps.${appId}.steps.${stepId}.transitions[${t}].on`);
        if (on !== 'success') {
          fail(`${protocolId}.apps.${appId}.steps.${stepId}.transitions[${t}].on must be success.`);
        }
        asString(transition.to, `${protocolId}.apps.${appId}.steps.${stepId}.transitions[${t}].to`);
      }

      const blocking = asObject(step.blocking, `${protocolId}.apps.${appId}.steps.${stepId}.blocking`);
      if (blocking.requires_paths !== undefined) {
        asStringArray(blocking.requires_paths, `${protocolId}.apps.${appId}.steps.${stepId}.blocking.requires_paths`);
      }
    }

    if (!stepIds.has(entryStep)) {
      fail(`${protocolId}.apps.${appId}.entry_step references unknown step ${entryStep}.`);
    }
    for (let i = 0; i < steps.length; i += 1) {
      const step = asObject(steps[i], `${protocolId}.apps.${appId}.steps[${i}]`);
      const stepId = asString(step.id, `${protocolId}.apps.${appId}.steps[${i}].id`);
      const transitions = asArray(step.transitions, `${protocolId}.apps.${appId}.steps.${stepId}.transitions`);
      for (const transitionRaw of transitions) {
        const transition = asObject(transitionRaw, `${protocolId}.apps.${appId}.steps.${stepId}.transitions[*]`);
        const to = asString(transition.to, `${protocolId}.apps.${appId}.steps.${stepId}.transitions[*].to`);
        if (!stepIds.has(to)) {
          fail(`${protocolId}.apps.${appId}.steps.${stepId} transition target unknown: ${to}`);
        }
      }
      const blocking = asObject(step.blocking, `${protocolId}.apps.${appId}.steps.${stepId}.blocking`);
      if (blocking.requires_paths !== undefined) {
        asStringArray(blocking.requires_paths, `${protocolId}.apps.${appId}.steps.${stepId}.blocking.requires_paths`);
      }
    }
  }
}

function validateManifest(manifest, seenIds) {
  const id = asString(manifest.id, 'registry.protocol.id');
  if (seenIds.has(id)) {
    fail(`Duplicate protocol id in registry: ${id}`);
  }
  seenIds.add(id);

  asString(manifest.name, `${id}.name`);
  asString(manifest.network, `${id}.network`);
  toBase58Pubkey(manifest.programId, `${id}.programId`);
  asString(manifest.transport, `${id}.transport`);
  asStringArray(manifest.supportedCommands, `${id}.supportedCommands`);
  asString(manifest.status, `${id}.status`);
  resolvePublicAssetPath(manifest.idlPath, `${id}.idlPath`);
  resolvePublicAssetPath(manifest.metaPath, `${id}.metaPath`);
}

function loadOperations(meta, protocolId) {
  const operations = meta.operations;
  if (!operations || typeof operations !== 'object' || Array.isArray(operations)) {
    fail(`${protocolId}: meta operations are missing.`);
  }
  return operations;
}

function listStepNames(steps) {
  const names = [];
  for (const entry of steps) {
    if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
      names.push(entry.name);
    }
  }
  return names;
}

function validateFixtureShape(fixture, filename) {
  asObject(fixture, `${filename}`);
  const name = asString(fixture.name, `${filename}.name`);
  const protocolId = asString(fixture.protocolId, `${filename}.protocolId`);
  const operationId = asString(fixture.operationId, `${filename}.operationId`);
  const expect = asObject(fixture.expect, `${filename}.expect`);
  return { name, protocolId, operationId, expect };
}

function asOptionalStringArray(value, label) {
  if (value === undefined) {
    return [];
  }
  return asStringArray(value, label);
}

function checkRequiredKeys(container, keys, label) {
  for (const key of keys) {
    if (!(key in container)) {
      fail(`${label} is missing required key ${key}.`);
    }
  }
}

async function run() {
  const registry = await readJsonFile(REGISTRY_PATH, 'IDL registry');
  const registryObj = asObject(registry, 'registry');
  asString(registryObj.version, 'registry.version');

  const protocols = asArray(registryObj.protocols, 'registry.protocols');
  assert(protocols.length > 0, 'registry.protocols must not be empty.');

  const seenIds = new Set();
  const results = new Map();
  let totalOperations = 0;

  for (let i = 0; i < protocols.length; i += 1) {
    const manifest = asObject(protocols[i], `registry.protocols[${i}]`);
    validateManifest(manifest, seenIds);

    const protocolId = manifest.id;
    const idlPath = resolvePublicAssetPath(manifest.idlPath, `${protocolId}.idlPath`);
    const metaPath = resolvePublicAssetPath(manifest.metaPath, `${protocolId}.metaPath`);

    const idl = asObject(await readJsonFile(idlPath, `${protocolId} IDL`), `${protocolId} IDL`);
    const meta = asObject(await readJsonFile(metaPath, `${protocolId} Meta IDL`), `${protocolId} Meta IDL`);

    validateMetaSchema(meta, manifest);

    if (typeof meta.$schema === 'string' && meta.$schema.startsWith('/idl/')) {
      const schemaFile = resolvePublicAssetPath(meta.$schema, `${protocolId}.$schema`);
      if (!(await pathExists(schemaFile))) {
        fail(`${protocolId}: declared $schema file not found: ${meta.$schema}`);
      }
    }

    const idlAddress = typeof idl.address === 'string' ? idl.address : null;
    if (idlAddress) {
      const normalizedAddress = toBase58Pubkey(idlAddress, `${protocolId}.idl.address`);
      const normalizedProgramId = toBase58Pubkey(manifest.programId, `${protocolId}.programId`);
      if (normalizedAddress !== normalizedProgramId) {
        fail(
          `${protocolId}: registry programId (${normalizedProgramId}) does not match IDL address (${normalizedAddress}).`,
        );
      }
    }

    const idlInstructionNames = collectIdlInstructionNames(idl, protocolId);
    const operations = loadOperations(meta, protocolId);
    validateApps(meta, protocolId, operations);
    const materializedByOperation = {};

    for (const [operationId, operationRaw] of Object.entries(operations)) {
      const operation = asObject(operationRaw, `${protocolId}.operations.${operationId}`);
      const first = materializeOperation(operationId, operation, meta);
      const second = materializeOperation(operationId, operation, meta);

      if (stableStringify(first) !== stableStringify(second)) {
        fail(`${protocolId}.${operationId}: non-deterministic materialization.`);
      }

      ensureUniqueStepNames(first.discover, `${protocolId}.${operationId}.discover`);
      ensureUniqueStepNames(first.derive, `${protocolId}.${operationId}.derive`);
      ensureUniqueStepNames(first.compute, `${protocolId}.${operationId}.compute`);

      if (first.instruction) {
        if (!idlInstructionNames.has(first.instruction)) {
          fail(`${protocolId}.${operationId}: instruction ${first.instruction} not found in IDL.`);
        }
        asObject(first.args, `${protocolId}.${operationId}.args`);
        asObject(first.accounts, `${protocolId}.${operationId}.accounts`);
      }

      materializedByOperation[operationId] = {
        instruction: first.instruction,
        argsKeys: Object.keys(first.args),
        accountKeys: Object.keys(first.accounts),
        discoverStepNames: listStepNames(first.discover),
        deriveStepNames: listStepNames(first.derive),
        computeStepNames: listStepNames(first.compute),
      };
      totalOperations += 1;
    }

    results.set(protocolId, {
      manifest,
      materializedByOperation,
    });
  }

  let fixtureChecks = 0;
  if (await pathExists(FIXTURE_DIR)) {
    const files = (await fs.readdir(FIXTURE_DIR))
      .filter((entry) => entry.endsWith('.json'))
      .sort();

    for (const filename of files) {
      const fixturePath = path.join(FIXTURE_DIR, filename);
      const fixtureRaw = await readJsonFile(fixturePath, `fixture ${filename}`);
      const fixture = validateFixtureShape(fixtureRaw, filename);

      const protocolResult = results.get(fixture.protocolId);
      if (!protocolResult) {
        fail(`${filename}: unknown protocolId ${fixture.protocolId}.`);
      }

      const operationResult = protocolResult.materializedByOperation[fixture.operationId];
      if (!operationResult) {
        fail(`${filename}: unknown operationId ${fixture.operationId} for protocol ${fixture.protocolId}.`);
      }

      if (fixture.expect.instruction !== undefined) {
        const expectedInstruction = asString(fixture.expect.instruction, `${filename}.expect.instruction`);
        if (operationResult.instruction !== expectedInstruction) {
          fail(
            `${filename}: instruction mismatch for ${fixture.protocolId}.${fixture.operationId}. expected ${expectedInstruction}, got ${operationResult.instruction || '(none)'}.`,
          );
        }
      }

      if (fixture.expect.requiredArgs !== undefined) {
        const requiredArgs = asStringArray(fixture.expect.requiredArgs, `${filename}.expect.requiredArgs`);
        checkRequiredKeys(
          Object.fromEntries(operationResult.argsKeys.map((key) => [key, true])),
          requiredArgs,
          `${filename}: args for ${fixture.protocolId}.${fixture.operationId}`,
        );
      }

      if (fixture.expect.requiredAccounts !== undefined) {
        const requiredAccounts = asStringArray(
          fixture.expect.requiredAccounts,
          `${filename}.expect.requiredAccounts`,
        );
        checkRequiredKeys(
          Object.fromEntries(operationResult.accountKeys.map((key) => [key, true])),
          requiredAccounts,
          `${filename}: accounts for ${fixture.protocolId}.${fixture.operationId}`,
        );
      }

      if (fixture.expect.requiredDiscoverSteps !== undefined) {
        const required = asStringArray(
          fixture.expect.requiredDiscoverSteps,
          `${filename}.expect.requiredDiscoverSteps`,
        );
        checkRequiredKeys(
          Object.fromEntries(operationResult.discoverStepNames.map((key) => [key, true])),
          required,
          `${filename}: discover steps for ${fixture.protocolId}.${fixture.operationId}`,
        );
      }

      if (fixture.expect.requiredDeriveSteps !== undefined) {
        const required = asStringArray(
          fixture.expect.requiredDeriveSteps,
          `${filename}.expect.requiredDeriveSteps`,
        );
        checkRequiredKeys(
          Object.fromEntries(operationResult.deriveStepNames.map((key) => [key, true])),
          required,
          `${filename}: derive steps for ${fixture.protocolId}.${fixture.operationId}`,
        );
      }

      if (fixture.expect.requiredComputeSteps !== undefined) {
        const required = asStringArray(
          fixture.expect.requiredComputeSteps,
          `${filename}.expect.requiredComputeSteps`,
        );
        checkRequiredKeys(
          Object.fromEntries(operationResult.computeStepNames.map((key) => [key, true])),
          required,
          `${filename}: compute steps for ${fixture.protocolId}.${fixture.operationId}`,
        );
      }

      fixtureChecks += 1;
    }
  }

  const coverageByProtocol = new Map();
  for (const [protocolId] of results) {
    coverageByProtocol.set(protocolId, {
      parityPositive: 0,
      parityNegative: 0,
      simulationPositive: 0,
      simulationNegative: 0,
    });
  }

  const rpcParityFiles = (await pathExists(RPC_PARITY_FIXTURE_DIR))
    ? (await fs.readdir(RPC_PARITY_FIXTURE_DIR)).filter((entry) => entry.endsWith('.json')).sort()
    : [];
  for (const filename of rpcParityFiles) {
    const fixturePath = path.join(RPC_PARITY_FIXTURE_DIR, filename);
    const fixture = asObject(await readJsonFile(fixturePath, `RPC parity fixture ${filename}`), filename);
    const protocolId = asString(fixture.protocolId, `${filename}.protocolId`);
    const expect = asObject(fixture.expect ?? {}, `${filename}.expect`);
    const bucket = coverageByProtocol.get(protocolId);
    if (!bucket) {
      fail(`${filename}: unknown protocolId ${protocolId}.`);
    }
    const isNegative =
      filename.includes('.negative.') ||
      filename.endsWith('.negative.json') ||
      asOptionalStringArray(expect.errorIncludes, `${filename}.expect.errorIncludes`).length > 0;
    if (isNegative) {
      bucket.parityNegative += 1;
    } else {
      bucket.parityPositive += 1;
    }
  }

  const rpcSimulationFiles = (await pathExists(RPC_SIM_FIXTURE_DIR))
    ? (await fs.readdir(RPC_SIM_FIXTURE_DIR)).filter((entry) => entry.endsWith('.json')).sort()
    : [];
  for (const filename of rpcSimulationFiles) {
    const fixturePath = path.join(RPC_SIM_FIXTURE_DIR, filename);
    const fixture = asObject(await readJsonFile(fixturePath, `RPC simulation fixture ${filename}`), filename);
    const protocolId = asString(fixture.protocolId, `${filename}.protocolId`);
    const expect = asObject(fixture.expect ?? {}, `${filename}.expect`);
    const bucket = coverageByProtocol.get(protocolId);
    if (!bucket) {
      fail(`${filename}: unknown protocolId ${protocolId}.`);
    }
    const isNegative =
      filename.includes('.negative.') ||
      filename.endsWith('.negative.json') ||
      expect.ok === false ||
      asOptionalStringArray(expect.errorIncludes, `${filename}.expect.errorIncludes`).length > 0;
    if (isNegative) {
      bucket.simulationNegative += 1;
    } else {
      bucket.simulationPositive += 1;
    }
  }

  const missingCoverageErrors = [];
  for (const [protocolId, bucket] of coverageByProtocol) {
    const missing = [];
    if (bucket.parityPositive < 1) {
      missing.push('parityPositive');
    }
    if (bucket.parityNegative < 1) {
      missing.push('parityNegative');
    }
    if (bucket.simulationPositive < 1) {
      missing.push('simulationPositive');
    }
    if (bucket.simulationNegative < 1) {
      missing.push('simulationNegative');
    }
    if (missing.length > 0) {
      missingCoverageErrors.push(
        `${protocolId} missing RPC coverage: ${missing.join(', ')} (found parity+ ${bucket.parityPositive}, parity- ${bucket.parityNegative}, sim+ ${bucket.simulationPositive}, sim- ${bucket.simulationNegative})`,
      );
    }
  }
  if (missingCoverageErrors.length > 0) {
    fail(`RPC fixture coverage gate failed:\n${missingCoverageErrors.join('\n')}`);
  }

  console.log(
    `Protocol pack checks passed: protocols=${results.size}, operations=${totalOperations}, fixtures=${fixtureChecks}, rpcParityFixtures=${rpcParityFiles.length}, rpcSimulationFixtures=${rpcSimulationFiles.length}.`,
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
