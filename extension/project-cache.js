export const PROJECT_CACHE_TTL_MS = 5 * 60 * 1000;

export async function cachedProjects({ storage, fetchProjects, now = () => Date.now(), ttl = PROJECT_CACHE_TTL_MS, force = false }) {
  const stored = await storage.get(['bookmarkProjects', 'bookmarkProjectsCachedAt']);
  if (!force && Array.isArray(stored.bookmarkProjects)
    && Number.isFinite(stored.bookmarkProjectsCachedAt)
    && now() - stored.bookmarkProjectsCachedAt < ttl) {
    return { projects: stored.bookmarkProjects, cached: true };
  }
  const projects = await fetchProjects();
  await storage.set({ bookmarkProjects: projects, bookmarkProjectsCachedAt: now() });
  return { projects, cached: false };
}
