export const ssr = false;
export const prerender = true;

export async function load() {
  // Client-only: check IndexedDB for existing current session id
  try {
    const { get } = await import('idb-keyval');
    const id = await get('current-session');
    return { hasCurrentSession: Boolean(id) };
  } catch {
    return { hasCurrentSession: false };
  }
}