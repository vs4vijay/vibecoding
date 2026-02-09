# Contributing to Syncthing Wrapped

Thank you for your interest in contributing to Syncthing Wrapped! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates.

When creating a bug report, include:
- **Device Information**: Make, model, Android version
- **App Version**: Found in app settings or build.gradle
- **Steps to Reproduce**: Clear, numbered steps
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Logs**: Include relevant logcat output
- **Screenshots**: If applicable

**Bug Report Template:**
```markdown
**Device:** Pixel 5, Android 13
**App Version:** 1.0.0
**Build Type:** Debug/Release

**Steps to Reproduce:**
1. Launch app
2. Navigate to...
3. Tap on...

**Expected:** The app should...
**Actual:** The app does...

**Logs:**
```
adb logcat output here
```

**Screenshots:**
[Attach screenshots if applicable]
```

### Suggesting Features

Feature requests are welcome! Please include:
- **Use Case**: Why is this feature needed?
- **Proposed Solution**: How should it work?
- **Alternatives**: Other solutions you've considered
- **Additional Context**: Any other relevant information

### Pull Requests

We love pull requests! Here's how to submit one:

#### 1. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/syncthing-wrapped.git
cd syncthing-wrapped
```

#### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions or modifications

#### 3. Set Up Development Environment

Follow the [BUILDING.md](BUILDING.md) guide to set up your development environment.

#### 4. Make Your Changes

- Write clean, readable code
- Follow existing code style and conventions
- Add comments for complex logic
- Update documentation if needed
- Add tests if applicable

#### 5. Test Your Changes

Before submitting, ensure:
- [ ] App builds successfully: `./gradlew assembleDebug`
- [ ] Lint passes: `./gradlew lint`
- [ ] Tests pass: `./gradlew test`
- [ ] Manual testing completed (see [TESTING.md](TESTING.md))
- [ ] No new warnings introduced

#### 6. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: Add support for custom Syncthing port

- Allow users to configure custom port in settings
- Update service to use configured port
- Add validation for port number
- Update documentation"
```

Commit message format:
```
<type>: <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test additions or changes
- `chore`: Build process or auxiliary tool changes

#### 7. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then:
1. Go to the repository on GitHub
2. Click "Compare & pull request"
3. Fill out the PR template
4. Submit the pull request

**Pull Request Template:**
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring
- [ ] Other (please describe)

## Testing
- [ ] Builds successfully
- [ ] Lint passes
- [ ] Tests pass
- [ ] Manually tested on device
- [ ] Tested on Android version(s): X.X

## Screenshots
[If applicable]

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-reviewed code
- [ ] Commented complex code sections
- [ ] Updated documentation
- [ ] Added tests for new features
- [ ] All tests pass
- [ ] No new warnings
```

## Development Guidelines

### Code Style

- **Java**: Follow [Google Java Style Guide](https://google.github.io/styleguide/javaguide.html)
- **Indentation**: 4 spaces (no tabs)
- **Line Length**: Maximum 120 characters
- **Naming**:
  - Classes: `PascalCase`
  - Methods/Variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`

### File Organization

```java
// 1. Package declaration
package com.syncthing.wrapped;

// 2. Imports (grouped and sorted)
import android.app.Service;
import android.content.Intent;
// ...

// 3. Class documentation
/**
 * Service that manages the Syncthing binary.
 */
public class SyncthingService extends Service {
    // 4. Constants
    private static final String TAG = "SyncthingService";
    
    // 5. Fields
    private Process syncthingProcess;
    
    // 6. Constructors
    
    // 7. Lifecycle methods
    @Override
    public void onCreate() {
        // ...
    }
    
    // 8. Public methods
    
    // 9. Private methods
    
    // 10. Inner classes
}
```

### Adding Dependencies

Before adding a new dependency:
1. Check if it's really needed
2. Verify it's actively maintained
3. Check for security vulnerabilities
4. Keep dependencies minimal

Update `app/build.gradle`:
```gradle
dependencies {
    implementation 'group:artifact:version'
}
```

### Resource Naming

Follow Android naming conventions:

- Layouts: `activity_main.xml`, `fragment_settings.xml`
- IDs: `@+id/button_submit`, `@+id/text_username`
- Strings: `<string name="app_name">`, `<string name="error_network">`
- Colors: `<color name="primary">`, `<color name="accent">`
- Dimensions: `<dimen name="padding_large">`, `<dimen name="text_size_normal">`

### Documentation

- Document all public classes and methods
- Use Javadoc format:
  ```java
  /**
   * Brief description of what this method does.
   *
   * @param param1 Description of param1
   * @return Description of return value
   * @throws Exception Description of when exception is thrown
   */
  public String exampleMethod(String param1) throws Exception {
      // Implementation
  }
  ```

### Testing

- Write unit tests for business logic
- Write instrumentation tests for UI
- Place tests in appropriate directories:
  - Unit tests: `app/src/test/java/`
  - Instrumentation tests: `app/src/androidTest/java/`

Example test:
```java
@Test
public void testBinaryExtraction() {
    // Arrange
    SyncthingService service = new SyncthingService();
    
    // Act
    File binary = service.extractSyncthingBinary();
    
    // Assert
    assertNotNull(binary);
    assertTrue(binary.exists());
}
```

## Project Structure

Understanding the project structure:

```
syncthing-wrapped/
├── .github/
│   └── workflows/          # CI/CD workflows
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/       # Java source code
│   │   │   ├── res/        # Android resources
│   │   │   └── assets/     # Syncthing binaries
│   │   ├── test/           # Unit tests
│   │   └── androidTest/    # Instrumentation tests
│   └── build.gradle        # App-level build config
├── scripts/                # Build and utility scripts
├── build.gradle            # Project-level build config
├── settings.gradle         # Project settings
└── *.md                    # Documentation
```

## Review Process

1. **Automated Checks**: GitHub Actions runs lint, tests, and build
2. **Code Review**: Maintainers review your code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, PR will be merged

## Getting Help

- **Documentation**: Check README, BUILDING.md, and TESTING.md
- **Issues**: Search existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions

## Recognition

Contributors will be:
- Listed in the project's contributors page
- Mentioned in release notes (for significant contributions)
- Given credit in commit messages

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE)).

## Questions?

Don't hesitate to ask! We're here to help. Open an issue or start a discussion if you have any questions.

Thank you for contributing! 🎉
