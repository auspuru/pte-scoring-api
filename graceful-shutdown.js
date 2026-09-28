'use strict';

// Keep this deadline below Railway's deploy.drainingSeconds (60 seconds).
function installGracefulShutdown(server, { cleanup, timeoutMs = 55_000, logger = console } = {}) {
  let stopping = false;
  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    logger.log(`${signal} — draining active HTTP requests`);

    // Also bounds stuck requests and resource cleanup. A repeated signal must
    // not interrupt an in-flight progress write or start cleanup twice.
    const deadline = setTimeout(() => {
      logger.error('Shutdown deadline exceeded; forcing exit');
      process.exit(1);
    }, timeoutMs);

    server.close(async error => {
      let exitCode = error ? 1 : 0;
      if (error) logger.error('HTTP shutdown failed:', error);
      try {
        // Browser/database resources remain usable until requests finish.
        if (cleanup) await cleanup();
      } catch (cleanupError) {
        exitCode = 1;
        logger.error('Shutdown cleanup failed:', cleanupError);
      }
      clearTimeout(deadline);
      logger.log('HTTP requests drained; shutdown complete');
      process.exit(exitCode);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return shutdown;
}

module.exports = { installGracefulShutdown };
