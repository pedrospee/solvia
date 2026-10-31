# Solvia

A personal finance management application built around a real personal need: organizing, planning and understanding finances across multiple accounts, currencies, debts, goals and future obligations.

This project is also a personal experiment in **vibecoding** and AI-assisted software development: how far can a useful, maintainable application go when human-defined requirements, business rules and architectural decisions are combined with AI-assisted implementation?

## About the author and the use of AI

I am a junior developer, and this project is also how I am learning. Most of the processes used here are new to me: layered architecture, double-entry modelling, test-first financial rules, strict TypeScript, linting, Git hooks and secret scanning.

This is how the work is divided:

| I do                                                     | AI (Claude Code) does                        |
| -------------------------------------------------------- | -------------------------------------------- |
| Define the requirements and the financial rules          | Propose architecture options and trade-offs  |
| Make every architectural decision                        | Write most of the implementation and tests   |
| Review, run and validate every phase before approving it | Explain the code and the reasoning behind it |
| Decide what is built next and what is left out           | Flag ambiguities, risks and inconsistencies  |

The AI is a development tool and a tutor. It is not the source of truth for financial decisions or requirements. Every phase is reviewed and approved by me before the next one starts.

## Why this project exists

Spreadsheets become hard to maintain as financial complexity grows. I wanted a single system that answers:
- What do I currently have?
- What do I owe?
- What is coming next?
- How much can I actually spend?
- How are my debts progressing?
- Am I on track toward my financial goals?
- How does my financial position change across EUR and BRL?

## Development approach

- **Human-defined requirements and financial rules**, written down before any code
- **AI-assisted implementation**, reviewed and validated by me
- **Small phases**, each approved before the next one starts
- **Automated tests** for every important financial rule
- **Simple, maintainable architecture**: a pure TypeScript financial core, independent of database and UI
- **No real personal financial data** in the repository

## Project status

Early development. The financial core and the backend (SQLite persistence, HTTP API, backup, restore and export) exist; Phase 2B is complete (see [architecture.md](docs/architecture.md#phase-2b-slices)). The user interface is being built in Phase 2C ([ADR-0005](docs/adr/0005-minimal-frontend.md)): accounts (with their balances) and categories can already be managed from it.

| Phase | Scope                                                                                                                      | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0     | Foundation: TypeScript, Vitest, Biome, Git hooks, documentation                                                            | ✅ Done |
| 1     | Financial core: money, exchange rates, double-entry ledger                                                                 | ✅ Done |
| 2A    | Monorepo (npm workspaces), CI, Dependabot                                                                                  | ✅ Done |
| 2B    | Backend: SQLite persistence, HTTP API, accounts, categories, manual exchange rates, transactions, backup                   | ✅ Done |
| 2C    | Minimal UI (React + Vite)                                                                                                  | Next    |
| 3–12  | Debts, credit cards, planning, payoff simulator, goals, analytics, dashboard, investments, integrations, advanced security | Planned |

The full roadmap and rules are in [docs/](docs/).

## Documentation

| Document                                      | Contents                                                    |
| --------------------------------------------- | ----------------------------------------------------------- |
| [architecture.md](docs/architecture.md)       | Layers, ledger model, structure, stack, roadmap             |
| [business-rules.md](docs/business-rules.md)   | Every approved financial rule and its implementation status |
| [financial-model.md](docs/financial-model.md) | Entities, postings, formulas                                |
| [security.md](docs/security.md)               | Data protection and secret handling                         |
| [development.md](docs/development.md)         | Setup, scripts, workspaces, conventions                     |
| [adr/](docs/adr/)                             | Architecture decision records                               |

## Getting started

Requires Node.js 24 LTS and [Gitleaks](https://github.com/gitleaks/gitleaks).

```sh
npm install
npm run check        # typecheck + lint + tests, every workspace
cp .env.example .env # set DATABASE_PATH and BACKUP_DIR (outside the repository)
npm run db:migrate   # create or update the database
npm run db:backup    # a verified backup; see docs/development.md for restore and export
npm run dev          # API on http://127.0.0.1:3000 and UI on http://127.0.0.1:5173
```

## Repository structure

An npm workspaces monorepo ([ADR-0001](docs/adr/0001-monorepo-with-npm-workspaces.md)):

```text
packages/core        @solvia/core        pure financial core: money, exchange rates, ledger
packages/contracts   @solvia/contracts   Zod schemas of the API's JSON
backend              @solvia/backend     HTTP API (Hono) and SQLite persistence (Drizzle)
frontend             @solvia/frontend    React UI (Vite), in progress (Phase 2C)
docs            requirements, rules, architecture and decision records
```

## Tech stack

| In use                                                                                                                                                              | Planned |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Node.js 24, TypeScript (strict), npm workspaces, Zod, Vitest, Biome, Gitleaks, GitHub Actions, SQLite, Drizzle ORM, Hono, React, Vite, TanStack Query, React Router | —       |

## Important note

This is a **personal project and an experiment**, not a financial product or a professional financial advice tool. Every estimate it produces is based only on the data entered into it.

Real financial data must never be committed to this repository.

## License

This project is currently intended as a personal development project. No license is granted for reuse at this stage.
