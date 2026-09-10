#!/usr/bin/env bash
# Source after the app's trusted deployment config. No credentials are printed.
configure_target() {
  : "${PROJECT_ID:?}" "${SERVICE:?}"
  TARGET_SERVICE=${TARGET_SERVICE:-$SERVICE}
  if [[ "$TARGET_SERVICE" == *-staging ]]; then
    SECRET_PREFIX=${SECRET_PREFIX:-mockinterview-staging}
    RUNTIME_ACCOUNT_ID=${RUNTIME_ACCOUNT_ID:-mockinterview-staging}
    MIN_INSTANCES=${MIN_INSTANCES:-0}
    [[ "$SECRET_PREFIX" == *staging && "$RUNTIME_ACCOUNT_ID" == *staging && "${DB_NAME:-}" == *staging && "${DB_USER:-}" == *staging ]] || {
      echo 'Staging requires separate staging-suffixed secret prefix, runtime account, database and database user.' >&2
      return 1
    }
  else
    SECRET_PREFIX=${SECRET_PREFIX:-mockinterview}
    RUNTIME_ACCOUNT_ID=${RUNTIME_ACCOUNT_ID:-mockinterview-runtime}
    MIN_INSTANCES=${MIN_INSTANCES:-1}
  fi
  RUNTIME_SA=${RUNTIME_SA:-${RUNTIME_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com}
  [[ "$RUNTIME_SA" == "${RUNTIME_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com" ]] || {
    echo 'RUNTIME_SA must match the app runtime account in the selected project.' >&2
    return 1
  }
  export TARGET_SERVICE SECRET_PREFIX RUNTIME_ACCOUNT_ID RUNTIME_SA MIN_INSTANCES
}
