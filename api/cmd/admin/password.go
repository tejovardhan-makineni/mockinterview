package main

import (
	"errors"
	"golang.org/x/crypto/bcrypt"
	"os"
	"strings"
)

// Passwords never enter argv, logs, source code, or stdout. A caller must first
// provision and verify the owner account; this helper grants no identity rights.
func ownerPasswordHash(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", errors.New("could not read owner password file")
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("owner password file must be a regular file readable only by its owner (chmod 600)")
	}
	if info.Size() > 74 {
		return "", errors.New("owner password must contain 16–72 bytes")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", errors.New("could not read owner password file")
	}
	password := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
	if len(password) < 16 || len(password) > 72 || strings.ContainsAny(password, "\r\n\x00") {
		return "", errors.New("owner password must contain 16–72 bytes on one line")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", errors.New("could not secure owner password")
	}
	return string(hash), nil
}
