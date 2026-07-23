/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local SVG minify transform using patched svgo (v3+/v4).
 * Replaces gulp-svgmin (locked to vulnerable svgo@2) without changing call sites.
 * Does not rewrite frozen application icon sources under resources/; only streams vinyl files passed in.
 */

import { Transform } from 'stream';
import { optimize } from 'svgo';

export function svgmin(): Transform {
	return new Transform({
		objectMode: true,
		async transform(file, _enc, cb) {
			try {
				if (file.isNull?.() || !file.contents) {
					cb(null, file);
					return;
				}
				if (file.isStream?.()) {
					cb(new Error('svgmin: streaming vinyl files are not supported'));
					return;
				}
				const input = file.contents.toString('utf8');
				const result = optimize(input, {
					path: file.path,
					multipass: true,
					plugins: ['preset-default'],
				});
				file.contents = Buffer.from(result.data, 'utf8');
				cb(null, file);
			} catch (err) {
				cb(err as Error);
			}
		},
	});
}
