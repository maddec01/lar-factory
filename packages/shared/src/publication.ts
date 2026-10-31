// Browser-safe requests and results for the publication journal. Provider adapters execute only claimed operations.

export interface GateEvidence {
  gateId: string;
  workId: string;
  sourceRevision: number;
  briefDigest: string;
  approvedBy: string;
  evidence: string;
  recordedAt: string;
}

export interface GateResult {
  briefDigest: string | null;
  current: boolean;
  evidence: GateEvidence[];
}

export interface PublicationSource {
  workId: string;
  revision: number;
  /** Includes refinement and structure, excludes execution metadata and journal writes. */
  digest: string;
  gate: GateEvidence | null;
}

export interface PublicationReadiness {
  eligible: boolean;
  reasons: string[];
  sources: PublicationSource[];
}

export interface PublicationDestination {
  provider: 'github' | 'azure';
  repository: string;
  /** Azure project or team scope, when needed. */
  project?: string;
  ticket?: string;
  url?: string;
}

export interface VocabularyTerm {
  type: string | null;
  labels: string[];
}

export interface PublicationTicket {
  workId: string;
  destination: PublicationDestination;
  /** Effective entries applicable to this ticket, after local overrides and repository defaults. */
  vocabulary: Record<string, VocabularyTerm>;
  /** The user's explicit resolution of all applicable exclusive type candidates, including choosing none. */
  typeResolution: { candidates: string[]; selected: string | null };
  title: string;
  body: string;
}

export type PublicationLocation =
  | { kind: 'body'; start: number; end: number }
  | { kind: 'comment'; commentId: string };

interface Operation {
  operationId: string;
  ticketWorkId: string;
  /** Earlier operations whose successful results this operation requires. */
  dependsOn: string[];
}

export type PublicationOperation = Operation & (
  | { kind: 'create' }
  | { kind: 'append' | 'replace'; content: string; location: Extract<PublicationLocation, { kind: 'body' }>; expectedText: string }
  | { kind: 'comment'; content: string }
  | { kind: 'replace-comment'; content: string; location: Extract<PublicationLocation, { kind: 'comment' }>; expectedText: string }
  | { kind: 'relationship'; relatedWorkId: string; relationship: 'child' | 'blocked-by' }
  | { kind: 'textual-relationship'; relatedWorkId: string; relationship: 'child' | 'blocked-by'; content: string }
  | { kind: 'pr-closing-reference'; pullRequest: string; content: string }
);

export interface PublicationContent {
  tickets: PublicationTicket[];
  /** Provider writes in dispatch order. An uncertain or failed operation stops dispatch. */
  operations: PublicationOperation[];
}

export interface PublicationProposal extends PublicationContent {
  /** Every source returned by publicationReadiness, at the revision used to prepare the content. */
  sources: { workId: string; revision: number }[];
  replaces?: string;
}

export type PublicationOutcome =
  | { status: 'successful'; evidence: string; ticket?: string; url?: string; location?: PublicationLocation }
  | { status: 'failed' | 'uncertain'; evidence: string };

export interface PublicationAttempt {
  /** Creation receipts survive independently of content verification. */
  verification?: { status: 'pending' | 'verified' | 'discrepancy'; evidence: string };
  claimToken: string;
  claimedBy: string;
  claimedAt: string;
  /** Claiming records uncertainty before the provider write. No expiry returns it to pending. */
  status: 'successful' | 'failed' | 'uncertain';
  evidence: string | null;
  ticket: string | null;
  url: string | null;
  location: PublicationLocation | null;
  resolvedBy: string | null;
  recordedAt: string | null;
}

export interface PublicationOperationResult {
  operation: PublicationOperation;
  status: 'pending' | PublicationAttempt['status'];
  attempt: PublicationAttempt | null;
}

export interface PublicationPlan extends PublicationContent {
  planId: string;
  workId: string;
  revision: number;
  /** SHA-256 of the complete immutable proposal, source evidence included. Approval must echo it. */
  digest: string;
  sources: PublicationSource[];
  replaces: string | null;
  supersededBy: string | null;
  proposedAt: string;
  approval: { approvedBy: string; approvedAt: string; digest: string } | null;
  results: PublicationOperationResult[];
}

export interface PublicationPending {
  plan: PublicationPlan;
  current: boolean;
  reasons: string[];
  next: PublicationOperation | null;
  successful: string[];
  failed: string[];
  uncertain: string[];
}

export interface PublishedText {
  planId: string;
  operationId: string;
  workId: string;
  ticket: string;
  url: string;
  text: string;
  location: PublicationLocation;
  recordedAt: string;
}

export interface PublicationAttachment {
  workId: string;
  planId: string;
  ticket: string;
  url: string;
  recordedAt: string;
}
