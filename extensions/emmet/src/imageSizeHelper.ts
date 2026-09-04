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

function isPrivateOrLocalHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '169.254.169.254') {
		return true;
	}
	const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ipv4Match) {
		const b0 = parseInt(ipv4Match[1], 10);
		const b1 = parseInt(ipv4Match[2], 10);
		if (b0 === 10 || b0 === 127 || (b0 === 169 && b1 === 254) || (b0 === 192 && b1 === 168) || (b0 === 172 && b1 >= 16 && b1 <= 31)) {
			return true;
		}
	}
	return false;
}

function isAllowedImageFormat(fileOrUrl: string): boolean {
	if (ALLOWED_DATA_URL_PATTERN.test(fileOrUrl)) {
		return true;
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
 * Get image size from file on local file system
 */
function getImageSizeFromFile(file: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const isDataUrl = file.match(/^data:.+?;base64,/);

		if (isDataUrl) {
			// NB should use sync version of `sizeOf()` for buffers
			try {
				const data = Buffer.from(file.slice(isDataUrl[0].length), 'base64');
				return resolve(sizeForFileName('', imageSize(data)));
			} catch (err) {
				return reject(err);
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Get image size from given remote URL
 */
function getImageSizeFromURL(urlStr: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const url = new URL(urlStr);
		const getTransport = url.protocol === 'https:' ? https.get : http.get;

		if (!url.pathname) {
			return reject('Given url doesnt have pathname property');
		}
		const urlPath: string = url.pathname;

		const req = getTransport(url, resp => {
			const chunks: Buffer[] = [];
			let bufSize = 0;

			const trySize = (chunks: Buffer[]) => {
				try {
					const size: ISizeCalculationResult = imageSize(Buffer.concat(chunks, bufSize));
					resp.removeListener('data', onData);
					resp.destroy(); // no need to read further
					resolve(sizeForFileName(path.basename(urlPath), size));
				} catch (err) {
					// might not have enough data, skip error
				}
			};

			const onData = (chunk: Buffer) => {
				bufSize += chunk.length;
				if (bufSize > MAX_IMAGE_BYTES) {
					resp.removeListener('data', onData);
					resp.destroy();
					reject(new Error('Image exceeds size limit of 5MB'));
					return;
				}
				chunks.push(chunk);
				trySize(chunks);
			};

			resp
				.on('data', onData)
				.on('end', () => trySize(chunks))
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
 * the final dimentions will be downscaled by N
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
