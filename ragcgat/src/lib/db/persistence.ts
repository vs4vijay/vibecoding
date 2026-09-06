let persistRequested = false;

export async function ensurePersistence(): Promise<boolean> {
	try {
		if (persistRequested) return true;
		const nav = (globalThis as { navigator?: Navigator }).navigator;
		const storage = nav?.storage;
		if (!storage?.persist) return false;
		persistRequested = true;
		return await storage.persist();
	} catch {
		return false;
	}
}
