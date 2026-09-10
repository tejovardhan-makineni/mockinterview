-- Optional instrument; existing responses and older writers remain valid.
ALTER TABLE interview_feedback ADD COLUMN comparison JSONB;
ALTER TABLE interview_feedback ADD CONSTRAINT interview_feedback_comparison_valid CHECK (
 comparison IS NULL OR COALESCE(
 jsonb_typeof(comparison)='object'
 AND comparison ?& ARRAY['version','prior_use','tool_names','preference','details']
 AND comparison - ARRAY['version','prior_use','tool_names','preference','details'] = '{}'::jsonb
 AND comparison->>'version'='tool-comparison-v1'
 AND comparison->>'prior_use' IN ('yes','no','prefer_not_to_say')
 AND jsonb_typeof(comparison->'version')='string'
 AND jsonb_typeof(comparison->'prior_use')='string'
 AND jsonb_typeof(comparison->'tool_names')='string'
 AND jsonb_typeof(comparison->'preference')='string'
 AND jsonb_typeof(comparison->'details')='string'
 AND char_length(comparison->>'tool_names')<=300
 AND char_length(comparison->>'details')<=1000
 AND comparison->>'preference' IN ('','mockinterview_better','about_same','other_tools_better','unable_to_judge')
 AND (comparison->>'prior_use'='yes' OR (comparison->>'tool_names'='' AND comparison->>'preference'='' AND comparison->>'details'='')),
 false)
);
CREATE INDEX interview_feedback_suggestions_idx ON interview_feedback(updated_at DESC,session_id DESC) WHERE comment<>'' OR comparison IS NOT NULL;
