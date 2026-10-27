/** Firestore layout (design §11). The only place collection names are spelled out. */
export const Collections = {
  // registration
  accounts: 'accounts',
  accountIdentities: 'account_identities',
  accountFactors: 'account_factors',
  signInMethods: 'sign_in_methods',
  members: 'members',
  memberStatusHistory: 'member_status_history',
  applications: 'applications',
  bylawsVersions: 'bylaws_versions',
  bylawsChecks: 'bylaws_checks',
  bylawsCheckReferences: 'bylaws_check_references',
  profilePhotos: 'profile_photos',
  photoChecks: 'photo_checks',
  positions: 'positions',
  positionTerms: 'position_terms',
  eligibilitySnapshots: 'eligibility_snapshots',
  // voting
  elections: 'elections',
  proposalSnapshots: 'proposal_snapshots',
  proposalReviews: 'proposal_reviews',
  /** `consistency_checks/{electionId}_{accountId}`: one platform consistency check per person per election (design §5.5). */
  consistencyChecks: 'consistency_checks',
  results: 'results',
  // audit & admin
  auditEvents: 'audit_events',
  ledgerHead: 'ledger_head',
  blocks: 'blocks',
  anchors: 'anchors',
  signingKeys: 'signing_keys',
  roleAssignments: 'role_assignments',
  approvalRequests: 'approval_requests',
  locks: 'locks',
  /** `anthropic_key/current`: who added the Anthropic API key in the app, never the key (design §5.6). */
  anthropicKey: 'anthropic_key',
  /** `navigation/current`: what the web app shows each membership state and role (design §10.5). */
  navigation: 'navigation',
  // notifications (design §6.8)
  notices: 'notices',
  noticeOutbox: 'notice_outbox',
  noticeSettings: 'notice_settings',
  // testing mode (design §10.4)
  testingPersonas: 'testing_personas',
} as const;

/** Subcollection of `notices/{noticeId}`: one record per person on the roll. */
export const NOTICE_RECIPIENTS = 'recipients';

/** Subcollections of `elections/{electionId}`. */
export const ElectionCollections = {
  contests: 'contests',
  candidates: 'candidates',
  rollEntries: 'roll_entries',
  participation: 'participation',
  ballotPool: 'ballot_pool',
  sealedBlocks: 'sealed_blocks',
} as const;

export type ElectionCollection = (typeof ElectionCollections)[keyof typeof ElectionCollections];

export function electionDocPath(electionId: string, collection: ElectionCollection, docId: string): string {
  return `${Collections.elections}/${electionId}/${collection}/${docId}`;
}

/** Sequence numbers and block indexes are zero-padded so document IDs sort numerically. */
export function sequenceId(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('sequence must be a non-negative integer');
  return String(n).padStart(12, '0');
}
