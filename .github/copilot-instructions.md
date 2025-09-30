# GitHub Copilot Instructions

## Project: OmniCal

A TypeScript calendar aggregation API syncing Google Calendar and ICS feeds.

## Code Style

### TypeScript

- Use explicit return types
- Prefer interfaces over types
- Use strict mode
- PascalCase for types, camelCase for variables

### Formatting

- **Tabs** for indentation (not spaces)
- Use ESModules (`import/export`)
- Prefer async/await over promises
- Alphabetize object properties and imports

### Naming

- camelCase: variables, functions
- PascalCase: types, interfaces, classes
- UPPER_CASE: constants

### Best Practices

- DRY and SOLID principles
- Functions should be pure when possible
- Minimize function arguments
- Self-documenting code (minimal comments)
- JSDoc for public APIs

## Project-Specific

### Database

- Use better-sqlite3 (synchronous)
- snake_case for columns
- camelCase for TypeScript properties

### API

- Validate with Zod schemas
- camelCase for JSON keys
- Proper HTTP status codes
- X-API-Key header authentication

### Error Handling

- No console.log in production
- Proper error types
- Meaningful error messages

### Security

- Never hardcode secrets
- Use environment variables
- Encrypt OAuth tokens
