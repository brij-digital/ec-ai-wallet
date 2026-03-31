import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const IDL_DIR = path.join(PUBLIC_DIR, 'idl');
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

function asString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function asOptionalObject(value, label) {
  if (value === undefined) {
    return {};
  }
  return asObject(value, label);
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

function resolvePublicAssetPath(assetPath, label) {
  const rel = asString(assetPath, label);
  if (!rel.startsWith('/idl/')) {
    fail(`${label} must start with /idl/.`);
  }
  const resolved = path.normalize(path.join(PUBLIC_DIR, rel.slice(1)));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    fail(`${label} resolves outside public/.`);
  }
  return resolved;
}

function normalizePubkey(value, label) {
  try {
    return new PublicKey(asString(value, label)).toBase58();
  } catch {
    fail(`${label} must be a valid base58 public key.`);
  }
}

function validateOutputSchemaFields(fields, label) {
  const fieldMap = asObject(fields, `${label}.fields`);
  const names = Object.keys(fieldMap);
  if (names.length === 0) {
    fail(`${label}.fields must declare at least one field.`);
  }
  for (const [fieldName, fieldRaw] of Object.entries(fieldMap)) {
    const fieldSpec = asObject(fieldRaw, `${label}.fields.${fieldName}`);
    asString(fieldSpec.type, `${label}.fields.${fieldName}.type`);
    if (fieldSpec.description !== undefined) {
      asString(fieldSpec.description, `${label}.fields.${fieldName}.description`);
    }
  }
}

function validateOutputSchema(schema, label) {
  const objectSchema = asObject(schema, label);
  if (objectSchema.entity_type !== undefined) {
    asString(objectSchema.entity_type, `${label}.entity_type`);
  }
  if (objectSchema.identity_fields !== undefined) {
    asArray(objectSchema.identity_fields, `${label}.identity_fields`).forEach((entry, index) => {
      asString(entry, `${label}.identity_fields[${index}]`);
    });
  }
  validateOutputSchemaFields(objectSchema.fields, label);
}

function collectInstructionNamesFromCodama(codama, label) {
  const program = asObject(codama.program, `${label}.program`);
  const instructions = asArray(program.instructions ?? [], `${label}.program.instructions`);
  return new Set(
    instructions.map((entry, index) =>
      toSnakeCase(
        asString(
          asObject(entry, `${label}.program.instructions[${index}]`).name,
          `${label}.program.instructions[${index}].name`,
        ),
      ),
    ),
  );
}

function validateRuntimeInputs(protocolId, sectionLabel, operationId, operation) {
  const op = asObject(operation, `${protocolId}.${sectionLabel}.${operationId}`);
  const inputs = asOptionalObject(op.inputs, `${protocolId}.${sectionLabel}.${operationId}.inputs`);
  for (const [inputName, inputRaw] of Object.entries(inputs)) {
    const input = asObject(inputRaw, `${protocolId}.${sectionLabel}.${operationId}.inputs.${inputName}`);
    asString(input.type, `${protocolId}.${sectionLabel}.${operationId}.inputs.${inputName}.type`);
  }

  if (op.read_output !== undefined) {
    const readOutput = asObject(op.read_output, `${protocolId}.${sectionLabel}.${operationId}.read_output`);
    asString(readOutput.type, `${protocolId}.${sectionLabel}.${operationId}.read_output.type`);
    asString(readOutput.source, `${protocolId}.${sectionLabel}.${operationId}.read_output.source`);
    if (readOutput.object_schema !== undefined) {
      validateOutputSchema(
        readOutput.object_schema,
        `${protocolId}.${sectionLabel}.${operationId}.read_output.object_schema`,
      );
    }
    if (readOutput.item_schema !== undefined) {
      validateOutputSchema(
        readOutput.item_schema,
        `${protocolId}.${sectionLabel}.${operationId}.read_output.item_schema`,
      );
    }
    if (readOutput.scalar_type !== undefined) {
      asString(readOutput.scalar_type, `${protocolId}.${sectionLabel}.${operationId}.read_output.scalar_type`);
    }
    const outputType = readOutput.type;
    if ((outputType === 'object' && readOutput.object_schema === undefined)
      || ((outputType === 'array' || outputType === 'list') && readOutput.item_schema === undefined)
      || (outputType === 'scalar' && readOutput.scalar_type === undefined)) {
      fail(`${protocolId}.${sectionLabel}.${operationId}.read_output is missing typed schema for ${outputType}.`);
    }
  }

  return op;
}

function validateExecution(protocolId, executionId, execution, instructionNames) {
  const op = validateRuntimeInputs(protocolId, 'agentRuntime.contract_writes', executionId, execution);
  if (op.instruction !== undefined) {
    const instruction = asString(op.instruction, `${protocolId}.agentRuntime.contract_writes.${executionId}.instruction`);
    if (!instructionNames.has(instruction)) {
      fail(`${protocolId}: execution ${executionId} references missing instruction ${instruction}.`);
    }
  }
  const accounts = asOptionalObject(op.accounts, `${protocolId}.agentRuntime.contract_writes.${executionId}.accounts`);
  for (const [accountName, binding] of Object.entries(accounts)) {
    asString(binding, `${protocolId}.agentRuntime.contract_writes.${executionId}.accounts.${accountName}`);
  }
  if (op.remaining_accounts !== undefined) {
    if (typeof op.remaining_accounts === 'string') {
      asString(op.remaining_accounts, `${protocolId}.agentRuntime.contract_writes.${executionId}.remaining_accounts`);
    } else {
      const metas = asArray(op.remaining_accounts, `${protocolId}.agentRuntime.contract_writes.${executionId}.remaining_accounts`);
      for (let index = 0; index < metas.length; index += 1) {
        const meta = asObject(metas[index], `${protocolId}.agentRuntime.contract_writes.${executionId}.remaining_accounts[${index}]`);
        asString(meta.pubkey, `${protocolId}.agentRuntime.contract_writes.${executionId}.remaining_accounts[${index}].pubkey`);
        if (meta.isSigner !== undefined && typeof meta.isSigner !== 'boolean') {
          fail(`${protocolId}.agentRuntime.contract_writes.${executionId}.remaining_accounts[${index}].isSigner must be boolean.`);
        }
        if (meta.isWritable !== undefined && typeof meta.isWritable !== 'boolean') {
          fail(`${protocolId}.agentRuntime.contract_writes.${executionId}.remaining_accounts[${index}].isWritable must be boolean.`);
        }
      }
    }
  }
}

function validateIndexingIndexView(protocolId, indexing, operationId) {
  const operations = asOptionalObject(indexing.operations, `${protocolId}.indexing.operations`);
  const operation = asObject(operations[operationId], `${protocolId}.indexing.operations.${operationId}`);
  const indexView = validateRuntimeInputs(protocolId, 'indexing.operations', operationId, asObject(
    operation.index_view,
    `${protocolId}.indexing.operations.${operationId}.index_view`,
  ));
  asString(indexView.kind, `${protocolId}.indexing.operations.${operationId}.index_view.kind`);
}

function validateCompute(protocolId, operationId, operation) {
  validateRuntimeInputs(protocolId, 'agentRuntime.computes', operationId, operation);
}

async function main() {
  const registry = asObject(await readJson(REGISTRY_PATH, 'registry'), 'registry');
  asString(registry.version, 'registry.version');
  const protocols = asArray(registry.protocols, 'registry.protocols');
  if (protocols.length === 0) {
    fail('registry.protocols must not be empty.');
  }

  let runtimeBackedCount = 0;
  let operationCount = 0;
  const seenIds = new Set();

  for (let index = 0; index < protocols.length; index += 1) {
    const manifest = asObject(protocols[index], `registry.protocols[${index}]`);
    const protocolId = asString(manifest.id, `registry.protocols[${index}].id`);
    if (seenIds.has(protocolId)) {
      fail(`Duplicate protocol id in registry: ${protocolId}`);
    }
    seenIds.add(protocolId);

    asString(manifest.name, `${protocolId}.name`);
    asString(manifest.network, `${protocolId}.network`);
    asString(manifest.transport, `${protocolId}.transport`);
    asArray(manifest.supportedCommands ?? [], `${protocolId}.supportedCommands`);
    asString(manifest.status, `${protocolId}.status`);
    const programId = normalizePubkey(manifest.programId, `${protocolId}.programId`);

    const isActive = manifest.status !== 'inactive';
    if (manifest.appPath !== undefined) {
      fail(`${protocolId}: appPath is no longer allowed.`);
    }
    if (manifest.metaPath !== undefined || manifest.metaCorePath !== undefined) {
      fail(`${protocolId}: legacy metaPath/metaCorePath is not allowed.`);
    }

    const codamaPath = resolvePublicAssetPath(manifest.codamaIdlPath, `${protocolId}.codamaIdlPath`);
    const codama = asObject(await readJson(codamaPath, `${protocolId} codama`), `${protocolId} codama`);
    if (codama.standard !== 'codama') {
      fail(`${protocolId}: codamaIdlPath must point to a Codama artifact.`);
    }
    const codamaProgram = asObject(codama.program, `${protocolId}.codama.program`);
    const codamaProgramId = normalizePubkey(codamaProgram.publicKey, `${protocolId}.codama.program.publicKey`);
    if (codamaProgramId !== programId) {
      fail(`${protocolId}: registry programId does not match codama.program.publicKey.`);
    }

    const instructionNames = collectInstructionNamesFromCodama(codama, `${protocolId}.codama`);

    if (manifest.agentRuntimePath === undefined || manifest.indexingSpecPath === undefined) {
      if (isActive) {
        fail(`${protocolId}: active protocols must declare agentRuntimePath and indexingSpecPath.`);
      }
      continue;
    }

    runtimeBackedCount += 1;
    const agentRuntimePath = resolvePublicAssetPath(manifest.agentRuntimePath, `${protocolId}.agentRuntimePath`);
    const agentRuntime = asObject(await readJson(agentRuntimePath, `${protocolId} agent runtime`), `${protocolId} agent runtime`);
    if (agentRuntime.schema !== 'solana-agent-runtime.v1') {
      fail(`${protocolId}: agentRuntimePath must point to solana-agent-runtime.v1.`);
    }
    if (asString(agentRuntime.protocol?.protocolId, `${protocolId}.agentRuntime.protocol.protocolId`) !== protocolId) {
      fail(`${protocolId}: agentRuntime.protocol.protocolId mismatch.`);
    }

    const indexingPath = resolvePublicAssetPath(manifest.indexingSpecPath, `${protocolId}.indexingSpecPath`);
    const indexing = asObject(await readJson(indexingPath, `${protocolId} indexing spec`), `${protocolId} indexing spec`);
    if (indexing.schema !== 'declarative-decoder-runtime.v1') {
      fail(`${protocolId}: indexingSpecPath must point to declarative-decoder-runtime.v1.`);
    }
    if (asString(indexing.protocolId, `${protocolId}.indexing.protocolId`) !== protocolId) {
      fail(`${protocolId}: indexing.protocolId mismatch.`);
    }

    const decoderArtifacts = asObject(indexing.decoderArtifacts, `${protocolId}.indexing.decoderArtifacts`);
    if (Object.keys(decoderArtifacts).length === 0) {
      fail(`${protocolId}: indexing.decoderArtifacts must not be empty.`);
    }
    for (const [artifactName, artifactRaw] of Object.entries(decoderArtifacts)) {
      const artifact = asObject(artifactRaw, `${protocolId}.indexing.decoderArtifacts.${artifactName}`);
      if (artifact.codecIdlPath !== undefined) {
        fail(`${protocolId}: indexing decoder artifact ${artifactName} must not declare legacy codecIdlPath.`);
      }
      if (artifact.idlPath !== undefined) {
        fail(`${protocolId}: indexing decoder artifact ${artifactName} must not declare legacy idlPath.`);
      }
      if (artifact.family === 'codama') {
        const artifactCodamaPath = resolvePublicAssetPath(
          artifact.codamaPath,
          `${protocolId}.indexing.decoderArtifacts.${artifactName}.codamaPath`,
        );
        const artifactCodama = asObject(
          await readJson(artifactCodamaPath, `${protocolId} indexing codama ${artifactName}`),
          `${protocolId} indexing codama ${artifactName}`,
        );
        if (artifactCodama.standard !== 'codama') {
          fail(`${protocolId}: indexing decoder artifact ${artifactName} codamaPath is not Codama.`);
        }
      }
    }

    const indexViews = asOptionalObject(agentRuntime.index_views, `${protocolId}.agentRuntime.index_views`);
    const computes = asOptionalObject(agentRuntime.computes, `${protocolId}.agentRuntime.computes`);
    const contract_writes = asOptionalObject(agentRuntime.contract_writes, `${protocolId}.agentRuntime.contract_writes`);

    if (Object.keys(indexViews).length > 0) {
      fail(`${protocolId}: agentRuntime.index_views is no longer allowed; declare reads in indexing.operations.`);
    }

    const indexingOperations = asOptionalObject(indexing.operations, `${protocolId}.indexing.operations`);
    for (const [operationId, operationRaw] of Object.entries(indexingOperations)) {
      const operation = asObject(operationRaw, `${protocolId}.indexing.operations.${operationId}`);
      if (operation.index_view === undefined) {
        continue;
      }
      validateIndexingIndexView(protocolId, indexing, operationId);
      operationCount += 1;
    }
    for (const [operationId, operationRaw] of Object.entries(computes)) {
      validateCompute(protocolId, operationId, operationRaw);
      operationCount += 1;
    }
    for (const [operationId, operationRaw] of Object.entries(contract_writes)) {
      validateExecution(protocolId, operationId, operationRaw, instructionNames);
      operationCount += 1;
    }
  }

  console.log(
    `Protocol pack validation passed for ${protocols.length} protocol(s); ${runtimeBackedCount} runtime-backed protocol(s), ${operationCount} runtime operation(s).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
