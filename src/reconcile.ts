import fs from 'fs';
import path from 'path';
import { NormalizedEvent, Issue, ReconcileResult } from './types';
import { log } from './logger';

const STATE_FILE = path.join(process.cwd(), 'data', 'state.json');

type PersistedState = Record<string, Issue>;

function loadState(): PersistedState {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state: PersistedState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Build a stable issue key from an event.
 * Groups events that refer to the same ongoing issue.
 */
function issueKey(event: NormalizedEvent): string {
  const room = event.room ?? 'noroom';
  switch (event.type) {
    case 'maintenance':       return `maintenance::${room}`;
    case 'deposit_issue':     return `deposit::${room}`;
    case 'compliance':        return `compliance::scanner`;
    case 'facilities':        return `facilities::${room}`;
    case 'no_show':           return `no_show::${room}`;
    case 'finance_note':      return `finance::${room}`;
    case 'check_in_issue':    return `checkin_issue::${room}`;
    case 'early_checkout_request': return `early_checkout::${room}`;
    case 'complaint':         return `complaint::${room}::${event.shiftDate}`;
    case 'incident':          return `incident::${room}::${event.shiftDate}`;
    default:                  return `${event.type}::${room}::${event.shiftDate}`;
  }
}

/**
 * Detect prompt injection: instructions directed at the AI / handover system.
 */
function detectInjection(event: NormalizedEvent): boolean {
  const lower = event.description.toLowerCase() + ' ' + event.sourceText.toLowerCase();
  return (
    lower.includes('system note') ||
    lower.includes('ignore all') ||
    lower.includes('handover tool') ||
    lower.includes('add a ') && lower.includes('credit') ||
    (lower.includes('ignore') && lower.includes('other items'))
  );
}

/**
 * Check for contradictions across events on the same issue key.
 */
function detectConflicts(events: NormalizedEvent[]): string[] {
  const flags: string[] = [];
  const statuses = [...new Set(events.map((e) => e.status))];
  if (statuses.includes('resolved') && statuses.includes('unresolved')) {
    flags.push('CONFLICT');
  }
  return flags;
}

export function reconcile(
  hotelId: string,
  allEvents: NormalizedEvent[],
  targetShiftDate: string
): ReconcileResult {
  const state = loadState();

  // Detect and flag prompt injection attempts before any processing
  for (const event of allEvents) {
    if (detectInjection(event)) {
      event.flags = [...(event.flags ?? []), 'SECURITY'];
      log.warn('reconcile', 'Prompt injection attempt detected', {
        hotelId,
        eventId: event.id,
        room: event.room,
        sourceText: event.sourceText.slice(0, 120),
      });
    }
  }

  // Group all events by issue key
  const byKey: Record<string, NormalizedEvent[]> = {};
  for (const event of allEvents) {
    const key = issueKey(event);
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(event);
  }

  // Update persistent state with everything we know
  for (const [key, events] of Object.entries(byKey)) {
    const sorted = events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const latest = sorted[sorted.length - 1];
    const conflictFlags = detectConflicts(sorted);
    const allFlags = [...new Set(sorted.flatMap((e) => e.flags ?? []).concat(conflictFlags))];

    const existing = state[key];

    if (!existing) {
      state[key] = {
        key,
        type: latest.type,
        room: latest.room,
        guest: latest.guest,
        summary: latest.description,
        state: latest.status === 'resolved' ? 'resolved' : 'open',
        openedOn: sorted[0].shiftDate,
        events: sorted,
        flags: allFlags,
      };
    } else {
      // Update with latest info
      existing.summary = latest.description;
      existing.guest = latest.guest ?? existing.guest;
      existing.events = sorted;
      existing.flags = allFlags;

      if (latest.status === 'resolved' && existing.state !== 'resolved') {
        existing.state = 'resolved';
        existing.resolvedOn = latest.shiftDate;
      } else if (latest.status === 'pending') {
        existing.state = 'pending';
      } else if (latest.status === 'unresolved') {
        existing.state = 'open';
      }
    }
  }

  saveState(state);

  // Classify for target handover date
  const targetEvents = allEvents.filter((e) => e.shiftDate === targetShiftDate);
  const targetKeys = new Set(targetEvents.map(issueKey));

  const newIssues: Issue[] = [];
  const openIssues: Issue[] = [];
  const resolvedIssues: Issue[] = [];
  const pendingIssues: Issue[] = [];
  const flaggedItems: NormalizedEvent[] = allEvents.filter(
    (e) => e.shiftDate === targetShiftDate && (e.flags ?? []).length > 0
  );

  for (const [key, issue] of Object.entries(state)) {
    const isTargetNight = targetKeys.has(key);
    const wasOpenedBeforeTonight = issue.openedOn < targetShiftDate;

    if (issue.state === 'resolved' && issue.resolvedOn === targetShiftDate) {
      resolvedIssues.push(issue);
    } else if (isTargetNight && !wasOpenedBeforeTonight && issue.state !== 'resolved') {
      newIssues.push(issue);
    } else if (wasOpenedBeforeTonight && issue.state === 'open') {
      openIssues.push(issue);
    } else if (issue.state === 'pending' && (isTargetNight || wasOpenedBeforeTonight)) {
      pendingIssues.push(issue);
    }
  }

  log.info('reconcile', 'Reconciliation complete', {
    hotelId,
    shiftDate: targetShiftDate,
    new: newIssues.length,
    open: openIssues.length,
    resolved: resolvedIssues.length,
    pending: pendingIssues.length,
    flagged: flaggedItems.length,
  });

  return {
    hotelId,
    shiftDate: targetShiftDate,
    newIssues,
    openIssues,
    resolvedIssues,
    pendingIssues,
    flaggedItems,
  };
}
