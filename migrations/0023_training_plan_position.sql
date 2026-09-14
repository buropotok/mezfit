ALTER TABLE training_plan ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0);

UPDATE training_plan AS current
SET position = (
  SELECT COUNT(*)
  FROM training_plan AS preceding
  WHERE preceding.user_id = current.user_id
    AND (
      preceding.updated_at > current.updated_at
      OR (preceding.updated_at = current.updated_at AND preceding.id > current.id)
    )
);

CREATE INDEX idx_training_plan_user_position ON training_plan(user_id, position);
