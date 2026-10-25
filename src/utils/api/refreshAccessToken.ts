export async function refreshGithubToken(
    refreshToken: string
) {
    const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
            method: 'POST',
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
        }
    );

    // {
    //     provider: 'github',
    //     type: 'oauth',
    //     providerAccountId: '...',
    //     access_token: '...',
    //     expires_at: 1791159155,
    //     refresh_token: '...',
    //     refresh_token_expires_in: 15724800,
    //     token_type: 'bearer',
    //     scope: ''
    // }
    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(
            data.error_description || 'Failed to refresh GitHub token'
        );
    }

    return {
        accessToken: data.access_token,
        accessTokenExpiry: Date.now() + data.expires_in * 1000,
        refreshToken: data.refresh_token,
        refreshTokenExpiry: Date.now() + data.refresh_token_expires_in * 1000,
    };
}
