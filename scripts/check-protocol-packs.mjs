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

function collectInstructionNamesFromCodecIdl(idl, label) {
  const instructions = asArray(idl.instructions ?? [], `${label}.instructions`);
  return new Set(
    instructions.map((entry, index) =>
      asString(asObject(entry, `${label}.instructions[${index}]`).name, `${label}.instructions[${index}].name`),
    ),
  );
}

function collectInstructionNamesFromCodama(codama, label) {
  const program = asObject(codama.program, `${label}.program`);
  const instructions = asArray(program.instructions ?? [], `${label}.program.instructions`);
  return new Set(
    instructions.map((entry, index) =>
      asString(
        asObject(entry, `${label}.program.instructions[${index}]`).name,
        `${label}.program.instructions[${index}].name`,
      ),
    ),
  );
}

async function resolveCodecIdlPath(manifest, protocolId) {
  if (manifest.runtimeSpecPath !== undefined && manifest.idlPath !== undefined) {
    fail(`${protocolId}: registry idlPath is not allowed alongside runtimeSpecPath.`);
  }
  if (manifest.runtimeSpecPath === undefined) {
    return manifest.idlPath !== undefined
      ? resolvePublicAssetPath(manifest.idlPath, `${protocolId}.idlPath`)
      : null;
  }

  const runtimePath = resolvePublicAssetPath(manifest.runtimeSpecPath, `${protocolId}.runtimeSpecPath`);
  const runtime = asObject(await readJson(runtimePath, `${protocolId} runtime spec`), `${protocolId} runtime spec`);
  const decoderArtifacts = asObject(runtime.decoderArtifacts, `${protocolId}.runtime.decoderArtifacts`);
  const candidates = new Set();
  for (const [artifactName, artifactRaw] of Object.entries(decoderArtifacts)) {
    const artifact = asObject(artifactRaw, `${protocolId}.runtime.decoderArtifacts.${artifactName}`);
    if (artifact.idlPath !== undefined) {
      fail(`${protocolId}: runtime decoder artifact ${artifactName} must not declare legacy idlPath.`);
    }
    const codecIdlPath = asString(
      artifact.codecIdlPath,
      `${protocolId}.runtime.decoderArtifacts.${artifactName}.codecIdlPath`,
    );
    candidates.add(resolvePublicAssetPath(codecIdlPath, `${protocolId}.runtime.decoderArtifacts.${artifactName}.codecIdlPath`));
  }
  if (candidates.size === 0) {
    return null;
  }
  if (candidates.size > 1) {
    fail(`${protocolId}: runtime decoderArtifacts declare multiple codec IDL paths.`);
  }
  return Array.from(candidates)[0] ?? null;
}

function validateRuntimeOperation(protocolId, operationId, operation, instructionNames) {
  const op = asObject(operation, `${protocolId}.runtime.operations.${operationId}`);
  if (op.instruction !== undefined) {
    const instruction = asString(op.instruction, `${protocolId}.runtime.operations.${operationId}.instruction`);
    if (!instructionNames.has(instruction)) {
      fail(`${protocolId}: runtime operation ${operationId} references missing instruction ${instruction}.`);
    }
  }

  const inputs = asOptionalObject(op.inputs, `${protocolId}.runtime.operations.${operationId}.inputs`);
  for (const [inputName, inputRaw] of Object.entries(inputs)) {
    const input = asObject(inputRaw, `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}`);
    asString(input.type, `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}.type`);
    if (input.bind_from !== undefined) {
      asString(input.bind_from, `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}.bind_from`);
    }
    if (input.read_from !== undefined) {
      asString(input.read_from, `${protocolId}.runtime.operations.${operationId}.inputs.${inputName}.read_from`);
    }
  }

  if (op.read_output !== undefined) {
    const readOutput = asObject(op.read_output, `${protocolId}.runtime.operations.${operationId}.read_output`);
    asString(readOutput.source, `${protocolId}.runtime.operations.${operationId}.read_output.source`);
  }
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

    const codecIdlPath = await resolveCodecIdlPath(manifest, protocolId);
    const instructionNames = codecIdlPath
      ? collectInstructionNamesFromCodecIdl(
          asObject(await readJson(codecIdlPath, `${protocolId} codec IDL`), `${protocolId} codec IDL`),
          `${protocolId}.codecIdl`,
        )
      : collectInstructionNamesFromCodama(codama, `${protocolId}.codama`);

    if (manifest.runtimeSpecPath === undefined) {
      continue;
    }

    runtimeBackedCount += 1;
    const runtimePath = resolvePublicAssetPath(manifest.runtimeSpecPath, `${protocolId}.runtimeSpecPath`);
    const runtime = asObject(await readJson(runtimePath, `${protocolId} runtime spec`), `${protocolId} runtime spec`);
    if (runtime.schema !== 'declarative-decoder-runtime.v1') {
      fail(`${protocolId}: runtimeSpecPath must point to declarative-decoder-runtime.v1.`);
    }
    if (asString(runtime.protocolId, `${protocolId}.runtime.protocolId`) !== protocolId) {
      fail(`${protocolId}: runtime.protocolId mismatch.`);
    }

    const decoderArtifacts = asObject(runtime.decoderArtifacts, `${protocolId}.runtime.decoderArtifacts`);
    if (Object.keys(decoderArtifacts).length === 0) {
      fail(`${protocolId}: runtime.decoderArtifacts must not be empty.`);
    }
    for (const [artifactName, artifactRaw] of Object.entries(decoderArtifacts)) {
      const artifact = asObject(artifactRaw, `${protocolId}.runtime.decoderArtifacts.${artifactName}`);
      const codecPath = resolvePublicAssetPath(
        artifact.codecIdlPath,
        `${protocolId}.runtime.decoderArtifacts.${artifactName}.codecIdlPath`,
      );
      await readJson(codecPath, `${protocolId} runtime codec IDL ${artifactName}`);
      if (artifact.idlPath !== undefined) {
        fail(`${protocolId}: runtime decoder artifact ${artifactName} must not declare legacy idlPath.`);
      }
      if (artifact.family === 'codama') {
        const artifactCodamaPath = resolvePublicAssetPath(
          artifact.codamaPath,
          `${protocolId}.runtime.decoderArtifacts.${artifactName}.codamaPath`,
        );
        const artifactCodama = asObject(
          await readJson(artifactCodamaPath, `${protocolId} runtime codama ${artifactName}`),
          `${protocolId} runtime codama ${artifactName}`,
        );
        if (artifactCodama.standard !== 'codama') {
          fail(`${protocolId}: runtime decoder artifact ${artifactName} codamaPath is not Codama.`);
        }
      }
    }

    const operations = asObject(runtime.operations, `${protocolId}.runtime.operations`);
    for (const [operationId, operationRaw] of Object.entries(operations)) {
      validateRuntimeOperation(protocolId, operationId, operationRaw, instructionNames);
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
