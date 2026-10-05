import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localeForChar, nextWordBoundary, wordAt } from '../src/segment.ts';

describe('localeForChar', () => {
	it('returns null for Latin', () => {
		assert.equal(localeForChar('h', 'hello'), null);
	});

	it('detects Thai', () => {
		assert.equal(localeForChar('ส', 'สวัสดี'), 'th');
	});

	it('detects Japanese kana', () => {
		assert.equal(localeForChar('こ', 'こんにちは'), 'ja');
	});

	it('uses ja for han when the line also has kana', () => {
		assert.equal(localeForChar('日', '日本語です'), 'ja');
	});

	it('uses zh for han when the line has no kana', () => {
		assert.equal(localeForChar('中', '中文测试'), 'zh');
	});
});

describe('nextWordBoundary', () => {
	it('returns null inside English words', () => {
		const line = 'hello world';
		assert.equal(nextWordBoundary(line, 0, 3, false), null);
		assert.equal(nextWordBoundary(line, 0, 3, true), null);
	});

	it('splits a Japanese phrase into more than one word', () => {
		const line = '私は猫です';
		const end = line.length;
		const mid = nextWordBoundary(line, 0, end, false);
		assert.notEqual(mid, null);
		assert.ok(mid! > 0);
		assert.ok(mid! < end);

		const words: string[] = [];
		let pos = end;
		while (pos > 0) {
			const prev = nextWordBoundary(line, 0, pos, false);
			if (prev == null) break;
			words.push(line.slice(prev, pos));
			pos = prev;
		}
		assert.ok(words.length >= 2, `expected ≥2 words, got ${words.join('|')}`);
	});

	it('finds a boundary inside Thai, not the whole line', () => {
		const line = 'ฉันรักภาษาไทย';
		const end = line.length;
		const mid = nextWordBoundary(line, 0, end, false);
		assert.notEqual(mid, null);
		assert.ok(mid! > 0);
		assert.ok(mid! < end);
	});

	it('finds a boundary inside a Chinese-only line', () => {
		const line = '我喜欢中文';
		const end = line.length;
		const mid = nextWordBoundary(line, 0, end, false);
		assert.notEqual(mid, null);
		assert.ok(mid! > 0);
		assert.ok(mid! < end);
	});
});

describe('wordAt', () => {
	it('returns null for English', () => {
		assert.equal(wordAt('hello', 0, 2), null);
	});

	it('selects English touching Chinese on either or both sides', () => {
		for (const line of [
			'喜欢使用Obsidian 整理学习笔记。',
			'喜欢使用Obsidian整理学习笔记。',
			'Obsidian整理学习笔记。',
			'喜欢使用Obsidian',
		]) {
			const from = line.indexOf('Obsidian');
			const to = from + 'Obsidian'.length;
			for (let pos = from; pos < to; pos++) {
				assert.deepEqual(wordAt(line, 0, pos), { from, to }, `${line} at ${pos}`);
			}
		}
	});

	it('returns absolute ranges on later lines', () => {
		const line = '喜欢使用Obsidian整理笔记';
		assert.deepEqual(wordAt(line, 50, 58), { from: 54, to: 62 });
	});

	it('selects English touching Japanese', () => {
		const line = '私はObsidianを使います';
		assert.deepEqual(wordAt(line, 0, 6), { from: 2, to: 10 });
	});

	it('selects an English word containing a number next to Chinese', () => {
		assert.deepEqual(wordAt('使用GPT4学习', 0, 4), { from: 2, to: 6 });
	});

	it('keeps defaults for English separated from Chinese by spaces or punctuation', () => {
		for (const line of ['中文 hello world', '中文,hello', '中文。hello', '中文 hello-world']) {
			assert.equal(wordAt(line, 0, line.indexOf('hello') + 2), null);
		}
	});

	it('still selects Chinese words in mixed text', () => {
		assert.deepEqual(wordAt('Obsidian中文', 0, 9), { from: 8, to: 10 });
	});

	it('selects one Japanese word, not the whole sentence', () => {
		const line = '私は猫です';
		const range = wordAt(line, 0, 0);
		assert.notEqual(range, null);
		assert.ok(range!.to - range!.from < line.length);
		assert.ok(range!.to - range!.from >= 1);
	});
});
