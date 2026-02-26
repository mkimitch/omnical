'use strict';
import { describe, expect, it } from 'vitest';

// Test the transparency normalization logic for Google Calendar
describe('Google Calendar transparency mapping', () => {
	const normalizeGoogleTransparency = (value: string | undefined): 'opaque' | 'transparent' => {
		if (!value) return 'opaque';
		const lower = value.toLowerCase();
		return lower === 'transparent' ? 'transparent' : 'opaque';
	};

	it('should return "opaque" when transparency is undefined', () => {
		expect(normalizeGoogleTransparency(undefined)).toBe('opaque');
	});

	it('should return "opaque" when transparency is "opaque"', () => {
		expect(normalizeGoogleTransparency('opaque')).toBe('opaque');
	});

	it('should return "transparent" when transparency is "transparent"', () => {
		expect(normalizeGoogleTransparency('transparent')).toBe('transparent');
	});

	it('should handle case-insensitive "OPAQUE"', () => {
		expect(normalizeGoogleTransparency('OPAQUE')).toBe('opaque');
	});

	it('should handle case-insensitive "TRANSPARENT"', () => {
		expect(normalizeGoogleTransparency('TRANSPARENT')).toBe('transparent');
	});

	it('should handle mixed case "Transparent"', () => {
		expect(normalizeGoogleTransparency('Transparent')).toBe('transparent');
	});

	it('should default unknown values to "opaque"', () => {
		expect(normalizeGoogleTransparency('unknown')).toBe('opaque');
		expect(normalizeGoogleTransparency('busy')).toBe('opaque');
		expect(normalizeGoogleTransparency('')).toBe('opaque');
	});
});

// Test the transparency normalization logic for ICS/iCalendar
describe('ICS TRANSP property mapping', () => {
	const normalizeIcsTransparency = (value: string | undefined | null): 'opaque' | 'transparent' => {
		if (!value) return 'opaque';
		const upper = value.toUpperCase().trim();
		return upper === 'TRANSPARENT' ? 'transparent' : 'opaque';
	};

	it('should return "opaque" when TRANSP is undefined', () => {
		expect(normalizeIcsTransparency(undefined)).toBe('opaque');
	});

	it('should return "opaque" when TRANSP is null', () => {
		expect(normalizeIcsTransparency(null)).toBe('opaque');
	});

	it('should return "opaque" when TRANSP is "OPAQUE"', () => {
		expect(normalizeIcsTransparency('OPAQUE')).toBe('opaque');
	});

	it('should return "transparent" when TRANSP is "TRANSPARENT"', () => {
		expect(normalizeIcsTransparency('TRANSPARENT')).toBe('transparent');
	});

	it('should handle lowercase "opaque"', () => {
		expect(normalizeIcsTransparency('opaque')).toBe('opaque');
	});

	it('should handle lowercase "transparent"', () => {
		expect(normalizeIcsTransparency('transparent')).toBe('transparent');
	});

	it('should handle whitespace around value', () => {
		expect(normalizeIcsTransparency('  TRANSPARENT  ')).toBe('transparent');
		expect(normalizeIcsTransparency('  OPAQUE  ')).toBe('opaque');
	});

	it('should default unknown values to "opaque" per RFC 5545', () => {
		expect(normalizeIcsTransparency('unknown')).toBe('opaque');
		expect(normalizeIcsTransparency('BUSY')).toBe('opaque');
		expect(normalizeIcsTransparency('')).toBe('opaque');
	});
});

// Test the TimeTransparency building logic
describe('TimeTransparency object building', () => {
	type TimeTransparency = {
		blocksTime: boolean;
		value: 'opaque' | 'transparent';
		source: {
			provider: 'google' | 'ics';
			rawValue: string | null;
		};
	};

	const extractRawTransparencyValue = (
		sourceJson: string,
		calType: 'google' | 'ics',
	): string | null => {
		try {
			const parsed = JSON.parse(sourceJson) as Record<string, unknown>;
			if (calType === 'google') {
				const val = parsed.transparency;
				return typeof val === 'string' ? val : null;
			} else {
				const val = parsed.transp;
				return typeof val === 'string' ? val : null;
			}
		} catch {
			return null;
		}
	};

	const buildTimeTransparency = (
		transparency: string | null,
		sourceJson: string,
		calType: 'google' | 'ics',
	): TimeTransparency => {
		const normalizedValue: 'opaque' | 'transparent' =
			transparency === 'transparent' ? 'transparent' : 'opaque';
		const rawValue = extractRawTransparencyValue(sourceJson, calType);
		return {
			blocksTime: normalizedValue === 'opaque',
			value: normalizedValue,
			source: {
				provider: calType,
				rawValue,
			},
		};
	};

	it('should build correct TimeTransparency for opaque Google event', () => {
		const result = buildTimeTransparency(
			'opaque',
			JSON.stringify({ transparency: 'opaque' }),
			'google',
		);
		expect(result).toEqual({
			blocksTime: true,
			value: 'opaque',
			source: {
				provider: 'google',
				rawValue: 'opaque',
			},
		});
	});

	it('should build correct TimeTransparency for transparent Google event', () => {
		const result = buildTimeTransparency(
			'transparent',
			JSON.stringify({ transparency: 'transparent' }),
			'google',
		);
		expect(result).toEqual({
			blocksTime: false,
			value: 'transparent',
			source: {
				provider: 'google',
				rawValue: 'transparent',
			},
		});
	});

	it('should build correct TimeTransparency for missing Google transparency', () => {
		const result = buildTimeTransparency(null, JSON.stringify({}), 'google');
		expect(result).toEqual({
			blocksTime: true,
			value: 'opaque',
			source: {
				provider: 'google',
				rawValue: null,
			},
		});
	});

	it('should build correct TimeTransparency for opaque ICS event', () => {
		const result = buildTimeTransparency(
			'opaque',
			JSON.stringify({ transp: 'OPAQUE' }),
			'ics',
		);
		expect(result).toEqual({
			blocksTime: true,
			value: 'opaque',
			source: {
				provider: 'ics',
				rawValue: 'OPAQUE',
			},
		});
	});

	it('should build correct TimeTransparency for transparent ICS event', () => {
		const result = buildTimeTransparency(
			'transparent',
			JSON.stringify({ transp: 'TRANSPARENT' }),
			'ics',
		);
		expect(result).toEqual({
			blocksTime: false,
			value: 'transparent',
			source: {
				provider: 'ics',
				rawValue: 'TRANSPARENT',
			},
		});
	});

	it('should build correct TimeTransparency for missing ICS TRANSP', () => {
		const result = buildTimeTransparency(null, JSON.stringify({}), 'ics');
		expect(result).toEqual({
			blocksTime: true,
			value: 'opaque',
			source: {
				provider: 'ics',
				rawValue: null,
			},
		});
	});

	it('should handle invalid JSON gracefully', () => {
		const result = buildTimeTransparency('opaque', 'not valid json', 'google');
		expect(result).toEqual({
			blocksTime: true,
			value: 'opaque',
			source: {
				provider: 'google',
				rawValue: null,
			},
		});
	});
});
