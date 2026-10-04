package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopAIHasNoFreeOrStubFallback(t *testing.T) {
	c := DesktopClient{}
	if c.Stubbed() {
		t.Fatal("desktop advertised simulated AI")
	}
	if _, err := c.Generate(context.Background(), GenerateRequest{}); err == nil {
		t.Fatal("desktop accepted missing personal key")
	}
	r := httptest.NewRequest("POST", "/resume/review", nil)
	r.Header.Set("X-Mockinterview-Provider", "unsupported")
	r.Header.Set("X-Mockinterview-Key", "synthetic-invalid-key")
	DesktopCredentials(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		if _, err := c.Generate(r.Context(), GenerateRequest{}); err == nil {
			t.Fatal("unsupported personal provider accepted")
		}
	})).ServeHTTP(httptest.NewRecorder(), r)
}
