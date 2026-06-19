import fs from 'fs';
import path from 'path';
import { NormalizedEvent } from '../types';

interface RawEvent {
  id: string;
  timestamp: string;
  type: string;
  room: string | null;
  guest: string | null;
  description: string;
  status: 'resolved' | 'unresolved' | 'pending';
}

interface EventsFile {
  hotel: { id: string; name: string; rooms: number; timezone: string };
  events: RawEvent[];
}

/**
 * Determine the handover morning date for a given event timestamp.
 * A shift runs ~23:00–07:00, so events before 07:00 belong to the
 * same handover morning as that calendar date; events at/after 23:00
 * belong to the next morning's handover.
 */
function shiftDateFor(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const hour = d.getUTCHours() + 8; // +08:00 timezone offset
  const localHour = hour % 24;

  // Clone date and work in local (+08:00) terms
  const localDate = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  if (localHour >= 7 && localHour < 23) {
    // Daytime event — shouldn't normally appear, but assign to next morning
    localDate.setUTCDate(localDate.getUTCDate() + 1);
  } else if (localHour >= 23) {
    // Evening start of shift → handover is next morning
    localDate.setUTCDate(localDate.getUTCDate() + 1);
  }
  // localHour < 7 → early morning, same calendar date as the handover morning

  return localDate.toISOString().slice(0, 10);
}

export function ingestEvents(dataDir: string): { hotelId: string; hotelName: string; events: NormalizedEvent[] } {
  const raw: EventsFile = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'events.json'), 'utf-8')
  );

  const events: NormalizedEvent[] = raw.events.map((e) => ({
    id: e.id,
    source: 'json',
    shiftDate: shiftDateFor(e.timestamp),
    timestamp: e.timestamp,
    type: e.type,
    room: e.room,
    guest: e.guest,
    description: e.description,
    status: e.status,
    sourceText: `[${e.id}] ${e.timestamp} | ${e.type} | room ${e.room ?? 'N/A'} | ${e.description}`,
    flags: [],
  }));

  return {
    hotelId: raw.hotel.id,
    hotelName: raw.hotel.name,
    events,
  };
}
