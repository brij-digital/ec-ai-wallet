import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'public', 'idl', 'registry.json');
const AIDL_DIR = path.join(ROOT, 'aidl');

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
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

async function pathExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filepath, label) {
  const raw = await fs.readFile(filepath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new Error(`${label} not found: ${path.relative(ROOT, filepath)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} invalid JSON: ${path.relative(ROOT, filepath)}`);
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

function normalizeAidlTargetOutput(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith('/idl/')) {
    return cleaned;
  }
  if (cleaned.startsWith('public/idl/')) {
    return `/idl/${cleaned.slice('public/idl/'.length)}`;
  }
  return cleaned;
}

async function listAidlTargets() {
  const entries = await fs.readdir(AIDL_DIR, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.aidl.json')) {
      continue;
    }
    const filepath = path.join(AIDL_DIR, entry.name);
    try {
      const aidl = asObject(await readJson(filepath, `AIDL ${entry.name}`), `AIDL ${entry.name}`);
      const target = asObject(aidl.target, `AIDL ${entry.name}.target`);
      const output = asString(target.output, `AIDL ${entry.name}.target.output`);
      const protocolId = asString(target.protocolId, `AIDL ${entry.name}.target.protocolId`);
      out.push({ file: filepath, output, protocolId });
    } catch {
      out.push({ file: filepath, output: null, protocolId: null });
    }
  }
  return out;
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

  const aidlTargets = await listAidlTargets();
  let errors = 0;
  let warnings = 0;

  for (const rawManifest of selected) {
    const manifest = asObject(rawManifest, 'registry.protocol');
    const id = asString(manifest.id, `${manifest.id}.id`);
    const programId = checkPubkey(manifest.programId, `${id}.programId`);

    const idlPath = resolvePublicAssetPath(manifest.idlPath, `${id}.idlPath`);
    const metaPath = resolvePublicAssetPath(manifest.metaPath, `${id}.metaPath`);

    const protocolErrors = [];
    const protocolWarnings = [];

    const idlExists = await pathExists(idlPath);
    if (!idlExists) {
      protocolErrors.push(`Missing IDL file: ${path.relative(ROOT, idlPath)}`);
    }

    const metaExists = await pathExists(metaPath);
    if (!metaExists) {
      protocolErrors.push(`Missing Meta IDL file: ${path.relative(ROOT, metaPath)}`);
    }

    let idl = null;
    let meta = null;

    if (idlExists) {
      try {
        idl = asObject(await readJson(idlPath, `${id} IDL`), `${id} IDL`);
        const idlAddress = typeof idl.address === 'string' ? idl.address : null;
        if (idlAddress) {
          const normalized = checkPubkey(idlAddress, `${id}.idl.address`);
          if (normalized !== programId) {
            protocolErrors.push(`IDL address mismatch: idl.address=${normalized}, registry.programId=${programId}`);
          }
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (metaExists) {
      try {
        meta = asObject(await readJson(metaPath, `${id} Meta IDL`), `${id} Meta IDL`);
        const schema = asString(meta.schema, `${id}.meta.schema`);
        if (schema !== 'meta-idl.v0.6') {
          protocolErrors.push(`Unsupported meta schema: ${schema} (expected meta-idl.v0.6)`);
        }
        const metaProtocolId = asString(meta.protocolId, `${id}.meta.protocolId`);
        if (metaProtocolId !== id) {
          protocolErrors.push(`meta.protocolId mismatch: ${metaProtocolId} != ${id}`);
        }

        const operations = asObject(meta.operations, `${id}.meta.operations`);
        const operationIds = Object.keys(operations);
        if (operationIds.length === 0) {
          protocolWarnings.push('No operations declared in meta.operations.');
        }

        const appsRaw = meta.apps;
        if (appsRaw === undefined) {
          protocolErrors.push('No apps declared (required by app-first schema).');
        } else {
          const apps = asObject(appsRaw, `${id}.meta.apps`);
          const appIds = Object.keys(apps);
          if (appIds.length === 0) {
            protocolErrors.push('apps exists but is empty.');
          }
        }
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const matchingAidl = aidlTargets.filter((target) => target.protocolId === id);
    if (matchingAidl.length === 0) {
      protocolWarnings.push('No AIDL source found targeting this protocolId.');
    }
    const expectedOutput = asString(manifest.metaPath, `${id}.metaPath`);
    const outputMatches = aidlTargets.filter((target) => normalizeAidlTargetOutput(target.output) === expectedOutput);
    if (outputMatches.length === 0) {
      protocolWarnings.push(`No AIDL target.output matches ${expectedOutput}.`);
    }

    const status = asString(manifest.status, `${id}.status`);
    if (status === 'active' && (meta?.apps === undefined || Object.keys(meta.apps ?? {}).length === 0)) {
      protocolErrors.push('Protocol is active but has no apps for End User mode.');
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
    console.log(`- idl: ${path.relative(ROOT, idlPath)} ${idlExists ? 'OK' : 'MISSING'}`);
    console.log(`- meta: ${path.relative(ROOT, metaPath)} ${metaExists ? 'OK' : 'MISSING'}`);
    if (meta && typeof meta === 'object' && meta.operations && typeof meta.operations === 'object') {
      console.log(`- operations: ${Object.keys(meta.operations).length}`);
      console.log(`- apps: ${meta.apps && typeof meta.apps === 'object' ? Object.keys(meta.apps).length : 0}`);
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
