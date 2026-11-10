import type {Express} from 'express';

/**
 * Starts an Express app on an ephemeral port for integration tests.
 *
 * @return The base URL to hit, and a close() to shut the server down.
 */
export function listen(app: Express): Promise<{url: string, close: () => Promise<void>}> {
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}
