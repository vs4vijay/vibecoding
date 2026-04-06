# Contributing to Cosmos DB TUI

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

1. **Fork and clone the repository**
```bash
git clone https://github.com/yourusername/cosmosdb-tui.git
cd cosmosdb-tui
```

2. **Install dependencies**
```bash
bun install
```

3. **Set up environment**
```bash
cp .env.example .env
# Edit .env with your Cosmos DB credentials
```

4. **Run and test**
```bash
bun start
```

## Project Structure

```
cosmosdb-tui/
├── src/
│   ├── index.ts              # Entry point
│   ├── cosmosService.ts      # Cosmos DB service layer
│   └── ui/
│       ├── app.ts            # Main TUI application
│       ├── theme.ts          # UI themes
│       ├── keyBindings.ts    # Keyboard shortcuts
│       └── queryHelper.ts    # SQL query utilities
├── dist/                     # Compiled output
├── docs/                     # Documentation
└── tests/                    # Tests (future)
```

## Code Style

- Use **TypeScript** for all new code
- Follow **ESLint** rules (when configured)
- Use **async/await** for asynchronous operations
- Add **JSDoc comments** for public APIs
- Keep functions **small and focused**
- Use **descriptive variable names**

## Making Changes

### Adding Features

1. **Create a feature branch**
```bash
git checkout -b feature/your-feature-name
```

2. **Implement your feature**
- Add new functionality in appropriate files
- Update types and interfaces
- Add error handling

3. **Test your changes**
- Run the application: `bun start`
- Test all affected functionality
- Try development mode: `bun dev`

4. **Update documentation**
- Update README.md if needed
- Add examples to EXAMPLES.md
- Update QUICKSTART.md for user-facing changes

5. **Commit and push**
```bash
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

### Fixing Bugs

1. **Create a bug fix branch**
```bash
git checkout -b fix/bug-description
```

2. **Fix the issue**
- Identify root cause
- Implement fix
- Add error handling if needed

3. **Test the fix**
- Verify bug is resolved
- Check for regressions
- Test edge cases

4. **Commit and push**
```bash
git commit -m "fix: describe the bug fix"
git push origin fix/bug-description
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

Examples:
```
feat: add query history feature
fix: resolve connection timeout issue
docs: update installation instructions
refactor: simplify document loading logic
```

## Pull Request Process

1. **Ensure your code runs**
```bash
bun start
```

2. **Update documentation**
- README.md for feature changes
- QUICKSTART.md for usage changes
- Add examples if applicable

3. **Create pull request**
- Provide clear description
- Reference related issues
- Include screenshots for UI changes

4. **Address review feedback**
- Make requested changes
- Respond to comments
- Update PR as needed

## Feature Ideas

Here are areas where contributions are welcome:

### High Priority
- [ ] Document editing with validation
- [ ] Export query results (JSON, CSV)
- [ ] Query history with persistence
- [ ] Multiple connection profiles
- [ ] Container statistics dashboard

### Medium Priority
- [ ] Stored procedure management
- [ ] Trigger management
- [ ] User-defined function (UDF) support
- [ ] Index policy viewer
- [ ] TTL configuration

### Nice to Have
- [ ] Change feed monitoring
- [ ] Performance metrics
- [ ] Theme customization
- [ ] Plugin system
- [ ] Keyboard shortcut customization

## Testing Guidelines

Currently, the project doesn't have automated tests, but manual testing is essential:

### Test Checklist
- [ ] Database CRUD operations
- [ ] Container CRUD operations
- [ ] Document CRUD operations
- [ ] SQL query execution
- [ ] Navigation between panels
- [ ] Keyboard shortcuts
- [ ] Error handling
- [ ] Edge cases (empty lists, long names, etc.)

### Future: Automated Tests
Contributions for test infrastructure are welcome:
- Unit tests with Jest
- Integration tests with test Cosmos DB
- End-to-end tests for TUI

## Documentation

Good documentation is crucial. When adding features:

1. **Update README.md**
   - Add to feature list
   - Update screenshots
   - Add to roadmap if applicable

2. **Update QUICKSTART.md**
   - Add usage instructions
   - Include examples
   - Update keyboard shortcuts

3. **Update EXAMPLES.md**
   - Add query examples
   - Show real-world use cases

4. **Add inline comments**
   - Document complex logic
   - Explain non-obvious decisions
   - Add JSDoc for public APIs

## Code Review

All submissions require review. We look for:

- **Functionality**: Does it work as intended?
- **Code quality**: Is it well-structured and readable?
- **Documentation**: Is it properly documented?
- **Testing**: Has it been manually tested?
- **Style**: Does it follow project conventions?

## Getting Help

- **Questions**: Open a GitHub issue with the "question" label
- **Bugs**: Open a GitHub issue with the "bug" label
- **Features**: Open a GitHub issue with the "enhancement" label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

Thank you for contributing! 🙏
