import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'public', 'idl');
const REGISTRY_DIR = process.env.PROTOCOL_REGISTRY_DIR?.trim()
  ? path.resolve(process.env.PROTOCOL_REGISTRY_DIR.trim())
  : path.resolve(ROOT, '../protocol-registry');
const SCHEMAS_DIR = path.join(REGISTRY_DIR, 'schemas');
const PROTOCOLS_DIR = path.join(REGISTRY_DIR, 'protocols');
const ACTION_RUNNERS_DIR = path.join(REGISTRY_DIR, 'action-runners');
const REGISTRY_PATH = path.join(REGISTRY_DIR, 'registry.json');

const SCHEMA_FILES = new Set([
  'declarative_decoder_runtime.schema.v1.json',
  'solana_action_runner.schema.v1.json',
  'solana_agent_runtime.schema.v1.json',
]);
const EXCLUDED_FILES = new Set(['README.md']);
const MANAGED_TARGET_PATTERNS = [
  /^registry\.json$/,
  /^action_runners\.json$/,
  /\.runner\.json$/,
  /^[a-z0-9_]+\.(codama|runtime|ingest|indexed-reads|directory\.db|seed|compute)\.json$/,
];

function fail(message) {
  throw new Error(message);
}

function isManagedTargetFile(name) {
  return SCHEMA_FILES.has(name) || MANAGED_TARGET_PATTERNS.some((pattern) => pattern.test(name));
}

function protocolSlugToFlatName(slug) {
  return slug.replace(/-/g, '_');
}

function rewritePathToConsumer(value) {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.startsWith('/schemas/')) {
    return `/idl/${path.basename(value)}`;
  }

  const protocolMatch = value.match(/^\/protocols\/([^/]+)\/([^/]+)$/);
  if (protocolMatch) {
    const [, slug, fileName] = protocolMatch;
    return `/idl/${protocolSlugToFlatName(slug)}.${fileName}`;
  }

  const actionRunnerMatch = value.match(/^\/action-runners\/([^/]+)$/);
  if (actionRunnerMatch) {
    return `/idl/${actionRunnerMatch[1]}`;
  }

  return value;
}

function rewriteJsonForConsumer(value) {
  if (Array.isArray(value)) {
    return value.map(rewriteJsonForConsumer);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, rewriteJsonForConsumer(nested)]),
    );
  }
  return rewritePathToConsumer(value);
}

async function readJson(filePath, label) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) {
    fail(`${label} not found: ${filePath}`);
  }
  return JSON.parse(raw);
}

async function listJsonFiles(dirPath, label) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    fail(`${label} not found: ${dirPath}`);
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

async function buildDesiredFiles() {
  const desired = new Map();

  const registry = rewriteJsonForConsumer(await readJson(REGISTRY_PATH, 'Protocol registry'));
  desired.set('registry.json', `${JSON.stringify(registry, null, 2)}\n`);

  for (const fileName of await listJsonFiles(SCHEMAS_DIR, 'Protocol registry schemas')) {
    const parsed = rewriteJsonForConsumer(await readJson(path.join(SCHEMAS_DIR, fileName), fileName));
    desired.set(fileName, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  const protocolEntries = await fs.readdir(PROTOCOLS_DIR, { withFileTypes: true }).catch(() => null);
  if (!protocolEntries) {
    fail(`Protocol registry protocols not found: ${PROTOCOLS_DIR}`);
  }

  for (const entry of protocolEntries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const slug = entry.name;
    const flatPrefix = protocolSlugToFlatName(slug);
    const protocolDir = path.join(PROTOCOLS_DIR, slug);
    for (const fileName of await listJsonFiles(protocolDir, `Protocol registry protocol ${slug}`)) {
      const parsed = rewriteJsonForConsumer(await readJson(path.join(protocolDir, fileName), `${slug}/${fileName}`));
      desired.set(`${flatPrefix}.${fileName}`, `${JSON.stringify(parsed, null, 2)}\n`);
    }
  }

  for (const fileName of await listJsonFiles(ACTION_RUNNERS_DIR, 'Protocol registry action runners')) {
    const parsed = rewriteJsonForConsumer(await readJson(path.join(ACTION_RUNNERS_DIR, fileName), fileName));
    desired.set(fileName, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  return desired;
}

async function readFileOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const desiredFiles = await buildDesiredFiles();
  const updates = [];

  for (const [fileName, content] of desiredFiles) {
    const targetPath = path.join(TARGET_DIR, fileName);
    if (checkMode) {
      const current = await readFileOrNull(targetPath);
      if (current !== content) {
        updates.push(fileName);
      }
      continue;
    }

    await fs.writeFile(targetPath, content, 'utf8');
    updates.push(fileName);
  }

  const extras = [];
  const targetEntries = await fs.readdir(TARGET_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of targetEntries) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = entry.name;
    if (EXCLUDED_FILES.has(fileName) || desiredFiles.has(fileName) || !isManagedTargetFile(fileName)) {
      continue;
    }
    if (checkMode) {
      extras.push(fileName);
      continue;
    }
    await fs.unlink(path.join(TARGET_DIR, fileName));
    extras.push(fileName);
  }

  if (checkMode) {
    if (updates.length > 0 || extras.length > 0) {
      const chunks = [];
      if (updates.length > 0) {
        chunks.push(`Out of date copies:\n- ${updates.join('\n- ')}`);
      }
      if (extras.length > 0) {
        chunks.push(`Unexpected managed files:\n- ${extras.join('\n- ')}`);
      }
      fail(
        `Protocol registry artifacts in ${TARGET_DIR} are out of date.\nEdit protocol sources in ${REGISTRY_DIR}, then rerun npm run registry:sync.\n\n${chunks.join('\n\n')}`,
      );
    }
    console.log(`Protocol registry artifacts are up to date in ${TARGET_DIR}. Do not edit synced files by hand.`);
    return;
  }

  console.log(
    `Synced ${updates.length} protocol registry artifact(s) into ${TARGET_DIR} and removed ${extras.length} stale managed file(s). Do not edit synced files by hand.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
