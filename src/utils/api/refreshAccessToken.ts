export async function refreshGithubToken(refreshToken: string) {
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams({
            client_id: process.env.GITHUB_CLIENT_ID!,
            client_secret: process.env.GITHUB_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error('GitHub token refresh returned invalid JSON');
    }
    if (!response.ok || !data || typeof data !== 'object' || data.error) {
        throw new Error('Failed to refresh GitHub token');
    }
    const now = Date.now();
    const accessTokenExpiry = now + data.expires_in * 1000;
    const refreshTokenExpiry = now + data.refresh_token_expires_in * 1000;
    if (
        typeof data.access_token !== 'string' || !data.access_token.trim() ||
        typeof data.refresh_token !== 'string' || !data.refresh_token.trim() ||
        typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        typeof data.refresh_token_expires_in !== 'number' || !Number.isFinite(data.refresh_token_expires_in) || data.refresh_token_expires_in <= 0 ||
        !Number.isFinite(accessTokenExpiry) || accessTokenExpiry <= now ||
        !Number.isFinite(refreshTokenExpiry) || refreshTokenExpiry <= now
    ) {
        throw new Error('GitHub token refresh returned invalid token data');
    }
    return {
        accessToken: data.access_token,
        accessTokenExpiry,
        refreshToken: data.refresh_token,
        refreshTokenExpiry,
    };
}
