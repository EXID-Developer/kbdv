/** Fan-out of server-wide events (`GET /api/events`) to every connected screen. */
export type Send = (event: string, data: unknown) => void;

const clients = new Set<Send>();

export function addClient(send: Send): () => void {
  clients.add(send);
  return () => clients.delete(send);
}

export function broadcast(event: string, data: unknown) {
  for (const send of clients) send(event, data);
}
