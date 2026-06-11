/**
 * @module OmniSearch
 * @summary Fuzzy search engine for the command-palette / omni-bar.
 *
 * Wraps fuse.js with KiMaster-specific defaults: weighted keys, extended
 * search syntax (`'foo` = exact, `^foo` = prefix), match index tracking so
 * the palette can render highlighted ranges without re-scanning strings.
 *
 * Usage:
 *   import { createSearcher } from './omni-search.js';
 *   const search = createSearcher([{ id, label, description, tags, group }]);
 *   const hits = search('drc');   // ranked results
 *
 * @see https://www.fusejs.io/
 */

import Fuse from 'fuse.js';

const DEFAULTS = {
  includeScore:      true,
  includeMatches:   true,
  ignoreLocation:   true,
  minMatchCharLength: 1,
  threshold:         0.4,
  distance:          200,
  useExtendedSearch: false,
  keys: [
    { name: 'label',       weight: 0.55 },
    { name: 'id',          weight: 0.20 },
    { name: 'description', weight: 0.15 },
    { name: 'tags',        weight: 0.10 },
  ],
};

/**
 * Build a searchable index over a flat list of items.
 *
 * @template T
 * @param {Array<T & { id: string, label: string, description?: string, tags?: string[] }>} items
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {{ search: (query: string, limit?: number) => Array<T & { _score: number, _matches: Array<{ key: string, indices: Array<[number, number]> }> }>, items: Array<T> }}
 */
export function createSearcher(items, opts) {
  const fuse = new Fuse(items, { ...DEFAULTS, ...opts });

  return {
    items,
    /**
     * @param {string} query
     * @param {number} [limit=50]
     */
    search(query, limit = 50) {
      const q = (query ?? '').trim();
      if (!q) {
        return items.slice(0, limit).map(it => {
          it._score = 0;
          it._matches = [];
          return it;
        });
      }
      return fuse.search(q, { limit }).map(r => {
        r.item._score   = r.score   ?? 0;
        r.item._matches = r.matches ?? [];
        return r.item;
      });
    },
    /** Recompute the index after the underlying list changes. */
    refresh() { fuse.setCollection(items); },
  };
}
