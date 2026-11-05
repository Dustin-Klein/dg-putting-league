export async function postJson<T = void>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data as T;
}
