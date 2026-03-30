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

async function main() {
  const registry = asObject(await readJson(REGISTRY_PATH, 'IDL registry'), 'registry');
  const protocols = asArray(registry.protocols, 'registry.protocols');
  const reports = [];

  for (const protocolRaw of protocols) {
    const protocol = asObject(protocolRaw, 'registry.protocol');
    const protocolId = asNonEmptyString(protocol.id, 'registry.protocol.id');
    if (protocol.appPath !== undefined) {
      fail(`${protocolId}: appPath is no longer allowed.`);
    }
    if (!protocol.runtimeSpecPath) {
      continue;
    }

    const runtimePack = asObject(
      await readJson(toLocalPublicPath(protocol.runtimeSpecPath, `${protocolId}.runtimeSpecPath`), `${protocolId} runtime spec`),
      `${protocolId}.runtime`,
    );
    if (runtimePack.schema !== 'declarative-decoder-runtime.v1') {
      fail(`${protocolId}.runtime.schema must be declarative-decoder-runtime.v1.`);
    }

    const operations = asObject(runtimePack.operations ?? {}, `${protocolId}.runtime.operations`);
    let lintedOperations = 0;
    for (const [operationId, operationRaw] of Object.entries(operations)) {
      const operation = asObject(operationRaw, `${protocolId}.runtime.operations.${operationId}`);
      const inputs = asObject(operation.inputs ?? {}, `${protocolId}.runtime.operations.${operationId}.inputs`);
      for (const [inputName, inputRaw] of Object.entries(inputs)) {
        const input = asObject(inputRaw, `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}`);
        asNonEmptyString(input.type, `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}.type`);
        if (input.bind_from !== undefined) {
          asNonEmptyString(
            input.bind_from,
            `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}.bind_from`,
          );
        }
        if (input.read_from !== undefined) {
          asNonEmptyString(
            input.read_from,
            `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}.read_from`,
          );
        }
      }
      if (operation.read_output !== undefined) {
        const readOutput = asObject(
          operation.read_output,
          `${protocolId}.runtime.operations.${operationId}.read_output`,
        );
        asNonEmptyString(
          readOutput.source,
          `${protocolId}.runtime.operations.${operationId}.read_output.source`,
        );
      }
      lintedOperations += 1;
    }
    reports.push({ protocolId, lintedOperations });
  }

  for (const report of reports) {
    console.log(`${report.protocolId}: runtime lint OK (${report.lintedOperations} operation(s)).`);
  }
  console.log(`pack:lint passed for ${reports.length} runtime-backed protocol(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
