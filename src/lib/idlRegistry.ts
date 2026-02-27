export type ProtocolManifest = {
  id: string;
  name: string;
  network: string;
  programId: string;
  idlPath: string;
  transport: 'local-orca-whirlpool';
  supportedCommands: string[];
  status: 'active' | 'inactive';
};

type RegistryShape = {
  version: string;
  protocols: ProtocolManifest[];
};

let registryCache: RegistryShape | null = null;

export async function loadRegistry(): Promise<RegistryShape> {
  if (registryCache) {
    return registryCache;
  }

  const response = await fetch('/idl/registry.json');
  if (!response.ok) {
    throw new Error('Failed to load local IDL registry.');
  }

  const parsed = (await response.json()) as RegistryShape;
  registryCache = parsed;
  return parsed;
}

export async function getPrimarySwapProtocol(): Promise<ProtocolManifest> {
  const registry = await loadRegistry();
  const manifest = registry.protocols.find(
    (protocol) => protocol.status === 'active' && protocol.supportedCommands.includes('/swap'),
  );

  if (!manifest) {
    throw new Error('No active swap protocol found in registry.');
  }

  return manifest;
}
