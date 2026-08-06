.PHONY: help up down dev api web build test seed lint fmt tidy

help:
	@echo "mockinterview — targets:"
	@echo "  make up      start Postgres (docker compose)"
	@echo "  make down    stop Postgres"
	@echo "  make dev     run API + web together (needs 'make up' first)"
	@echo "  make api     run the Go API only"
	@echo "  make web     run the Next.js web only"
	@echo "  make seed    seed a demo user (corpus is embedded/loaded automatically)"
	@echo "  make build   build API binary + web static export"
	@echo "  make test    go test ./... + web build check"

up:
	docker compose up -d
	@echo "waiting for postgres..." && sleep 2

down:
	docker compose down

api:
	cd api && go run ./cmd/mockinterview

web:
	cd web && npm run dev

# Run API and web concurrently; Ctrl-C stops both.
dev:
	@bash -c '\
	  ( cd api && go run ./cmd/mockinterview ) & API_PID=$$!; \
	  ( cd web && npm run dev ) & WEB_PID=$$!; \
	  trap "kill $$API_PID $$WEB_PID 2>/dev/null" INT TERM; \
	  wait'

seed:
	cd api && go run ./cmd/mockinterview -seed

# Verify every LLM provider whose key is in .env with a tiny real call.
check-llm:
	cd api && go run ./cmd/mockinterview -check-llm

build:
	cd api && go build -o bin/mockinterview ./cmd/mockinterview
	cd web && npm run build

test:
	cd api && go build ./... && go test ./...

lint:
	cd api && go vet ./...
	cd web && npm run lint

fmt:
	cd api && gofmt -w .

tidy:
	cd api && go mod tidy
