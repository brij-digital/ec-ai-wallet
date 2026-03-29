import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IDL_DIR = path.join(ROOT, 'public/idl');

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
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function buildCorePack(meta, sourceFile) {
  const version = asString(meta.version, `${sourceFile}.version`);
  const protocolId = asString(meta.protocolId, `${sourceFile}.protocolId`);
  const label = asString(meta.label, `${sourceFile}.label`);
  const templates =
    meta.templates && typeof meta.templates === 'object' && !Array.isArray(meta.templates)
      ? meta.templates
      : {};
  const operations = asObject(meta.operations, `${sourceFile}.operations`);
  const sourceEntries =
    meta.sources && typeof meta.sources === 'object' && !Array.isArray(meta.sources)
      ? Object.entries(meta.sources).filter(([, value]) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
          }
          const kind = value.kind;
          return kind === 'inline' || kind === 'http_json';
        })
      : [];

  return {
    $schema: '/idl/meta_idl.core.schema.v0.6.json',
    schema: 'meta-idl.core.v0.6',
    version,
    protocolId,
    label,
    ...(sourceEntries.length > 0 ? { sources: Object.fromEntries(sourceEntries) } : {}),
    templates,
    operations,
  };
}

function buildAppPack(meta, sourceFile) {
  const version = asString(meta.version, `${sourceFile}.version`);
  const protocolId = asString(meta.protocolId, `${sourceFile}.protocolId`);
  const label = asString(meta.label, `${sourceFile}.label`);
  const apps = asObject(meta.apps, `${sourceFile}.apps`);

  return {
    $schema: '/idl/meta_app.schema.v0.1.json',
    schema: 'meta-app.v0.1',
    version,
    protocolId,
    label,
    apps,
  };
}

function resolveOutputPaths(metaPath) {
  if (!metaPath.endsWith('.meta.json')) {
    fail(`Expected *.meta.json file, got ${metaPath}`);
  }
  const base = metaPath.slice(0, -'.meta.json'.length);
  return {
    corePath: `${base}.meta.core.json`,
    appPath: `${base}.app.json`,
  };
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const entries = await fs.readdir(IDL_DIR, { withFileTypes: true });
  const metaFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.meta.json') &&
        !entry.name.endsWith('.meta.core.json'),
    )
    .map((entry) => path.join(IDL_DIR, entry.name))
    .sort();

  if (metaFiles.length === 0) {
    console.log('No *.meta.json files found under public/idl.');
    return;
  }

  const updates = [];
  for (const metaFile of metaFiles) {
    const sourceFile = path.relative(ROOT, metaFile);
    const parsed = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    const meta = asObject(parsed, sourceFile);
    const { corePath, appPath } = resolveOutputPaths(metaFile);

    const corePackText = `${JSON.stringify(buildCorePack(meta, sourceFile), null, 2)}\n`;
    const appPackText = `${JSON.stringify(buildAppPack(meta, sourceFile), null, 2)}\n`;

    if (checkMode) {
      const currentCore = await fs.readFile(corePath, 'utf8').catch(() => null);
      const currentApp = await fs.readFile(appPath, 'utf8').catch(() => null);
      if (currentCore !== corePackText) {
        updates.push(`${sourceFile} -> ${path.relative(ROOT, corePath)}`);
      }
      if (currentApp !== appPackText) {
        updates.push(`${sourceFile} -> ${path.relative(ROOT, appPath)}`);
      }
      continue;
    }

    await fs.writeFile(corePath, corePackText, 'utf8');
    await fs.writeFile(appPath, appPackText, 'utf8');
    updates.push(`${sourceFile} -> ${path.relative(ROOT, corePath)}`);
    updates.push(`${sourceFile} -> ${path.relative(ROOT, appPath)}`);
  }

  if (checkMode) {
    if (updates.length > 0) {
      console.error('Split meta outputs are out of date:');
      for (const item of updates) {
        console.error(`- ${item}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log('Split meta outputs are up to date.');
    return;
  }

  console.log('Generated split meta packs:');
  for (const item of updates) {
    console.log(`- ${item}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
