import {validatePackage} from '../../src/analysis/schema';

// The pipeline packages bundled in the app (written by
// backend/scripts/seed_demo.py) must pass the TV's own validation.
let bundled: Record<string, unknown> = {};
try {
  bundled = require('../../src/analysis/packages').BUNDLED ?? {};
} catch {
  bundled = {}; // not seeded: nothing to check
}

describe('bundled packages', () => {
  const ids = Object.keys(bundled);
  (ids.length ? it.each(ids) : it.skip.each(['none']))(
    '%s validates and keeps every widget',
    (id) => {
      const raw = bundled[id] as {widgets: unknown[]; answers?: unknown[]};
      const pkg = validatePackage(raw, id);
      expect(pkg).not.toBeNull();
      expect(pkg!.widgets).toHaveLength(raw.widgets.length);
      expect(pkg!.answers).toHaveLength(raw.answers?.length ?? 0);
    },
  );
});
