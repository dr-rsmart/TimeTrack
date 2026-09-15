# Migration 15: rotating native refresh tokens

Adds one-time rotating refresh-token records for the native shell. Access
tokens are short-lived; refresh tokens are hashed at rest and revoked on use.
