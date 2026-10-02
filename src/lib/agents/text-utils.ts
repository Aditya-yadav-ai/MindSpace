/** Small, dependency-free text helpers shared by tools, agents and the verifier. */

const STOPWORDS = new Set(
  (
    "a an the and or but if then else of to in on at by for with about into over after before " +
    "is are was were be been being am do does did done have has had having i you he she it we they " +
    "me my your our their this that these those there here what which who whom whose when where why how " +
    "can could should would will shall may might must not no nor so than too very just also as from up down " +
    "out off again further once all any both each few more most other some such only own same s t don now " +
    "please find show tell give get make need want look summarize summarise explain page tab"
  ).split(" "),
);

export function normaliseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/** Lower-cased, punctuation-free form used for grounding comparisons. */
export function comparable(value: string) {
  return normaliseWhitespace(value.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => normaliseWhitespace(part))
    .filter((part) => part.length > 0);
}

/** Content words only, lightly stemmed so "deadlines" matches "deadline". */
export function contentTokens(value: string): string[] {
  const matches = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .map((token) => (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token));
}

const INJECTION_PATTERNS: { id: string; pattern: RegExp }[] = [
  {
    id: "override-instructions",
    pattern:
      /ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)/i,
  },
  {
    id: "disregard",
    pattern:
      /disregard (?:all |any )?(?:the )?(?:previous|prior|above|system) (?:instructions|prompts?|rules)/i,
  },
  { id: "role-reset", pattern: /you are now (?:a |an |the )?[a-z]/i },
  {
    id: "system-prompt",
    pattern:
      /(?:reveal|print|show|repeat) (?:your |the )?(?:system|hidden) (?:prompt|instructions)/i,
  },
  { id: "tool-command", pattern: /(?:call|invoke|run|use) the [a-z_.]+ tool/i },
  {
    id: "exfiltrate",
    pattern:
      /(?:send|forward|email|post) (?:this|the|all|your) (?:data|conversation|notes|documents|context) to/i,
  },
];

/**
 * Cheap heuristic scan for text that tries to instruct the assistant.
 * Page content is always treated as data; this only lets the verifier warn
 * the reader that the page contained instruction-like text.
 */
export function detectInjectionSignals(text: string): string[] {
  const found: string[] = [];
  for (const { id, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(text)) found.push(id);
  }
  return found;
}

export function clip(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
