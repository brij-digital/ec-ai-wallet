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

function validateOutputSchema(schema, label) {
  const objectSchema = asObject(schema, label);
  const fields = asObject(objectSchema.fields, `${label}.fields`);
  if (Object.keys(fields).length === 0) {
    fail(`${label}.fields must not be empty.`);
  }
  if (objectSchema.entity_type !== undefined) {
    asNonEmptyString(objectSchema.entity_type, `${label}.entity_type`);
  }
  if (objectSchema.identity_fields !== undefined) {
    asArray(objectSchema.identity_fields, `${label}.identity_fields`).forEach((entry, index) => {
      asNonEmptyString(entry, `${label}.identity_fields[${index}]`);
    });
  }
  for (const [fieldName, fieldRaw] of Object.entries(fields)) {
    const field = asObject(fieldRaw, `${label}.fields.${fieldName}`);
    asNonEmptyString(field.type, `${label}.fields.${fieldName}.type`);
    if (field.description !== undefined) {
      asNonEmptyString(field.description, `${label}.fields.${fieldName}.description`);
    }
  }
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
    if (!protocol.agentRuntimePath) {
      continue;
    }

    const runtimePack = asObject(
      await readJson(toLocalPublicPath(protocol.agentRuntimePath, `${protocolId}.agentRuntimePath`), `${protocolId} agent runtime`),
      `${protocolId}.agentRuntime`,
    );
    if (runtimePack.schema !== 'solana-agent-runtime.v1') {
      fail(`${protocolId}.agentRuntime.schema must be solana-agent-runtime.v1.`);
    }

    const sections = [
      ['index_views', asObject(runtimePack.index_views ?? {}, `${protocolId}.agentRuntime.index_views`)],
      ['computes', asObject(runtimePack.computes ?? {}, `${protocolId}.agentRuntime.computes`)],
      ['contract_writes', asObject(runtimePack.contract_writes ?? {}, `${protocolId}.agentRuntime.contract_writes`)],
    ];
    let lintedOperations = 0;
    for (const [sectionName, operations] of sections) {
      for (const [operationId, operationRaw] of Object.entries(operations)) {
        const operation = asObject(operationRaw, `${protocolId}.agentRuntime.${sectionName}.${operationId}`);
        const inputs = asObject(operation.inputs ?? {}, `${protocolId}.agentRuntime.${sectionName}.${operationId}.inputs`);
        for (const [inputName, inputRaw] of Object.entries(inputs)) {
          const input = asObject(inputRaw, `${protocolId}.agentRuntime.${sectionName}.${operationId}.inputs.${inputName}`);
          asNonEmptyString(input.type, `${protocolId}.agentRuntime.${sectionName}.${operationId}.inputs.${inputName}.type`);
        }
        if (operation.read_output !== undefined) {
          const readOutput = asObject(
            operation.read_output,
            `${protocolId}.agentRuntime.${sectionName}.${operationId}.read_output`,
          );
          asNonEmptyString(
            readOutput.type,
            `${protocolId}.agentRuntime.${sectionName}.${operationId}.read_output.type`,
          );
          asNonEmptyString(
            readOutput.source,
            `${protocolId}.agentRuntime.${sectionName}.${operationId}.read_output.source`,
          );
          if (readOutput.object_schema !== undefined) {
            validateOutputSchema(
              readOutput.object_schema,
              `${protocolId}.agentRuntime.${sectionName}.${operationId}.read_output.object_schema`,
            );
          }
          if (readOutput.item_schema !== undefined) {
            validateOutputSchema(
              readOutput.item_schema,
              `${protocolId}.agentRuntime.${sectionName}.${operationId}.read_output.item_schema`,
            );
          }
          if (readOutput.scalar_type !== undefined) {
            asNonEmptyString(
              readOutput.scalar_type,
              `${protocolId}.agentRuntime.${sectionName}.${operationId}.read_output.scalar_type`,
            );
          }
        }
        lintedOperations += 1;
      }
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
