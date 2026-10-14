import type { LanguageCode } from '../types/language';
import type { Rating } from '../types/review';

/**
 * Deep links, shared by the widgets and the app.
 *
 * Every widget target — WidgetKit, Glance, and the web dashboard tile — builds
 * its links here rather than concatenating strings in Swift and Kotlin. Two
 * copies of a URL format in two languages that only run on their own platform
 * is the kind of thing that silently breaks on one of them.
 *
 * The path structure deliberately matches the Expo Router routes, so the same
 * path works as a custom-scheme link on device and as a plain URL on web.
 */
export const APP_SCHEME = 'mon';

export interface DeepLinkOptions {
  /** Emit a web path instead of a custom-scheme URL. */
  web?: boolean;
}

function build(path: string, params: Record<string, string | number | undefined>, options: DeepLinkOptions): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const suffix = query ? `?${query}` : '';
  return options.web ? `/${path}${suffix}` : `${APP_SCHEME}:///${path}${suffix}`;
}

/** Open the app on the dashboard. */
export function linkToHome(options: DeepLinkOptions = {}): string {
  return build('', {}, options);
}

/** Start a review session, optionally forcing a language. */
export function linkToReview(languageCode?: LanguageCode, options: DeepLinkOptions = {}): string {
  return build('review', { language: languageCode }, options);
}

/** Open a session positioned on a specific card. */
export function linkToCard(cardId: string, options: DeepLinkOptions = {}): string {
  return build('review', { card: cardId }, options);
}

/**
 * Grade a card and continue.
 *
 * Used where a widget tap has to hand off to the app to do the work: Android
 * widgets below the interactive threshold, and iOS versions without App
 * Intents. On iOS 17+ the interactive widget grades in-process through the
 * `GradeCardIntent` and never opens the app at all.
 */
export function linkToGrade(cardId: string, rating: Rating, options: DeepLinkOptions = {}): string {
  return build('grade', { card: cardId, rating }, options);
}

/** Reveal the answer for a card without grading, for the two-tap widget flow. */
export function linkToReveal(cardId: string, options: DeepLinkOptions = {}): string {
  return build('review', { card: cardId, reveal: 1 }, options);
}

export function linkToStats(options: DeepLinkOptions = {}): string {
  return build('stats', {}, options);
}

export function linkToSettings(options: DeepLinkOptions = {}): string {
  return build('settings', {}, options);
}

export interface ParsedDeepLink {
  route: 'home' | 'review' | 'grade' | 'stats' | 'settings';
  cardId?: string;
  languageCode?: string;
  rating?: Rating;
  reveal?: boolean;
}

/** Parse a link produced by the helpers above, from either the scheme or web form. */
export function parseDeepLink(url: string): ParsedDeepLink | undefined {
  let path: string;
  let search: string;

  try {
    const withoutScheme = url.replace(`${APP_SCHEME}://`, '');
    const [rawPath = '', rawSearch = ''] = withoutScheme.split('?');
    path = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
    search = rawSearch;
  } catch {
    return undefined;
  }

  const params = new Map<string, string>();
  for (const pair of search.split('&')) {
    if (!pair) continue;
    const [key = '', value = ''] = pair.split('=');
    params.set(decodeURIComponent(key), decodeURIComponent(value));
  }

  const rating = params.get('rating');
  const parsedRating = rating ? (Number(rating) as Rating) : undefined;

  const base: ParsedDeepLink = {
    route: 'home',
    ...(params.get('card') ? { cardId: params.get('card') } : {}),
    ...(params.get('language') ? { languageCode: params.get('language') } : {}),
    ...(parsedRating && parsedRating >= 1 && parsedRating <= 4 ? { rating: parsedRating } : {}),
    ...(params.get('reveal') === '1' ? { reveal: true } : {}),
  };

  switch (path) {
    case '':
      return { ...base, route: 'home' };
    case 'review':
      return { ...base, route: 'review' };
    case 'grade':
      return { ...base, route: 'grade' };
    case 'stats':
      return { ...base, route: 'stats' };
    case 'settings':
      return { ...base, route: 'settings' };
    default:
      return undefined;
  }
}
