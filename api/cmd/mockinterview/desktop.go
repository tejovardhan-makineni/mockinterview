package main

import (
	"bytes"
	"crypto/subtle"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// The loopback listener is not a trust boundary by itself. Every request,
// including WebSocket handshakes and static assets, must come through the
// Electron session's exact-origin, per-launch secret injection.
func desktopBridge(secret, host string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://"+host+"; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
			origin := r.Header.Get("Origin")
			if r.Host != host || (origin != "" && origin != "http://"+host) || len(secret) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Desktop-Token")), []byte(secret)) != 1 {
				http.Error(w, "Desktop session required", http.StatusForbidden)
				return
			}
			r.Header.Del("X-Desktop-Token")
			next.ServeHTTP(w, r)
		})
	}
}

const desktopSharingOrigin = "https://mockinterview-api-661893776515.us-west1.run.app"

// Only consented project sharing and hosted-account authentication are proxied.
// No hosted interview/provider routes exist here. A fixed destination and fresh
// header set avoid SSRF and leaking the local session or personal provider key.
func desktopRemoteProxy() http.Handler {
	return desktopRemoteProxyClient(&http.Client{Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }})
}

func desktopRemoteProxyClient(client *http.Client) http.Handler {
	allowed := map[string]bool{
		"POST /api/v1/auth/login":            true,
		"GET /api/v1/auth/me":                true,
		"GET /api/v1/legal-policy":           true,
		"POST /api/v1/auth/logout":           true,
		"POST /api/v1/community/analytics":   true,
		"DELETE /api/v1/community/analytics": true,
		"POST /api/v1/community/templates":   true,
		"POST /api/v1/feedback":              true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/desktop/remote")
		if r.URL.RawQuery != "" || !allowed[r.Method+" "+p] {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 128*1024))
		if err != nil {
			http.Error(w, "Sharing request too large", http.StatusRequestEntityTooLarge)
			return
		}
		upstream, err := http.NewRequestWithContext(r.Context(), r.Method, desktopSharingOrigin+p, bytes.NewReader(body))
		if err != nil {
			http.Error(w, "Sharing unavailable", http.StatusBadGateway)
			return
		}
		upstream.Header.Set("Content-Type", "application/json")
		upstream.Header.Set("Authorization", r.Header.Get("Authorization"))
		response, err := client.Do(upstream)
		if err != nil {
			http.Error(w, "Sharing unavailable; your local data is saved", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
		if err != nil || len(data) > 2*1024*1024 || response.StatusCode >= 300 && response.StatusCode < 400 {
			http.Error(w, "Sharing unavailable", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(data)
	})
}

func desktopAssets(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := path.Clean("/" + r.URL.Path)
		// Unknown API paths must never turn into an HTML page.
		if strings.HasPrefix(name, "/api/") || strings.ContainsRune(name, '\\') {
			http.NotFound(w, r)
			return
		}
		// Root confines resolution even when a packaged directory contains a
		// symlink. Never pass a request-derived path to unrestricted file I/O.
		files, err := os.OpenRoot(root)
		if err != nil {
			http.Error(w, "Desktop assets unavailable", http.StatusServiceUnavailable)
			return
		}
		defer files.Close()
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			name = "."
		}
		info, err := files.Stat(name)
		if err == nil && info.IsDir() {
			name = path.Join(name, "index.html")
			info, err = files.Stat(name)
		}
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		file, err := files.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
}
