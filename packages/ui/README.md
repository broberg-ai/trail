# @trail/ui

Preact UI primitives shared across Trail's front-ends.

**Behaviour is shared; styling is not.** Each component documents a DOM contract
(class names, `data-` attributes) and each consuming app writes the CSS in its
own palette. That is deliberate: the onboarding app is light/dark themed off
`html[data-theme]`, the Web Clipper popup is always dark and ships inside a
browser extension. One stylesheet could not serve both without one of them
inheriting tokens it does not have.

What must never be duplicated is the part that is hard and easy to get subtly
wrong: keyboard navigation, ARIA roles, focus handling, click-outside.

## Components

- **`BauhausSelect`** — replaces the native `<select>`, which is banned across
  these repos: it cannot be styled, ignores the design system, breaks dark mode,
  and renders as a macOS system control that matches no brand.
