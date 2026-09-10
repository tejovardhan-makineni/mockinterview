.PHONY: help install up down dev api web build test lint fmt tidy validate-content preview-format new-scenario new-format local-stack check-llm
ID ?= work-sample-reservation-review

help:
	@echo "make install: install Go and web dependencies"
	@echo "make up / down: start or stop local services (preserves database)"
	@echo "make dev: run API and web; make local-stack: run both in Docker"
	@echo "make test / lint / build / validate-content: local checks"
	@echo "make new-scenario ID=my-scenario / new-format ID=my-format: draft content"
	@echo "make preview-format ID=work-sample-reservation-review: private author preview"

install:
	cd api && go mod download
	cd web && npm ci --no-audit --no-fund

up:
	docker compose up -d --wait postgres

down:
	docker compose --profile app down

api:
	cd api && go run ./cmd/mockinterview

web:
	cd web && npm run dev

dev:
	@bash scripts/dev.sh

local-stack:
	docker compose --profile app up -d --build --wait

build:
	cd api && go build -o bin/mockinterview ./cmd/mockinterview
	cd web && npm run build

test:
	cd api && go test ./...
	cd web && npm test
	python3 scripts/test_content.py
	python3 scripts/test_deploy.py

lint:
	cd api && go vet ./...
	cd web && npm run lint

validate-content:
	cd api && go run ./cmd/mockinterview -validate-corpus data/corpus
	cd api && go test ./internal/corpus ./internal/pack ./internal/live ./internal/scoring
	python3 scripts/test_content.py

preview-format:
	cd api && go run ./cmd/previewformat -id "$(ID)"

new-scenario:
	python3 scripts/content.py new-scenario --id "$(ID)"

new-format:
	python3 scripts/content.py new-format --id "$(ID)"

# Explicitly makes billable calls to providers configured in .env; never run in CI.
check-llm:
	cd api && go run ./cmd/mockinterview -check-llm

fmt:
	cd api && gofmt -w internal cmd

tidy:
	cd api && go mod tidy
