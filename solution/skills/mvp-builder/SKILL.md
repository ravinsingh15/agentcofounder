---
name: mvp-builder
description: Turn a non-technical product idea into a small, tested browser application while recording assumptions.
---

# MVP Builder

1. Extract the entity, its attributes, every journey in the public journey contract, and any ambiguity.
2. Treat journey coverage as fixed. Choose the smallest data model and interface only after mapping how every journey will work.
3. Prefer browser-local persistence unless the idea genuinely requires a backend.
4. Implement accessible controls, validation, empty states, errors, and responsive layout.
5. Test observable user behaviour across the public journey contract with the included Vitest, jsdom, and Testing Library setup.
6. Run the tests and production build before reporting success.
7. Write `report.partial.json` with this exact shape:

```json
{
  "status": "success",
  "app_url": "http://localhost:3000",
  "start_command": "npm run dev",
  "summary": "Short description of the application",
  "implemented_features": ["Feature"],
  "assumptions": ["Ambiguity and the decision made"],
  "tests_run": [
    {
      "command": "npm test",
      "journey": "User-visible behaviour that was verified",
      "result": "passed"
    }
  ]
}
```

Use `partial` when useful functionality remains incomplete and `failed` when the app cannot run. Never invent a passing test.
Use only `passed` or `failed` for each test result. Record an unrun check as `failed` and explain why in its journey.
