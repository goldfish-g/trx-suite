// Where the app lives for the public, and how it names itself to search
// engines and link previews. index.html says the same (canonical link,
// og:url, structured data). The server lets search engines index only this
// address (server/src/seo.ts), so the home server, test servers and copies
// elsewhere stay out of search results.

export const SITE_URL = 'https://tombs.nexus';

/** The page's title on the home screen, which search results show. */
export const SITE_TITLE = 'Tombs Nexus · Play Tomb Raider and TRLE levels online';
