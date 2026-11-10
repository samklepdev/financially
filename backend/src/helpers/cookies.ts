/**
 * Parses a raw Cookie request header into a name -> value map.
 *
 * @param header The raw value of req.headers.cookie, if present.
 * @return A map of cookie names to decoded values. Empty if the header is missing.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
    if (!header) {
        return {};
    }

    const cookies: Record<string, string> = {};

    for (const pair of header.split(';')) {
        const [name, ...rest] = pair.trim().split('=');
        if (!name) {
            continue;
        }
        cookies[name] = decodeURIComponent(rest.join('='));
    }

    return cookies;
}
