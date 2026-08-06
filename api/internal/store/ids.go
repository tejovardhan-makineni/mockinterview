package store

import "github.com/google/uuid"

// NewID returns a time-ordered UUIDv7, used for all primary keys so rows sort
// roughly by creation time and index well.
func NewID() string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}
