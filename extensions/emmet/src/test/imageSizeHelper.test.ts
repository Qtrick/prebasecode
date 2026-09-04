/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { getImageSize, isPrivateOrLocalHost, isValidImageMagicBytes } from '../imageSizeHelper';

suite('Emmet imageSizeHelper Security & Parsing Tests', () => {

	test('rejects private IPv4 and localhost hosts', () => {
		assert.strictEqual(isPrivateOrLocalHost('localhost'), true);
		assert.strictEqual(isPrivateOrLocalHost('127.0.0.1'), true);
		assert.strictEqual(isPrivateOrLocalHost('127.1.2.3'), true);
		assert.strictEqual(isPrivateOrLocalHost('0.0.0.0'), true);
		assert.strictEqual(isPrivateOrLocalHost('10.0.0.1'), true);
		assert.strictEqual(isPrivateOrLocalHost('172.16.0.1'), true);
		assert.strictEqual(isPrivateOrLocalHost('172.31.255.255'), true);
		assert.strictEqual(isPrivateOrLocalHost('192.168.1.1'), true);
		assert.strictEqual(isPrivateOrLocalHost('169.254.169.254'), true);
	});

	test('rejects IPv6 loopback, link-local, unique-local, and mapped IPv4', () => {
		assert.strictEqual(isPrivateOrLocalHost('::1'), true);
		assert.strictEqual(isPrivateOrLocalHost('[::1]'), true);
		assert.strictEqual(isPrivateOrLocalHost('fe80::1'), true);
		assert.strictEqual(isPrivateOrLocalHost('[fe80::1]'), true);
		assert.strictEqual(isPrivateOrLocalHost('fc00::1'), true);
		assert.strictEqual(isPrivateOrLocalHost('fd12:3456::1'), true);
		assert.strictEqual(isPrivateOrLocalHost('::ffff:127.0.0.1'), true);
		assert.strictEqual(isPrivateOrLocalHost('::ffff:192.168.1.1'), true);
	});

	test('rejects alternate numeric IP representations', () => {
		// Decimal IP for 127.0.0.1 is 2130706433
		assert.strictEqual(isPrivateOrLocalHost('2130706433'), true);
		// Hex IP for 127.0.0.1 is 0x7f000001
		assert.strictEqual(isPrivateOrLocalHost('0x7f000001'), true);
	});

	test('allows public domains and IPs', () => {
		assert.strictEqual(isPrivateOrLocalHost('example.com'), false);
		assert.strictEqual(isPrivateOrLocalHost('cdn.example.org'), false);
		assert.strictEqual(isPrivateOrLocalHost('8.8.8.8'), false);
		assert.strictEqual(isPrivateOrLocalHost('1.1.1.1'), false);
	});

	test('validates magic bytes for supported raster formats', () => {
		// PNG magic bytes: \x89PNG\r\n\x1a\n
		const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
		assert.strictEqual(isValidImageMagicBytes(pngHeader), true);

		// JPEG magic bytes: \xFF\xD8\xFF
		const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
		assert.strictEqual(isValidImageMagicBytes(jpegHeader), true);

		// GIF magic bytes: GIF87a / GIF89a
		const gifHeader = Buffer.from('GIF89a', 'ascii');
		assert.strictEqual(isValidImageMagicBytes(gifHeader), true);

		// WebP magic bytes: RIFF....WEBP
		const webpHeader = Buffer.concat([
			Buffer.from('RIFF', 'ascii'),
			Buffer.from([0x20, 0x00, 0x00, 0x00]),
			Buffer.from('WEBP', 'ascii')
		]);
		assert.strictEqual(isValidImageMagicBytes(webpHeader), true);

		// Invalid magic bytes (e.g. HTML, SVG, random text)
		const htmlHeader = Buffer.from('<!DOCTYPE html><html>', 'utf8');
		assert.strictEqual(isValidImageMagicBytes(htmlHeader), false);

		const svgHeader = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'utf8');
		assert.strictEqual(isValidImageMagicBytes(svgHeader), false);
	});

	test('rejects data URLs exceeding MAX_DATA_URL_BYTES', async () => {
		// Create an oversized data URL (> 5MB)
		const largePayload = 'A'.repeat(5 * 1024 * 1024 + 100);
		const oversizedDataUrl = `data:image/png;base64,${largePayload}`;
		const result = await getImageSize(oversizedDataUrl);
		assert.strictEqual(result, undefined);
	});

	test('parses valid compact data URL correctly', async () => {
		const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAHYcAAB2HAY/l8WUAAAATSURBVBhXY/jPwADGDP////8PAB/uBfuDMzhuAAAAAElFTkSuQmCC';
		const size = await getImageSize(validPngDataUrl);
		assert.ok(size);
		assert.strictEqual(size.realWidth, 2);
		assert.strictEqual(size.realHeight, 2);
		assert.strictEqual(size.width, 2);
		assert.strictEqual(size.height, 2);
	});
});
