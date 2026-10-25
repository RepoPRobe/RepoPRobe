declare global {
  namespace Express {
    interface AuthenticatedUser {
      userId: string;
      githubUserId: string;
      accessToken: string;
      accessTokenExpiry: number;
      refreshToken: string;
      refreshTokenExpiry: number;
    }

    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};