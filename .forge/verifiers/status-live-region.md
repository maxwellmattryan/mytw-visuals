---
paths: [apps/**]
severity: minor
mode: warn
---
Does every element this change adds or edits to show changing status, progress or error text (such as "Rendering frame…", "Done." or an export error) carry `role="status"`, `role="alert"` or an `aria-live` attribute?

Screen readers announce text changes only inside a live region, so status text in a plain element is silent. The design review raised this for status `<pre>` elements in jobs 15 and 19. Answer YES when the change adds or edits no such element, or when the element already has one of these attributes.
