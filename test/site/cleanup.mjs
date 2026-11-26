// Cleanup for the browser tests' after() hooks. On CI a Chromium close has hung for hours
// after a file's last test passed (2026-11-25, a push run of test.yml), which kept the test
// file's process alive and the "Charter site" check running until it was cancelled. These
// never wait forever: the browser gets a fixed time to close, and the server drops its open
// connections before it stops. npm run test:site also passes --test-force-exit, and the CI
// job has a timeout, so a hang anywhere else still ends.

/** Close a Playwright browser, giving up after `ms` milliseconds. */
export async function closeBrowser(browser, ms = 15000) {
  if (!browser) return;
  let timer;
  const gaveUp = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.error(`cleanup: the browser did not close within ${ms} ms; moving on`);
      resolve();
    }, ms);
  });
  try {
    await Promise.race([browser.close().catch(() => {}), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stop an http.Server now: drop its keep-alive connections, then close it. */
export function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  server.close();
}
