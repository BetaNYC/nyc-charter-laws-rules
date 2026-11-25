// The site's fixed settings (issue #62). One place for the address and the name.

/** Every absolute URL (canonical links, sitemaps, structured data) starts with this. */
export const SITE_BASE = "https://law.beta.nyc";

/** The site's name, at the end of every page title. */
export const SITE_NAME = "BetaNYC Law Reader";

/** The short name in the top bar, next to the BetaNYC wordmark. */
export const SITE_SHORT_NAME = "Law Reader";

export const REPO_URL = "https://github.com/BetaNYC/nyc-charter-laws-rules";

/** The MCP server on npm, which gives AI assistants the same text. */
export const NPM_URL = "https://www.npmjs.com/package/@betanyc/nyc-charter-laws-rules";

/**
 * The books on the site: the Charter (Phase 2), the Administrative Code and the Rules (Phase 5,
 * #65). `label` starts page titles ("NYC Charter § 259: ..."); `name` is the book's full
 * name; `short` is the top bar's link; `long` is the name in running text ("the Administrative
 * Code"); `official` is the bold line's name for the official copy.
 */
export const BOOKS = {
  charter: {
    corpus: "charter",
    slug: "charter",
    label: "NYC Charter",
    name: "New York City Charter",
    short: "Charter",
    long: "Charter",
    aml: "NYCcharter",
    official: "The official Charter",
  },
  // The Administrative Code, titles first. `titles` switches model.js to the title > chapter
  // layout; `source` is its id in DATA-SOURCES.json.
  admin_code: {
    corpus: "admin_code",
    slug: "admin-code",
    source: "admin-code",
    label: "NYC Administrative Code",
    name: "New York City Administrative Code",
    short: "Admin Code",
    long: "Administrative Code",
    aml: "NYCadmin",
    official: "The official Administrative Code",
    titles: true,
  },
  // The Rules of the City of New York, titles first. Each title restarts its chapter and section
  // numbers, so `rcny` makes model.js lay it out per title (layoutRules): paths and citations
  // come from each record's `titleNumber` ("15 RCNY § 1-01"), which the index has since 0.7.0
  // (#59). An index without it is not built (build.js rulesReady). `latestUrl` is where the City
  // posts current rules (src/tools.ts FOOTER: "For the latest rules information, see ...").
  rules: {
    corpus: "rules",
    slug: "rules",
    source: "rules",
    label: "NYC Rules",
    name: "Rules of the City of New York",
    short: "Rules",
    long: "Rules",
    aml: "NYCrules",
    official: "The official Rules",
    titles: true,
    rcny: true,
    latestUrl: "https://rules.cityofnewyork.us",
  },
};

/** Absolute URL for a site path ("/charter/sections/259"). */
export function absoluteUrl(path) {
  return SITE_BASE + path;
}

/**
 * The books build-site builds, in order, unless told otherwise (--charter-only). The Rules are
 * left out of a build whose index has no titles yet (build.js rulesReady).
 */
export const DEFAULT_BOOKS = ["charter", "admin_code", "rules"];
