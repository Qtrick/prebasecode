/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on @sergeche's work on the emmet plugin for atom

import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { imageSize } from 'image-size';
import { ISizeCalculationResult } from 'image-size/dist/types/interface';

const reUrl = /^https?:/;
export type ImageInfoWithScale = {
	realWidth: number;
	realHeight: number;
	width: number;
	height: number;
};

const ALLOWED_WEB_IMAGE_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp'
]);

const ALLOWED_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;
export const MAX_DATA_URL_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 5000;

export function isValidImageMagicBytes(buffer: Buffer): boolean {
	if (!buffer || buffer.length < 4) {
		return false;
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (buffer.length >= 8 &&
		buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
		buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
		return true;
	}
	// JPEG: FF D8 FF
	if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
		return true;
	}
	// GIF: GIF87a or GIF89a
	if (buffer.length >= 6 &&
		buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
		(buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61) {
		return true;
	}
	// WebP: RIFF....WEBP
	if (buffer.length >= 12 &&
		buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
		buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
		return true;
	}
	return false;
}

export function isPrivateOrLocalHost(hostname: string): boolean {
	let host = (hostname || '').toLowerCase().trim();
	if (host.startsWith('[') && host.endsWith(']')) {
		host = host.slice(1, -1);
	}
	if (!host || host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '::1' || host === '::' || host === '169.254.169.254') {
		return true;
	}

	// Hex representations e.g. 0x7f000001
	if (/^0x[0-9a-f]+$/i.test(host)) {
		const num = parseInt(host, 16);
		const b0 = (num >>> 24) & 0xff;
		const b1 = (num >>> 16) & 0xff;
		if (b0 === 10 || b0 === 127 || (b0 === 169 && b1 === 254) || (b0 === 192 && b1 === 168) || (b0 === 172 && b1 >= 16 && b1 <= 31) || b0 === 0) {
			return true;
		}
	}

	// Pure integer representation e.g. 2130706433 (127.0.0.1)
	if (/^\d+$/.test(host)) {
		const num = parseInt(host, 10);
		const b0 = (num >>> 24) & 0xff;
		const b1 = (num >>> 16) & 0xff;
		if (b0 === 10 || b0 === 127 || (b0 === 169 && b1 === 254) || (b0 === 192 && b1 === 168) || (b0 === 172 && b1 >= 16 && b1 <= 31) || b0 === 0) {
			return true;
		}
	}

	// Standard dotted IPv4
	const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ipv4Match) {
		const b0 = parseInt(ipv4Match[1], 10);
		const b1 = parseInt(ipv4Match[2], 10);
		if (b0 === 0 || b0 === 10 || b0 === 127 || (b0 === 169 && b1 === 254) || (b0 === 192 && b1 === 168) || (b0 === 172 && b1 >= 16 && b1 <= 31)) {
			return true;
		}
	}

	// IPv6 loopback, link-local (fe80::/10), unique local (fc00::/7, fd00::/8)
	if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc00:') || host.startsWith('fd')) {
		return true;
	}

	// IPv4-mapped IPv6 (::ffff:127.0.0.1)
	if (host.startsWith('::ffff:')) {
		const mappedIpv4 = host.slice(7);
		return isPrivateOrLocalHost(mappedIpv4);
	}

	return false;
}

function isAllowedImageFormat(fileOrUrl: string): boolean {
	if (ALLOWED_DATA_URL_PATTERN.test(fileOrUrl)) {
		// Cap data URL length to prevent memory exhaustion
		return fileOrUrl.length <= MAX_DATA_URL_BYTES;
	}
	let pathname = fileOrUrl;
	try {
		if (reUrl.test(fileOrUrl)) {
			const parsed = new URL(fileOrUrl);
			if (isPrivateOrLocalHost(parsed.hostname)) {
				return false;
			}
			pathname = parsed.pathname;
		}
	} catch {
		return false;
	}
	const ext = path.extname(pathname).toLowerCase();
	return ALLOWED_WEB_IMAGE_EXTENSIONS.has(ext);
}

/**
 * Get size of given image file. Supports files from local filesystem,
 * as well as URLs
 */
export function getImageSize(file: string): Promise<ImageInfoWithScale | undefined> {
	file = file.replace(/^file:\/\//, '');
	if (!isAllowedImageFormat(file)) {
		return Promise.resolve(undefined);
	}
	return reUrl.test(file) ? getImageSizeFromURL(file) : getImageSizeFromFile(file);
}

/**
 * Get image size from file on local file system or data URL
 */
function getImageSizeFromFile(file: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const isDataUrl = file.match(/^data:.+?;base64,/);

		if (isDataUrl) {
			if (file.length > MAX_DATA_URL_BYTES) {
				return resolve(undefined);
			}
			try {
				const data = Buffer.from(file.slice(isDataUrl[0].length), 'base64');
				if (!isValidImageMagicBytes(data)) {
					return resolve(undefined);
				}
				return resolve(sizeForFileName('', imageSize(data)));
			} catch {
				return resolve(undefined);
			}
		}

		imageSize(file, (err: Error | null, size?: ISizeCalculationResult) => {
			if (err) {
				reject(err);
			} else {
				resolve(sizeForFileName(path.basename(file), size));
			}
		});
	});
}

/**
 * Get image size from given remote URL
 */
function getImageSizeFromURL(urlStr: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		let url: URL;
		try {
			url = new URL(urlStr);
		} catch {
			return reject(new Error('Invalid URL'));
		}

		if (isPrivateOrLocalHost(url.hostname)) {
			return reject(new Error('Access to private or local network is forbidden'));
		}

		const getTransport = url.protocol === 'https:' ? https.get : http.get;
		if (!url.pathname) {
			return reject(new Error('Given url does not have pathname property'));
		}
		const urlPath: string = url.pathname;

		const req = getTransport(url, resp => {
			// Require 200 OK status. Disallow redirects to unverified targets.
			if (resp.statusCode !== 200) {
				resp.destroy();
				return reject(new Error(`Unexpected HTTP status ${resp.statusCode}`));
			}

			const chunks: Buffer[] = [];
			let bufSize = 0;
			let resolved = false;

			const onData = (chunk: Buffer) => {
				bufSize += chunk.length;
				if (bufSize > MAX_IMAGE_BYTES) {
					resp.removeListener('data', onData);
					resp.destroy();
					reject(new Error('Image exceeds size limit of 5MB'));
					return;
				}
				chunks.push(chunk);

				// Only attempt parse once we have enough header bytes for magic validation (min 16 bytes)
				if (bufSize >= 16 && !resolved) {
					const combined = Buffer.concat(chunks, bufSize);
					if (!isValidImageMagicBytes(combined)) {
						resp.removeListener('data', onData);
						resp.destroy();
						reject(new Error('Payload does not match supported image magic bytes'));
						return;
					}
					try {
						const size: ISizeCalculationResult = imageSize(combined);
						if (size && size.width && size.height) {
							resolved = true;
							resp.removeListener('data', onData);
							resp.destroy();
							resolve(sizeForFileName(path.basename(urlPath), size));
						}
					} catch {
						// Need more chunks for full dimension header
					}
				}
			};

			resp
				.on('data', onData)
				.on('end', () => {
					if (!resolved) {
						try {
							const combined = Buffer.concat(chunks, bufSize);
							if (!isValidImageMagicBytes(combined)) {
								return reject(new Error('Payload is not a valid image format'));
							}
							const size: ISizeCalculationResult = imageSize(combined);
							resolve(sizeForFileName(path.basename(urlPath), size));
						} catch (err) {
							reject(err);
						}
					}
				})
				.once('error', err => {
					resp.removeListener('data', onData);
					reject(err);
				});
		});

		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy();
			reject(new Error('Image fetch timed out'));
		});

		req.once('error', reject);
	});
}

/**
 * Returns size object for given file name. If file name contains `@Nx` token,
 * the final dimensions will be downscaled by N
 */
function sizeForFileName(fileName: string, size?: ISizeCalculationResult): ImageInfoWithScale | undefined {
	const m = fileName.match(/@(\d+)x\./);
	const scale = m ? +m[1] : 1;

	if (!size || !size.width || !size.height) {
		return;
	}

	return {
		realWidth: size.width,
		realHeight: size.height,
		width: Math.floor(size.width / scale),
		height: Math.floor(size.height / scale)
	};
}

