import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrolling; tests spy on this no-op when they need it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
