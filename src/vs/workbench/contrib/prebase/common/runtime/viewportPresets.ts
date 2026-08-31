/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PreBaseViewportPreset = 'responsive' | 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface ViewportSize {
	width: number;
	height: number;
}

export const VIEWPORT_PRESET_SIZES: Record<Exclude<PreBaseViewportPreset, 'responsive'>, ViewportSize> = {
	desktop: { width: 1440, height: 900 },
	laptop: { width: 1280, height: 800 },
	tablet: { width: 768, height: 1024 },
	mobile: { width: 390, height: 844 }
};

export function resolveViewportSize(
	preset: PreBaseViewportPreset,
	customWidth?: number,
	customHeight?: number,
	rotated?: boolean
): ViewportSize | null {
	if (preset === 'responsive') {
		if (customWidth && customHeight) {
			return rotated
				? { width: customHeight, height: customWidth }
				: { width: customWidth, height: customHeight };
		}
		return null;
	}
	const base = VIEWPORT_PRESET_SIZES[preset];
	const width = customWidth ?? base.width;
	const height = customHeight ?? base.height;
	return rotated ? { width: height, height: width } : { width, height };
}
