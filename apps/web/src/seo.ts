import { onUnmounted, toValue, watchEffect, type MaybeRefOrGetter } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';
import { LINK_CARD_ROUTE } from 'ustp-domain';

/**
 * What search engines are told about each page (design §15, "Search engines"): its description, its canonical address,
 * and `noindex` for pages that must stay out of search results. robots.txt and the sitemap come from the api.
 */

/** The site's description, also in index.html (which link previews read) and the hub's fallback. */
export const SITE_DESCRIPTION =
  "The U.S. Transhumanist Party's member site: apply to join, vote in party elections, check your ballot receipt, and read the bylaws, offices and certified results.";

/** Each public page's description, by its route's path in router.ts. Pages behind sign-in need none. */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  '/': SITE_DESCRIPTION,
  '/vote': 'Register as a U.S. Transhumanist Party member, cast your ballot in party elections, and independently verify that it was counted.',
  '/register': 'Apply to become a member of the U.S. Transhumanist Party.',
  '/courses': 'Free courses from the U.S. Transhumanist Party: a map of which comes after which, with lessons, quizzes and certificates.',
  '/course/:courseId': 'A free course from the U.S. Transhumanist Party: lessons, quizzes and a certificate.',
  '/verify':
    "Check a U.S. Transhumanist Party ballot receipt against the election's published record, in your browser and from public data only.",
  '/guide': 'How to vote, run and audit a U.S. Transhumanist Party election on this site, page by page.',
  '/bylaws/:version?': 'The bylaws of the U.S. Transhumanist Party, every published version, with a way to check a copy.',
  '/results/:id': 'Results of a U.S. Transhumanist Party election, from its published record, which anyone can verify.',
  '/offices': 'Who holds each U.S. Transhumanist Party office now, and how they came to hold it.',
  '/polls': 'Polls from the U.S. Transhumanist Party anyone may answer: say what you think, see what others think, and share the results.',
  '/polls/:id': 'A poll from the U.S. Transhumanist Party anyone may answer. It decides nothing; the party decides in its elections.',
};

/**
 * Pages open to everyone that still stay out of search results: signing in, the account emails' links, one person's
 * course certificate, and unsubscribing.
 */
const NOT_LISTED: ReadonlySet<string> = new Set(['/signin', '/email-action', '/course/certificates/:id', '/unsubscribe']);

/** The route paths this module names, for its test to find in router.ts. */
export const DESCRIBED_ROUTES = [...Object.keys(DESCRIPTIONS), ...NOT_LISTED];

export interface PageSeo {
  readonly description: string;
  /** Whether search engines may list the page: not behind sign-in, and not one of the pages kept out. */
  readonly listed: boolean;
}

type Route = Pick<RouteLocationNormalized, 'meta'> & { readonly matched: readonly { readonly path: string }[] };

export function pageSeo(route: Route): PageSeo {
  const path = route.matched.at(-1)?.path ?? '/';
  return {
    description: DESCRIPTIONS[path] ?? SITE_DESCRIPTION,
    listed: !route.meta.requiresAuth && !route.meta.roles && !NOT_LISTED.has(path),
  };
}

/** The page's own address: no query or fragment, and no trailing slash but the root's. */
export function canonicalUrl(origin: string, path: string): string {
  return origin + (path.replace(/\/+$/, '') || '/');
}

/**
 * The description the api wrote into the page's `<head>` for its link preview (design §15, "Link previews"), when the
 * head was written for `path`: its `og:url` is that page. index.html as built has no `og:url`.
 */
export function servedDescription(ogUrl: string | null | undefined, description: string | null | undefined, path: string): string | null {
  const served = ogUrl ? URL.parse(ogUrl) : null;
  if (!served || !description) return null;
  const bare = (p: string) => p.replace(/\/+$/, '') || '/';
  return bare(served.pathname) === bare(path) ? description : null;
}

/**
 * A preview page's card image (design §15, "Link previews"), as its link preview shows it, for the page to show and offer
 * too. `v` only tells caches apart, as the preview's own image address does: an open poll's card changes at its close,
 * an election's when its results are certified.
 */
export const cardSrc = (path: string, v: string) => `${LINK_CARD_ROUTE}?path=${encodeURIComponent(path)}&v=${encodeURIComponent(v)}`;

let routeDescription = SITE_DESCRIPTION;
let descriptionOwner: object | null = null;
let firstPage = true;

/**
 * After each navigation: the route's description, canonical link and robots tag. On the first page opened, a
 * description the api wrote for it (a news post's summary, say) is kept in place of the route's general one.
 */
export function applyRouteSeo(route: Route & Pick<RouteLocationNormalized, 'path'>): void {
  const seo = pageSeo(route);
  const served = firstPage
    ? servedDescription(
        document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content,
        document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
        route.path,
      )
    : null;
  firstPage = false;
  routeDescription = served ?? seo.description;
  descriptionOwner = null;
  setMeta('description', routeDescription);
  setMeta('robots', seo.listed ? null : 'noindex');
  setCanonical(seo.listed ? canonicalUrl(location.origin, route.path) : null);
}

/**
 * A description the page writes itself (the hub's, from its profile) in place of its route's. Set up after the route's,
 * so it wins; on leaving, the next page's is kept, as `usePageTitle` does with titles.
 */
export function usePageDescription(description: MaybeRefOrGetter<string>): void {
  const page = {};
  watchEffect(() => {
    descriptionOwner = page;
    setMeta('description', toValue(description).trim() || routeDescription);
  });
  onUnmounted(() => {
    if (descriptionOwner !== page) return;
    descriptionOwner = null;
    setMeta('description', routeDescription);
  });
}

function setMeta(name: string, content: string | null): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (content === null) return tag?.remove();
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.append(tag);
  }
  tag.content = content;
}

function setCanonical(href: string | null): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) return link?.remove();
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = href;
}
