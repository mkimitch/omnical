-- Add task_lists and raw_tasks tables for Google Tasks integration
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS task_lists (
	id TEXT PRIMARY KEY,               -- gtlist_{sha1(googleId).slice(0,12)}
	google_task_list_id TEXT NOT NULL, -- Google's opaque list ID
	label TEXT,
	color TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER DEFAULT 0,
	last_synced_at INTEGER,            -- epoch ms of max(task.updated) seen, NULL = never synced
	updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS task_lists_google_id ON task_lists (google_task_list_id);

CREATE TABLE IF NOT EXISTS raw_tasks (
	task_list_id TEXT NOT NULL,        -- references task_lists.id (unenforced)
	task_id TEXT NOT NULL,             -- Google's task ID
	title TEXT,
	notes TEXT,
	status TEXT NOT NULL DEFAULT 'needsAction', -- 'needsAction' | 'completed'
	due_iso TEXT,                      -- UTC date ISO or NULL (date-only from Google)
	completed_iso TEXT,                -- UTC datetime ISO or NULL
	deleted INTEGER NOT NULL DEFAULT 0,
	hidden INTEGER NOT NULL DEFAULT 0,
	position TEXT,                     -- lexicographic ordering string
	parent TEXT,                       -- parent task_id for subtasks, NULL = top-level
	updated_ts INTEGER NOT NULL,       -- epoch ms
	source_json TEXT NOT NULL,         -- raw Google Task JSON
	PRIMARY KEY (task_list_id, task_id)
);

CREATE INDEX IF NOT EXISTS raw_tasks_list_status ON raw_tasks (task_list_id, status);
CREATE INDEX IF NOT EXISTS raw_tasks_due ON raw_tasks (due_iso) WHERE due_iso IS NOT NULL;
CREATE INDEX IF NOT EXISTS raw_tasks_updated ON raw_tasks (task_list_id, updated_ts);

COMMIT;
PRAGMA foreign_keys=ON;
