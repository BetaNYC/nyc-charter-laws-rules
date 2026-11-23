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
 * The books on the site. Only the Charter is built in Phase 2; the Administrative Code and the
 * Rules follow in Phase 5 (#65). `label` starts page titles ("NYC Charter § 259: ..."); `name`
 * is the book's full name; `official` is the bold line's name for the official copy.
 */
export const BOOKS = {
  charter: {
    corpus: "charter",
    slug: "charter",
    label: "NYC Charter",
    name: "New York City Charter",
    short: "Charter",
    aml: "NYCcharter",
    official: "The official Charter",
  },
};

/** Absolute URL for a site path ("/charter/sections/259"). */
export function absoluteUrl(path) {
  return SITE_BASE + path;
}
