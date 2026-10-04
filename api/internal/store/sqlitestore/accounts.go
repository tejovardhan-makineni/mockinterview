package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tejo/mockinterview-api/internal/persona"
	"github.com/tejo/mockinterview-api/internal/store"
)

func (s *Store) CreateUser(ctx context.Context, email, hash string) (store.User, error) {
	return s.createUser(ctx, email, hash, "", "")
}
func (s *Store) CreateUserWithPolicies(ctx context.Context, email, hash, terms, privacy string) (store.User, error) {
	return s.createUser(ctx, email, hash, terms, privacy)
}
func (s *Store) createUser(ctx context.Context, email, hash, terms, privacy string) (store.User, error) {
	u := store.User{ID: store.NewID(), Email: email, PasswordHash: hash, Role: "user"}
	if terms != "" || privacy != "" {
		now := time.Now().UTC()
		u.AdultConfirmedAt = &now
		u.PoliciesAcceptedAt = &now
		u.TermsVersion = terms
		u.PrivacyVersion = privacy
	}
	err := execJSON(ctx, s.db, `INSERT INTO users(id,email,data) VALUES(?,?,?)`, u, u.ID, u.Email)
	return u, err
}
func (s *Store) UserByEmail(ctx context.Context, email string) (store.User, error) {
	return readJSON[store.User](ctx, s.db, `SELECT data FROM users WHERE email=?`, email)
}
func (s *Store) UserByID(ctx context.Context, id string) (store.User, error) {
	return readJSON[store.User](ctx, s.db, `SELECT data FROM users WHERE id=?`, id)
}
func (s *Store) AcceptPolicies(ctx context.Context, id, terms, privacy string) (u store.User, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		var e error
		u, e = readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, id)
		if e != nil {
			return e
		}
		now := time.Now().UTC()
		if u.PoliciesAcceptedAt == nil || u.AdultConfirmedAt == nil || u.TermsVersion != terms || u.PrivacyVersion != privacy {
			u.PoliciesAcceptedAt = &now
		}
		if u.AdultConfirmedAt == nil {
			u.AdultConfirmedAt = &now
		}
		u.TermsVersion = terms
		u.PrivacyVersion = privacy
		return saveUser(ctx, tx, u)
	})
	return
}
func saveUser(ctx context.Context, q executor, u store.User) error {
	return execJSON(ctx, q, `UPDATE users SET data=?2 WHERE id=?1`, u, u.ID)
}
func (s *Store) GetSettings(ctx context.Context, id string) (json.RawMessage, error) {
	return readJSON[json.RawMessage](ctx, s.db, `SELECT settings FROM users WHERE id=?`, id)
}
func (s *Store) SaveSettings(ctx context.Context, id string, settings json.RawMessage) error {
	// Provider credentials never belong in the durable profile. They use the
	// encrypted, expiring session_credentials table instead.
	var fields map[string]json.RawMessage
	settings = normalizeJSON(settings)
	if err := json.Unmarshal(settings, &fields); err != nil {
		return err
	}
	for key := range fields {
		if strings.Contains(strings.ToLower(key), "api_key") || strings.EqualFold(key, "apikey") || strings.EqualFold(key, "provider_key") {
			delete(fields, key)
		}
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE users SET settings=? WHERE id=?`, string(raw), id)
	return affected(result, err, store.ErrNotFound)
}
func (s *Store) GetConfig(ctx context.Context, id string) (store.InterviewConfig, error) {
	c, err := readJSON[store.InterviewConfig](ctx, s.db, `SELECT data FROM interview_configs WHERE user_id=?`, id)
	if errors.Is(err, store.ErrNotFound) {
		return store.DefaultConfig(), nil
	}
	if err != nil {
		return c, err
	}
	c.VoiceID = persona.NormalizeVoiceID(c.VoiceID)
	c.FaceID = persona.NormalizeFaceID(c.FaceID)
	c.Personality = persona.NormalizePersonalityID(c.Personality)
	return c, nil
}
func (s *Store) SaveConfig(ctx context.Context, id string, c store.InterviewConfig) error {
	return execJSON(ctx, s.db, `INSERT INTO interview_configs(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data`, c, id)
}
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		u, err := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, id)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if u.EmailVerified {
			if _, err = tx.ExecContext(ctx, `DELETE FROM tester_emails WHERE email=?`, strings.ToLower(strings.TrimSpace(u.Email))); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id)
		return err
	})
}
func (s *Store) SaveAuthAction(ctx context.Context, uid, purpose, hash string, expires time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, uid); e != nil {
			return e
		}
		var recent bool
		if e := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM auth_actions WHERE user_id=? AND purpose=? AND created_at>?)`, uid, purpose, nowMillis()-60000).Scan(&recent); e != nil {
			return e
		}
		if recent {
			return store.ErrActionThrottled
		}
		_, e := tx.ExecContext(ctx, `INSERT INTO auth_actions(token_hash,user_id,purpose,expires_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,purpose) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=excluded.created_at`, hash, uid, purpose, expires.UnixMilli(), nowMillis())
		return e
	})
}
func (s *Store) ConsumeAuthAction(ctx context.Context, hash, purpose, password string) (uid string, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		e := tx.QueryRowContext(ctx, `SELECT user_id FROM auth_actions WHERE token_hash=? AND purpose=? AND expires_at>?`, hash, purpose, nowMillis()).Scan(&uid)
		if errors.Is(e, sql.ErrNoRows) {
			return store.ErrNotFound
		}
		if e != nil {
			return e
		}
		u, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, uid)
		if e != nil {
			return e
		}
		if purpose == "verify" {
			u.EmailVerified = true
		} else if purpose == "reset" && password != "" {
			u.EmailVerified = true
			u.PasswordHash = password
			u.TokenVersion++
		} else {
			return errors.New("invalid action")
		}
		if e = saveUser(ctx, tx, u); e != nil {
			return e
		}
		if purpose == "reset" {
			_, e = tx.ExecContext(ctx, `DELETE FROM auth_actions WHERE user_id=?`, uid)
		} else {
			_, e = tx.ExecContext(ctx, `DELETE FROM auth_actions WHERE token_hash=?`, hash)
		}
		return e
	})
	return
}
func (s *Store) ChangePassword(ctx context.Context, id, previous, next string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		u, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, id)
		if e != nil {
			return e
		}
		if u.PasswordHash != previous {
			return store.ErrNotFound
		}
		u.PasswordHash = next
		u.TokenVersion++
		if e = saveUser(ctx, tx, u); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `DELETE FROM auth_actions WHERE user_id=?`, id)
		return e
	})
}
func (s *Store) RevokeSessions(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		u, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, id)
		if e != nil {
			return e
		}
		u.TokenVersion++
		return saveUser(ctx, tx, u)
	})
}

// Resume's API JSON intentionally omits the original text; the durable document
// adds it explicitly, so tailored interviews survive an application restart.
type resumeDocument struct {
	Resume     store.Resume
	ParsedText string
}

func (s *Store) SaveResume(ctx context.Context, uid, filename, text string, parsed json.RawMessage) (r store.Resume, err error) {
	r = store.Resume{ID: store.NewID(), Filename: filename, ParsedText: text, ParsedJSON: normalizeJSON(parsed)}
	err = s.write(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, `DELETE FROM resumes WHERE user_id=?`, uid); e != nil {
			return e
		}
		return execJSON(ctx, tx, `INSERT INTO resumes(id,user_id,data) VALUES(?,?,?)`, resumeDocument{r, text}, r.ID, uid)
	})
	return
}
func (s *Store) LatestResume(ctx context.Context, id string) (store.Resume, error) {
	d, e := readJSON[resumeDocument](ctx, s.db, `SELECT data FROM resumes WHERE user_id=?`, id)
	d.Resume.ParsedText = d.ParsedText
	return d.Resume, e
}
func (s *Store) DeleteResumes(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, `DELETE FROM resumes WHERE user_id=?`, id); e != nil {
			return e
		}
		_, e := tx.ExecContext(ctx, `DELETE FROM resume_reviews WHERE user_id=?`, id)
		return e
	})
}
func (s *Store) SaveResumeReview(ctx context.Context, uid, rid, provider, model string, result json.RawMessage) (string, error) {
	id := store.NewID()
	var resumeID any
	if rid != "" {
		resumeID = rid
	}
	_, e := s.db.ExecContext(ctx, `INSERT INTO resume_reviews(id,user_id,resume_id,provider,model,result,created_at) VALUES(?,?,?,?,?,?,?)`, id, uid, resumeID, provider, model, string(normalizeJSON(result)), nowMillis())
	return id, e
}
