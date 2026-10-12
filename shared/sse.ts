export interface SseMessage {
  event: string;
  data: unknown;
}

/**
 * Splits complete Server-Sent Events off the front of `buffer`. Returns the parsed events and the unparsed rest.
 * Comment lines (heartbeats) are skipped; `data` is JSON, as the backend always sends.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const text = buffer.replace(/\r\n?/g, '\n');
  let start = 0;
  for (let end = text.indexOf('\n\n'); end >= 0; end = text.indexOf('\n\n', start)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of text.slice(start, end).split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) messages.push({ event, data: JSON.parse(data.join('\n')) });
    start = end + 2;
  }
  return { messages, rest: text.slice(start) };
}
