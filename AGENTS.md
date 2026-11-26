# AGENTS.md

Welcome to NexusWMS! This file contains guidelines and configurations for AI agents working in this repository.

## Architecture Overview

- **Backend (`/backend`)**: NestJS application implementing DDD / OOP domain entities and repository interfaces (`backend/src/domain/`).
- **Frontend (`/frontend`)**: React + Vite application with strongly-typed ViewModels and API services (`frontend/src/`).
- **Shared Contracts (`/shared`)**: Shared TypeScript interfaces and DTOs (`shared/wms.contracts.ts`).

## Agent skills

### Issue tracker

GitHub issues tracked via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`GLOSSARY.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.
