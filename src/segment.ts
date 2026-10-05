/**
 * Word boundaries for scripts that do not put spaces between words.
 *
 * Obsidian/CodeMirror treat every “word” character as one group, so a Japanese
 * sentence with no spaces counts as a single word. We use Intl.Segmenter on the
 * current line when the character next to the cursor needs a dictionary. Pointer
 * selection also checks the surrounding word for a dictionary script.
 * Returning null means “leave this action to Obsidian’s default”.
 */

export type SegmentLocale = 'ja' | 'zh' | 'th' | 'lo' | 'km' | 'my';

export interface WordRange {
	from: number;
	to: number;
}

// Scripts that ICU breaks with a dictionary, not whitespace.
const SCRIPT_RANGES: ReadonlyArray<{ locale: SegmentLocale; re: RegExp }> = [
	{ locale: 'th', re: /[\u0E00-\u0E7F]/ },
	{ locale: 'lo', re: /[\u0E80-\u0EFF]/ },
	{ locale: 'km', re: /[\u1780-\u17FF]/ },
	{ locale: 'my', re: /[\u1000-\u109F]/ },
	// Hiragana / Katakana — Japanese.
	{ locale: 'ja', re: /[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/ },
	// CJK Unified Ideographs — Japanese or Chinese; decided from the rest of the line.
	{ locale: 'zh', re: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/ },
];

const KANA_RE = /[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/;

const segmenterCache = new Map<SegmentLocale, Intl.Segmenter>();

function getSegmenter(locale: SegmentLocale): Intl.Segmenter | null {
	if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
		return null;
	}
	let seg = segmenterCache.get(locale);
	if (!seg) {
		seg = new Intl.Segmenter(locale, { granularity: 'word' });
		segmenterCache.set(locale, seg);
	}
	return seg;
}

/** Locale for one character, or null if Obsidian’s default word rules are fine. */
export function localeForChar(ch: string, lineText: string): SegmentLocale | null {
	if (!ch) return null;
	for (const { locale, re } of SCRIPT_RANGES) {
		if (!re.test(ch)) continue;
		// Han alone → Chinese. Han next to kana on this line → Japanese.
		if (locale === 'zh' && KANA_RE.test(lineText)) return 'ja';
		return locale;
	}
	return null;
}

export function hasSegmenter(): boolean {
	return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

function wordSegments(
	text: string,
	locale: SegmentLocale,
): Array<{ index: number; length: number }> {
	const seg = getSegmenter(locale);
	if (!seg) return [];
	const out: Array<{ index: number; length: number }> = [];
	for (const part of seg.segment(text)) {
		if (!part.isWordLike) continue;
		out.push({ index: part.index, length: part.segment.length });
	}
	return out;
}

/**
 * Character just before `pos` (backward) or at `pos` (forward).
 * `pos` is absolute in the document; `lineFrom` is the start of this line.
 * Null → caller should fall through to the default keymap.
 */
export function probeLocale(
	lineText: string,
	lineFrom: number,
	pos: number,
	forward: boolean,
): SegmentLocale | null {
	const offset = pos - lineFrom;
	if (forward) {
		if (offset >= lineText.length) return null;
		return localeForChar(lineText[offset]!, lineText);
	}
	if (offset <= 0) return null;
	return localeForChar(lineText[offset - 1]!, lineText);
}

/** Next word boundary past `pos`, or null if we should not handle this. */
export function nextWordBoundary(
	lineText: string,
	lineFrom: number,
	pos: number,
	forward: boolean,
): number | null {
	const locale = probeLocale(lineText, lineFrom, pos, forward);
	if (!locale) return null;

	const offset = pos - lineFrom;
	const words = wordSegments(lineText, locale);
	if (words.length === 0) return null;

	if (forward) {
		for (const w of words) {
			const end = w.index + w.length;
			if (w.index <= offset && offset < end) return lineFrom + end;
			if (w.index > offset) return lineFrom + end;
		}
		return null;
	}

	// Backward: land at the start of the word that ends at or before the cursor.
	for (let i = words.length - 1; i >= 0; i--) {
		const w = words[i]!;
		const end = w.index + w.length;
		if (end <= offset) return lineFrom + w.index;
		if (w.index < offset && offset <= end) return lineFrom + w.index;
	}
	return null;
}

/** Look for a dictionary script in the uninterrupted word around the pointer. */
function localeInWord(lineText: string, offset: number): SegmentLocale | null {
	const before = lineText.slice(0, offset).match(/[\p{L}\p{M}\p{N}_]+$/u)?.[0] ?? '';
	const after = lineText.slice(offset).match(/^[\p{L}\p{M}\p{N}_]+/u)?.[0] ?? '';
	for (const ch of before + after) {
		const locale = localeForChar(ch, lineText);
		if (locale) return locale;
	}
	return null;
}

/** Word under `pos` for double-click / double-tap, or null to leave alone. */
export function wordAt(lineText: string, lineFrom: number, pos: number): WordRange | null {
	const offset = Math.max(0, Math.min(pos - lineFrom, lineText.length));
	let locale = probeLocale(lineText, lineFrom, pos, true);
	if (!locale) locale = probeLocale(lineText, lineFrom, pos, false);
	// A click inside Latin text can still belong to a word touching Chinese, etc.
	if (!locale) locale = localeInWord(lineText, offset);
	if (!locale) return null;

	const words = wordSegments(lineText, locale);
	for (const w of words) {
		const end = w.index + w.length;
		if (w.index <= offset && offset < end) {
			return { from: lineFrom + w.index, to: lineFrom + end };
		}
	}
	// Cursor exactly at the end of a word (common after a click).
	for (const w of words) {
		const end = w.index + w.length;
		if (offset === end) {
			return { from: lineFrom + w.index, to: lineFrom + end };
		}
	}
	return null;
}
