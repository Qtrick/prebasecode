/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure TypeScript SHA-256 and HMAC-SHA256 implementation conforming to FIPS 180-4 / RFC 2104.
 * Zero external dependencies. Operates identically across Browser, Node, Electron, and Web Workers.
 */

const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(n: number, x: number): number {
	return (x >>> n) | (x << (32 - n));
}

function encodeUtf8(str: string): Uint8Array {
	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(str);
	}
	const utf8: number[] = [];
	for (let i = 0; i < str.length; i++) {
		let charcode = str.charCodeAt(i);
		if (charcode < 0x80) {
			utf8.push(charcode);
		} else if (charcode < 0x800) {
			utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
		} else if (charcode < 0xd800 || charcode >= 0xe000) {
			utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
		} else {
			i++;
			charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
			utf8.push(
				0xf0 | (charcode >> 18),
				0x80 | ((charcode >> 12) & 0x3f),
				0x80 | ((charcode >> 6) & 0x3f),
				0x80 | (charcode & 0x3f)
			);
		}
	}
	return new Uint8Array(utf8);
}

export function computePureSha256Raw(bytes: Uint8Array): Uint8Array {
	const bitLength = bytes.length * 8;

	// Length with padding: 1 byte (0x80) + k zero bytes + 8 bytes length = multiple of 64 bytes
	const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
	const buffer = new Uint8Array(paddedLength);
	buffer.set(bytes);
	buffer[bytes.length] = 0x80;

	// Append original length in bits (big-endian 64-bit uint)
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const highBits = Math.floor(bitLength / 0x100000000);
	const lowBits = bitLength >>> 0;
	view.setUint32(paddedLength - 8, highBits, false);
	view.setUint32(paddedLength - 4, lowBits, false);

	let h0 = 0x6a09e667;
	let h1 = 0xbb67ae85;
	let h2 = 0x3c6ef372;
	let h3 = 0xa54ff53a;
	let h4 = 0x510e527f;
	let h5 = 0x9b05688c;
	let h6 = 0x1f83d9ab;
	let h7 = 0x5be0cd19;

	const w = new Uint32Array(64);

	for (let i = 0; i < paddedLength; i += 64) {
		for (let t = 0; t < 16; t++) {
			w[t] = view.getUint32(i + t * 4, false);
		}
		for (let t = 16; t < 64; t++) {
			const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
			const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
			w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
		}

		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		let f = h5;
		let g = h6;
		let h = h7;

		for (let t = 0; t < 64; t++) {
			const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
			const ch = (e & f) ^ (~e & g);
			const temp1 = (h + s1 + ch + K[t] + w[t]) | 0;
			const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (s0 + maj) | 0;

			h = g;
			g = f;
			f = e;
			e = (d + temp1) | 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) | 0;
		}

		h0 = (h0 + a) | 0;
		h1 = (h1 + b) | 0;
		h2 = (h2 + c) | 0;
		h3 = (h3 + d) | 0;
		h4 = (h4 + e) | 0;
		h5 = (h5 + f) | 0;
		h6 = (h6 + g) | 0;
		h7 = (h7 + h) | 0;
	}

	const result = new Uint8Array(32);
	const resView = new DataView(result.buffer, result.byteOffset, result.byteLength);
	resView.setUint32(0, h0, false);
	resView.setUint32(4, h1, false);
	resView.setUint32(8, h2, false);
	resView.setUint32(12, h3, false);
	resView.setUint32(16, h4, false);
	resView.setUint32(20, h5, false);
	resView.setUint32(24, h6, false);
	resView.setUint32(28, h7, false);
	return result;
}

export function computePureSha256(input: string): string {
	const raw = computePureSha256Raw(encodeUtf8(input));
	let hex = '';
	for (let i = 0; i < raw.length; i++) {
		hex += raw[i].toString(16).padStart(2, '0');
	}
	return hex;
}

export function computePureHmacSha256(key: string, message: string): string {
	let keyBytes = encodeUtf8(key);
	const blockSize = 64;

	if (keyBytes.length > blockSize) {
		keyBytes = computePureSha256Raw(keyBytes);
	}

	const paddedKey = new Uint8Array(blockSize);
	paddedKey.set(keyBytes);

	const oKeyPad = new Uint8Array(blockSize);
	const iKeyPad = new Uint8Array(blockSize);

	for (let i = 0; i < blockSize; i++) {
		oKeyPad[i] = paddedKey[i] ^ 0x5c;
		iKeyPad[i] = paddedKey[i] ^ 0x36;
	}

	const msgBytes = encodeUtf8(message);
	const innerMsg = new Uint8Array(blockSize + msgBytes.length);
	innerMsg.set(iKeyPad, 0);
	innerMsg.set(msgBytes, blockSize);
	const innerHash = computePureSha256Raw(innerMsg);

	const outerMsg = new Uint8Array(blockSize + innerHash.length);
	outerMsg.set(oKeyPad, 0);
	outerMsg.set(innerHash, blockSize);
	const outerHash = computePureSha256Raw(outerMsg);

	let hex = '';
	for (let i = 0; i < outerHash.length; i++) {
		hex += outerHash[i].toString(16).padStart(2, '0');
	}
	return hex;
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
	if (typeof a !== 'string' || typeof b !== 'string') {
		return false;
	}
	const aBytes = encodeUtf8(a);
	const bBytes = encodeUtf8(b);

	let mismatch = aBytes.length === bBytes.length ? 0 : 1;
	const len = Math.min(aBytes.length, bBytes.length);

	for (let i = 0; i < len; i++) {
		mismatch |= (aBytes[i] ^ bBytes[i]);
	}

	return mismatch === 0 && aBytes.length === bBytes.length;
}
