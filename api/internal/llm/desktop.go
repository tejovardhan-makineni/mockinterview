package llm

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

type desktopCredentialsKey struct{}

// DesktopCredentials attaches transient personal credentials to the request,
// never to global state or a log. Only the desktop router installs this middleware.
func DesktopCredentials(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := Settings{Provider: Provider(r.Header.Get("X-Mockinterview-Provider")), Model: r.Header.Get("X-Mockinterview-Model"), APIKey: r.Header.Get("X-Mockinterview-Key")}
		r = r.WithContext(context.WithValue(r.Context(), desktopCredentialsKey{}, s))
		next.ServeHTTP(w, r)
	})
}

func DesktopPersonalSettings(ctx context.Context) (Settings, bool) {
	s, ok := ctx.Value(desktopCredentialsKey{}).(Settings)
	return s, ok
}

// DesktopClient serves auxiliary AI features with the user's current key.
// Session interviews/scoring already use their own encrypted BYOK credentials.
// Missing credentials fail closed; desktop never uses the deterministic demo.
type DesktopClient struct{}

func (DesktopClient) Generate(ctx context.Context, req GenerateRequest) (string, error) {
	s, ok := DesktopPersonalSettings(ctx)
	if !ok || len(strings.TrimSpace(s.APIKey)) < 8 || len(s.APIKey) > 4096 {
		return "", errors.New("validate your personal AI key in interview setup before using AI features")
	}
	if err := ValidateSelection(string(s.Provider), s.Model, "text"); err != nil {
		return "", err
	}
	c, err := New(ctx, s)
	if err != nil {
		return "", errors.New("could not configure your personal AI provider")
	}
	req.Model = c.Info().Model
	result, err := c.Generate(ctx, req)
	if err != nil {
		return "", errors.New("your AI provider could not complete the request; check your key, model access and connection")
	}
	return result, nil
}
func (DesktopClient) Stubbed() bool { return false }
func (DesktopClient) Info() Info    { return Info{Provider: "personal", Model: "user-selected"} }
