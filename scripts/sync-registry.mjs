if (!process.env.APPPACK_REGISTRY_DIR && process.env.PROTOCOL_REGISTRY_DIR) {
  process.env.APPPACK_REGISTRY_DIR = process.env.PROTOCOL_REGISTRY_DIR;
}

await import('./sync-from-registry.mjs');
