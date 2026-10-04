-- Private product-improvement data; never exposed through public/community listings.
CREATE TABLE beta_applications (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 motivation TEXT NOT NULL CHECK (length(motivation) BETWEEN 10 AND 2000),
 feedback_commitment BOOLEAN NOT NULL CHECK (feedback_commitment),
 commitment_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE template_requests (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 profession TEXT NOT NULL CHECK (length(profession) BETWEEN 1 AND 160),
 goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 500),
 level TEXT NOT NULL CHECK (length(level) BETWEEN 1 AND 120),
 description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 3000),
 status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','planned','shipped','closed')),
 reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX template_requests_user_idx ON template_requests(user_id,created_at DESC);
CREATE INDEX template_requests_recent_idx ON template_requests(created_at DESC);
CREATE TABLE shared_interview_results (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_session_id TEXT NOT NULL CHECK (length(client_session_id) BETWEEN 1 AND 120),
 source TEXT NOT NULL CHECK (source IN ('web','local','mobile')),
 consent_version TEXT NOT NULL,
 consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id, source, client_session_id)
);
CREATE INDEX shared_interview_results_recent_idx ON shared_interview_results(updated_at DESC);
