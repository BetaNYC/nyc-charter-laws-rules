// Placeholder for XML corpus parsing and search logic.
//
// Data sources (publicly available bulk XML downloads from AML):
//   Charter:         http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip
//   Administrative Code: http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip
//   Rules of NYC:    http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip
//
// Run `npm run fetch-data` to download, unzip, and index these files into data/index/.
// The index is gitignored — each user builds it locally from the public source files.

export type Corpus = "charter" | "admin_code" | "rules";

export interface Section {
  corpus: Corpus;
  title: string;
  citation: string;
  heading: string;
  text: string;
}

export async function searchCorpus(
  _query: string,
  _corpus: Corpus | "all" = "all",
  _limit = 10
): Promise<Section[]> {
  throw new Error("Not implemented — run npm run fetch-data first.");
}

export async function getSection(_citation: string): Promise<Section | null> {
  throw new Error("Not implemented — run npm run fetch-data first.");
}

export async function listTitles(_corpus: Corpus): Promise<string[]> {
  throw new Error("Not implemented — run npm run fetch-data first.");
}

export async function getTitle(_corpus: Corpus, _title: string): Promise<Section[]> {
  throw new Error("Not implemented — run npm run fetch-data first.");
}
