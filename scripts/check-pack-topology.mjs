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

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function resolveIdlPath(assetPath, label) {
  const rel = asString(assetPath, label);
  if (!rel.startsWith('/idl/')) {
    fail(`${label} must start with /idl/.`);
  }
  const resolved = path.normalize(path.join(IDL_DIR, rel.slice('/idl/'.length)));
  if (!resolved.startsWith(IDL_DIR)) {
    fail(`${label} resolves outside public/idl.`);
  }
  return resolved;
}

async function readJson(filePath, label) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) {
    fail(`${label} not found: ${path.relative(ROOT, filePath)}`);
  }
  return JSON.parse(raw);
}

async function main() {
  const registry = asObject(await readJson(REGISTRY_PATH, 'registry'), 'registry');
  const protocols = registry.protocols;
  if (!Array.isArray(protocols) || protocols.length === 0) {
    fail('registry.protocols must be a non-empty array.');
  }

  let runtimeBackedCount = 0;

  for (const manifest of protocols) {
    const protocol = asObject(manifest, 'registry.protocol');
    const protocolId = asString(protocol.id, 'registry.protocol.id');
    const isActive = protocol.status !== 'inactive';

    if (protocol.appPath !== undefined) {
      fail(`${protocolId}: appPath is no longer allowed.`);
    }
    if (protocol.metaPath !== undefined || protocol.metaCorePath !== undefined) {
      fail(`${protocolId}: legacy metaPath/metaCorePath is not allowed.`);
    }

    const codama = asObject(
      await readJson(resolveIdlPath(protocol.codamaIdlPath, `${protocolId}.codamaIdlPath`), `${protocolId} codama`),
      `${protocolId} codama`,
    );
    if (codama.standard !== 'codama') {
      fail(`${protocolId}: codamaIdlPath does not point to a Codama artifact.`);
    }

    if (!protocol.agentRuntimePath || !protocol.indexingSpecPath) {
      if (isActive) {
        fail(`${protocolId}: active protocols must declare agentRuntimePath and indexingSpecPath.`);
      }
      continue;
    }

    const agentRuntime = asObject(
      await readJson(resolveIdlPath(protocol.agentRuntimePath, `${protocolId}.agentRuntimePath`), `${protocolId} agent runtime`),
      `${protocolId} agent runtime`,
    );
    if (agentRuntime.schema !== 'solana-agent-runtime.v1') {
      fail(`${protocolId}: agent runtime schema must be solana-agent-runtime.v1.`);
    }
    if (asString(agentRuntime.protocol?.protocolId, `${protocolId}.agentRuntime.protocol.protocolId`) !== protocolId) {
      fail(`${protocolId}: agent runtime protocol id mismatch.`);
    }
    const indexing = asObject(
      await readJson(resolveIdlPath(protocol.indexingSpecPath, `${protocolId}.indexingSpecPath`), `${protocolId} indexing spec`),
      `${protocolId} indexing spec`,
    );
    if (indexing.schema !== 'declarative-decoder-runtime.v1') {
      fail(`${protocolId}: indexing schema must be declarative-decoder-runtime.v1.`);
    }
    if (asString(indexing.protocolId, `${protocolId}.indexing.protocolId`) !== protocolId) {
      fail(`${protocolId}: indexing.protocolId mismatch.`);
    }
    runtimeBackedCount += 1;
  }

  console.log(
    `Pack topology OK for ${protocols.length} protocol(s); ${runtimeBackedCount} protocol(s) use Codama + indexing + agent runtime.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
