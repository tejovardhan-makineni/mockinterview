// Command admin is an operator-only local command, never an HTTP endpoint.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/store"
	"os"
	"time"
)

func main() {
	uid := flag.String("grant-admin-user", "", "verified account UUID to grant feedback administration")
	addTester := flag.String("add-tester", "", "email to grant unlimited tester access (registration may follow)")
	removeTester := flag.String("remove-tester", "", "email whose tester access should be removed")
	listTesters := flag.Bool("list-testers", false, "list tester emails as JSON")
	flag.Parse()
	actions := 0
	for _, value := range []string{*uid, *addTester, *removeTester} {
		if value != "" {
			actions++
		}
	}
	if *listTesters {
		actions++
	}
	if actions != 1 || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: admin -grant-admin-user UUID | -add-tester EMAIL | -remove-tester EMAIL | -list-testers")
		os.Exit(2)
	}
	for _, email := range []string{*addTester, *removeTester} {
		if email != "" {
			if _, err := store.NormalizeTesterEmail(email); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(2)
			}
		}
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
	if *listTesters {
		items, err := st.ListTesters(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, "could not load testers")
			os.Exit(1)
		}
		if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"testers": items}); err != nil {
			os.Exit(1)
		}
		return
	}
	if *addTester != "" {
		item, err := st.AddTester(ctx, *addTester)
		if err != nil {
			fmt.Fprintln(os.Stderr, "could not add tester")
			os.Exit(1)
		}
		if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"tester": item}); err != nil {
			os.Exit(1)
		}
		return
	}
	if *removeTester != "" {
		if err := st.RemoveTester(ctx, *removeTester); err != nil {
			fmt.Fprintln(os.Stderr, "could not remove tester")
			os.Exit(1)
		}
		fmt.Println("Tester access removed.")
		return
	}
	tag, err := st.Pool.Exec(ctx, `UPDATE users SET role='admin',token_version=token_version+1 WHERE id=$1 AND email_verified=true`, *uid)
	if err != nil || tag.RowsAffected() != 1 {
		fmt.Fprintln(os.Stderr, "no verified account matched; no role changed")
		os.Exit(1)
	}
	fmt.Println("Admin role stored; previous login sessions revoked. Sign in again.")
}
