import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IDL_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_PATH = path.join(IDL_DIR, 'registry.json');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
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
    fail(`${label} is not valid JSON: ${path.relative(ROOT, filePath)}`);
  }
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
  assert(rel.startsWith('/idl/'), `${label} must start with /idl/.`);
  const resolved = path.normalize(path.join(IDL_DIR, rel.slice('/idl/'.length)));
  assert(resolved.startsWith(IDL_DIR), `${label} resolves outside public/idl.`);
  return resolved;
}

function requireSchema(value, expected, label) {
  const schema = asString(value?.schema, `${label}.schema`);
  if (schema !== expected) {
    fail(`${label}.schema must be ${expected}, received ${schema}.`);
  }
}

function validateLegacyMetaCore(protocolId, metaCore) {
  if (!metaCore || typeof metaCore !== 'object' || Array.isArray(metaCore)) {
    return;
  }
  const sources = metaCore.sources;
  if (sources === undefined) {
    return;
  }
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    fail(`${protocolId}: meta.core.sources must be an object when present.`);
  }
  for (const [sourceName, sourceRaw] of Object.entries(sources)) {
    const source = asObject(sourceRaw, `${protocolId}.metaCore.sources.${sourceName}`);
    const kind = asString(source.kind, `${protocolId}.metaCore.sources.${sourceName}.kind`);
    if (kind !== 'inline' && kind !== 'http_json') {
      fail(
        `${protocolId}: meta.core.sources.${sourceName} uses legacy runtime kind ${kind}; runtime logic must live in *.runtime.json.`,
      );
    }
  }
}

async function main() {
  const registry = asObject(await readJson(REGISTRY_PATH, 'registry'), 'registry');
  const protocols = registry.protocols;
  if (!Array.isArray(protocols) || protocols.length === 0) {
    fail('registry.protocols must be a non-empty array.');
  }

  let migratedCount = 0;

  for (const manifest of protocols) {
    const protocol = asObject(manifest, 'registry.protocol');
    const protocolId = asString(protocol.id, 'registry.protocol.id');

    const codamaPath = resolveIdlPath(protocol.codamaIdlPath, `${protocolId}.codamaIdlPath`);
    const codama = asObject(await readJson(codamaPath, `${protocolId} codama`), `${protocolId} codama`);
    if (codama.standard !== 'codama') {
      fail(`${protocolId}: codamaIdlPath does not point to a Codama artifact.`);
    }

    const appPath = resolveIdlPath(protocol.appPath, `${protocolId}.appPath`);
    const app = asObject(await readJson(appPath, `${protocolId} app spec`), `${protocolId} app spec`);
    requireSchema(app, 'meta-app.v0.1', `${protocolId}.app`);
    const appProtocolId = asString(app.protocolId, `${protocolId}.app.protocolId`);
    if (appProtocolId !== protocolId) {
      fail(`${protocolId}: app.protocolId mismatch (${appProtocolId}).`);
    }

    if (protocol.runtimeSpecPath) {
      const runtimePath = resolveIdlPath(protocol.runtimeSpecPath, `${protocolId}.runtimeSpecPath`);
      const runtime = asObject(await readJson(runtimePath, `${protocolId} runtime spec`), `${protocolId} runtime spec`);
      requireSchema(runtime, 'declarative-decoder-runtime.v1', `${protocolId}.runtime`);
      const runtimeProtocolId = asString(runtime.protocolId, `${protocolId}.runtime.protocolId`);
      if (runtimeProtocolId !== protocolId) {
        fail(`${protocolId}: runtime.protocolId mismatch (${runtimeProtocolId}).`);
      }
      migratedCount += 1;
    }

    if (protocol.metaPath) {
      const metaPath = resolveIdlPath(protocol.metaPath, `${protocolId}.metaPath`);
      await readJson(metaPath, `${protocolId} legacy meta`);
    }

    if (protocol.metaCorePath) {
      const metaCorePath = resolveIdlPath(protocol.metaCorePath, `${protocolId}.metaCorePath`);
      const metaCore = asObject(await readJson(metaCorePath, `${protocolId} legacy meta core`), `${protocolId} legacy meta core`);
      validateLegacyMetaCore(protocolId, metaCore);
    }
  }

  console.log(
    `Pack topology OK for ${protocols.length} protocol(s); ${migratedCount} protocol(s) already use Codama + runtime + app.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
