package main

import (
	"github.com/tejo/mockinterview-api/internal/store"
	"testing"
)

func TestCommunityRoutesRequireAuthenticatedOwner(t *testing.T) {
	srv := testServer(t, []string{store.OwnerEmail}, 1)
	c := &client{t: t, base: srv.URL}
	paths := []struct{ method, path string }{
		{"GET", "/community/beta"}, {"POST", "/community/beta"}, {"POST", "/community/templates"},
		{"POST", "/community/analytics"}, {"DELETE", "/community/analytics"}, {"GET", "/admin/community"},
		{"PATCH", "/admin/community/beta/not-an-id"}, {"PATCH", "/admin/community/templates/not-an-id"},
	}
	for _, route := range paths {
		if res, body := c.do(route.method, "/api/v1"+route.path, map[string]any{}); res.StatusCode != 401 {
			t.Fatalf("unauthenticated %s %s: %d %s", route.method, route.path, res.StatusCode, body)
		}
	}
	c.register(store.OwnerEmail, "test-owner-password-123")
	for _, route := range paths[5:] {
		if res, body := c.do(route.method, "/api/v1"+route.path, map[string]any{}); res.StatusCode != 403 {
			t.Fatalf("email-only privilege %s %s: %d %s", route.method, route.path, res.StatusCode, body)
		}
	}
	if res, body := c.do("GET", "/api/v1/community/beta", nil); res.StatusCode != 200 {
		t.Fatalf("own beta status: %d %s", res.StatusCode, body)
	}
}
