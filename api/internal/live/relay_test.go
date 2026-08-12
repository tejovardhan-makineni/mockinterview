package live

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// fakeConn is a stand-in for *websocket.Conn that satisfies wsWriter. It records
// how many writes it saw and can be told to fail, so tests can drive the write
// path without a real socket. It deliberately does NOT do its own locking — the
// serialization under test lives in wsConn, so `go test -race` on this file
// proves wsConn actually prevents concurrent writes to the underlying conn.
type fakeConn struct {
	writes int
	failAt int // if >0, the Nth write returns an error (models a dead client)
	closed bool
}

func (f *fakeConn) count() error {
	f.writes++
	if f.failAt > 0 && f.writes >= f.failAt {
		return errors.New("write: broken pipe")
	}
	return nil
}

func (f *fakeConn) WriteJSON(interface{}) error               { return f.count() }
func (f *fakeConn) WriteMessage(int, []byte) error            { return f.count() }
func (f *fakeConn) WriteControl(int, []byte, time.Time) error { return f.count() }
func (f *fakeConn) SetWriteDeadline(time.Time) error          { return nil }
func (f *fakeConn) Close() error                              { f.closed = true; return nil }

// TestConcurrentWritesAreSerialized is the GO-1/GO-8/GO-13/GO-14 regression: the
// reader goroutine (audio-out via writeBinary + transcript via writeServerMsg)
// and the browser→Gemini loop (the user_text echo via writeServerMsg) write to
// the SAME connection concurrently. Without wsConn's mutex, gorilla panics with
// "concurrent write to websocket connection"; with it, this passes cleanly under
// `go test -race`.
func TestConcurrentWritesAreSerialized(t *testing.T) {
	fc := &fakeConn{}
	wc := &wsConn{conn: fc}

	const iterations = 500
	var wg sync.WaitGroup

	// audio-out writer (models the reader goroutine streaming interviewer audio).
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			if err := wc.writeBinary([]byte{0x1, 0x2, 0x3}); err != nil {
				t.Errorf("writeBinary: %v", err)
				return
			}
		}
	}()

	// transcript writer (models the reader goroutine's streaming transcripts).
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			if err := wc.writeServerMsg(serverMsg{Type: "transcript", Role: "interviewer", Text: "hi"}); err != nil {
				t.Errorf("writeServerMsg: %v", err)
				return
			}
		}
	}()

	// user_text echo writer (models the browser→Gemini loop echoing typed input).
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			if err := wc.writeServerMsg(serverMsg{Type: "transcript", Role: "candidate", Text: "typed answer"}); err != nil {
				t.Errorf("writeServerMsg echo: %v", err)
				return
			}
		}
	}()

	// keep-alive pings also ride the same lock.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			if err := wc.writePing(); err != nil {
				t.Errorf("writePing: %v", err)
				return
			}
		}
	}()

	wg.Wait()
	if got, want := fc.writes, iterations*4; got != want {
		t.Fatalf("expected %d serialized writes, got %d", want, got)
	}
}

// TestWriteErrorPropagates guards GO-13: a failed write must surface to the
// caller (so a dead client triggers teardown) instead of being swallowed.
func TestWriteErrorPropagates(t *testing.T) {
	fc := &fakeConn{failAt: 1}
	wc := &wsConn{conn: fc}
	if err := wc.writeServerMsg(serverMsg{Type: "ready"}); err == nil {
		t.Fatal("expected write error to propagate, got nil")
	}
}

// TestSectionSchedule checks the time-driven section progression: one transition
// per section after the first, monotonic non-decreasing, intro gets the front of
// the interview and wrap the tail, and short interviews still yield a sane plan.
func TestSectionSchedule(t *testing.T) {
	// intro, resume, core, wrap over 30 min → 3 transitions.
	got := sectionSchedule(30*time.Minute, 4)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i] < got[i-1] {
			t.Errorf("not monotonic at %d: %v", i, got)
		}
	}
	if got[0] != 3*time.Minute+30*time.Second {
		t.Errorf("intro end = %v, want 3m30s", got[0])
	}
	if last, want := got[len(got)-1], 30*time.Minute-(2*time.Minute+30*time.Second); last != want {
		t.Errorf("wrap start = %v, want %v", last, want)
	}
	// Degenerate: fewer than 2 sections → no transitions.
	if s := sectionSchedule(30*time.Minute, 1); s != nil {
		t.Errorf("n=1 schedule = %v, want nil", s)
	}
	// Very short interview stays monotonic and non-negative.
	short := sectionSchedule(2*time.Minute, 4)
	for i, at := range short {
		if at < 0 {
			t.Errorf("short[%d] negative: %v", i, at)
		}
		if i > 0 && at < short[i-1] {
			t.Errorf("short not monotonic at %d: %v", i, short)
		}
	}
}

// TestOriginChecker guards SEC-6: only the configured web origin(s), same-origin,
// or header-less (non-browser) requests may open the socket.
func TestOriginChecker(t *testing.T) {
	check := originChecker([]string{"https://app.example.com", "http://localhost:3000/"})
	cases := []struct {
		origin string
		host   string
		want   bool
	}{
		{"", "app.example.com", true},                          // no Origin header (native client)
		{"https://app.example.com", "app.example.com", true},   // allowed origin
		{"http://localhost:3000", "localhost:3000", true},      // allowed (trailing slash tolerated)
		{"https://app.example.com", "api.internal", true},      // allowed origin regardless of host
		{"https://evil.example.com", "app.example.com", false}, // cross-site hijack attempt
		{"https://app.example.com.evil.com", "x", false},       // look-alike host
		{"::not a url::", "app.example.com", false},            // unparseable
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "http://"+c.host+"/api/v1/sessions/x/live", nil)
		req.Host = c.host
		if c.origin != "" {
			req.Header.Set("Origin", c.origin)
		}
		if got := check(req); got != c.want {
			t.Errorf("origin=%q host=%q: got %v want %v", c.origin, c.host, got, c.want)
		}
	}
}
