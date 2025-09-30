# AI IDE Rules Template

Copy this file to `.cursorrules` (Cursor) or other AI IDE configuration files.
Customize the "Project Context" section for each project.

---

## Project Context

[REPLACE: Describe your project - what it does, key technologies, architecture]

Example: This is a TypeScript REST API that does X using Y and Z technologies.

---

## Code Style & Standards

### 1. General Principles

- Use **tabs** for indentation
- Follow **DRY (Don't Repeat Yourself)** and **SOLID** principles
- Prefer **functions over direct execution** of code
- Prefer **functional programming** over imperative programming
- Use **strict mode** (`"use strict";`)
- Use **descriptive and meaningful names** for variables, functions, classes, methods, and objects

### 2. TypeScript Best Practices

- Use **explicit return types** for functions
- Scope types **as close to usage as possible**
- Prefer **interfaces over types** when possible
- Use **readonly** where applicable
- Use **type composition** when needed
- Enable **strict mode** in `tsconfig.json`
- Use **PascalCase** for type definitions
- Place **shared types in the closest parent directory**

### 3. Imports & Modules

- Use **ESModules (`import/export`)** over CommonJS
- Use **destructuring** where applicable
- Alphabetize imports (where appropriate)

### 4. Async Patterns

- Prefer **async/await** over `.then()`
- Use **template literals** instead of string concatenation

### 5. Variables and Constants

- Use **camelCase** for variables and functions
- Use **UPPER_CASE** for constants
- Use `let` and `const` instead of `var`
- **Break down** complex mathematical operations into named constants
- Avoid **mental mapping**—use clear variable names

### 6. Functions

- Use **ES6 arrow function syntax**
- Minimize **function arguments**; use **options objects** for many parameters
- Follow the **Single Responsibility Principle**
- Use **semantic function names** that clearly describe their purpose
- Avoid **boolean flags as function parameters**
- Split **conditional logic into separate functions**

### 7. Objects and Data Structures

- Use **getters and setters** where applicable
- Use **object destructuring** when useful
- Use **spread/rest operators** appropriately
- **Alphabetize** object properties (where appropriate)

### 8. Comments

- **Only comment business logic**; code should be self-explanatory
- Use **JSDoc for documenting functions and classes**
- **Remove commented-out code** instead of leaving it in the codebase

### 9. Error Handling

- No **linter warnings or errors**
- No **compilation warnings or errors**
- No **console warnings or errors**
- No **extraneous console logs** in production

### 10. React (if applicable)

- **Prefer function components** over class components
- Use **React hooks** (`useState`, `useEffect`, `useMemo`, etc.)
- Extract logic into **custom hooks** when reusable
- Use **React Context** for global state
- Always provide **unique `key` props** for list items
- **Avoid using array indices as keys**
- Use **useMemo** for expensive calculations
- Wrap callbacks with **useCallback**

### 11. Styling (if applicable)

- Use `oklch()` for color management
- Alphabetize CSS properties
- Prefer CSS Modules or styled-components
- Use semantic HTML

### 12. Accessibility (if applicable)

- Use **semantic HTML** (`<button>`, `<nav>`, `<header>`)
- Ensure **keyboard navigation** is supported
- Use **ARIA attributes** when necessary
- Maintain **high contrast ratios** (4.5:1 for text)
- Support **prefers-reduced-motion**

---

## Project-Specific Guidelines

[REPLACE: Add project-specific rules, patterns, and conventions]

Example:

- Database: Use Prisma ORM with PostgreSQL
- API: RESTful endpoints with Zod validation
- Auth: JWT tokens with refresh token rotation
- Testing: Jest for unit tests, Playwright for E2E

---

## What NOT to Do

- Don't use `var`
- Don't leave commented-out code
- Don't use array indices as React keys (if React)
- Don't nest CSS classes excessively
- Don't hardcode sensitive values (use environment variables)
- Don't ignore TypeScript errors
- Don't skip error handling
