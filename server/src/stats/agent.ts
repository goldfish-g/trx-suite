// The browser and system a visit came from, told from its User-Agent in
// broad strokes, and what a bot was after, told from the address it tried.

/** Order matters: Edge, Opera and Samsung Internet also call themselves Chrome, and Chrome Safari. */
const BROWSERS: readonly [string, RegExp][] = [
    ['Edge', /\bEdg(e|A|iOS)?\//],
    ['Opera', /\b(OPR|OPiOS|Opera)\//],
    ['Samsung Internet', /\bSamsungBrowser\//],
    ['Firefox', /\b(Firefox|FxiOS)\//],
    ['Chrome', /\b(Chrome|CriOS|Chromium)\//],
    ['Safari', /\bVersion\/[\d.]+.*\bSafari\//],
];

const SYSTEMS: readonly [string, RegExp][] = [
    ['Android', /\bAndroid\b/],
    ['iOS', /\b(iPhone|iPad|iPod)\b/],
    ['ChromeOS', /\bCrOS\b/],
    ['Windows', /\bWindows\b/],
    ['macOS', /\bMac OS X\b/],
    ['Linux', /\bLinux\b/],
];

export function browserOf(userAgent: string): string {
    return BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'Other';
}

export function systemOf(userAgent: string): string {
    return SYSTEMS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'Other';
}

/** Where people come from: the sites worth naming, the rest as one. */
const REFERRERS: readonly [string, RegExp][] = [
    ['TRCustoms', /(^|\.)trcustoms\.org$/],
    ['Reddit', /(^|\.)reddit\.com$|(^|\.)redd\.it$/],
    ['Discord', /(^|\.)discord(app)?\.com$|(^|\.)discord\.gg$/],
    ['YouTube', /(^|\.)youtube\.com$|(^|\.)youtu\.be$/],
    ['Google', /(^|\.)google\.[a-z.]+$/],
    ['Bing', /(^|\.)bing\.com$/],
    ['DuckDuckGo', /(^|\.)duckduckgo\.com$/],
    ['Facebook', /(^|\.)facebook\.com$|(^|\.)fb\.com$/],
    ['Instagram', /(^|\.)instagram\.com$/],
    ['X', /(^|\.)(twitter|x)\.com$|(^|\.)t\.co$/],
    ['Bluesky', /(^|\.)bsky\.app$/],
    ['GitHub', /(^|\.)github\.com$/],
    ['Tomb Raider Forums', /(^|\.)tombraiderforums\.com$/],
    ['Steam', /(^|\.)steamcommunity\.com$|(^|\.)steampowered\.com$/],
];

/** A referrer's host as the stats show it; sites not named are "Other sites", so the page never advertises. */
export function referrerOf(host: string): string {
    return REFERRERS.find(([, pattern]) => pattern.test(host))?.[0] ?? 'Other sites';
}

const BOT_PROBES: readonly [string, RegExp][] = [
    ['WordPress', /^\/(wp-|wordpress|xmlrpc\.php)|\/wp-(admin|login|content|includes|json)/i],
    ['Secrets and settings', /\/\.(env|git|aws|ssh|svn|DS_Store|vscode|idea)|\/(config|credentials|secrets?)\.(json|ya?ml|php|js|ini|xml)|\/(web\.config|docker-compose\.ya?ml|id_rsa)/i],
    ['Admin panels', /^\/(admin|administrator|phpmyadmin|pma|myadmin|manager|cpanel|webadmin|login\.action|actuator|console|solr|boaform|cgi-bin)(\/|$|\.)/i],
    ['Developer servers', /^\/(@fs|@vite|_next|__webpack|node_modules|vendor\/phpunit)(\/|$)/i],
    ['PHP scripts', /\.php\d?(\/|$|\?)/i],
    ['Other scans', /\.(asp|aspx|jsp|cgi|bak|sql|old|zip|tar|gz|rar)(\/|$)|^\/(shell|setup|install|backup|db|test|debug|api\/v1\/pods|HNAP1|owa|ecp|remote|autodiscover)(\/|$|\.)/i],
];

/** What a request for a page this app never serves was looking for, or null for an ordinary one. */
export function botProbeOf(path: string): string | null {
    return BOT_PROBES.find(([, pattern]) => pattern.test(path))?.[0] ?? null;
}
