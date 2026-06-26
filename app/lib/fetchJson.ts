// Small fetch helper that parses JSON and surfaces the API's `error` message on
// non-2xx responses. Shared by the page data hooks and the search form.
export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Request failed.");
  return json as T;
}
