import { Document, model, Schema } from "mongoose";

import { encryptToken } from "../../utils/auth/tokenEncryption";

export interface IUser extends Document {
  githubUserId: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  accessToken: string;
  accessTokenExpiry: number;
  refreshToken: string;
  refreshTokenExpiry: number;
  tokenRefreshLockId?: string;
  tokenRefreshLockUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    tokenRefreshLockId: { type: String },
    tokenRefreshLockUntil: { type: Date },
    githubUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    githubLogin: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      default: null,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    htmlUrl: {
      type: String,
      default: null,
    },
    accessToken: {
      type: String,
      set: (value: string) => encryptToken(value, "accessToken"),
      required: true,
    },
    accessTokenExpiry: {
      type: Number,
      required: true,
    },
    refreshToken: {
      type: String,
      set: (value: string) => encryptToken(value, "refreshToken"),
      required: true,
    },
    refreshTokenExpiry: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const User = model<IUser>("User", userSchema);
