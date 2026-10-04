package main

import (
	"golang.org/x/crypto/bcrypt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOwnerPasswordFilePrivacy(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "owner-password")
	secret := "test-only-owner-secret-012345"
	if err := os.WriteFile(path, []byte(secret+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	hash, err := ownerPasswordHash(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = bcrypt.CompareHashAndPassword([]byte(hash), []byte(secret)); err != nil {
		t.Fatal("password not correctly hashed")
	}
	if err = os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = ownerPasswordHash(path); err == nil {
		t.Fatal("public password file accepted")
	}
	if err = os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"weak", strings.Repeat("a", 73), secret + "\nsecond line"} {
		if err = os.WriteFile(path, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = ownerPasswordHash(path); err == nil {
			t.Fatal("invalid password accepted")
		}
	}
	link := filepath.Join(dir, "link")
	if err = os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err = ownerPasswordHash(link); err == nil {
		t.Fatal("symlink password file accepted")
	}
}
