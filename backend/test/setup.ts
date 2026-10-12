import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Imported first by tests that load config: keeps test data out of backend/data and ignores a local .env.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'kbdv-test-'));
process.env.ADMIN_TOKEN = '';
