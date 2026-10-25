import { Document, model, Schema } from "mongoose";

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
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
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
      required: true,
    },
    accessTokenExpiry: {
      type: Number,
      required: true,
    },
    refreshToken: {
      type: String,
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