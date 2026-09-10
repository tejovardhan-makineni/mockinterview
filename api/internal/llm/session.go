package llm

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
)

// Session keys never enter the normal session/config JSON. The associated data
// binds encrypted bytes to one authenticated owner and one attempt.
func SealKey(key []byte, uid, sid, plain string) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("personal keys are not configured on this server")
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, []byte(plain), []byte(uid+":"+sid)), nil
}
func OpenKey(key []byte, uid, sid string, sealed []byte) (string, error) {
	if len(key) != 32 {
		return "", errors.New("personal keys unavailable")
	}
	b, e := aes.NewCipher(key)
	if e != nil {
		return "", e
	}
	g, e := cipher.NewGCM(b)
	if e != nil {
		return "", e
	}
	if len(sealed) < g.NonceSize() {
		return "", errors.New("invalid credential")
	}
	plain, e := g.Open(nil, sealed[:g.NonceSize()], sealed[g.NonceSize():], []byte(uid+":"+sid))
	if e != nil {
		return "", errors.New("invalid credential")
	}
	return string(plain), nil
}
func UsageIdentity(key []byte, email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	local, domain, ok := strings.Cut(email, "@")
	if ok && (domain == "gmail.com" || domain == "googlemail.com") {
		local, _, _ = strings.Cut(local, "+")
		email = strings.ReplaceAll(local, ".", "") + "@gmail.com"
	}
	h := hmac.New(sha256.New, key)
	h.Write([]byte("interview-usage-v1:" + email))
	return hex.EncodeToString(h.Sum(nil))
}

var modelName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$`)

func ValidateSelection(provider, model, mode string) error {
	switch provider {
	case "gemini", "openai", "anthropic", "deepseek", "xai":
	default:
		return errors.New("unsupported provider")
	}
	if mode != "voice" && mode != "text" {
		return errors.New("mode must be voice or text")
	}
	if mode == "voice" && provider != "gemini" {
		return errors.New("this provider supports text interviews; choose Gemini for native voice")
	}
	if model != "" && (!modelName.MatchString(model) || strings.Contains(model, "://")) {
		return errors.New("invalid model name")
	}
	return nil
}
func ValidatePersonalKey(ctx context.Context, provider, model, mode, key string) (Client, error) {
	if e := ValidateSelection(provider, model, mode); e != nil {
		return nil, e
	}
	if len(strings.TrimSpace(key)) < 8 || len(key) > 4096 {
		return nil, errors.New("enter a valid provider API key")
	}
	c, e := New(ctx, Settings{Provider: Provider(provider), Model: model, APIKey: key})
	if e != nil {
		return nil, errors.New("could not configure provider")
	}
	_, e = c.Generate(ctx, GenerateRequest{Purpose: PurposeGeneric, Messages: []Message{{Role: "user", Text: "Reply with OK."}}, MaxTokens: 32})
	if e != nil {
		return nil, errors.New("provider rejected the key or model; verify access and try again")
	}
	return c, nil
}
