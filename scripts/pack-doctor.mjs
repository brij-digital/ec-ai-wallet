import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'public', 'idl', 'registry.json');

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    index += 1;
  }
  return out;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, label) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new Error(`${label} not found: ${path.relative(ROOT, filePath)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} invalid JSON: ${path.relative(ROOT, filePath)}`);
  }
}

function resolvePublicAssetPath(assetPath, label) {
  const rel = asString(assetPath, label);
  if (!rel.startsWith('/idl/')) {
    throw new Error(`${label} must start with /idl/.`);
  }
  const normalized = path.normalize(path.join(ROOT, 'public', rel.slice(1)));
  const publicDir = path.join(ROOT, 'public');
  if (!normalized.startsWith(publicDir)) {
    throw new Error(`${label} resolves outside public/.`);
  }
  return normalized;
}

function checkPubkey(value, label) {
  try {
    return new PublicKey(asString(value, label)).toBase58();
  } catch {
    throw new Error(`${label} must be a valid base58 public key.`);
  }
}

async function resolveCodecIdlPath(manifest, protocolId) {
  if (manifest.runtimeSpecPath !== undefined && manifest.idlPath !== undefined) {
    throw new Error(`${protocolId}: registry idlPath is not allowed alongside runtimeSpecPath.`);
  }
  if (manifest.idlPath !== undefined) {
    return resolvePublicAssetPath(manifest.idlPath, `${protocolId}.idlPath`);
  }
  if (manifest.runtimeSpecPath === undefined) {
    return null;
  }

  const runtimePath = resolvePublicAssetPath(manifest.runtimeSpecPath, `${protocolId}.runtimeSpecPath`);
  const runtime = asObject(await readJson(runtimePath, `${protocolId} runtime spec`), `${protocolId} runtime spec`);
  const decoderArtifacts = asObject(runtime.decoderArtifacts, `${protocolId}.runtime.decoderArtifacts`);
  const candidates = new Set();
  for (const [artifactName, artifactRaw] of Object.entries(decoderArtifacts)) {
    const artifact = asObject(artifactRaw, `${protocolId}.runtime.decoderArtifacts.${artifactName}`);
    if (artifact.idlPath !== undefined) {
      throw new Error(`${protocolId}: runtime decoder artifact ${artifactName} must not declare legacy idlPath.`);
    }
    candidates.add(resolvePublicAssetPath(artifact.codecIdlPath, `${protocolId}.runtime.decoderArtifacts.${artifactName}.codecIdlPath`));
  }

  if (candidates.size === 0) {
    return null;
  }
  if (candidates.size > 1) {
    throw new Error(`${protocolId}: runtime decoderArtifacts declare multiple codec IDL paths.`);
  }
  return Array.from(candidates)[0] ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run pack:doctor -- [--protocol <protocol-id>] [--strict]');
    return;
  }

  const strict = Boolean(args.strict);
  const targetProtocolId = typeof args.protocol === 'string' ? args.protocol.trim() : null;

  const registry = asObject(await readJson(REGISTRY_PATH, 'Registry'), 'registry');
  const protocols = asArray(registry.protocols, 'registry.protocols');
  const selected = targetProtocolId
    ? protocols.filter((entry) => entry && typeof entry === 'object' && entry.id === targetProtocolId)
    : protocols;

  if (selected.length === 0) {
    throw new Error(targetProtocolId ? `Protocol not found in registry: ${targetProtocolId}` : 'No protocols in registry.');
  }

  let errors = 0;
  let warnings = 0;

  for (const rawManifest of selected) {
    const manifest = asObject(rawManifest, 'registry.protocol');
    const id = asString(manifest.id, `${manifest.id}.id`);
    const programId = checkPubkey(manifest.programId, `${id}.programId`);
    const codamaPath = resolvePublicAssetPath(manifest.codamaIdlPath, `${id}.codamaIdlPath`);
    const runtimePath = manifest.runtimeSpecPath ? resolvePublicAssetPath(manifest.runtimeSpecPath, `${id}.runtimeSpecPath`) : null;
    const codecIdlPath = await resolveCodecIdlPath(manifest, id);

    const protocolErrors = [];
    const protocolWarnings = [];

    if (manifest.appPath !== undefined) {
      protocolErrors.push('appPath is no longer allowed.');
    }
    if (manifest.metaPath !== undefined || manifest.metaCorePath !== undefined) {
      protocolErrors.push('legacy metaPath/metaCorePath is not allowed.');
    }

    const codamaExists = await pathExists(codamaPath);
    if (!codamaExists) {
      protocolErrors.push(`Missing Codama IDL file: ${path.relative(ROOT, codamaPath)}`);
    }

    const codecExists = codecIdlPath ? await pathExists(codecIdlPath) : false;
    if (codecIdlPath && !codecExists) {
      protocolErrors.push(`Missing codec IDL file: ${path.relative(ROOT, codecIdlPath)}`);
    }

    const runtimeExists = runtimePath ? await pathExists(runtimePath) : false;
    if (runtimePath && !runtimeExists) {
      protocolErrors.push(`Missing runtime spec file: ${path.relative(ROOT, runtimePath)}`);
    }

    if (codamaExists) {
      try {
        const codama = asObject(await readJson(codamaPath, `${id} Codama IDL`), `${id} Codama IDL`);
        const program = asObject(codama.program, `${id}.codama.program`);
        const normalized = checkPubkey(program.publicKey, `${id}.codama.program.publicKey`);
        if (normalized !== programId) {
          protocolErrors.push(`Codama publicKey mismatch: ${normalized} != ${programId}`);
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (runtimeExists && runtimePath) {
      try {
        const runtime = asObject(await readJson(runtimePath, `${id} runtime spec`), `${id} runtime spec`);
        if (runtime.schema !== 'declarative-decoder-runtime.v1') {
          protocolErrors.push(`Unsupported runtime schema: ${String(runtime.schema ?? '')}`);
        }
        if (asString(runtime.protocolId, `${id}.runtime.protocolId`) !== id) {
          protocolErrors.push(`runtime.protocolId mismatch: ${String(runtime.protocolId)} != ${id}`);
        }
        const operations = asObject(runtime.operations ?? {}, `${id}.runtime.operations`);
        if (Object.keys(operations).length === 0) {
          protocolWarnings.push('No runtime operations declared.');
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!runtimePath) {
      protocolWarnings.push('No runtimeSpecPath declared; protocol is not runtime-backed.');
    }

    if (protocolErrors.length > 0) {
      errors += protocolErrors.length;
    }
    if (protocolWarnings.length > 0) {
      warnings += protocolWarnings.length;
    }

    console.log(`\n[${id}]`);
    console.log(`- name: ${asString(manifest.name, `${id}.name`)}`);
    console.log(`- network: ${asString(manifest.network, `${id}.network`)}`);
    console.log(`- programId: ${programId}`);
    console.log(`- codama: ${path.relative(ROOT, codamaPath)} ${codamaExists ? 'OK' : 'MISSING'}`);
    if (codecIdlPath) {
      console.log(`- codec idl: ${path.relative(ROOT, codecIdlPath)} ${codecExists ? 'OK' : 'MISSING'}`);
    } else {
      console.log('- codec idl: none');
    }
    if (runtimePath) {
      console.log(`- runtime: ${path.relative(ROOT, runtimePath)} ${runtimeExists ? 'OK' : 'MISSING'}`);
    } else {
      console.log('- runtime: none');
    }

    for (const warn of protocolWarnings) {
      console.log(`  WARN: ${warn}`);
    }
    for (const err of protocolErrors) {
      console.log(`  ERROR: ${err}`);
    }
    if (protocolWarnings.length === 0 && protocolErrors.length === 0) {
      console.log('  OK: no issues detected.');
    }
  }

  console.log('\nDoctor summary:');
  console.log(`- protocols checked: ${selected.length}`);
  console.log(`- warnings: ${warnings}`);
  console.log(`- errors: ${errors}`);

  if (errors > 0 || (strict && warnings > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
