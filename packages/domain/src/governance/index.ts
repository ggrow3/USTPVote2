/**
 * The governance context (design §10): what the web app shows each membership state and staff role, and the quote on
 * the home page (§10.5).
 */
export {
  MENU_LINKS,
  ADMIN_SECTIONS,
  MEMBERSHIP_AUDIENCES,
  AUDIENCES,
  SIGNED_IN_AUDIENCES,
  SECTION_ROLES,
  GUARDED_SECTIONS,
  SIGN_IN_WAYS,
  START_PAGES,
  DEFAULT_NAVIGATION,
  menuLock,
  sectionLock,
  startPageOptions,
  resolveNavigation,
  checkNavigationSettings,
  navigationChanges,
  membershipAudience,
  shownTo,
  startPageFor,
  startPagePath,
  navigationSettingsSchema,
} from './navigation.js';
export type {
  MenuLink,
  AdminSection,
  MembershipAudience,
  Audience,
  SignedInAudience,
  StartPage,
  NavigationSettings,
  NavigationRecord,
  PublicNavigation,
  CellLock,
  NavigationChange,
  NavigationChangedPayload,
  Viewer,
  NavigationSettingsInput,
} from './navigation.js';
export {
  HOME_QUOTE_LIMITS,
  DEFAULT_HOME_QUOTE,
  tidyQuoteText,
  tidyAttribution,
  resolveHomeQuote,
  checkHomeQuote,
  homeQuoteChanges,
  homeQuoteSchema,
} from './home-quote.js';
export type {
  HomeQuote,
  HomeQuoteRecord,
  PublicHomeQuote,
  HomeQuoteChange,
  HomeQuoteChangedPayload,
  HomeQuoteInput,
} from './home-quote.js';
