// Command admin is an operator-only local command, never an HTTP endpoint.
package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/store"
	"os"
	"time"
)

func main() {
	uid := flag.String("grant-admin-user", "", "verified account UUID to grant feedback administration")
	flag.Parse()
	if *uid == "" {
		fmt.Fprintln(os.Stderr, "usage: admin -grant-admin-user VERIFIED_USER_UUID")
		os.Exit(2)
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "configuration is invalid")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	st, err := store.Open(ctx, cfg.DatabaseURL, 1)
	if err != nil {
		fmt.Fprintln(os.Stderr, "database unavailable")
		os.Exit(1)
	}
	defer st.Close()
	tag, err := st.Pool.Exec(ctx, `UPDATE users SET role='admin',token_version=token_version+1 WHERE id=$1 AND email_verified=true`, *uid)
	if err != nil || tag.RowsAffected() != 1 {
		fmt.Fprintln(os.Stderr, "no verified account matched; no role changed")
		os.Exit(1)
	}
	fmt.Println("Admin role stored; previous login sessions revoked. Sign in again.")
}
