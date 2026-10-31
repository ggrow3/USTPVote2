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
  /** `candidacies/{candidacyId}`: members running for public office, reviewed before they are public (design §5.8). */
  candidacies: 'candidacies',
  positions: 'positions',
  positionTerms: 'position_terms',
  /** `teams/{teamId}`: working groups members join (design §5.7). */
  teams: 'teams',
  /** `team_members/{teamId}_{accountId}`: who is on each team, as a lead or a member. */
  teamMembers: 'team_members',
  /** `team_requests/{teamId}_{accountId}`: each member's latest request to join a team. */
  teamRequests: 'team_requests',
  /** `forum_posts/{postId}`: discussions and proposals Active members post (design §5.9). */
  forumPosts: 'forum_posts',
  /** `forum_comments/{commentId}`: comments on posts and replies to them. */
  forumComments: 'forum_comments',
  /** `forum_votes/{kind}_{targetId}_{accountId}`: each member's vote on a post or comment, shown to nobody else. */
  forumVotes: 'forum_votes',
  /** `forum_reports/{kind}_{targetId}_{accountId}`: each member's report of a post or comment, for Membership Admins. */
  forumReports: 'forum_reports',
  /** `room_consents/{accountId}`: each member's acceptance of the room's terms, or its withdrawal (design §5.10). */
  roomConsents: 'room_consents',
  /** `room_messages/{messageId}`: the room's messages, the assistant's answers and notices; kept 90 days. */
  roomMessages: 'room_messages',
  /** `room_reactions/{messageId}_{accountId}`: a member's vote and emoji reactions on a message, shown to them only. */
  roomReactions: 'room_reactions',
  /** `room_memory/{itemId}`: the room's decisions and action items, the assistant's project memory. */
  roomMemory: 'room_memory',
  /** `room_jobs/{jobId}`: questions waiting for the assistant, run on the worker. */
  roomJobs: 'room_jobs',
  /**
   * `room_state/feed`: the room's change counter, the assistant's switch and the questions it is working on;
   * `room_state/door`: the door's intro line and the terms in force.
   */
  roomState: 'room_state',
  /** `room_voice/{accountId}`: who is in the room's call, from which page. */
  roomVoice: 'room_voice',
  /** `room_signals/{signalId}`: handshakes between pages in the call; deleted 5 minutes after they were sent. */
  roomSignals: 'room_signals',
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
  /** `course_images/{sha256}`: portraits uploaded by Course Administrators, as stored after re-encoding. */
  courseImages: 'course_images',
  /** `course_seeds/{seed}`: which starter courses have been added, so a course deleted later is not added again. */
  courseSeeds: 'course_seeds',
  /** `course_threads/{courseId}_{accountId}`: a learner's conversation with the course's instructors, and its switch. */
  courseThreads: 'course_threads',
  /** `course_messages/{messageId}`: the messages in those conversations. */
  courseMessages: 'course_messages',
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
  /** `sign_ins/{uid}_{authTime}`: each sign-in the api saw, with its address; expires (design §10.7). */
  signIns: 'sign_ins',
  /** `site_analytics/current`: the site's Google Analytics measurement ID, if any (design §10.7). */
  siteAnalytics: 'site_analytics',
  // communications (design §10.9)
  /** `news_posts/{postId}`: news, statements and press releases, drafts too. */
  newsPosts: 'news_posts',
  /** `press_kit/current`: the Press page's contact, description, facts and files. */
  pressKit: 'press_kit',
  /** `press_assets/{sha256}`: files uploaded for the press kit, as stored. */
  pressAssets: 'press_assets',
  /** `share_posts/{shareId}`: the share kit's ready-made posts for members. */
  sharePosts: 'share_posts',
  /** `share_counts/{item}`: how often each share button was pressed; nothing about who. */
  shareCounts: 'share_counts',
  /** `calendar_items/{itemId}`: the social media calendar's planned posts. */
  calendarItems: 'calendar_items',
  /** `suggestions/{suggestionId}`: suggestions sent with the public form, kept a year. */
  suggestions: 'suggestions',
  /** `suggestion_limits/{YYYY-MM-DD}`: each day's salt and counts for the form's limits. */
  suggestionLimits: 'suggestion_limits',
  /** `bots/{botId}`: the registry of the party's bots. */
  bots: 'bots',
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
