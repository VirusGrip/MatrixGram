const preparations = new Set<() => Promise<void>>();
export function registerUpdatePreparation(callback: () => Promise<void>) { preparations.add(callback); return () => { preparations.delete(callback); }; }
export async function prepareForUpdate() { await Promise.all([...preparations].map(callback => callback())); }
