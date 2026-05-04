import { createRequire } from "node:module";

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

type NodeJieba = {
  cutForSearch: (text: string) => string[];
  load?: (options?: { userDict?: string }) => void;
};

let jieba: NodeJieba | null | undefined;
let warnedLoadFailure = false;

const require = createRequire(import.meta.url);

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

export function isJiebaAvailable(): boolean {
  return getJieba() !== null;
}

function getJieba(): NodeJieba | null {
  if (jieba !== undefined) return jieba;

  try {
    const mod = require("nodejieba") as NodeJieba;
    const userDict = process.env.QMD_JIEBA_USER_DICT?.trim();
    if (userDict && mod.load) {
      mod.load({ userDict });
    }
    jieba = mod;
  } catch (error) {
    jieba = null;
    if (!warnedLoadFailure) {
      warnedLoadFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`nodejieba unavailable; CJK FTS will use trigram fallback only (${message})`);
    }
  }

  return jieba;
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tokens) {
    const token = raw.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }

  return result;
}

export function segmentTextForCjkFts(text: string): string {
  if (!hasCjk(text)) return text;

  const tokenizer = getJieba();
  if (!tokenizer) return text;

  return uniqueTokens(tokenizer.cutForSearch(text)).join(" ");
}

export function segmentQueryForCjkFts(query: string): string[] {
  if (!hasCjk(query)) {
    return uniqueTokens(query.split(/\s+/));
  }

  const tokenizer = getJieba();
  if (!tokenizer) return uniqueTokens(query.split(/\s+/));

  return uniqueTokens(tokenizer.cutForSearch(query));
}
