import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { findTarget, placeInfo, type PlaceInfo } from '../../shared/places.ts';
import type { Places, Report, Scope } from '../../shared/types.ts';
import { PLACES_FILE } from './config.ts';
import type { Subject } from './pipeline.ts';

export const MAX_PROMPT = 300;

let places: Places | null = null;

export async function loadPlaces(): Promise<Places> {
  places ??= JSON.parse(await readFile(PLACES_FILE, 'utf8')) as Places;
  return places;
}

export function getPlaces(): Places {
  if (!places) throw new Error('Places not loaded');
  return places;
}

/** Place description given to the model, with both names so it can match articles in either language. */
export function placeLabel(info: PlaceInfo): string {
  const names = info.name.ko && info.name.ko !== info.name.en ? `${info.name.en} (${info.name.ko})` : info.name.en;
  return info.country ? `${names}, ${info.country.name.en}` : names;
}

export function placeSubject(info: PlaceInfo): Subject {
  return { scope: info.scope, code: info.code, focus: { label: placeLabel(info) }, query: info.query };
}

/** Subject for a map place, or null when the code is unknown. */
export function findPlaceSubject(scope: Scope, code: string): Subject | null {
  const target = findTarget(getPlaces(), scope, code);
  return target ? placeSubject(placeInfo(getPlaces(), target)) : null;
}

export const normalizePrompt = (prompt: string) => prompt.replace(/\s+/g, ' ').trim();

export function topicSubject(prompt: string): Subject {
  const text = normalizePrompt(prompt);
  const code = createHash('sha256').update(text.toLowerCase()).digest('hex').slice(0, 16);
  return { scope: 'topic', code, focus: { label: text, request: text }, title: text };
}

/** Subject a stored report was generated for, used to answer questions about it. */
export function subjectOfReport(report: Report): Subject | null {
  if (report.scope === 'topic') return report.title ? topicSubject(report.title) : null;
  return findPlaceSubject(report.scope, report.code);
}
