# Site review — October 11, 2026

Reviewed the page templates, shared JavaScript/CSS, server routes, account/social authentication, revision management, backups, storage, and existing regression coverage. Browser checks used an isolated local copy with sample accounts and email delivery disabled. Real account data was not changed.

## Improvements completed

- Distinct browser-tab titles for each page, with consistent asset versions.
- Visible keyboard focus and current-page navigation labels. Skip-to-content links were removed at the owner's request.
- The backup restore file picker uses the same themed button treatment as the project logo picker.
- Arrow/Home/End navigation for tab controls. Mobile menus close on outside clicks or breakpoint changes; Escape returns focus to the menu button.
- Required feedback fields and contact length limits that match server storage limits.
- Revision descriptions start empty with a useful placeholder, so the required field prevents spending a credit on an untouched template.
- Private API responses explicitly prohibit caching.
- Background workspace responses cannot overwrite a freshly adjusted revision balance or content for a different signed-in account.
- API requests have a 20-second timeout, allowing stalled controls to recover.
- Failed sign-out reports that the session is still signed in instead of presenting a false success.
- Connection/portfolio errors use wording suitable for the live website.
- Completed scroll reveals release their transform rather than retaining an unnecessary composited layer.

## Verification

- All seven main pages checked at 320px: no horizontal overflow or broken images.
- Desktop portal/contact layout checked at 1280px; mobile layout also checked at 390px.
- Tested estimate-to-contact transfer, keyboard tabs/menu dismissal, revision form validation, owner sign-in, owner revision addition/subtraction, and sign-out.
- `npm test`: seven regression/integration tests plus site smoke checks pass, including private API caching, failed sign-out, stale workspace responses, revisions, database persistence, authentication, recovery, backup/restore, newsletter controls, and local assets.
- `npm audit --omit=dev`: zero reported production vulnerabilities.

## Useful next improvements

1. **Revision history:** record who added/subtracted each credit, when it happened, and an optional reason. The current balance works; a history would make billing/support questions easier to resolve.
2. **Real project case studies:** add finished work with screenshots, the client's problem, what changed, and approved testimonials. Avoid invented results or example projects presented as real work.
3. **Request attachments:** allow clients to include screenshots of requested changes, with file limits and private storage. This would make revision requests clearer.

Production deployment, real OAuth callbacks, email delivery, and real-user performance metrics were not exercised in this local review. The changes are in the workspace and have not been published by this review.
