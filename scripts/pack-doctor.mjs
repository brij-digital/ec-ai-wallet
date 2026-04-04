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
    const agentRuntimePath = manifest.agentRuntimePath ? resolvePublicAssetPath(manifest.agentRuntimePath, `${id}.agentRuntimePath`) : null;
    const ingestPath = manifest.ingestSpecPath ? resolvePublicAssetPath(manifest.ingestSpecPath, `${id}.ingestSpecPath`) : null;
    const indexedReadsPath = manifest.indexedReadsPath
      ? resolvePublicAssetPath(manifest.indexedReadsPath, `${id}.indexedReadsPath`)
      : null;

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

    const agentRuntimeExists = agentRuntimePath ? await pathExists(agentRuntimePath) : false;
    if (agentRuntimePath && !agentRuntimeExists) {
      protocolErrors.push(`Missing agent runtime file: ${path.relative(ROOT, agentRuntimePath)}`);
    }

    const ingestExists = ingestPath ? await pathExists(ingestPath) : false;
    if (ingestPath && !ingestExists) {
      protocolErrors.push(`Missing ingest spec file: ${path.relative(ROOT, ingestPath)}`);
    }

    const indexedReadsExists = indexedReadsPath ? await pathExists(indexedReadsPath) : false;
    if (indexedReadsPath && !indexedReadsExists) {
      protocolErrors.push(`Missing indexed reads file: ${path.relative(ROOT, indexedReadsPath)}`);
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

    if (agentRuntimeExists && agentRuntimePath) {
      try {
        const runtime = asObject(await readJson(agentRuntimePath, `${id} agent runtime`), `${id} agent runtime`);
        if (runtime.schema !== 'solana-agent-runtime.v1') {
          protocolErrors.push(`Unsupported agent runtime schema: ${String(runtime.schema ?? '')}`);
        }
        if (asString(runtime.protocol_id, `${id}.agentRuntime.protocol_id`) !== id) {
          protocolErrors.push(`agent runtime protocol_id mismatch: ${String(runtime.protocol_id)} != ${id}`);
        }
        if (checkPubkey(runtime.program_id, `${id}.agentRuntime.program_id`) !== programId) {
          protocolErrors.push(`agent runtime program_id mismatch: ${String(runtime.program_id)} != ${programId}`);
        }
        if (asString(runtime.codama_path, `${id}.agentRuntime.codama_path`) !== manifest.codamaIdlPath) {
          protocolErrors.push(`agent runtime codama_path mismatch: ${String(runtime.codama_path)} != ${manifest.codamaIdlPath}`);
        }
        const views = asObject(runtime.views ?? {}, `${id}.agentRuntime.views`);
        const writes = asObject(runtime.writes ?? {}, `${id}.agentRuntime.writes`);
        const transforms = asObject(runtime.transforms ?? {}, `${id}.agentRuntime.transforms`);
        void transforms;
        if (Object.keys(views).length + Object.keys(writes).length === 0) {
          protocolWarnings.push('No agent runtime capabilities declared.');
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (ingestExists && ingestPath) {
      try {
        const ingest = asObject(await readJson(ingestPath, `${id} ingest spec`), `${id} ingest spec`);
        if (ingest.schema !== 'declarative-decoder-runtime.v1') {
          protocolErrors.push(`Unsupported ingest schema: ${String(ingest.schema ?? '')}`);
        }
        if (asString(ingest.protocolId, `${id}.ingest.protocolId`) !== id) {
          protocolErrors.push(`ingest protocolId mismatch: ${String(ingest.protocolId)} != ${id}`);
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (indexedReadsExists && indexedReadsPath) {
      try {
        const indexedReads = asObject(await readJson(indexedReadsPath, `${id} indexed reads`), `${id} indexed reads`);
        if (indexedReads.schema !== 'declarative-decoder-runtime.v1') {
          protocolErrors.push(`Unsupported indexed reads schema: ${String(indexedReads.schema ?? '')}`);
        }
        if (asString(indexedReads.protocolId, `${id}.indexedReads.protocolId`) !== id) {
          protocolErrors.push(`indexedReads protocolId mismatch: ${String(indexedReads.protocolId)} != ${id}`);
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!agentRuntimePath || !indexedReadsPath) {
      protocolWarnings.push('Missing agentRuntimePath or indexedReadsPath; protocol is not fully split.');
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
    if (agentRuntimePath) {
      console.log(`- agent runtime: ${path.relative(ROOT, agentRuntimePath)} ${agentRuntimeExists ? 'OK' : 'MISSING'}`);
    } else {
      console.log('- agent runtime: none');
    }
    if (ingestPath) {
      console.log(`- ingest: ${path.relative(ROOT, ingestPath)} ${ingestExists ? 'OK' : 'MISSING'}`);
    } else {
      console.log('- ingest: none');
    }
    if (indexedReadsPath) {
      console.log(`- indexed reads: ${path.relative(ROOT, indexedReadsPath)} ${indexedReadsExists ? 'OK' : 'MISSING'}`);
    } else {
      console.log('- indexed reads: none');
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
