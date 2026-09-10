package llm

import (
	"bytes"
	"testing"
)

func TestSessionCredentialIsolation(t *testing.T) {
	key := bytes.Repeat([]byte{4}, 32)
	sealed, e := SealKey(key, "alice", "attempt", "secret-provider-key")
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(sealed, []byte("secret-provider-key")) {
		t.Fatal("stored plaintext")
	}
	plain, e := OpenKey(key, "alice", "attempt", sealed)
	if e != nil || plain != "secret-provider-key" {
		t.Fatal("roundtrip failed")
	}
	for _, pair := range [][2]string{{"bob", "attempt"}, {"alice", "other"}} {
		if _, e = OpenKey(key, pair[0], pair[1], sealed); e == nil {
			t.Fatal("cross-user/attempt credential accepted")
		}
	}
	sealed[len(sealed)-1] ^= 1
	if _, e = OpenKey(key, "alice", "attempt", sealed); e == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}
func TestUsageIdentityAndProviderCapabilities(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 32)
	if UsageIdentity(key, "First.Last+practice@gmail.com") != UsageIdentity(key, "firstlast@googlemail.com") {
		t.Fatal("gmail aliases differ")
	}
	if UsageIdentity(key, "a+b@example.com") == UsageIdentity(key, "a@example.com") {
		t.Fatal("non-Gmail canonicalization unsafe")
	}
	if ValidateSelection("openai", "gpt-4o-mini", "voice") == nil {
		t.Fatal("unsupported voice accepted")
	}
	if ValidateSelection("gemini", "https://internal", "text") == nil {
		t.Fatal("URL model accepted")
	}
}
