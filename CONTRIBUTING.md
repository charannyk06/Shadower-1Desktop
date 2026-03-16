# Contributing to Shadower

## Commit Message Format

This project follows a simplified conventional commits format:

```
type: description
```

### Types

- `feat` - New features or capabilities
- `fix` - Bug fixes
- `refactor` - Code changes that neither fix bugs nor add features
- `perf` - Performance improvements
- `remove` - Removal of code, features, or dependencies
- `docs` - Documentation only changes
- `test` - Adding or updating tests
- `chore` - Maintenance tasks, dependency updates

### Guidelines

1. **No scope in parentheses** - Use `feat: add user auth` not `feat(auth): add user auth`
2. **Lowercase description** - Start with lowercase, no period at end
3. **Imperative mood** - Write as a command: "add feature" not "added feature"
4. **Keep it concise** - First line should be under 72 characters
5. **Multi-line for details** - Add blank line then description for complex changes

### Examples

```
feat: add vector store cache management
fix: resolve race condition in thread creation
refactor: simplify theater panel to file explorer
perf: use Set for O(1) file extension lookup
remove: browser session state from theater mode
```

### Bad Examples

```
feat(ui): Add new button        # No scope, no capital
Fixed the bug                   # Wrong tense, no type
feat: Add feature.              # No capital, no period
```

## Code Style

- TypeScript with strict mode
- React functional components with hooks
- Tailwind CSS for styling
- Use `cn()` utility for conditional classes
