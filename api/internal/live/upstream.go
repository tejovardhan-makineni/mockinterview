package live

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
	"google.golang.org/genai"
	"sync"
	"time"
)

// The SDK's outbound Gorilla socket has no writer synchronization.
type liveSender interface {
	SendClientContent(genai.LiveClientContentInput) error
	SendRealtimeInput(genai.LiveRealtimeInput) error
	SendToolResponse(genai.LiveToolResponseInput) error
}
type upstream struct {
	mu      sync.Mutex
	session liveSender
	onError func()
}

func (u *upstream) content(in genai.LiveClientContentInput) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	e := u.session.SendClientContent(in)
	if e != nil && u.onError != nil {
		u.onError()
	}
	return e
}
func (u *upstream) audio(in genai.LiveRealtimeInput) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	e := u.session.SendRealtimeInput(in)
	if e != nil && u.onError != nil {
		u.onError()
	}
	return e
}
func (u *upstream) tool(in genai.LiveToolResponseInput) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	e := u.session.SendToolResponse(in)
	if e != nil && u.onError != nil {
		u.onError()
	}
	return e
}
func (r *Relay) deadline() time.Time {
	if r.attempt.DeadlineAt != nil {
		return *r.attempt.DeadlineAt
	}
	return time.Now().Add(time.Duration(r.attempt.DurationMinutes)*time.Minute + 30*time.Second)
}
func (r *Relay) record(ctx context.Context, role, text, event string) error {
	if text == "" {
		return nil
	}
	if event == "" {
		event = store.NewID()
	}
	meta, _ := json.Marshal(map[string]string{"event_id": event, "lease_owner": r.owner})
	c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return r.store.AddTurn(c, r.attempt.ID, role, text, 0, meta)
}
func (r *Relay) watch(ctx context.Context, conn *websocket.Conn, wc *wsConn, stop func()) {

	tick := time.NewTicker(5 * time.Second)
	ping := time.NewTicker(pingPeriod)
	defer tick.Stop()
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			if r.parentContext().Err() != nil {
				_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "server_restart", Text: "The service is restarting. Reconnect to resume your saved interview.", Retryable: true})
			} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				p, done := context.WithTimeout(context.Background(), 5*time.Second)
				_ = r.store.BeginTimedFinish(p, r.attempt.ID)
				done()
				_ = wc.writeServerMsg(serverMsg{Type: "ended"})
			}
			stop()
			return
		case <-ping.C:
			if wc.writePing() != nil {
				stop()
				return
			}
		case <-tick.C:
			if r.attempt.DeadlineAt != nil && time.Now().After(*r.attempt.DeadlineAt) {
				p, done := context.WithTimeout(context.Background(), 5*time.Second)
				_ = r.store.BeginTimedFinish(p, r.attempt.ID)
				done()
				_ = wc.writeServerMsg(serverMsg{Type: "ended", Text: "Your time is complete. Preparing your saved feedback."})
				stop()
				return
			}
			c, cancel := context.WithTimeout(ctx, 3*time.Second)
			u, e := r.store.UserByID(c, r.attempt.UserID)
			if e == nil && u.TokenVersion != r.tokenVersion {
				e = errors.New("auth expired")
			}
			if e == nil {
				e = r.store.HeartbeatLive(c, r.attempt.ID, r.owner)
			}
			cancel()
			if e != nil {
				stop()
				return
			}
		}
	}
}

func (r *Relay) stageContext(q corpus.Question, wc *wsConn) string {
	sections := SectionPlan(q, false, "")
	elapsed := time.Duration(0)
	if r.attempt.StartedAt != nil {
		elapsed = time.Since(*r.attempt.StartedAt)
	}
	stage := 0
	for i, at := range SectionSchedule(time.Duration(r.attempt.DurationMinutes)*time.Minute, sections) {
		if elapsed >= at {
			stage = i + 1
		}
	}
	if stage >= len(sections) {
		return ""
	}
	sec := sections[stage]
	_ = wc.writeServerMsg(serverMsg{Type: "section", Index: stage, Total: len(sections), Title: sec.Title, Kind: sec.Kind})
	return "\nACTIVE STAGE: " + sec.Title + ". " + sec.Guidance
}

func (r *Relay) parentContext() context.Context {
	if r.background != nil {
		return r.background
	}
	return context.Background()
}
