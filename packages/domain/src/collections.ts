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
  /** `registration_form/current`: the registration form's wording, its intro and questions (design §5.2). */
  registrationForm: 'registration_form',
  /** `registration_form_versions/{version}`: each saved version of that wording, never changed afterwards. */
  registrationFormVersions: 'registration_form_versions',
  bylawsChecks: 'bylaws_checks',
  bylawsCheckReferences: 'bylaws_check_references',
  profilePhotos: 'profile_photos',
  photoChecks: 'photo_checks',
  /** `candidacies/{candidacyId}`: members running for public office, reviewed before they are public (design �5.8). */
  candidacies: 'candidacies',
  positions: 'positions',
  positionTerms: 'position_terms',
  /** `teams/{teamId}`: working groups members join (design §5.7). */
  teams: 'teams',
  /** `team_members/{teamId}_{accountId}`: who is on each team, as a lead or a member. */
  teamMembers: 'team_members',
  /** `team_requests/{teamId}_{accountId}`: each member's latest request to join a team. */
  teamRequests: 'team_requests',
  eligibilitySnapshots: 'eligibility_snapshots',
  // voting
  elections: 'elections',
  proposalSnapshots: 'proposal_snapshots',
  proposalReviews: 'proposal_reviews',
  /** `consistency_checks/{electionId}_{accountId}`: one platform consistency check per person per election (design §5.5). */
  consistencyChecks: 'consistency_checks',
  /** `consistency_documents/{electionId}`: the documents an election's consistency checks compare with (design §5.5). */
  consistencyDocuments: 'consistency_documents',
  /** `election_checks/{checkId}`: the advisory election setup checks of an election against the bylaws (design §6.9). */
  electionChecks: 'election_checks',
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
  // first-party learning, deliberately isolated from member, election, ballot and audit records
  courses: 'courses',
  courseLessons: 'course_lessons',
  courseProfiles: 'course_profiles',
  courseVersions: 'course_versions',
  courseProgress: 'course_progress',
  courseAttempts: 'course_attempts',
  courseCertificates: 'course_certificates',
  courseLtiDeployments: 'course_lti_deployments',
  courseLtiOutcomes: 'course_lti_outcomes',
  /** `anthropic_key/current`: who added the Anthropic API key in the app, never the key (design §5.6). */
  anthropicKey: 'anthropic_key',
  /** `navigation/current`: what the web app shows each membership state and role (design §10.5). */
  navigation: 'navigation',
  /** `home_quote/current`: the quote on the home page (design §10.5). */
  homeQuote: 'home_quote',
  /** `hub/current`: the home page hub's profile, icons, Discord card and links (design §10.6). */
  hub: 'hub',
  /** `hub_logos/{sha256}`: logos uploaded for the hub, as stored after re-encoding (design §10.6). */
  hubLogos: 'hub_logos',
  /** `hub_covers/{sha256}`: cover banners uploaded for the hub, as stored after re-encoding (design §10.6). */
  hubCovers: 'hub_covers',
  /** `hub_backgrounds/{sha256}`: background photos uploaded for the pages, as stored after re-encoding (§10.6). */
  hubBackgrounds: 'hub_backgrounds',
  /** `hub_clicks/{target}`: how often each hub link was followed, in total and per day; nothing about who (§10.6). */
  hubClicks: 'hub_clicks',
  // notifications (design §6.8)
  notices: 'notices',
  noticeOutbox: 'notice_outbox',
  noticeSettings: 'notice_settings',
  /** `notice_receipts/{receiptId}`: one per send of election email, to the roll or a test (design §6.8). */
  noticeReceipts: 'notice_receipts',
  /** `notice_tests/{testId}`: an Election Admin's test email to themselves, queued for the worker (design §6.8). */
  noticeTests: 'notice_tests',
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
