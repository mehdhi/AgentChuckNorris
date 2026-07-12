# Story 1-1: Add --version flag

## Story

As a CLI user, I want a `--version` flag so that I can check which version is installed.

## Acceptance Criteria

1. Running `cli --version` prints the version from package.json
2. Exit code is 0
3. No other output is printed

## Tasks

- [ ] Parse the flag
- [ ] Print version
