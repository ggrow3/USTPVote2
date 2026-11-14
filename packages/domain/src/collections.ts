/** Firestore layout (design §11). The only place collection names are spelled out. */
export const Collections = {
  // registration
  accounts: 'accounts',
  accountIdentities: 'account_identities',
  accountFactors: 'account_factors',
  signInMethods: 'sign_in_methods',
  /** `mfa_policy/current`: whether members without an admin role must sign in with a second factor (design §4). */
  mfaPolicy: 'mfa_policy',
  members: 'members',
  memberStatusHistory: 'member_status_history',
  applications: 'applications',
  bylawsVersions: 'bylaws_versions',
  /** `registration_form/current`: the registration form's wording, its intro and questions (design §5.2). */
  registrationForm: 'registration_form',
  /** `registration_form_versions/{version}`: each saved version of that wording, never changed afterwards. */
  registrationFormVersions: 'registration_form_versions',
  /** `first_steps/current`: the getting started list new members see, as Membership Admins set it (design §5.16). */
  firstSteps: 'first_steps',
  /** `first_step_ticks/{accountId}`: the steps on that list a member ticked themselves. */
  firstStepTicks: 'first_step_ticks',
  bylawsChecks: 'bylaws_checks',
  bylawsCheckReferences: 'bylaws_check_references',
  profilePhotos: 'profile_photos',
  photoChecks: 'photo_checks',
  /** `candidacies/{candidacyId}`: members running for public office, reviewed before they are public (design §5.8). */
  candidacies: 'candidacies',
  /** `area_contacts/{contactId}`: office holders and candidates Communications Admins enter (design §5.12). */
  areaContacts: 'area_contacts',
  /** `email_templates/{office}`: the emails members send from the Your area page, one per kind of office (design §5.12). */
  emailTemplates: 'email_templates',
  /** `race_records/{state}`: what public records said about a state's federal races, or `US` the presidency's, shared a day (design §5.17). */
  raceRecords: 'race_records',
  positions: 'positions',
  positionTerms: 'position_terms',
  /** `teams/{teamId}`: working groups members join (design §5.7). */
  teams: 'teams',
  /** `bill_settings/current`: which teams have the Bills tool (design §5.14). */
  billSettings: 'bill_settings',
  /** `bill_watch/{congress}-{type}-{number}`: the legislative team's shared watchlist (design §5.14). */
  billWatch: 'bill_watch',
  /** `bill_notes/{noteId}`: the team's notes on watched bills (design §5.14). */
  billNotes: 'bill_notes',
  /** `bill_public/{congress}-{type}-{number}`: the bills the team shows on the public Legislation page (design §5.14). */
  billPublic: 'bill_public',
  /** `bill_roll_calls/{chamber}-{congress}-{session}-{roll}`: each roll call on a public bill, every member's vote (design §5.14). */
  billRollCalls: 'bill_roll_calls',
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
  // The inbox (design §10.13): in-app notifications, messages between members, and how each wants notifications by email.
  appNotifications: 'app_notifications',
  inboxPreferences: 'inbox_preferences',
  memberThreads: 'member_threads',
  memberMessages: 'member_messages',
  memberBlocks: 'member_blocks',
  messageReports: 'message_reports',
  // The membership inbox (design §10.13): conversations between the membership team and each member.
  membershipThreads: 'membership_threads',
  membershipMessages: 'membership_messages',
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
  /** `certificate_settings/current`: what System Admins set about certificates, the party's LinkedIn organization. */
  certificateSettings: 'certificate_settings',
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
  /** `api_keys/{name}`: who added a public-records service's key in the app, never the key (design §5.6). */
  apiKeys: 'api_keys',
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
  /** `page_hits/{page}`: hits on each page of the web app, per UTC day; nothing about who (design §10.7). */
  pageHits: 'page_hits',
  /** `page_visits/{visitId}`: a signed-in person's visit to a page, naming their account; expires (design §10.7). */
  pageVisits: 'page_visits',
  /** `visit_sources/{day}_{hash}`: arrivals per UTC day by where they came from and their campaign tags; nothing about who (§10.7). */
  visitSources: 'visit_sources',
  // communications (design §10.9)
  /** `news_posts/{postId}`: news, statements and press releases, drafts too. */
  newsPosts: 'news_posts',
  /** `press_kit/current`: the Press page's contact, description, facts and files. */
  pressKit: 'press_kit',
  /** `press_assets/{sha256}`: files uploaded for the press kit, as stored. */
  pressAssets: 'press_assets',
  /** `videos/{videoId}`: videos uploaded for lessons, news, the press kit and the hub; their bytes are in the videos bucket. */
  videos: 'videos',
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
  /** `discord_settings/current` and `discord_settings/token`: the Discord bot's switch and channels, and who added its token (design §10.18). */
  discordSettings: 'discord_settings',
  /** `discord_state/feed`, `discord_state/test` and `discord_state/app`: how far the bot has read, a test post waiting for the worker, and what Discord was told of the commands (design §10.18). */
  discordState: 'discord_state',
  /** `discord_posts/{id}`: each post the bot made, once (design §10.18). */
  discordPosts: 'discord_posts',
  /** `discord_outbox/{id}`: the emulators' stand-in for Discord, which records each post instead of sending it. */
  discordOutbox: 'discord_outbox',
  // issue polls (design §10.16): non-binding, apart from elections, never ledgered
  /** `polls/{pollId}`: the public issue polls Communications Admins write, drafts too. */
  polls: 'polls',
  /** `poll_tallies/{pollId}_{shard}`: each poll's counts, split over a few documents so many can vote at once. */
  pollTallies: 'poll_tallies',
  /** `poll_marks/{pollId}_{a|b}{hash}`: that an account or a browser has answered a poll, never what; deleted at the close. */
  pollMarks: 'poll_marks',
  /** `poll_limits/{YYYY-MM-DD}`: each day's salt for counting voters' addresses; deleted the day after next. */
  pollLimits: 'poll_limits',
  /** `poll_address_counts/{day}_{pollId}_{hash}`: answers from one address to one poll that day; deleted the day after next. */
  pollAddressCounts: 'poll_address_counts',
  /** `events/{eventId}`: the party's public events, drafts too (design §10.17). */
  events: 'events',
  /** `partners/{partnerId}`: partner groups, listed in public only with their consent (design §10.17). */
  partners: 'partners',
  // notifications (design §6.8)
  notices: 'notices',
  noticeOutbox: 'notice_outbox',
  noticeSettings: 'notice_settings',
  /** `notice_receipts/{receiptId}`: one per send of election email, to the roll or a test (design §6.8). */
  noticeReceipts: 'notice_receipts',
  /** `notice_tests/{testId}`: an Election Admin's test email to themselves, queued for the worker (design §6.8). */
  noticeTests: 'notice_tests',
  /** `notice_verifications/{receiptId}`: each send to a roll, checked 30 minutes after it finished (design §6.8). */
  noticeVerifications: 'notice_verifications',
  /** `welcome_emails/{accountId}`: the welcome email to a member a Membership Admin added, queued for the worker (§5.13). */
  welcomeEmails: 'welcome_emails',
  /** `mail_messages/{messageId}`: each message the mail service took and what its delivery reports said, kept 180 days (§6.8). */
  mailMessages: 'mail_messages',
  /** `mail_suppressions/{addressKey}`: addresses not to mail, because they bounced for good or were marked as spam (§6.8). */
  mailSuppressions: 'mail_suppressions',
  /** `mail_health/current` and `mail_health/request`: the email setup check's last run, and a System Admin's request (§10.12). */
  mailHealth: 'mail_health',
  /** `mail_requests/{requestId}`: a member's request for a test email, or to try their address again, kept 30 days (§10.12). */
  mailRequests: 'mail_requests',
  /** `mail_preferences/{accountId}`: whether a member unsubscribed or an admin stopped their email, and their link's token (§10.12). */
  mailPreferences: 'mail_preferences',
  /** `broadcasts/{broadcastId}`: an email an admin wrote to members, and who it came to in terms of the audience (§10.12). */
  broadcasts: 'broadcasts',
  /** `broadcast_recipients/{broadcastId}_{accountId}`: one member's copy of it, kept 180 days (§10.12). */
  broadcastRecipients: 'broadcast_recipients',
  /** `mail_digest/weekly`: when the weekly digest is next due (design §10.14). */
  mailDigest: 'mail_digest',
  /** `newsletter_subscribers/{subscriberId}`: an address on the newsletter's list, or waiting to be confirmed (§10.15). */
  newsletterSubscribers: 'newsletter_subscribers',
  /** `newsletter_limits/{YYYY-MM-DD}`: each day's salt and counts for the sign-up form's limits (§10.15). */
  newsletterLimits: 'newsletter_limits',
  // referrals (design §5.18)
  /** `referral_codes/{code}`: whose referral link a code is. */
  referralCodes: 'referral_codes',
  /** `referral_links/{accountId}`: a member's referral code. */
  referralLinks: 'referral_links',
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
