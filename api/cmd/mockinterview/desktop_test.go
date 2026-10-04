package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

func TestDesktopBridgeRejectsForeignRequests(t *testing.T) {
	secret := strings.Repeat("s", 64)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Desktop-Token") != "" {
			t.Fatal("bridge secret reached downstream handler")
		}
		w.WriteHeader(204)
	})
	for _, tc := range []struct {
		name, token, host, origin string
		status                    int
	}{
		{"missing", "", "127.0.0.1:12345", "", 403},
		{"wrong", strings.Repeat("x", 64), "127.0.0.1:12345", "", 403},
		{"foreign origin", secret, "127.0.0.1:12345", "https://untrusted.example", 403},
		{"foreign host", secret, "untrusted.example", "", 403},
		{"app", secret, "127.0.0.1:12345", "http://127.0.0.1:12345", 204},
		{"navigation", secret, "127.0.0.1:12345", "", 204},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://"+tc.host+"/api/v1/desktop/bootstrap", nil)
			r.Header.Set("X-Desktop-Token", tc.token)
			r.Header.Set("Origin", tc.origin)
			w := httptest.NewRecorder()
			desktopBridge(secret, "127.0.0.1:12345")(next).ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
}

func TestDesktopBootstrapAndPersonalKeyOnly(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	st := memstore.New()
	cfg := &config.Config{LocalDesktop: true, JWTSecret: strings.Repeat("j", 40), JWTTTL: time.Hour, SessionEncryptionKey: base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))}
	a := &App{Cfg: cfg, Store: st, LLM: llm.DesktopClient{}, Corpus: cat}
	r := chi.NewRouter()
	r.Route("/api/v1", a.Routes)
	var firstID, token string
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/desktop/bootstrap", nil))
		var payload struct {
			Token string
			User  struct {
				ID   string
				Role string
			}
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &payload) != nil || payload.Token == "" {
			t.Fatalf("bootstrap %d %s", w.Code, w.Body.String())
		}
		if i == 0 {
			firstID = payload.User.ID
		} else if payload.User.ID != firstID {
			t.Fatal("bootstrap created another profile")
		}
		if payload.User.Role == "admin" {
			t.Fatal("local profile unexpectedly admin")
		}
		token = payload.Token
	}
	for _, funding := range []string{"", "platform"} {
		body := `{"funding":"` + funding + `"}`
		request := httptest.NewRequest("POST", "/api/v1/sessions", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "personal_key_required") {
			t.Fatalf("desktop admitted free attempt: %d %s", w.Code, w.Body.String())
		}
	}
	u, err := st.UserByID(context.Background(), firstID)
	if err != nil || u.Email != "local@mockinterview.invalid" {
		t.Fatal("missing local profile")
	}
}

func TestDesktopAssetsServeExportWithoutDirectoryListing(t *testing.T) {
	root := t.TempDir()
	for name, content := range map[string]string{
		"index.html":            "home page",
		"setup/index.html":      "interview setup",
		"_next/static/chunk.js": "export const interview = true;",
		"api/index.html":        "must not serve API fallback",
		"desktop/index.html":    "must not serve proxy fallback",
		"empty/.keep":           "directory entries must not be listed",
	} {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	handler := desktopAssets(root)
	for _, tc := range []struct {
		method, target, rangeHeader, body string
		status                            int
	}{
		{"GET", "/", "", "home page", 200},
		{"GET", "/setup/", "", "interview setup", 200},
		{"GET", "/setup", "", "interview setup", 200},
		{"GET", "/_next/static/chunk.js?v=123", "", "export const interview = true;", 200},
		{"HEAD", "/setup/", "", "", 200},
		{"GET", "/setup/", "bytes=0-8", "interview", 206},
		{"POST", "/setup/", "", "", 405},
		{"GET", "/empty/", "", "", 404},
		{"GET", "/missing", "", "", 404},
		{"GET", "/api", "", "", 404},
		{"GET", "/api/", "", "", 404},
		{"GET", "/API/index.html", "", "", 404},
		{"GET", "/api/v1/missing", "", "", 404},
		{"GET", "/desktop/remote/missing", "", "", 404},
		{"GET", "/desktop/index.html", "", "", 404},
		{"GET", "/../../index.html", "", "", 404},
		{"GET", "/setup/../index.html", "", "", 404},
		{"GET", "/setup/%2e%2e/index.html", "", "", 404},
		{"GET", "/setup/%2E%2E%2findex.html", "", "", 404},
		{"GET", "/setup/%2e/index.html", "", "", 404},
		{"GET", "/setup%5c..%5cindex.html", "", "", 404},
		{"GET", "/C:%5cWindows%5cwin.ini", "", "", 404},
		{"GET", "/index.html::$DATA", "", "", 404},
		{"GET", "/setup./index.html", "", "", 404},
		{"GET", "/setup%20/index.html", "", "", 404},
		{"GET", "/%00index.html", "", "", 404},
		{"GET", "/setup//index.html", "", "", 404},
	} {
		t.Run(tc.method+" "+tc.target+" "+tc.rangeHeader, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.target, nil)
			r.Header.Set("Range", tc.rangeHeader)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if tc.status < 300 && w.Body.String() != tc.body {
				t.Fatalf("body %q, want %q", w.Body.String(), tc.body)
			}
		})
	}
}

func TestDesktopAssetsConfineSymlinksAndDirectoryIndexes(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "index.html"), []byte("private data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "public.txt"), []byte("bundled data"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, link := range []struct{ name, target string }{
		{"external.txt", filepath.Join(outside, "index.html")},
		{"external-directory", outside},
		{"safe-alias.txt", "public.txt"},
		{"loop", "loop"},
	} {
		if err := os.Symlink(link.target, filepath.Join(root, link.name)); err != nil {
			t.Skipf("symlink creation unavailable on this runner: %v", err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "linked-index"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "index.html"), filepath.Join(root, "linked-index", "index.html")); err != nil {
		t.Fatal(err)
	}
	handler := desktopAssets(root)
	for _, tc := range []struct {
		target string
		status int
	}{
		{"/external.txt", 404}, {"/external-directory/", 404},
		{"/external-directory/index.html", 404}, {"/linked-index/", 404},
		{"/loop", 404}, {"/safe-alias.txt", 200},
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", tc.target, nil))
		if w.Code != tc.status || strings.Contains(w.Body.String(), "private data") {
			t.Fatalf("%s: %d %s", tc.target, w.Code, w.Body.String())
		}
	}
}

func TestDesktopAssetsFailClosedWhenRootIsUnavailable(t *testing.T) {
	root := filepath.Join(t.TempDir(), "missing-root")
	w := httptest.NewRecorder()
	desktopAssets(root).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 {
		t.Fatalf("status %d", w.Code)
	}
}

type desktopRoundTrip func(*http.Request) (*http.Response, error)

func (f desktopRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDesktopSharingProxyIsBoundedAndNeverForwardsLocalSecrets(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: desktopRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != desktopSharingOrigin+"/api/v1/community/analytics" {
			t.Fatalf("unexpected target %s", r.URL)
		}
		if r.Header.Get("Authorization") != "Bearer hosted-session" {
			t.Fatal("missing explicit hosted session")
		}
		for _, h := range []string{"X-Desktop-Token", "X-Mockinterview-Key", "Cookie", "Origin"} {
			if r.Header.Get(h) != "" {
				t.Fatalf("leaked %s", h)
			}
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"ok":true}`))}, nil
	})}
	h := desktopRemoteProxyClient(client)
	for _, p := range []string{"/desktop/remote/api/v1/sessions", "/desktop/remote/api/v1/providers/validate", "/desktop/remote/https://example.com", "/desktop/remote/api/v1/community/analytics?target=evil"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", p, strings.NewReader("{}")))
		if w.Code != 404 {
			t.Fatalf("proxy permitted %s", p)
		}
	}
	r := httptest.NewRequest("POST", "/desktop/remote/api/v1/community/analytics", strings.NewReader("{}"))
	r.Header.Set("Authorization", "Bearer hosted-session")
	r.Header.Set("X-Desktop-Token", "local-secret")
	r.Header.Set("X-Mockinterview-Key", "personal-secret")
	r.Header.Set("Cookie", "local-cookie")
	r.Header.Set("Origin", "http://127.0.0.1:12345")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || calls != 1 {
		t.Fatalf("sharing %d calls %d", w.Code, calls)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/desktop/remote/api/v1/community/analytics", strings.NewReader(strings.Repeat("x", 128*1024+1))))
	if w.Code != 413 || calls != 1 {
		t.Fatal("oversized upload forwarded")
	}
}
