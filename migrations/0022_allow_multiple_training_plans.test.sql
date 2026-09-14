-- Documentation-level smoke assertions for manual/local D1 migration verification.
-- After migrations through 0022, training_plan.user_id must be non-unique and
-- all foreign keys in the program/workout graph must remain valid.
PRAGMA foreign_key_check;
PRAGMA index_list('training_plan');
