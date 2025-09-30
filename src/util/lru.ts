'use strict';

export class LruCache<V> {
	private maxSize: number;
	private ttlMs: number;
	private map: Map<string, { value: V; expiresAt: number }>;

	constructor(opts: { maxSize?: number; ttlMs: number }) {
		this.maxSize = opts.maxSize ?? 100;
		this.ttlMs = opts.ttlMs;
		this.map = new Map();
	}

	get(key: string): V | undefined {
		const e = this.map.get(key);
		if (!e) return undefined;
		if (Date.now() > e.expiresAt) {
			this.map.delete(key);
			return undefined;
		}
		// refresh LRU
		this.map.delete(key);
		this.map.set(key, e);
		return e.value;
	}

	set(key: string, value: V): void {
		if (this.map.size >= this.maxSize) {
			// evict oldest
			const firstKey = this.map.keys().next().value as string | undefined;
			if (firstKey) this.map.delete(firstKey);
		}
		this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
	}

	clear(): void {
		this.map.clear();
	}
}
