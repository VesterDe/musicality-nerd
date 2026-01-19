/**
 * Color-to-name mapping for preset annotation colors
 */

// Preset colors for annotations - used across the app
export const PRESET_COLORS: readonly string[] = [
	'#00ff00', // Green (default)
	'#ff0000', // Red
	'#0080ff', // Blue
	'#ffff00', // Yellow
	'#ff00ff', // Magenta
	'#00ffff', // Cyan
	'#ff8000', // Orange
	'#ff0080'  // Pink
];

// Map preset hex colors to human-readable names
export const COLOR_NAME_MAP: Record<string, string> = {
	'#00ff00': 'green',
	'#ff0000': 'red',
	'#0080ff': 'blue',
	'#ffff00': 'yellow',
	'#ff00ff': 'magenta',
	'#00ffff': 'cyan',
	'#ff8000': 'orange',
	'#ff0080': 'pink'
};

// Reverse map: name to color
export const NAME_TO_COLOR_MAP: Record<string, string> = Object.fromEntries(
	Object.entries(COLOR_NAME_MAP).map(([hex, name]) => [name, hex])
);

/**
 * Get a human-readable color name for a hex color.
 * Returns the hex code for custom colors not in the preset map.
 */
export function getColorName(hex: string): string {
	const normalized = hex.toLowerCase();
	return COLOR_NAME_MAP[normalized] || hex;
}

/**
 * Check if a name is a color name from our presets
 */
export function isColorName(name: string): boolean {
	return name.toLowerCase() in NAME_TO_COLOR_MAP;
}

/**
 * Parse an annotation label to extract base name and number.
 * Examples:
 *   "green 1" -> { baseName: "green", number: 1 }
 *   "red 42" -> { baseName: "red", number: 42 }
 *   "Intro" -> { baseName: "Intro", number: null }
 *   "My Section 3" -> { baseName: "My Section", number: 3 }
 */
export function parseAnnotationGroup(label: string): { baseName: string; number: number | null } {
	const match = label.match(/^(.+?)\s+(\d+)$/);
	if (match) {
		return {
			baseName: match[1],
			number: parseInt(match[2], 10)
		};
	}
	return {
		baseName: label,
		number: null
	};
}

/**
 * Get a lowercase group key for grouping annotations.
 * This is the lowercase version of the base name.
 */
export function getGroupKey(label: string): string {
	const { baseName } = parseAnnotationGroup(label);
	return baseName.toLowerCase();
}

/**
 * Get the color associated with a group key if it's a color name
 */
export function getColorForGroupKey(groupKey: string): string | null {
	return NAME_TO_COLOR_MAP[groupKey] || null;
}
