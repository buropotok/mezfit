-- Complete coach ownership for programs created before runtime writes
-- owner_coach_user_id directly. A creator is accepted as the coach owner only
-- when the creator has the coach role and either owns their own plan or has a
-- persisted coach/client relationship with the plan's client.
UPDATE training_plan AS plan
SET owner_coach_user_id = plan.created_by_user_id
WHERE plan.owner_coach_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM user_role AS creator_role
    WHERE creator_role.user_id = plan.created_by_user_id
      AND creator_role.role = 'coach'
  )
  AND (
    plan.user_id = plan.created_by_user_id
    OR EXISTS (
      SELECT 1
      FROM coach_client AS relationship
      WHERE relationship.coach_user_id = plan.created_by_user_id
        AND relationship.client_user_id = plan.user_id
    )
  );
