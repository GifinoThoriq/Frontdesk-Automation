export type IssueStatus = 'new' | 'open' | 'resolved' | 'pending';
export type EventSource = 'json' | 'night-log';

export interface NormalizedEvent {
  id: string;
  source: EventSource;
  shiftDate: string;        // YYYY-MM-DD of the morning the shift hands over to
  timestamp: string;        // ISO 8601
  type: string;
  room: string | null;
  guest: string | null;
  description: string;
  status: 'resolved' | 'unresolved' | 'pending';
  sourceText: string;       // raw original text — grounding anchor
  flags?: string[];         // e.g. ['CONFLICT', 'UNVERIFIED', 'SECURITY', 'GAP']
}

export interface Issue {
  key: string;              // e.g. "deposit::309" or "maintenance::112"
  type: string;
  room: string | null;
  guest: string | null;
  summary: string;
  state: IssueStatus;
  openedOn: string;         // shiftDate
  resolvedOn?: string;
  events: NormalizedEvent[];
  flags: string[];
}

export interface ReconcileResult {
  hotelId: string;
  shiftDate: string;
  newIssues: Issue[];
  openIssues: Issue[];
  resolvedIssues: Issue[];
  pendingIssues: Issue[];
  flaggedItems: NormalizedEvent[];
}

export interface HandoverSection {
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'info';
  items: HandoverItem[];
}

export interface HandoverItem {
  summary: string;
  detail: string;
  sourceQuote: string;
  flags: string[];
  room: string | null;
  guest: string | null;
}

export interface Handover {
  hotelId: string;
  hotelName: string;
  shiftDate: string;
  generatedAt: string;
  sections: HandoverSection[];
}
