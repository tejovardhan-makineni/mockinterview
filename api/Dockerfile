# Multi-stage build for the single mockinterview API binary. Built on Cloud Build
# (never local Docker), matching the house convention.
FROM golang:1.26.8-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Corpus JSON + migrations are embedded / read from the image; copy the whole tree.
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/mockinterview ./cmd/mockinterview

FROM alpine:3.24.1
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/mockinterview /app/mockinterview
# Ship the corpus (read at startup from CORPUS_DIR, default data/corpus).
COPY --from=build /src/data /app/data
USER app
ENV PORT=8080 CORPUS_DIR=/app/data/corpus
EXPOSE 8080
ENTRYPOINT ["/app/mockinterview"]
